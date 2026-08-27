import type {
  ExpenseInput,
  PaymentInput,
  SessionUser,
} from '@herms/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  auditLogs,
  customers,
  damageClaims,
  equipmentItems,
  expenses,
  orderLines,
  orders,
  payments,
} from './schema'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

export type FinanceConfig = {
  timezone: string
  currency: string
}

function assertSafeMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DataConflictError(`${label} is outside the supported integer money range`)
  }
  return value
}

function storeCondition(actor: SessionUser) {
  return actor.storeId ? eq(customers.storeId, actor.storeId) : undefined
}

export function calculateInvoiceTotals(
  lines: ReadonlyArray<{ lineTotalCents: number }>,
  paidAmountCents: number,
  claimAmountCents = 0,
) {
  const orderValueCents = lines.reduce(
    (sum, line) => assertSafeMoney(sum + line.lineTotalCents, 'Invoice value'),
    0,
  )
  const claimValue = assertSafeMoney(claimAmountCents, 'Confirmed claim value')
  const invoiceValueCents = assertSafeMoney(
    orderValueCents + claimValue,
    'Invoice and claim value',
  )
  const paid = assertSafeMoney(paidAmountCents, 'Paid amount')
  if (paid > invoiceValueCents) {
    throw new DataConflictError('Recorded payments exceed the frozen invoice value')
  }
  return {
    orderValueCents,
    claimAmountCents: claimValue,
    invoiceValueCents,
    paidAmountCents: paid,
    outstandingBalanceCents: invoiceValueCents - paid,
  }
}

export function createFinanceService(db: Database, config: FinanceConfig) {
  async function orderHeader(id: string, actor: SessionUser) {
    const scoped = storeCondition(actor)
    const [row] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        quotationId: orders.quotationId,
        customerId: orders.customerId,
        customerName: customers.name,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(scoped ? and(eq(orders.id, id), scoped) : eq(orders.id, id))
      .limit(1)
    if (!row) throw new DataNotFoundError('Order not found')
    return row
  }

  async function getInvoice(id: string, actor: SessionUser) {
    const header = await orderHeader(id, actor)
    const [lines, paidRows, claimRows] = await Promise.all([
      db
        .select({
          id: orderLines.id,
          equipmentItemId: orderLines.equipmentItemId,
          equipmentName: equipmentItems.name,
          unitOfMeasure: equipmentItems.unitOfMeasure,
          quantity: orderLines.quantity,
          unitPriceCents: orderLines.unitPriceCents,
          lineTotalCents: orderLines.lineTotalCents,
        })
        .from(orderLines)
        .innerJoin(equipmentItems, eq(orderLines.equipmentItemId, equipmentItems.id))
        .where(eq(orderLines.orderId, id))
        .orderBy(asc(equipmentItems.name)),
      db
        .select({
          paidAmountCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::integer`,
        })
        .from(payments)
        .where(eq(payments.orderId, id)),
      db
        .select({
          claimAmountCents: sql<number>`coalesce(sum(${damageClaims.claimAmountCents}), 0)::integer`,
        })
        .from(damageClaims)
        .where(and(eq(damageClaims.orderId, id), eq(damageClaims.status, 'confirmed'))),
    ])
    const totals = calculateInvoiceTotals(
      lines,
      paidRows[0]?.paidAmountCents ?? 0,
      claimRows[0]?.claimAmountCents ?? 0,
    )
    return { ...header, ...totals, currency: config.currency, lines }
  }

  return {
    getInvoice,

    async recordPayment(input: PaymentInput, actor: AuditActor) {
      const invoice = await getInvoice(input.orderId, actor)
      if (invoice.status === 'cancelled') {
        throw new DataConflictError('Payments cannot be recorded against a cancelled order')
      }
      if (input.amountCents > invoice.outstandingBalanceCents) {
        throw new DataConflictError('Payment amount cannot exceed the order outstanding balance')
      }

      const id = crypto.randomUUID()
      const paymentDate = new Date(input.paymentDate)
      const storeScope = actor.storeId
        ? sql`AND customer.store_id = ${actor.storeId}::uuid`
        : sql``
      const result = await db.execute<{
        id: string
        orderId: string
        customerId: string
        amountCents: number
        paymentDate: Date
        method: PaymentInput['method']
        createdBy: string | null
        createdAt: Date
      }>(sql`
        WITH payment_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${input.orderId}, 0))
        ),
        eligible AS (
          SELECT customer.id AS customer_id
          FROM ${orders} AS rental_order
          INNER JOIN ${customers} AS customer ON customer.id = rental_order.customer_id
          CROSS JOIN payment_lock
          WHERE rental_order.id = ${input.orderId}::uuid
            AND rental_order.status <> 'cancelled'
            ${storeScope}
            AND ${input.amountCents} <= (
              SELECT coalesce(sum(order_line.line_total_cents), 0)
              FROM ${orderLines} AS order_line
              WHERE order_line.order_id = rental_order.id
            ) + (
              SELECT coalesce(sum(claim.claim_amount_cents), 0)
              FROM ${damageClaims} AS claim
              WHERE claim.order_id = rental_order.id AND claim.status = 'confirmed'
            ) - (
              SELECT coalesce(sum(existing_payment.amount_cents), 0)
              FROM ${payments} AS existing_payment
              WHERE existing_payment.order_id = rental_order.id
            )
            AND customer.outstanding_balance_cents >= ${input.amountCents}
        ),
        inserted AS (
          INSERT INTO ${payments} (
            id, order_id, customer_id, amount_cents, payment_date, method, created_by
          )
          SELECT
            ${id}::uuid,
            ${input.orderId}::uuid,
            eligible.customer_id,
            ${input.amountCents},
            ${paymentDate},
            ${input.method}::payment_method,
            ${actor.id}::uuid
          FROM eligible
          RETURNING *
        ),
        updated_customer AS (
          UPDATE ${customers} AS customer
          SET
            outstanding_balance_cents = customer.outstanding_balance_cents - inserted.amount_cents,
            updated_at = now()
          FROM inserted
          WHERE customer.id = inserted.customer_id
          RETURNING customer.id
        ),
        audited AS (
          INSERT INTO ${auditLogs} (
            actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
          )
          SELECT
            'user'::audit_actor_type,
            ${actor.id}::uuid,
            'payment.create',
            'payment',
            inserted.id,
            NULL,
            to_jsonb(inserted.*),
            ${actor.requestId}
          FROM inserted
          INNER JOIN updated_customer ON updated_customer.id = inserted.customer_id
        )
        SELECT
          inserted.id,
          inserted.order_id AS "orderId",
          inserted.customer_id AS "customerId",
          inserted.amount_cents AS "amountCents",
          inserted.payment_date AS "paymentDate",
          inserted.method,
          inserted.created_by AS "createdBy",
          inserted.created_at AS "createdAt"
        FROM inserted
        INNER JOIN updated_customer ON updated_customer.id = inserted.customer_id
      `)
      const created = result.rows[0]
      if (!created) {
        throw new DataConflictError(
          'The order balance changed before this payment was recorded; refresh and retry',
        )
      }
      return created
    },

    async getCustomerBalance(id: string, actor: SessionUser) {
      const scoped = storeCondition(actor)
      const [customer] = await db
        .select({
          id: customers.id,
          name: customers.name,
          outstandingBalanceCents: customers.outstandingBalanceCents,
        })
        .from(customers)
        .where(scoped ? and(eq(customers.id, id), scoped) : eq(customers.id, id))
        .limit(1)
      if (!customer) throw new DataNotFoundError('Customer not found')

      const rows = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          invoiceValueCents: sql<number>`coalesce((
            SELECT sum(order_line.line_total_cents)
            FROM ${orderLines} AS order_line
            WHERE order_line.order_id = ${orders.id}
          ), 0)::integer + coalesce((
            SELECT sum(claim.claim_amount_cents)
            FROM ${damageClaims} AS claim
            WHERE claim.order_id = ${orders.id} AND claim.status = 'confirmed'
          ), 0)::integer`,
          orderValueCents: sql<number>`coalesce((
            SELECT sum(order_line.line_total_cents)
            FROM ${orderLines} AS order_line
            WHERE order_line.order_id = ${orders.id}
          ), 0)::integer`,
          claimAmountCents: sql<number>`coalesce((
            SELECT sum(claim.claim_amount_cents)
            FROM ${damageClaims} AS claim
            WHERE claim.order_id = ${orders.id} AND claim.status = 'confirmed'
          ), 0)::integer`,
          paidAmountCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::integer`,
        })
        .from(orders)
        .leftJoin(payments, eq(payments.orderId, orders.id))
        .where(and(eq(orders.customerId, id), ne(orders.status, 'cancelled')))
        .groupBy(orders.id)
        .orderBy(asc(orders.createdAt))
      const orderBalances = rows.map((row) => ({
        ...row,
        outstandingBalanceCents: assertSafeMoney(
          row.invoiceValueCents - row.paidAmountCents,
          'Order outstanding balance',
        ),
      }))
      const derivedBalance = orderBalances.reduce(
        (sum, row) => assertSafeMoney(sum + row.outstandingBalanceCents, 'Customer balance'),
        0,
      )
      if (derivedBalance !== customer.outstandingBalanceCents) {
        throw new DataConflictError('Customer balance cache is out of sync with its orders')
      }
      return { ...customer, currency: config.currency, orders: orderBalances }
    },

    async recordExpense(input: ExpenseInput, actor: AuditActor) {
      const expense = {
        id: crypto.randomUUID(),
        category: input.category,
        amountCents: input.amountCents,
        expenseDate: new Date(input.expenseDate),
        description: input.description || null,
        createdBy: actor.id,
        createdAt: new Date(),
      }
      await db.batch([
        db.insert(expenses).values(expense),
        db.insert(auditLogs).values({
          actorType: 'user',
          actorId: actor.id,
          action: 'expense.create',
          entityType: 'expense',
          entityId: expense.id,
          before: null,
          after: {
            ...expense,
            expenseDate: expense.expenseDate.toISOString(),
            createdAt: expense.createdAt.toISOString(),
          },
          requestId: actor.requestId,
        }),
      ])
      return expense
    },

    async getMonthly(month: string) {
      const monthStart = `${month}-01`
      const [incomeRows, expenseRows] = await Promise.all([
        db
          .select({
            value: sql<number>`coalesce(sum(${payments.amountCents}), 0)::integer`,
          })
          .from(payments)
          .where(sql`
            ${payments.paymentDate} >= ${monthStart}::date::timestamp AT TIME ZONE ${config.timezone}
            AND ${payments.paymentDate} < (${monthStart}::date + interval '1 month')::timestamp AT TIME ZONE ${config.timezone}
          `),
        db
          .select({
            value: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::integer`,
          })
          .from(expenses)
          .where(sql`
            ${expenses.expenseDate} >= ${monthStart}::date::timestamp AT TIME ZONE ${config.timezone}
            AND ${expenses.expenseDate} < (${monthStart}::date + interval '1 month')::timestamp AT TIME ZONE ${config.timezone}
          `),
      ])
      const incomeCents = assertSafeMoney(incomeRows[0]?.value ?? 0, 'Monthly income')
      const expenseCents = assertSafeMoney(expenseRows[0]?.value ?? 0, 'Monthly expenses')
      return {
        month,
        incomeCents,
        expenseCents,
        netPositionCents: incomeCents - expenseCents,
        currency: config.currency,
        timezone: config.timezone,
      }
    },
  }
}

export type FinanceService = ReturnType<typeof createFinanceService>
