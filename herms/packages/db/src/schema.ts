import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', [
  'business_owner',
  'sales',
  'field_staff',
  'store_admin',
  'finance',
  'system_admin',
])
export const customerType = pgEnum('customer_type', ['recurring', 'new'])
export const priceChangeReason = pgEnum('price_change_reason', [
  'scheduled_escalation',
  'negotiated',
  'correction',
])
export const auditActorType = pgEnum('audit_actor_type', ['user', 'token'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

export const stores = pgTable('store', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const users = pgTable(
  'user',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id').references(() => stores.id),
    name: text('name').notNull(),
    role: userRole('role').notNull(),
    isDeputyAdmin: boolean('is_deputy_admin').default(false).notNull(),
    phone: text('phone'),
    email: text('email'),
    passwordHash: text('password_hash'),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_email_unique')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    index('user_store_id_idx').on(table.storeId),
  ],
)

export const customers = pgTable(
  'customer',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    name: text('name').notNull(),
    type: customerType('type').default('new').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    outstandingBalanceCents: integer('outstanding_balance_cents').default(0).notNull(),
    ...timestamps,
  },
  (table) => [index('customer_store_id_idx').on(table.storeId)],
)

export const equipmentItems = pgTable('equipment_item', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  unitOfMeasure: text('unit_of_measure').default('unit').notNull(),
  currentUnitPriceCents: integer('current_unit_price_cents').notNull(),
  reorderThreshold: integer('reorder_threshold'),
  ...timestamps,
})

export const customerPrices = pgTable(
  'customer_price',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    unitPriceCents: integer('unit_price_cents').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('customer_price_customer_item_effective_unique').on(
      table.customerId,
      table.equipmentItemId,
      table.effectiveFrom,
    ),
    index('customer_price_customer_id_idx').on(table.customerId),
    index('customer_price_equipment_item_id_idx').on(table.equipmentItemId),
  ],
)

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    oldPriceCents: integer('old_price_cents'),
    newPriceCents: integer('new_price_cents').notNull(),
    effectiveDate: timestamp('effective_date', { withTimezone: true }).notNull(),
    reason: priceChangeReason('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('price_history_item_effective_idx').on(table.equipmentItemId, table.effectiveDate)],
)

export const auditLogs = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_actor_idx').on(table.actorType, table.actorId),
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_created_at_idx').on(table.createdAt),
  ],
)

export type Store = typeof stores.$inferSelect
export type User = typeof users.$inferSelect
export type Customer = typeof customers.$inferSelect
export type EquipmentItem = typeof equipmentItems.$inferSelect
export type CustomerPrice = typeof customerPrices.$inferSelect
export type PriceHistoryEntry = typeof priceHistory.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
