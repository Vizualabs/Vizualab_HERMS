import { Buffer } from 'node:buffer'

import type { QuotationInput, QuotationPricingMode, QuotationStatus, SessionUser } from '@herms/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Database } from './client'
import {
  auditLogs,
  customerPrices,
  customers,
  deliveryNoteLines,
  deliveryNotes,
  equipmentItems,
  noteTokens,
  orderLines,
  orders,
  outboxEvents,
  quotationLines,
  quotations,
  retentionNoteLines,
  retentionNotes,
  stockLedger,
  stores,
} from './schema'
import { DataConflictError, DataNotFoundError, type AuditActor } from './services'

export type CommercialConfig = {
  timezone: string
  currency: string
  quotationExpiryDays: number
  quotationNumberPrefix: string
  orderNumberPrefix: string
  tokenSecret: string
  publicAppUrl: string
}

export type PricedLine = {
  equipmentItemId: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export function resolveQuotationPricing(
  pricingMode: QuotationPricingMode,
  requestedLines: QuotationInput['lines'],
  standardPrices: ReadonlyMap<string, number>,
): { lines: PricedLine[]; totalValueCents: number } {
  const lines = requestedLines.map((line) => {
    const unitPriceCents =
      pricingMode === 'standard'
        ? standardPrices.get(line.equipmentItemId)
        : line.manualUnitPriceCents
    if (unitPriceCents === undefined) {
      throw new DataConflictError(
        pricingMode === 'standard'
          ? 'Every selected item requires a registered standard price'
          : 'Every selected item requires a manual unit price',
      )
    }
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new DataConflictError('Unit prices must be safe non-negative integers')
    }
    if (unitPriceCents <= 0) {
      throw new DataConflictError('Unit prices must be greater than zero')
    }
    const lineTotalCents = line.quantity * unitPriceCents
    if (!Number.isSafeInteger(lineTotalCents)) throw new DataConflictError('A quotation line total is too large')
    return { equipmentItemId: line.equipmentItemId, quantity: line.quantity, unitPriceCents, lineTotalCents }
  })
  const totalValueCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
  if (!Number.isSafeInteger(totalValueCents)) throw new DataConflictError('The quotation total is too large')
  return { lines, totalValueCents }
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Buffer.from(signature).toString('base64url')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Buffer.from(digest).toString('hex')
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

function effectiveStatus(status: QuotationStatus, expiresAt: Date | null, now = new Date()): QuotationStatus {
  return status === 'sent' && expiresAt && expiresAt <= now ? 'expired' : status
}

export function createCommercialService(db: Database, config: CommercialConfig) {
  async function rawToken(id: string) {
    return `${id}.${await hmac(config.tokenSecret, id)}`
  }

  function quotationLink(raw: string) {
    return `${config.publicAppUrl.replace(/\/$/, '')}/quotes/${raw}`
  }

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
        pricingMode: quotations.pricingMode,
        totalValueCents: quotations.totalValueCents,
        createdBy: quotations.createdBy,
        createdAt: quotations.createdAt,
        sentAt: quotations.sentAt,
        expiresAt: quotations.expiresAt,
        updatedAt: quotations.updatedAt,
        lineCount: sql<number>`(SELECT COUNT(*)::int FROM ${quotationLines} WHERE ${quotationLines.quotationId} = ${quotations.id})`,
        orderId: sql<string | null>`(SELECT id FROM ${orders} WHERE ${orders.quotationId} = ${quotations.id} LIMIT 1)`,
      })
      .from(quotations)
      .innerJoin(customers, eq(quotations.customerId, customers.id))
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(condition ? and(eq(quotations.id, id), condition) : eq(quotations.id, id))
      .limit(1)
    if (!row) throw new DataNotFoundError('Quotation not found')
    return row
  }

  async function publicQuotation(id: string) {
    const [header] = await db.select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      customerName: customers.name,
      status: quotations.status,
      totalValueCents: quotations.totalValueCents,
      sentAt: quotations.sentAt,
      expiresAt: quotations.expiresAt,
    }).from(quotations).innerJoin(customers, eq(quotations.customerId, customers.id))
      .where(eq(quotations.id, id)).limit(1)
    if (!header) throw new DataNotFoundError('Quotation not found')
    const lines = await db.select({
      equipmentName: equipmentItems.name,
      unitOfMeasure: equipmentItems.unitOfMeasure,
      quantity: quotationLines.quantity,
      unitPriceCents: quotationLines.unitPriceCents,
      lineTotalCents: quotationLines.lineTotalCents,
    }).from(quotationLines).innerJoin(equipmentItems, eq(quotationLines.equipmentItemId, equipmentItems.id))
      .where(eq(quotationLines.quotationId, id)).orderBy(equipmentItems.name)
    const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
      .from(orders).where(eq(orders.quotationId, id)).limit(1)
    return { ...header, status: effectiveStatus(header.status, header.expiresAt), currency: config.currency, lines, order: order ?? null }
  }

  async function tokenRecord(raw: string, requestId: string) {
    const [token] = await db.select().from(noteTokens)
      .where(and(eq(noteTokens.tokenHash, await sha256(raw)), eq(noteTokens.noteType, 'quotation'))).limit(1)
    if (!token) {
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: null, action: 'quotation_token.denied', entityType: 'quotation',
        entityId: null, before: null, after: { reason: 'not_found' }, requestId,
      })
      throw new DataNotFoundError('Quotation link not found')
    }
    if (token.status === 'revoked' || token.expiresAt <= new Date()) {
      await db.insert(auditLogs).values({
        actorType: 'token', actorId: token.id, action: 'quotation_token.denied', entityType: 'quotation',
        entityId: token.noteId, before: null,
        after: { reason: token.status === 'revoked' ? 'revoked' : 'expired' }, requestId,
      })
      throw new DataConflictError('The quotation link is expired or unavailable')
    }
    return token
  }

  function customerQuotationView(quotation: Awaited<ReturnType<typeof publicQuotation>>, tokenExpiresAt: Date) {
    const { id: _quotationId, order, ...safeQuotation } = quotation
    return {
      ...safeQuotation,
      order: order ? { orderNumber: order.orderNumber, status: order.status } : null,
      tokenExpiresAt,
    }
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
        storeId: customers.storeId,
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
          pricingMode: quotations.pricingMode,
          totalValueCents: quotations.totalValueCents,
          createdAt: quotations.createdAt,
          expiresAt: quotations.expiresAt,
          updatedAt: quotations.updatedAt,
          lineCount: sql<number>`(SELECT COUNT(*)::int FROM ${quotationLines} WHERE ${quotationLines.quotationId} = ${quotations.id})`,
          orderId: sql<string | null>`(SELECT id FROM ${orders} WHERE ${orders.quotationId} = ${quotations.id} LIMIT 1)`,
        })
        .from(quotations)
        .innerJoin(customers, eq(quotations.customerId, customers.id))
        .orderBy(desc(quotations.createdAt))
      const rows = await (condition ? query.where(condition) : query)
      return rows.map((row) => ({ ...row, status: effectiveStatus(row.status, row.expiresAt) }))
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
      return { ...header, status: effectiveStatus(header.status, header.expiresAt), currency: config.currency, timezone: config.timezone, lines }
    },

    async createQuotation(input: QuotationInput, actor: AuditActor) {
      const customerCondition = actor.storeId
        ? and(eq(customers.id, input.customerId), eq(customers.storeId, actor.storeId))
        : eq(customers.id, input.customerId)
      const [customer] = await db.select().from(customers).where(customerCondition).limit(1)
      if (!customer) throw new DataNotFoundError('Customer not found')

      const itemIds = input.lines.map((line) => line.equipmentItemId)
      const items = await db.select({
        id: equipmentItems.id,
        name: equipmentItems.name,
        unitPriceCents: equipmentItems.currentUnitPriceCents,
      })
        .from(equipmentItems).where(inArray(equipmentItems.id, itemIds))
      if (items.length !== itemIds.length) throw new DataNotFoundError('One or more equipment items were not found')

      const stockRows = await db.select({
        equipmentItemId: stockLedger.equipmentItemId,
        quantity: sql<number>`COALESCE(SUM(${stockLedger.quantityDelta}), 0)::int`,
      }).from(stockLedger)
        .where(and(
          eq(stockLedger.storeId, customer.storeId),
          inArray(stockLedger.equipmentItemId, itemIds),
        ))
        .groupBy(stockLedger.equipmentItemId)
      const availableByItem = new Map(items.map((item) => [item.id, 0]))
      for (const row of stockRows) {
        availableByItem.set(row.equipmentItemId, Number(row.quantity))
      }
      const namesByItem = new Map(items.map((item) => [item.id, item.name]))
      for (const line of input.lines) {
        const available = availableByItem.get(line.equipmentItemId) ?? 0
        if (line.quantity > available) {
          const name = namesByItem.get(line.equipmentItemId) ?? 'this item'
          throw new DataConflictError(
            `Not enough stock for ${name}. Available: ${available}.`,
          )
        }
      }

      const prices = await db
            .select({ equipmentItemId: customerPrices.equipmentItemId, unitPriceCents: customerPrices.unitPriceCents })
            .from(customerPrices)
            .where(and(eq(customerPrices.customerId, customer.id), isNull(customerPrices.effectiveTo), inArray(customerPrices.equipmentItemId, itemIds)))
      const standardPrices = new Map(items.map((item) => [item.id, item.unitPriceCents]))
      prices.forEach((price) => standardPrices.set(price.equipmentItemId, price.unitPriceCents))
      const priced = resolveQuotationPricing(
        input.pricingMode,
        input.lines,
        standardPrices,
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
        pricingMode: input.pricingMode,
        totalValueCents: priced.totalValueCents,
        createdBy: actor.id,
        createdAt: now,
        sentAt: now,
        expiresAt,
        updatedAt: now,
      }
      const tokenId = crypto.randomUUID()
      const raw = await rawToken(tokenId)
      await db.batch([
        db.insert(quotations).values(quotation),
        db.insert(quotationLines).values(priced.lines.map((line) => ({ id: crypto.randomUUID(), quotationId: id, ...line }))),
        db.insert(noteTokens).values({
          id: tokenId, tokenHash: await sha256(raw), noteType: 'quotation', noteId: id,
          status: 'active', expiresAt, usedAt: null, createdBy: actor.id, createdAt: now,
        }),
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
      return { ...await this.getQuotation(id, actor), submissionLink: quotationLink(raw) }
    },

    async getQuotationLink(id: string, actor: AuditActor) {
      const quotation = await quotationHeader(id, actor)
      if (quotation.status !== 'sent' || !quotation.expiresAt || quotation.expiresAt <= new Date()) {
        throw new DataConflictError('Only a current sent quotation can be shared')
      }
      const [token] = await db.select().from(noteTokens).where(and(
        eq(noteTokens.noteType, 'quotation'), eq(noteTokens.noteId, id), eq(noteTokens.status, 'active'),
      )).limit(1)
      if (!token || token.expiresAt <= new Date()) throw new DataConflictError('The quotation link has expired')
      return { submissionLink: quotationLink(await rawToken(token.id)), expiresAt: token.expiresAt }
    },

    async readQuotationByToken(raw: string, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const quotation = await publicQuotation(token.noteId)
      if (quotation.status === 'rejected' || quotation.status === 'expired') {
        throw new DataConflictError('The quotation is no longer available')
      }
      return customerQuotationView(quotation, token.expiresAt)
    },

    async acceptQuotationByToken(raw: string, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const before = await publicQuotation(token.noteId)
      const now = new Date()
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may be accepted')
      if (!before.expiresAt || before.expiresAt <= now) throw new DataConflictError('An expired quotation cannot be accepted')
      const [updated] = await db.batch([
        db.update(quotations).set({ status: 'accepted', updatedAt: now }).where(and(
          eq(quotations.id, before.id), eq(quotations.status, 'sent'), sql`${quotations.expiresAt} > ${now}`,
        )).returning(),
        db.execute(sql`UPDATE ${noteTokens} SET status = 'used', used_at = ${now}
          WHERE id = ${token.id}::uuid AND EXISTS (
            SELECT 1 FROM ${quotations} WHERE id = ${before.id}::uuid AND status = 'accepted' AND updated_at = ${now}
          )`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'token'::audit_actor_type, ${token.id}::uuid, 'quotation.accept', 'quotation', ${before.id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${requestId}
          FROM ${quotations} WHERE id = ${before.id}::uuid AND status = 'accepted' AND updated_at = ${now}`),
      ])
      if (!updated[0]) throw new DataConflictError('The quotation changed; reload and retry')
      return customerQuotationView(await publicQuotation(before.id), token.expiresAt)
    },

    async rejectQuotationByToken(raw: string, requestId: string) {
      const token = await tokenRecord(raw, requestId)
      const before = await publicQuotation(token.noteId)
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may be rejected')
      const now = new Date()
      const [updated] = await db.batch([
        db.update(quotations).set({ status: 'rejected', updatedAt: now })
          .where(and(eq(quotations.id, before.id), eq(quotations.status, 'sent'))).returning(),
        db.execute(sql`UPDATE ${noteTokens} SET status = 'revoked'
          WHERE note_type = 'quotation' AND note_id = ${before.id}::uuid AND EXISTS (
            SELECT 1 FROM ${quotations} WHERE id = ${before.id}::uuid AND status = 'rejected' AND updated_at = ${now}
          )`),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'token'::audit_actor_type, ${token.id}::uuid, 'quotation.reject', 'quotation', ${before.id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${requestId}
          FROM ${quotations} WHERE id = ${before.id}::uuid AND status = 'rejected' AND updated_at = ${now}`),
      ])
      if (!updated[0]) throw new DataConflictError('The quotation changed; reload and retry')
      return customerQuotationView({ ...before, status: 'rejected' as const }, token.expiresAt)
    },

    async rejectQuotation(id: string, actor: AuditActor) {
      const before = await quotationHeader(id, actor)
      if (before.status !== 'sent') throw new DataConflictError('Only a sent quotation may be rejected')
      if (!before.expiresAt || before.expiresAt <= new Date()) throw new DataConflictError('An expired quotation cannot be rejected')
      const updatedAt = new Date()
      const [updated] = await db.batch([
        db.update(quotations).set({ status: 'rejected', updatedAt }).where(and(eq(quotations.id, id), eq(quotations.status, 'sent'), eq(quotations.updatedAt, before.updatedAt))).returning(),
        db.update(noteTokens).set({ status: 'revoked' }).where(and(eq(noteTokens.noteType, 'quotation'), eq(noteTokens.noteId, id))),
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
        db.update(noteTokens).set({ status: 'revoked' }).where(and(eq(noteTokens.noteType, 'quotation'), eq(noteTokens.noteId, id))),
        db.execute(sql`INSERT INTO ${auditLogs} (actor_type, actor_id, action, entity_type, entity_id, before, after, request_id)
          SELECT 'user'::audit_actor_type, ${actor.id}::uuid, 'quotation.expire', 'quotation', ${id}::uuid,
          ${JSON.stringify(auditSnapshot(before))}::jsonb, to_jsonb(quotation.*), ${actor.requestId}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'expired' AND ${quotations.updatedAt} = ${now}`),
      ])
      if (!updated[0]) throw new DataConflictError('The quotation changed concurrently; retry')
      return this.getQuotation(id, actor)
    },

    async convertQuotationToOrder(id: string, actor: AuditActor) {
      const before = await quotationHeader(id, actor)
      const now = new Date()
      if (before.status !== 'accepted') throw new DataConflictError('Only an accepted quotation may be converted to an order')
      const [existing] = await db.select({ id: orders.id }).from(orders).where(eq(orders.quotationId, id)).limit(1)
      if (existing) throw new DataConflictError('This quotation has already been converted to an order')
      const orderId = crypto.randomUUID()
      const orderNumber = await nextNumber('order', now)
      await db.batch([
        db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`),
        db.execute(sql`INSERT INTO ${orders} (id, order_number, quotation_id, customer_id, status, total_value_cents, created_by, created_at, updated_at)
          SELECT ${orderId}::uuid, ${orderNumber}, ${id}::uuid, customer_id, 'open'::order_status, total_value_cents, ${actor.id}::uuid, ${now}, ${now}
          FROM ${quotations} WHERE ${quotations.id} = ${id}::uuid AND ${quotations.status} = 'accepted'
            AND NOT EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.quotationId} = ${id}::uuid)`),
        db.execute(sql`INSERT INTO ${orderLines} (id, order_id, equipment_item_id, quantity, unit_price_cents, line_total_cents)
          SELECT gen_random_uuid(), ${orderId}::uuid, equipment_item_id, quantity, unit_price_cents, line_total_cents
          FROM ${quotationLines} WHERE quotation_id = ${id}::uuid AND EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId}::uuid)`),
        db.execute(sql`UPDATE ${customers}
          SET outstanding_balance_cents = outstanding_balance_cents + ${before.totalValueCents},
              updated_at = ${now}
          WHERE id = ${before.customerId}::uuid
            AND EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId}::uuid)`),
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
        allocatedDeliveryQty: sql<number>`COALESCE((
          SELECT SUM(delivery_line.issued_qty)
          FROM ${deliveryNoteLines} delivery_line
          JOIN ${deliveryNotes} delivery_note ON delivery_note.id = delivery_line.delivery_note_id
          WHERE delivery_note.order_id = ${id}::uuid
            AND delivery_note.status <> 'rejected'
            AND delivery_line.equipment_item_id = ${orderLines.equipmentItemId}
        ), 0)::int`,
        approvedDeliveredQty: sql<number>`COALESCE((
          SELECT SUM(delivery_line.counted_qty)
          FROM ${deliveryNoteLines} delivery_line
          JOIN ${deliveryNotes} delivery_note ON delivery_note.id = delivery_line.delivery_note_id
          WHERE delivery_note.order_id = ${id}::uuid
            AND delivery_note.status = 'approved'
            AND delivery_line.equipment_item_id = ${orderLines.equipmentItemId}
        ), 0)::int`,
        accountedRetentionQty: sql<number>`COALESCE((
          SELECT SUM(
            CASE WHEN return_note.status = 'approved'
              THEN return_line.counted_returned_qty
              ELSE COALESCE(return_line.counted_returned_qty, return_line.returned_qty)
            END + return_line.balance_qty + return_line.missing_damaged_qty
          )
          FROM ${retentionNoteLines} return_line
          JOIN ${retentionNotes} return_note ON return_note.id = return_line.retention_note_id
          WHERE return_note.order_id = ${id}::uuid
            AND return_note.status <> 'rejected'
            AND return_line.equipment_item_id = ${orderLines.equipmentItemId}
        ), 0)::int`,
        availableStockQty: sql<number>`GREATEST(
          COALESCE((
            SELECT SUM(ledger.quantity_delta)
            FROM ${stockLedger} ledger
            WHERE ledger.store_id = ${header.storeId}::uuid
              AND ledger.equipment_item_id = ${orderLines.equipmentItemId}
          ), 0) - COALESCE((
            SELECT SUM(active_line.issued_qty)
            FROM ${deliveryNoteLines} active_line
            JOIN ${deliveryNotes} active_note
              ON active_note.id = active_line.delivery_note_id
            WHERE active_note.store_id = ${header.storeId}::uuid
              AND active_note.status IN ('draft', 'reopened', 'pending_approval')
              AND active_line.equipment_item_id = ${orderLines.equipmentItemId}
          ), 0), 0
        )::int`,
      }).from(orderLines).innerJoin(equipmentItems, eq(orderLines.equipmentItemId, equipmentItems.id))
        .where(eq(orderLines.orderId, id)).orderBy(equipmentItems.name)
      return { ...header, currency: config.currency, timezone: config.timezone, lines }
    },
  }
}

export type CommercialService = ReturnType<typeof createCommercialService>
