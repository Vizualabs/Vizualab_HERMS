import {
  calculateEscalatedPriceCents,
  type DashboardDiscrepancies,
  type DashboardEscalations,
  type DashboardFilters,
  type DashboardIncomeExpenses,
  type DashboardPayments,
  type DashboardRankings,
  type DashboardStock,
} from '@herms/shared'
import { asc, desc, eq, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  customers,
  dashboardDiscrepancyRollups,
  dashboardMonthlyRollups,
  dashboardStockRollups,
  equipmentItems,
  orders,
  priceHistory,
  users,
} from './schema'
import { DataConflictError } from './services'

export type DashboardConfig = {
  timezone: string
  currency: string
}

function safeInteger(value: unknown, label: string) {
  const decoded = Number(value ?? 0)
  if (!Number.isSafeInteger(decoded)) {
    throw new DataConflictError(`${label} is outside the supported integer range`)
  }
  return decoded
}

function monthInTimezone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) throw new DataConflictError('The dashboard month could not be resolved')
  return `${year}-${month}`
}

export function previousDashboardMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const previous = new Date(Date.UTC(year!, monthNumber! - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLastDate(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year!, monthNumber!, 0))
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
}

export function resolveDashboardFilters(
  filters: DashboardFilters,
  timezone: string,
  now = new Date(),
) {
  const month = filters.month ?? monthInTimezone(timezone, now)
  return {
    month,
    from: filters.from ?? `${month}-01`,
    to: filters.to ?? monthLastDate(month),
    customerId: filters.customerId ?? null,
    itemId: filters.itemId ?? null,
  }
}

type MonthlyRow = {
  month: string
  pendingAmountCents: number | string
  receivedAmountCents: number | string
  expenseAmountCents: number | string
}

export function createDashboardService(db: Database, config: DashboardConfig) {
  async function monthlyRows(month: string) {
    const previousMonth = previousDashboardMonth(month)
    const result = await db.execute<MonthlyRow>(sql`
      WITH requested("month") AS (
        VALUES (${`${month}-01`}::date), (${`${previousMonth}-01`}::date)
      )
      SELECT to_char(requested."month", 'YYYY-MM') AS "month",
        coalesce(sum(
          rollup."invoiced_amount_cents"
          + rollup."confirmed_claim_amount_cents"
          - rollup."received_payment_amount_cents"
        ) FILTER (WHERE rollup."month_start" <= requested."month"), 0)::bigint
          AS "pendingAmountCents",
        coalesce(sum(rollup."received_payment_amount_cents")
          FILTER (WHERE rollup."month_start" = requested."month"), 0)::bigint
          AS "receivedAmountCents",
        coalesce(sum(rollup."expense_amount_cents")
          FILTER (WHERE rollup."month_start" = requested."month"), 0)::bigint
          AS "expenseAmountCents"
      FROM requested
      LEFT JOIN ${dashboardMonthlyRollups} rollup
        ON rollup."month_start" <= requested."month"
      GROUP BY requested."month"
      ORDER BY requested."month" DESC
    `)
    const decoded = new Map(result.rows.map((row) => [row.month, {
      month: row.month,
      pendingAmountCents: safeInteger(row.pendingAmountCents, 'Pending payments'),
      receivedAmountCents: safeInteger(row.receivedAmountCents, 'Received payments'),
      expenseAmountCents: safeInteger(row.expenseAmountCents, 'Expenses'),
    }]))
    const empty = (target: string) => ({
      month: target,
      pendingAmountCents: 0,
      receivedAmountCents: 0,
      expenseAmountCents: 0,
    })
    return {
      current: decoded.get(month) ?? empty(month),
      previous: decoded.get(previousMonth) ?? empty(previousMonth),
    }
  }

  async function getStock(): Promise<DashboardStock> {
    const rows = await db
      .select({
        equipmentItemId: equipmentItems.id,
        equipmentName: equipmentItems.name,
        category: equipmentItems.category,
        unitOfMeasure: equipmentItems.unitOfMeasure,
        quantity: sql<number>`coalesce(${dashboardStockRollups.quantity}, 0)::bigint`,
        currentUnitPriceCents: equipmentItems.currentUnitPriceCents,
        valueCents: sql<number>`(
          coalesce(${dashboardStockRollups.quantity}, 0)
          * ${equipmentItems.currentUnitPriceCents}::bigint
        )::bigint`,
      })
      .from(equipmentItems)
      .leftJoin(
        dashboardStockRollups,
        eq(dashboardStockRollups.equipmentItemId, equipmentItems.id),
      )
      .orderBy(asc(equipmentItems.name))
    const items = rows.map((row) => ({
      ...row,
      quantity: safeInteger(row.quantity, 'Stock quantity'),
      valueCents: safeInteger(row.valueCents, 'Stock value'),
    }))
    return {
      asOf: new Date().toISOString(),
      currency: config.currency,
      totalQuantity: items.reduce((sum, row) => sum + row.quantity, 0),
      totalValueCents: items.reduce((sum, row) => sum + row.valueCents, 0),
      items,
    }
  }

  async function getPayments(month?: string): Promise<DashboardPayments> {
    const selectedMonth = month ?? monthInTimezone(config.timezone)
    const rows = await monthlyRows(selectedMonth)
    return {
      currency: config.currency,
      timezone: config.timezone,
      current: {
        month: rows.current.month,
        pendingAmountCents: rows.current.pendingAmountCents,
        receivedAmountCents: rows.current.receivedAmountCents,
      },
      previous: {
        month: rows.previous.month,
        pendingAmountCents: rows.previous.pendingAmountCents,
        receivedAmountCents: rows.previous.receivedAmountCents,
      },
    }
  }

  async function getIncomeExpenses(month?: string): Promise<DashboardIncomeExpenses> {
    const selectedMonth = month ?? monthInTimezone(config.timezone)
    const rows = await monthlyRows(selectedMonth)
    const period = (row: typeof rows.current) => ({
      month: row.month,
      incomeCents: row.receivedAmountCents,
      expenseCents: row.expenseAmountCents,
      netPositionCents: row.receivedAmountCents - row.expenseAmountCents,
    })
    return {
      currency: config.currency,
      timezone: config.timezone,
      current: period(rows.current),
      previous: period(rows.previous),
    }
  }

  function filterSql(filters: ReturnType<typeof resolveDashboardFilters>) {
    return sql`
      rollup."recorded_at" >= ${filters.from}::date::timestamp AT TIME ZONE ${config.timezone}
      AND rollup."recorded_at" < (${filters.to}::date + interval '1 day')::timestamp
        AT TIME ZONE ${config.timezone}
      ${filters.customerId ? sql`AND rollup."customer_id" = ${filters.customerId}::uuid` : sql``}
      ${filters.itemId ? sql`AND rollup."equipment_item_id" = ${filters.itemId}::uuid` : sql``}
    `
  }

  async function getDiscrepancies(
    input: DashboardFilters = {},
  ): Promise<DashboardDiscrepancies> {
    const filters = resolveDashboardFilters(input, config.timezone)
    const result = await db.execute<{
      id: string
      orderId: string | null
      orderNumber: string | null
      customerId: string | null
      customerName: string | null
      equipmentItemId: string
      equipmentName: string
      discrepancyType: 'missing' | 'damaged'
      status: DashboardDiscrepancies['rows'][number]['status']
      responsibleParty: DashboardDiscrepancies['rows'][number]['responsibleParty']
      quantity: number | string
      unitPriceCents: number | string
      valueCents: number | string
      reason: string | null
      recordedAt: Date | string
      approvedAt: Date | string
    }>(sql`
      SELECT rollup."discrepancy_id" AS "id",
        rollup."order_id" AS "orderId",
        rental_order."order_number" AS "orderNumber",
        rollup."customer_id" AS "customerId",
        customer."name" AS "customerName",
        rollup."equipment_item_id" AS "equipmentItemId",
        item."name" AS "equipmentName",
        rollup."discrepancy_type" AS "discrepancyType",
        rollup."status",
        rollup."responsible_party" AS "responsibleParty",
        rollup."quantity",
        rollup."unit_price_cents" AS "unitPriceCents",
        rollup."value_cents" AS "valueCents",
        rollup."reason",
        rollup."recorded_at" AS "recordedAt",
        rollup."approved_at" AS "approvedAt"
      FROM ${dashboardDiscrepancyRollups} rollup
      JOIN ${equipmentItems} item ON item."id" = rollup."equipment_item_id"
      LEFT JOIN ${customers} customer ON customer."id" = rollup."customer_id"
      LEFT JOIN ${orders} rental_order ON rental_order."id" = rollup."order_id"
      WHERE rollup."status" = 'open'
        AND ${filterSql(filters)}
      ORDER BY rollup."recorded_at" DESC, rollup."discrepancy_id" ASC
    `)
    const rows = result.rows.map((row) => ({
      ...row,
      quantity: safeInteger(row.quantity, 'Discrepancy quantity'),
      unitPriceCents: safeInteger(row.unitPriceCents, 'Discrepancy unit price'),
      valueCents: safeInteger(row.valueCents, 'Discrepancy value'),
      recordedAt: new Date(row.recordedAt).toISOString(),
      approvedAt: new Date(row.approvedAt).toISOString(),
    }))
    return {
      currency: config.currency,
      filters,
      openCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalValueCents: rows.reduce((sum, row) => sum + row.valueCents, 0),
      rows,
    }
  }

  async function getRankings(input: DashboardFilters = {}): Promise<DashboardRankings> {
    const filters = resolveDashboardFilters(input, config.timezone)
    const [itemRows, customerRows] = await Promise.all([
      db.execute<{
        id: string
        name: string
        caseCount: number | string
        quantity: number | string
        valueCents: number | string
      }>(sql`
        SELECT item."id", item."name",
          count(*)::integer AS "caseCount",
          sum(rollup."quantity")::bigint AS "quantity",
          sum(rollup."value_cents")::bigint AS "valueCents"
        FROM ${dashboardDiscrepancyRollups} rollup
        JOIN ${equipmentItems} item ON item."id" = rollup."equipment_item_id"
        WHERE ${filterSql(filters)}
        GROUP BY item."id", item."name"
        ORDER BY count(*) DESC, sum(rollup."quantity") DESC, item."name" ASC
        LIMIT 10
      `),
      db.execute<{
        id: string
        name: string
        caseCount: number | string
        quantity: number | string
        valueCents: number | string
      }>(sql`
        SELECT customer."id", customer."name",
          count(*)::integer AS "caseCount",
          sum(rollup."quantity")::bigint AS "quantity",
          sum(rollup."value_cents")::bigint AS "valueCents"
        FROM ${dashboardDiscrepancyRollups} rollup
        JOIN ${customers} customer ON customer."id" = rollup."customer_id"
        WHERE ${filterSql(filters)}
        GROUP BY customer."id", customer."name"
        ORDER BY count(*) DESC, sum(rollup."quantity") DESC, customer."name" ASC
        LIMIT 10
      `),
    ])
    const decode = (row: (typeof itemRows.rows)[number]) => ({
      ...row,
      caseCount: safeInteger(row.caseCount, 'Ranking case count'),
      quantity: safeInteger(row.quantity, 'Ranking quantity'),
      valueCents: safeInteger(row.valueCents, 'Ranking value'),
    })
    return {
      currency: config.currency,
      limit: 10,
      items: itemRows.rows.map(decode),
      customers: customerRows.rows.map(decode),
    }
  }

  async function getEscalations(): Promise<DashboardEscalations> {
    const [historyRows, previewRows] = await Promise.all([
      db
        .select({
          effectiveDate: priceHistory.effectiveDate,
          ownerId: priceHistory.createdBy,
          ownerName: sql<string>`coalesce(${users.name}, 'Unknown owner')`,
          itemCount: sql<number>`count(*)::integer`,
          previousValueCents: sql<number>`coalesce(sum(${priceHistory.oldPriceCents}), 0)::bigint`,
          escalatedValueCents: sql<number>`sum(${priceHistory.newPriceCents})::bigint`,
        })
        .from(priceHistory)
        .leftJoin(users, eq(priceHistory.createdBy, users.id))
        .where(eq(priceHistory.reason, 'owner_escalation'))
        .groupBy(priceHistory.effectiveDate, priceHistory.createdBy, users.name)
        .orderBy(desc(priceHistory.effectiveDate))
        .limit(10),
      db
        .select({
          currentUnitPriceCents: equipmentItems.currentUnitPriceCents,
        })
        .from(equipmentItems),
    ])
    const history = historyRows.map((row) => ({
      effectiveDate: row.effectiveDate.toISOString(),
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      itemCount: safeInteger(row.itemCount, 'Escalation item count'),
      previousValueCents: safeInteger(row.previousValueCents, 'Previous price book value'),
      escalatedValueCents: safeInteger(row.escalatedValueCents, 'Escalated price book value'),
    }))
    const currentValueCents = previewRows.reduce(
      (sum, row) => sum + row.currentUnitPriceCents,
      0,
    )
    const escalatedValueCents = previewRows.reduce(
      (sum, row) => sum + calculateEscalatedPriceCents(row.currentUnitPriceCents),
      0,
    )
    return {
      currency: config.currency,
      percentage: 10,
      lastEscalation: history[0] ?? null,
      history,
      preview: {
        itemCount: previewRows.length,
        currentValueCents,
        escalatedValueCents,
      },
    }
  }

  async function getFilterOptions() {
    const [customerRows, itemRows] = await Promise.all([
      db.select({ id: customers.id, name: customers.name })
        .from(customers)
        .orderBy(asc(customers.name)),
      db.select({ id: equipmentItems.id, name: equipmentItems.name })
        .from(equipmentItems)
        .orderBy(asc(equipmentItems.name)),
    ])
    return { customers: customerRows, items: itemRows }
  }

  async function getReport(input: DashboardFilters = {}, includeEscalations = false) {
    const filters = resolveDashboardFilters(input, config.timezone)
    const resolvedInput = {
      month: filters.month,
      from: filters.from,
      to: filters.to,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.itemId ? { itemId: filters.itemId } : {}),
    }
    const [stock, payments, incomeExpenses, discrepancies, rankings, escalations] =
      await Promise.all([
        getStock(),
        getPayments(filters.month),
        getIncomeExpenses(filters.month),
        getDiscrepancies(resolvedInput),
        getRankings(resolvedInput),
        includeEscalations ? getEscalations() : Promise.resolve(null),
      ])
    return {
      generatedAt: new Date().toISOString(),
      filters,
      stock,
      payments,
      incomeExpenses,
      discrepancies,
      rankings,
      escalations,
    }
  }

  return {
    getStock,
    getPayments,
    getIncomeExpenses,
    getDiscrepancies,
    getRankings,
    getFilterOptions,
    getEscalations,
    getReport,
  }
}

export type DashboardService = ReturnType<typeof createDashboardService>
export type DashboardReport = Awaited<ReturnType<DashboardService['getReport']>>
