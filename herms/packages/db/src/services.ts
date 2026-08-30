import type {
  CustomerInput,
  CustomerUpdate,
  EquipmentInput,
  EquipmentUpdate,
  PriceChangeInput,
  RecurringCustomerInput,
  SessionUser,
} from '@herms/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { Database } from './client'
import { reconcileReorderAlertsForItem } from './reorder'
import {
  auditLogs,
  customerPrices,
  customers,
  equipmentItems,
  priceHistory,
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
      if (!user?.passwordHash || !(await Bun.password.verify(password, user.passwordHash))) return null
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
      const before = await customerForActor(id, actor)
      const itemIds = input.prices.map((price) => price.equipmentItemId)
      const knownItems = await db
        .select({ id: equipmentItems.id })
        .from(equipmentItems)
        .where(inArray(equipmentItems.id, itemIds))
      if (knownItems.length !== itemIds.length) {
        throw new DataNotFoundError('One or more equipment items were not found')
      }
      const effectiveFrom = new Date()
      const updated = { ...before, type: 'recurring' as const, updatedAt: effectiveFrom }
      await db.batch([
        db
          .update(customerPrices)
          .set({ effectiveTo: effectiveFrom })
          .where(and(eq(customerPrices.customerId, id), isNull(customerPrices.effectiveTo))),
        db.insert(customerPrices).values(
          input.prices.map((price) => ({
            customerId: id,
            equipmentItemId: price.equipmentItemId,
            unitPriceCents: price.unitPriceCents,
            effectiveFrom,
          })),
        ),
        db.update(customers).set({ type: 'recurring', updatedAt: effectiveFrom }).where(eq(customers.id, id)),
        db.insert(auditLogs).values(
          auditValues(actor, 'customer.set_recurring', 'customer', id, before, {
            ...updated,
            prices: input.prices,
          }),
        ),
      ])
      return { ...updated, prices: input.prices }
    },

    async listItems() {
      return db.select().from(equipmentItems).orderBy(equipmentItems.name)
    },

    getItem,

    async createItem(input: EquipmentInput, actor: AuditActor) {
      const now = new Date()
      const created = {
        id: crypto.randomUUID(),
        name: input.name,
        category: input.category,
        unitOfMeasure: input.unitOfMeasure,
        currentUnitPriceCents: input.currentUnitPriceCents,
        reorderThreshold: input.reorderThreshold ?? null,
        createdAt: now,
        updatedAt: now,
      }
      await db.batch([
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
          .values(auditValues(actor, 'equipment_item.create', 'equipment_item', created.id, null, created)),
        db.execute(reconcileReorderAlertsForItem(created.id, actor, now)),
      ])
      return created
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
