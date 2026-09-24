import type {
  CustomerInput,
  CustomerPricesInput,
  CustomerUpdate,
  EquipmentInput,
  EquipmentUpdate,
  PriceChangeInput,
  RecurringCustomerInput,
  SessionUser,
  StockAdditionInput,
} from '@herms/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Database } from './client'
import { verifyPassword } from './password'
import { reconcileReorderAlertsForItem, reconcileReorderAlertsForLedger } from './reorder'
import {
  auditLogs,
  customerPrices,
  customers,
  equipmentItems,
  openingBalanceNoteLines,
  openingBalanceNotes,
  priceHistory,
  stockLedger,
  stores,
  users,
} from './schema'

export class DataNotFoundError extends Error {}
export class DataConflictError extends Error {}

export type AuditActor = SessionUser & { requestId: string }

function nullable(value: string | null | undefined) {
  return value?.trim() ? value.trim() : null
}

function auditSnapshot(value: object | null): Record<string, unknown> | null {
  return value ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : null
}

function auditValues(
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string | null,
  before: object | null,
  after: object | null,
) {
  return {
    actorType: 'user' as const,
    actorId: actor.id,
    action,
    entityType,
    entityId,
    before: auditSnapshot(before),
    after: auditSnapshot(after),
    requestId: actor.requestId,
  }
}

function publicUser(user: typeof users.$inferSelect): SessionUser {
  return {
    id: user.id,
    storeId: user.storeId,
    name: user.name,
    role: user.role,
    isDeputyAdmin: user.isDeputyAdmin,
    email: user.email,
  }
}

export function createIdentityService(db: Database) {
  return {
    async authenticate(email: string, password: string): Promise<SessionUser | null> {
      const [user] = await db
        .select()
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, eq(users.active, true)))
        .limit(1)
      if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) return null
      return publicUser(user)
    },

    async findActiveUser(id: string): Promise<SessionUser | null> {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), eq(users.active, true)))
        .limit(1)
      return user ? publicUser(user) : null
    },
  }
}

export type IdentityService = ReturnType<typeof createIdentityService>

export function createMasterDataService(db: Database) {
  async function resolveStoreId(actor: SessionUser) {
    if (actor.storeId) return actor.storeId
    const [store] = await db.select({ id: stores.id }).from(stores).orderBy(stores.createdAt).limit(1)
    if (!store) throw new DataNotFoundError('No store is configured')
    return store.id
  }

  async function customerForActor(id: string, actor: SessionUser) {
    const conditions = actor.storeId
      ? and(eq(customers.id, id), eq(customers.storeId, actor.storeId))
      : eq(customers.id, id)
    const [customer] = await db.select().from(customers).where(conditions).limit(1)
    if (!customer) throw new DataNotFoundError('Customer not found')
    return customer
  }

  async function getItem(id: string) {
    const [item] = await db.select().from(equipmentItems).where(eq(equipmentItems.id, id)).limit(1)
    if (!item) throw new DataNotFoundError('Equipment item not found')
    return item
  }

  async function nextOpeningBalanceNumber() {
    const sequence = await db.execute<{ value: string }>(
      sql`SELECT nextval('opening_balance_note_number_seq')::text AS value`,
    )
    const value = sequence.rows[0]?.value
    if (!value) throw new Error('Could not allocate an opening balance note number')
    return `OB-${BigInt(value).toString().padStart(6, '0')}`
  }

  async function saveCustomerPrices(
    id: string,
    input: CustomerPricesInput,
    actor: AuditActor,
    requireRecurringCustomer: boolean,
  ) {
    const before = await customerForActor(id, actor)
    if (requireRecurringCustomer && before.type !== 'recurring') {
      throw new DataConflictError('Convert the customer to recurring before updating special prices')
    }

    const itemIds = input.prices.map((price) => price.equipmentItemId)
    const knownItems = itemIds.length === 0
      ? []
      : await db
        .select({ id: equipmentItems.id })
        .from(equipmentItems)
        .where(inArray(equipmentItems.id, itemIds))
    if (knownItems.length !== itemIds.length) {
      throw new DataNotFoundError('One or more equipment items were not found')
    }

    const effectiveFrom = new Date()
    const updated = { ...before, type: 'recurring' as const, updatedAt: effectiveFrom }
    const closeCurrentPrices = db
      .update(customerPrices)
      .set({ effectiveTo: effectiveFrom })
      .where(and(eq(customerPrices.customerId, id), isNull(customerPrices.effectiveTo)))
    const updateCustomer = db
      .update(customers)
      .set({ type: 'recurring', updatedAt: effectiveFrom })
      .where(eq(customers.id, id))
    const audit = db.insert(auditLogs).values(
      auditValues(
        actor,
        requireRecurringCustomer ? 'customer.prices_update' : 'customer.set_recurring',
        'customer',
        id,
        before,
        { ...updated, prices: input.prices },
      ),
    )

    if (input.prices.length === 0) {
      await db.batch([closeCurrentPrices, updateCustomer, audit])
    } else {
      await db.batch([
        closeCurrentPrices,
        db.insert(customerPrices).values(
          input.prices.map((price) => ({
            customerId: id,
            equipmentItemId: price.equipmentItemId,
            unitPriceCents: price.unitPriceCents,
            effectiveFrom,
          })),
        ),
        updateCustomer,
        audit,
      ])
    }

    return { ...updated, prices: input.prices }
  }

  return {
    async listCustomers(actor: SessionUser) {
      const query = db.select().from(customers).orderBy(customers.name)
      return actor.storeId ? query.where(eq(customers.storeId, actor.storeId)) : query
    },

    async getCustomer(id: string, actor: SessionUser) {
      const customer = await customerForActor(id, actor)
      const prices = await db
        .select()
        .from(customerPrices)
        .where(and(eq(customerPrices.customerId, id), isNull(customerPrices.effectiveTo)))
        .orderBy(customerPrices.equipmentItemId)
      return { ...customer, prices }
    },

    async createCustomer(input: CustomerInput, actor: AuditActor) {
      const now = new Date()
      const created = {
        id: crypto.randomUUID(),
        storeId: await resolveStoreId(actor),
        name: input.name,
        type: input.type,
        phone: nullable(input.phone),
        email: nullable(input.email),
        address: nullable(input.address),
        outstandingBalanceCents: 0,
        createdAt: now,
        updatedAt: now,
      }
      await db.batch([
        db.insert(customers).values(created),
        db
          .insert(auditLogs)
          .values(auditValues(actor, 'customer.create', 'customer', created.id, null, created)),
      ])
      return created
    },

    async updateCustomer(id: string, input: CustomerUpdate, actor: AuditActor) {
      const before = await customerForActor(id, actor)
      const updatedAt = new Date()
      const updated = {
        ...before,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: nullable(input.phone) }),
        ...(input.email === undefined ? {} : { email: nullable(input.email) }),
        ...(input.address === undefined ? {} : { address: nullable(input.address) }),
        updatedAt,
      }
      const auditId = crypto.randomUUID()
      const [updatedResult] = await db.batch([
        db
          .update(customers)
          .set({
            name: updated.name,
            phone: updated.phone,
            email: updated.email,
            address: updated.address,
            updatedAt,
          })
          .where(and(eq(customers.id, id), eq(customers.updatedAt, before.updatedAt)))
          .returning(),
        db.execute(sql`
          INSERT INTO ${auditLogs} (
            id, actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT
            ${auditId}::uuid, 'user'::audit_actor_type, ${actor.id}::uuid,
            'customer.update', 'customer', ${id}::uuid,
            ${JSON.stringify(auditSnapshot(before))}::jsonb,
            to_jsonb(customer.*), ${actor.requestId}
          FROM ${customers}
          WHERE ${customers.id} = ${id}::uuid
            AND ${customers.updatedAt} = ${updatedAt}
        `),
      ])
      if (!updatedResult[0]) throw new DataConflictError('The customer changed concurrently; retry')
      return updated
    },

    async setRecurringCustomer(id: string, input: RecurringCustomerInput, actor: AuditActor) {
      return saveCustomerPrices(id, input, actor, false)
    },

    async replaceCustomerPrices(id: string, input: CustomerPricesInput, actor: AuditActor) {
      return saveCustomerPrices(id, input, actor, true)
    },

    async listItems(actor: SessionUser) {
      const storeId = await resolveStoreId(actor)
      const items = await db.select().from(equipmentItems).orderBy(equipmentItems.name)
      const stocks = items.length === 0
        ? []
        : await db.select({
          equipmentItemId: stockLedger.equipmentItemId,
          quantity: sql<number>`COALESCE(SUM(${stockLedger.quantityDelta}), 0)::int`,
        }).from(stockLedger)
          .where(and(
            eq(stockLedger.storeId, storeId),
            inArray(stockLedger.equipmentItemId, items.map((item) => item.id)),
          ))
          .groupBy(stockLedger.equipmentItemId)
      const quantityByItem = new Map(stocks.map((row) => [row.equipmentItemId, Number(row.quantity)]))
      return items.map((item) => ({
        ...item,
        currentStockQty: quantityByItem.get(item.id) ?? 0,
      }))
    },

    async getItem(id: string, actor: SessionUser) {
      const item = await getItem(id)
      const storeId = await resolveStoreId(actor)
      const totals = await db.execute<{
        currentStockQty: number | string
        openingStockQty: number | string
        totalReceivedQty: number | string
        pendingReceiptQty: number | string
      }>(sql`
        SELECT
          COALESCE((
            SELECT SUM(ledger.quantity_delta)
            FROM ${stockLedger} ledger
            WHERE ledger.equipment_item_id = ${id}::uuid
              AND ledger.store_id = ${storeId}::uuid
          ), 0)::int AS "currentStockQty",
          COALESCE((
            SELECT SUM(line.counted_qty)
            FROM ${openingBalanceNoteLines} line
            JOIN ${openingBalanceNotes} note ON note.id = line.opening_balance_note_id
            WHERE line.equipment_item_id = ${id}::uuid
              AND note.store_id = ${storeId}::uuid
              AND note.entry_type = 'opening_balance'
              AND note.status = 'approved'
          ), 0)::int AS "openingStockQty",
          COALESCE((
            SELECT SUM(line.counted_qty)
            FROM ${openingBalanceNoteLines} line
            JOIN ${openingBalanceNotes} note ON note.id = line.opening_balance_note_id
            WHERE line.equipment_item_id = ${id}::uuid
              AND note.store_id = ${storeId}::uuid
              AND note.status = 'approved'
          ), 0)::int AS "totalReceivedQty",
          COALESCE((
            SELECT SUM(line.requested_qty)
            FROM ${openingBalanceNoteLines} line
            JOIN ${openingBalanceNotes} note ON note.id = line.opening_balance_note_id
            WHERE line.equipment_item_id = ${id}::uuid
              AND note.store_id = ${storeId}::uuid
              AND note.status = 'pending_approval'
          ), 0)::int AS "pendingReceiptQty"
      `)
      const summary = totals.rows[0]
      return {
        ...item,
        currentStockQty: Number(summary?.currentStockQty ?? 0),
        openingStockQty: Number(summary?.openingStockQty ?? 0),
        totalReceivedQty: Number(summary?.totalReceivedQty ?? 0),
        pendingReceiptQty: Number(summary?.pendingReceiptQty ?? 0),
      }
    },

    async createItem(input: EquipmentInput, actor: AuditActor) {
      const now = new Date()
      const created = {
        id: crypto.randomUUID(),
        name: input.name,
        category: input.category,
        unitOfMeasure: input.unitOfMeasure,
        currentUnitPriceCents: input.currentUnitPriceCents,
        purchasePriceCents: input.purchasePriceCents,
        reorderThreshold: input.reorderThreshold ?? null,
        createdAt: now,
        updatedAt: now,
      }
      const commonWrites = [
        db.insert(equipmentItems).values(created),
        db.insert(priceHistory).values({
          equipmentItemId: created.id,
          oldPriceCents: null,
          newPriceCents: created.currentUnitPriceCents,
          effectiveDate: now,
          reason: 'negotiated',
          createdBy: actor.id,
        }),
        db
          .insert(auditLogs)
          .values(auditValues(actor, 'equipment_item.create', 'equipment_item', created.id, null, {
            ...created,
            openingQuantity: input.openingQuantity,
          })),
      ] as const

      if (input.openingQuantity === 0) {
        await db.batch([
          ...commonWrites,
          db.execute(reconcileReorderAlertsForItem(created.id, actor, now)),
        ])
        return { ...created, openingQuantity: 0, openingBalanceStatus: null }
      }

      const storeId = await resolveStoreId(actor)
      const openingNote = {
        id: crypto.randomUUID(),
        obNumber: await nextOpeningBalanceNumber(),
        storeId,
        entryType: 'opening_balance' as const,
        status: 'approved' as const,
        submittedBy: actor.id,
        approvedBy: actor.id,
        submittedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      const openingLine = {
        id: crypto.randomUUID(),
        openingBalanceNoteId: openingNote.id,
        equipmentItemId: created.id,
        requestedQty: input.openingQuantity,
        countedQty: input.openingQuantity,
      }
      await db.batch([
        ...commonWrites,
        db.insert(openingBalanceNotes).values(openingNote),
        db.insert(openingBalanceNoteLines).values(openingLine),
        db.insert(stockLedger).values({
          equipmentItemId: created.id,
          storeId,
          sourceType: 'opening_balance',
          sourceNoteId: openingNote.id,
          direction: 'in',
          quantityDelta: input.openingQuantity,
          createdBy: actor.id,
          createdAt: now,
        }),
        db.execute(reconcileReorderAlertsForLedger(
          'opening_balance', openingNote.id, now, actor,
        )),
        db.insert(auditLogs).values(auditValues(
          actor,
          'opening_balance.post',
          'opening_balance_note',
          openingNote.id,
          null,
          { ...openingNote, lines: [openingLine] },
        )),
      ])
      return {
        ...created,
        openingQuantity: input.openingQuantity,
        openingBalanceStatus: openingNote.status,
        openingBalanceNoteId: openingNote.id,
        openingBalanceNoteNumber: openingNote.obNumber,
      }
    },

    async addItemStock(id: string, input: StockAdditionInput, actor: AuditActor) {
      const item = await getItem(id)
      const now = new Date()
      const storeId = await resolveStoreId(actor)
      const note = {
        id: crypto.randomUUID(),
        obNumber: await nextOpeningBalanceNumber(),
        storeId,
        entryType: 'stock_addition' as const,
        status: 'approved' as const,
        submittedBy: actor.id,
        approvedBy: actor.id,
        submittedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      const line = {
        id: crypto.randomUUID(),
        openingBalanceNoteId: note.id,
        equipmentItemId: id,
        requestedQty: input.quantity,
        countedQty: input.quantity,
      }
      await db.batch([
        db.insert(openingBalanceNotes).values(note),
        db.insert(openingBalanceNoteLines).values(line),
        db.insert(stockLedger).values({
          equipmentItemId: id,
          storeId,
          sourceType: 'opening_balance',
          sourceNoteId: note.id,
          direction: 'in',
          quantityDelta: input.quantity,
          createdBy: actor.id,
          createdAt: now,
        }),
        db.execute(reconcileReorderAlertsForLedger('opening_balance', note.id, now, actor)),
        db.insert(auditLogs).values(auditValues(
          actor,
          'stock_addition.post',
          'opening_balance_note',
          note.id,
          null,
          { ...note, equipmentName: item.name, lines: [line] },
        )),
      ])
      return {
        equipmentItemId: item.id,
        equipmentName: item.name,
        quantity: input.quantity,
        status: note.status,
        noteId: note.id,
        noteNumber: note.obNumber,
        entryType: note.entryType,
      }
    },

    async updateItem(id: string, input: EquipmentUpdate, actor: AuditActor) {
      const before = await getItem(id)
      const updatedAt = new Date()
      const updated = { ...before, ...input, updatedAt }
      const auditId = crypto.randomUUID()
      const [updatedResult] = await db.batch([
        db
          .update(equipmentItems)
          .set({ ...input, updatedAt })
          .where(and(eq(equipmentItems.id, id), eq(equipmentItems.updatedAt, before.updatedAt)))
          .returning(),
        db.execute(sql`
          INSERT INTO ${auditLogs} (
            id, actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT
            ${auditId}::uuid, 'user'::audit_actor_type, ${actor.id}::uuid,
            'equipment_item.update', 'equipment_item', ${id}::uuid,
            ${JSON.stringify(auditSnapshot(before))}::jsonb,
            to_jsonb(equipment_item.*), ${actor.requestId}
          FROM ${equipmentItems}
          WHERE ${equipmentItems.id} = ${id}::uuid
            AND ${equipmentItems.updatedAt} = ${updatedAt}
        `),
        db.execute(reconcileReorderAlertsForItem(id, actor, updatedAt)),
      ])
      if (!updatedResult[0]) throw new DataConflictError('The equipment item changed concurrently; retry')
      return updated
    },

    async changeItemPrice(id: string, input: PriceChangeInput, actor: AuditActor) {
      const before = await getItem(id)
      if (before.currentUnitPriceCents === input.newPriceCents) {
        throw new DataConflictError('The new price must differ from the current price')
      }
      const updatedAt = new Date()
      const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : updatedAt
      const historyId = crypto.randomUUID()
      const auditId = crypto.randomUUID()
      const [updatedResult] = await db.batch([
        db
          .update(equipmentItems)
          .set({ currentUnitPriceCents: input.newPriceCents, updatedAt })
          .where(
            and(
              eq(equipmentItems.id, id),
              eq(equipmentItems.currentUnitPriceCents, before.currentUnitPriceCents),
              eq(equipmentItems.updatedAt, before.updatedAt),
            ),
          )
          .returning(),
        db.execute(sql`
          INSERT INTO ${priceHistory} (
            id, equipment_item_id, old_price_cents, new_price_cents,
            effective_date, reason, created_by
          )
          SELECT
            ${historyId}::uuid, ${id}::uuid, ${before.currentUnitPriceCents},
            ${input.newPriceCents}, ${effectiveDate}, ${input.reason}::price_change_reason,
            ${actor.id}::uuid
          FROM ${equipmentItems}
          WHERE ${equipmentItems.id} = ${id}::uuid
            AND ${equipmentItems.currentUnitPriceCents} = ${input.newPriceCents}
            AND ${equipmentItems.updatedAt} = ${updatedAt}
        `),
        db.execute(sql`
          INSERT INTO ${auditLogs} (
            id, actor_type, actor_id, action, entity_type, entity_id,
            before, after, request_id
          )
          SELECT
            ${auditId}::uuid, 'user'::audit_actor_type, ${actor.id}::uuid,
            'equipment_item.price_change', 'equipment_item', ${id}::uuid,
            ${JSON.stringify(auditSnapshot(before))}::jsonb,
            to_jsonb(equipment_item.*), ${actor.requestId}
          FROM ${equipmentItems}
          WHERE ${equipmentItems.id} = ${id}::uuid
            AND ${equipmentItems.currentUnitPriceCents} = ${input.newPriceCents}
            AND ${equipmentItems.updatedAt} = ${updatedAt}
        `),
      ])
      const updated = updatedResult[0]
      if (!updated) throw new DataConflictError('The equipment price changed concurrently; retry')
      return updated
    },

    async listPriceHistory(id: string) {
      await getItem(id)
      return db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.equipmentItemId, id))
        .orderBy(desc(priceHistory.effectiveDate), desc(priceHistory.createdAt))
    },

    async listAuditLogs() {
      return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100)
    },
  }
}

export type MasterDataService = ReturnType<typeof createMasterDataService>
