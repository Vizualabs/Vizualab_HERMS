import type { CustomerType, QuotationInput, SessionUser } from '@herms/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  auditLogs,
  customerPrices,
  customers,
  equipmentItems,
  orderLines,
  orders,
  outboxEvents,
  quotationLines,
  quotations,
  stores,
} from './schema'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

export type CommercialConfig = {
  timezone: string
  currency: string
  quotationExpiryDays: number
  quotationNumberPrefix: string
  orderNumberPrefix: string
}

export type PricedLine = {
  equipmentItemId: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export function resolveQuotationPricing(
  customerType: CustomerType,
  requestedLines: QuotationInput['lines'],
  fixedPrices: ReadonlyMap<string, number>,
): { lines: PricedLine[]; totalValueCents: number } {
  const lines = requestedLines.map((line) => {
    const unitPriceCents =
      customerType === 'recurring'
        ? fixedPrices.get(line.equipmentItemId)
        : line.manualUnitPriceCents
    if (unitPriceCents === undefined) {
      throw new DataConflictError(
        customerType === 'recurring'
          ? 'Every selected item requires a current customer fixed price'
          : 'Every selected item requires a manual unit price',
      )
    }
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new DataConflictError('Unit prices must be safe non-negative integers')
    }
    if (customerType === 'new' && unitPriceCents <= 0) {
      throw new DataConflictError('Manual unit prices must be greater than zero')
    }
    const lineTotalCents = line.quantity * unitPriceCents
    if (!Number.isSafeInteger(lineTotalCents)) throw new DataConflictError('A quotation line total is too large')
    return { equipmentItemId: line.equipmentItemId, quantity: line.quantity, unitPriceCents, lineTotalCents }
  })
  const totalValueCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  if (!Number.isSafeInteger(totalValueCents)) throw new DataConflictError('The quotation total is too large')
  return { lines, totalValueCents }
}

function auditSnapshot(value: object | null): Record<string, unknown> | null {
  return value ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : null
}

function numberYear(now: Date, timezone: string) {
  return new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: timezone }).format(now)
}

function formatNumber(prefix: string, year: string, sequence: bigint) {
  return `${prefix}-${year}-${sequence.toString().padStart(6, '0')}`
}

export function createCommercialService(db: Database, config: CommercialConfig) {
  async function nextNumber(kind: 'quotation' | 'order', now: Date) {
    const sequence = kind === 'quotation' ? 'quotation_number_seq' : 'order_number_seq'
    const result = await db.execute<{ value: string }>(sql.raw(`SELECT nextval('${sequence}')::text AS value`))
    const value = result.rows[0]?.value
    if (!value) throw new Error(`Could not allocate a ${kind} number`)
    return formatNumber(
      kind === 'quotation' ? config.quotationNumberPrefix : config.orderNumberPrefix,
      numberYear(now, config.timezone),
      BigInt(value),
    )
  }

  function storeCondition(actor: SessionUser) {
    return actor.storeId ? eq(customers.storeId, actor.storeId) : undefined
  }

  async function quotationHeader(id: string, actor: SessionUser) {
    const condition = storeCondition(actor)
    const [row] = await db
      .select({
        id: quotations.id,
        quotationNumber: quotations.quotationNumber,
        customerId: quotations.customerId,
        customerName: customers.name,
        customerType: customers.type,
        customerPhone: customers.phone,
        customerEmail: customers.email,
        customerAddress: customers.address,
        storeName: stores.name,
        storeAddress: stores.address,
        status: quotations.status,
        totalValueCents: quotations.totalValueCents,
        createdBy: quotations.createdBy,
        createdAt: quotations.createdAt,
        sentAt: quotations.sentAt,
        expiresAt: quotations.expiresAt,
        updatedAt: quotations.updatedAt,
      })
      .from(quotations)
      .innerJoin(customers, eq(quotations.customerId, customers.id))
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(condition ? and(eq(quotations.id, id), condition) : eq(quotations.id, id))
      .limit(1)
    if (!row) throw new DataNotFoundError('Quotation not found')
    return row
  }

  async function orderHeader(id: string, actor: SessionUser) {
    const condition = storeCondition(actor)
    const [row] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        quotationId: orders.quotationId,
        customerId: orders.customerId,
        customerName: customers.name,
        status: orders.status,
        totalValueCents: orders.totalValueCents,
        createdBy: orders.createdBy,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(condition ? and(eq(orders.id, id), condition) : eq(orders.id, id))
      .limit(1)
    if (!row) throw new DataNotFoundError('Order not found')
    return row
  }

  return {
    async listQuotations(actor: SessionUser) {
      const condition = storeCondition(actor)
      const query = db
        .select({
          id: quotations.id,
          quotationNumber: quotations.quotationNumber,
          customerId: quotations.customerId,
          customerName: customers.name,
          status: quotations.status,
          totalValueCents: quotations.totalValueCents,
          createdAt: quotations.createdAt,
          expiresAt: quotations.expiresAt,
        })
        .from(quotations)
        .innerJoin(customers, eq(quotations.customerId, customers.id))
        .orderBy(desc(quotations.createdAt))
      return condition ? query.where(condition) : query
    },

    async getQuotation(id: string, actor: SessionUser) {
      const header = await quotationHeader(id, actor)
      const lines = await db
        .select({
          id: quotationLines.id,
          equipmentItemId: quotationLines.equipmentItemId,
          equipmentName: equipmentItems.name,
          unitOfMeasure: equipmentItems.unitOfMeasure,
          quantity: quotationLines.quantity,
          unitPriceCents: quotationLines.unitPriceCents,
          lineTotalCents: quotationLines.lineTotalCents,
        })
        .from(quotationLines)
        .innerJoin(equipmentItems, eq(quotationLines.equipmentItemId, equipmentItems.id))
        .where(eq(quotationLines.quotationId, id))
        .orderBy(equipmentItems.name)
      return { ...header, currency: config.currency, timezone: config.timezone, lines }
    },

    async createQuotation(input: QuotationInput, actor: AuditActor) {
      const customerCondition = actor.storeId
        ? and(eq(customers.id, input.customerId), eq(customers.storeId, actor.storeId))
        : eq(customers.id, input.customerId)
      const [customer] = await db.select().from(customers).where(customerCondition).limit(1)
      if (!customer) throw new DataNotFoundError('Customer not found')

      const itemIds = input.lines.map((line) => line.equipmentItemId)
      const items = await db.select({ id: equipmentItems.id }).from(equipmentItems).where(inArray(equipmentItems.id, itemIds))
      if (items.length !== itemIds.length) throw new DataNotFoundError('One or more equipment items were not found')

      const prices = customer.type === 'recurring'
        ? await db
            .select({ equipmentItemId: customerPrices.equipmentItemId, unitPriceCents: customerPrices.unitPriceCents })
            .from(customerPrices)
            .where(and(eq(customerPrices.customerId, customer.id), isNull(customerPrices.effectiveTo), inArray(customerPrices.equipmentItemId, itemIds)))
        : []
      const priced = resolveQuotationPricing(
        customer.type,
        input.lines,
        new Map(prices.map((price) => [price.equipmentItemId, price.unitPriceCents])),
      )
      const now = new Date()
      const id = crypto.randomUUID()
      const quotationNumber = await nextNumber('quotation', now)
      const expiresAt = new Date(now.getTime() + config.quotationExpiryDays * 86_400_000)
      const quotation = {
        id,
        quotationNumber,
        customerId: customer.id,
        status: 'sent' as const,
        totalValueCents: priced.totalValueCents,
        createdBy: actor.id,
        createdAt: now,
        sentAt: now,
        expiresAt,
        updatedAt: now,
      }
      await db.batch([
        db.insert(quotations).values(quotation),
        db.insert(quotationLines).values(priced.lines.map((line) => ({ id: crypto.randomUUID(), quotationId: id, ...line }))),
        db.insert(outboxEvents).values({
          id: crypto.randomUUID(),
          eventType: 'quotation_created',
          aggregateType: 'quotation',
          aggregateId: id,
          idempotencyKey: `quotation_created:${id}`,
          payload: {
            quotationId: id,
            quotationNumber,
            customerId: customer.id,
            requestId: actor.requestId,
          },
        }),
        db.insert(auditLogs).values({
          actorType: 'user', actorId: actor.id, action: 'quotation.create', entityType: 'quotation', entityId: id,
          before: null, after: auditSnapshot(quotation), requestId: actor.requestId,
        }),
      ])
      return this.getQuotation(id, actor)
    },

    async rejectQuotation(id: string, actor: AuditActor) {
      const before = await quotationHeader(id, actor)
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may be rejected')
      const updatedAt = new Date()
      const [updated] = await db.batch([
        db.update(quotations).set({ status: 'rejected', updatedAt }).where(and(eq(quotations.id, id), eq(quotations.status, 'sent'), eq(quotations.updatedAt, before.updatedAt))).returning(),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'quotation.reject', 'quotation', ${id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${actor.requestId}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'rejected' AND ${quotations.updatedAt} = ${updatedAt}`),
      ])
      if (!updated[0]) throw new DataConflictError('The quotation changed concurrently; retry')
      return this.getQuotation(id, actor)
    },

    async expireQuotation(id: string, actor: AuditActor) {
      const before = await quotationHeader(id, actor)
      const now = new Date()
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may expire')
      if (!before.expiresAt || before.expiresAt > now) throw new DataConflictError('The quotation has not reached its expiry date')
      const [updated] = await db.batch([
        db.update(quotations).set({ status: 'expired', updatedAt: now }).where(and(eq(quotations.id, id), eq(quotations.status, 'sent'), eq(quotations.updatedAt, before.updatedAt))).returning(),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'quotation.expire', 'quotation', ${id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${actor.requestId}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'expired' AND ${quotations.updatedAt} = ${now}`),
      ])
      if (!updated[0]) throw new DataConflictError('The quotation changed concurrently; retry')
      return this.getQuotation(id, actor)
    },

    async acceptQuotation(id: string, actor: AuditActor) {
      const before = await quotationHeader(id, actor)
      const now = new Date()
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may be accepted')
      if (before.expiresAt && before.expiresAt <= now) throw new DataConflictError('An expired quotation cannot be accepted')
      const orderId = crypto.randomUUID()
      const orderNumber = await nextNumber('order', now)
      await db.batch([
        db.update(quotations).set({ status: 'accepted', updatedAt: now }).where(and(eq(quotations.id, id), eq(quotations.status, 'sent'), eq(quotations.updatedAt, before.updatedAt), sql`${quotations.expiresAt} > ${now}`)),
        db.execute(sql`INSERT INTO ${orders} (id, order_number, quotation_id, customer_id, status, total_value_cents, created_by, created_at, updated_at)
          SELECT ${orderId}::uuid, ${orderNumber}, ${id}::uuid, customer_id, 'open'::order_status, total_value_cents, ${actor.id}::uuid, ${now}, ${now}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'accepted' AND ${quotations.updatedAt} = ${now}`),
        db.execute(sql`INSERT INTO ${orderLines} (id, order_id, equipment_item_id, quantity, unit_price_cents, line_total_cents)
          SELECT gen_random_uuid(), ${orderId}::uuid, equipment_item_id, quantity, unit_price_cents, line_total_cents
          FROM ${quotationLines} WHERE quotation_id = ${id}::uuid AND EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId}::uuid)`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'quotation.accept', 'quotation', ${id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${actor.requestId}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'accepted' AND ${quotations.updatedAt} = ${now}`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'order.create', 'order', ${orderId}::uuid,
          NULL, to_jsonb("order".*), ${actor.requestId} FROM ${orders} WHERE ${orders.id} = ${orderId}::uuid`),
      ])
      const [created] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1)
      if (!created) throw new DataConflictError('The quotation changed concurrently; retry')
      return this.getOrder(orderId, actor)
    },

    async listOrders(actor: SessionUser) {
      const condition = storeCondition(actor)
      const query = db.select({
        id: orders.id, orderNumber: orders.orderNumber, quotationId: orders.quotationId,
        customerId: orders.customerId, customerName: customers.name, status: orders.status,
        totalValueCents: orders.totalValueCents, createdAt: orders.createdAt,
      }).from(orders).innerJoin(customers, eq(orders.customerId, customers.id)).orderBy(desc(orders.createdAt))
      return condition ? query.where(condition) : query
    },

    async getOrder(id: string, actor: SessionUser) {
      const header = await orderHeader(id, actor)
      const lines = await db.select({
        id: orderLines.id, equipmentItemId: orderLines.equipmentItemId,
        equipmentName: equipmentItems.name, unitOfMeasure: equipmentItems.unitOfMeasure,
        quantity: orderLines.quantity, unitPriceCents: orderLines.unitPriceCents,
        lineTotalCents: orderLines.lineTotalCents,
      }).from(orderLines).innerJoin(equipmentItems, eq(orderLines.equipmentItemId, equipmentItems.id))
        .where(eq(orderLines.orderId, id)).orderBy(equipmentItems.name)
      return { ...header, currency: config.currency, timezone: config.timezone, lines }
    },
  }
}

export type CommercialService = ReturnType<typeof createCommercialService>
