import {
  bigint,
  boolean,
  date,
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
  'super_user',
])
export const customerType = pgEnum('customer_type', ['recurring', 'new'])
export const priceChangeReason = pgEnum('price_change_reason', [
  'scheduled_escalation',
  'owner_escalation',
  'negotiated',
  'correction',
])
export const auditActorType = pgEnum('audit_actor_type', ['user', 'token'])
export const quotationStatus = pgEnum('quotation_status', ['sent', 'accepted', 'rejected', 'expired'])
export const orderStatus = pgEnum('order_status', ['open', 'fully_returned', 'cancelled'])
export const outboxStatus = pgEnum('outbox_status', ['pending', 'published', 'failed'])
export const noteStatus = pgEnum('note_status', ['draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'reopened'])
export const discrepancyType = pgEnum('discrepancy_type', ['missing', 'damaged', 'not_accepted', 'other'])
export const discrepancyStatus = pgEnum('discrepancy_status', ['open', 'resolved', 'written_off', 'claimed'])
export const responsibleParty = pgEnum('responsible_party', ['customer', 'staff_member'])
export const stockDirection = pgEnum('stock_direction', ['in', 'out', 'write_off'])
export const tokenStatus = pgEnum('token_status', ['active', 'used', 'revoked'])
export const paymentMethod = pgEnum('payment_method', [
  'cash',
  'bank_transfer',
  'cheque',
  'other',
])
export const claimStatus = pgEnum('claim_status', ['drafted', 'confirmed', 'rejected'])

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
  (table) => [
    index('price_history_item_effective_idx').on(table.equipmentItemId, table.effectiveDate),
    uniqueIndex('price_history_scheduled_effective_unique')
      .on(table.equipmentItemId, table.effectiveDate)
      .where(sql`${table.reason} = 'scheduled_escalation'`),
  ],
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

export const quotations = pgTable(
  'quotation',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quotationNumber: text('quotation_number').notNull().unique(),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    status: quotationStatus('status').default('sent').notNull(),
    totalValueCents: integer('total_value_cents').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('quotation_customer_id_idx').on(table.customerId), index('quotation_status_idx').on(table.status)],
)

export const quotationLines = pgTable(
  'quotation_line',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quotationId: uuid('quotation_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
  },
  (table) => [index('quotation_line_quotation_id_idx').on(table.quotationId)],
)

export const orders = pgTable(
  'order',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    quotationId: uuid('quotation_id').unique().references(() => quotations.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    status: orderStatus('status').default('open').notNull(),
    totalValueCents: integer('total_value_cents').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    ...timestamps,
  },
  (table) => [index('order_customer_id_idx').on(table.customerId), index('order_status_idx').on(table.status)],
)

export const orderLines = pgTable(
  'order_line',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
  },
  (table) => [index('order_line_order_id_idx').on(table.orderId)],
)

export const payments = pgTable(
  'payment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    amountCents: integer('amount_cents').notNull(),
    paymentDate: timestamp('payment_date', { withTimezone: true }).notNull(),
    method: paymentMethod('method').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('payment_order_id_idx').on(table.orderId),
    index('payment_customer_id_idx').on(table.customerId),
    index('payment_payment_date_idx').on(table.paymentDate),
  ],
)

export const expenses = pgTable(
  'expense',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    category: text('category').notNull(),
    amountCents: integer('amount_cents').notNull(),
    expenseDate: timestamp('expense_date', { withTimezone: true }).notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('expense_expense_date_idx').on(table.expenseDate)],
)

export const outboxEvents = pgTable(
  'outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: outboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('outbox_status_available_at_idx').on(table.status, table.availableAt)],
)

export const deliveryNotes = pgTable(
  'delivery_note',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dnNumber: text('dn_number').notNull().unique(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    storeId: uuid('store_id').references(() => stores.id),
    status: noteStatus('status').default('draft').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('delivery_note_order_id_idx').on(table.orderId), index('delivery_note_store_status_idx').on(table.storeId, table.status)],
)

export const deliveryNoteLines = pgTable(
  'delivery_note_line',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryNoteId: uuid('delivery_note_id').notNull().references(() => deliveryNotes.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    issuedQty: integer('issued_qty').notNull(),
    handedOverQty: integer('handed_over_qty').notNull(),
    countedQty: integer('counted_qty'),
    mismatchReason: discrepancyType('mismatch_reason'),
    mismatchDetail: text('mismatch_detail'),
  },
  (table) => [unique('delivery_note_line_item_unique').on(table.deliveryNoteId, table.equipmentItemId), index('delivery_note_line_note_id_idx').on(table.deliveryNoteId)],
)

export const retentionNotes = pgTable(
  'retention_note',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rnNumber: text('rn_number').notNull().unique(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    deliveryNoteId: uuid('delivery_note_id').references(() => deliveryNotes.id),
    storeId: uuid('store_id').references(() => stores.id),
    status: noteStatus('status').default('draft').notNull(),
    submittedBy: uuid('submitted_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('retention_note_order_id_idx').on(table.orderId),
    index('retention_note_store_status_idx').on(table.storeId, table.status),
  ],
)

export const retentionNoteLines = pgTable(
  'retention_note_line',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    retentionNoteId: uuid('retention_note_id').notNull().references(() => retentionNotes.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    returnedQty: integer('returned_qty').default(0).notNull(),
    balanceQty: integer('balance_qty').default(0).notNull(),
    missingDamagedQty: integer('missing_damaged_qty').default(0).notNull(),
    countedReturnedQty: integer('counted_returned_qty'),
    mismatchReason: discrepancyType('mismatch_reason'),
    responsibleParty: responsibleParty('responsible_party'),
    reasonDetail: text('reason_detail'),
  },
  (table) => [
    unique('retention_note_line_item_unique').on(table.retentionNoteId, table.equipmentItemId),
    index('retention_note_line_note_id_idx').on(table.retentionNoteId),
  ],
)

export const stockLedger = pgTable(
  'stock_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    storeId: uuid('store_id').references(() => stores.id),
    sourceType: text('source_type').notNull(),
    sourceNoteId: uuid('source_note_id').notNull(),
    direction: stockDirection('direction').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    reversalOfId: uuid('reversal_of_id'),
    reversalReason: text('reversal_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('stock_ledger_source_item_direction_unique').on(table.sourceType, table.sourceNoteId, table.equipmentItemId, table.direction),
    uniqueIndex('stock_ledger_reversal_of_unique').on(table.reversalOfId).where(sql`${table.reversalOfId} is not null`),
    index('stock_ledger_item_created_idx').on(table.equipmentItemId, table.createdAt),
    index('stock_ledger_store_id_idx').on(table.storeId),
  ],
)

export const reorderAlerts = pgTable(
  'reorder_alert',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id').notNull().references(() => stores.id),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    openedLedgerId: uuid('opened_ledger_id').references(() => stockLedger.id),
    resolvedLedgerId: uuid('resolved_ledger_id').references(() => stockLedger.id),
    threshold: integer('threshold').notNull(),
    openedQuantity: integer('opened_quantity').notNull(),
    resolvedQuantity: integer('resolved_quantity'),
    status: text('status', { enum: ['open', 'resolved'] }).default('open').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('reorder_alert_one_open_per_store_item')
      .on(table.storeId, table.equipmentItemId)
      .where(sql`${table.status} = 'open'`),
    index('reorder_alert_store_status_idx').on(table.storeId, table.status, table.openedAt),
    index('reorder_alert_item_idx').on(table.equipmentItemId, table.openedAt),
  ],
)

export const discrepancies = pgTable(
  'discrepancy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceNoteId: uuid('source_note_id').notNull(),
    sourceLineId: uuid('source_line_id'),
    orderId: uuid('order_id').references(() => orders.id),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    quantity: integer('quantity').notNull(),
    discrepancyType: discrepancyType('discrepancy_type').notNull(),
    reason: text('reason'),
    responsibleParty: responsibleParty('responsible_party'),
    valueCents: integer('value_cents').default(0).notNull(),
    status: discrepancyStatus('status').default('open').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('discrepancy_source_line_unique').on(table.sourceType, table.sourceLineId).where(sql`${table.sourceLineId} is not null`),
    index('discrepancy_status_idx').on(table.status),
    index('discrepancy_equipment_item_id_idx').on(table.equipmentItemId),
    index('discrepancy_order_id_idx').on(table.orderId),
  ],
)

export const damageClaims = pgTable(
  'damage_claim',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discrepancyId: uuid('discrepancy_id').notNull().unique().references(() => discrepancies.id),
    orderId: uuid('order_id').references(() => orders.id),
    customerId: uuid('customer_id').notNull().references(() => customers.id),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    claimAmountCents: integer('claim_amount_cents').notNull(),
    status: claimStatus('status').default('drafted').notNull(),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('damage_claim_status_idx').on(table.status),
    index('damage_claim_customer_id_idx').on(table.customerId),
    index('damage_claim_order_id_idx').on(table.orderId),
  ],
)

export const dashboardStockRollups = pgTable('dashboard_stock_rollup', {
  equipmentItemId: uuid('equipment_item_id')
    .primaryKey()
    .references(() => equipmentItems.id, { onDelete: 'cascade' }),
  quantity: bigint('quantity', { mode: 'number' }).default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const dashboardMonthlyRollups = pgTable('dashboard_monthly_rollup', {
  monthStart: date('month_start').primaryKey(),
  invoicedAmountCents: bigint('invoiced_amount_cents', { mode: 'number' }).default(0).notNull(),
  confirmedClaimAmountCents: bigint('confirmed_claim_amount_cents', { mode: 'number' }).default(0).notNull(),
  receivedPaymentAmountCents: bigint('received_payment_amount_cents', { mode: 'number' }).default(0).notNull(),
  expenseAmountCents: bigint('expense_amount_cents', { mode: 'number' }).default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const dashboardDiscrepancyRollups = pgTable(
  'dashboard_discrepancy_rollup',
  {
    discrepancyId: uuid('discrepancy_id')
      .primaryKey()
      .references(() => discrepancies.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').references(() => orders.id),
    customerId: uuid('customer_id').references(() => customers.id),
    equipmentItemId: uuid('equipment_item_id').notNull().references(() => equipmentItems.id),
    discrepancyType: discrepancyType('discrepancy_type').notNull(),
    status: discrepancyStatus('status').notNull(),
    responsibleParty: responsibleParty('responsible_party'),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    valueCents: bigint('value_cents', { mode: 'number' }).notNull(),
    reason: text('reason'),
    sourceType: text('source_type').notNull(),
    sourceNoteId: uuid('source_note_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dashboard_discrepancy_recorded_idx').on(table.recordedAt),
    index('dashboard_discrepancy_customer_recorded_idx').on(table.customerId, table.recordedAt),
    index('dashboard_discrepancy_item_recorded_idx').on(table.equipmentItemId, table.recordedAt),
    index('dashboard_discrepancy_status_type_idx').on(table.status, table.discrepancyType),
  ],
)

export const noteTokens = pgTable(
  'note_token',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    noteType: text('note_type').notNull(),
    noteId: uuid('note_id').notNull(),
    status: tokenStatus('status').default('active').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('note_token_live_note_unique').on(table.noteType, table.noteId).where(sql`${table.status} in ('active', 'used')`),
    index('note_token_note_idx').on(table.noteType, table.noteId),
  ],
)

export type Store = typeof stores.$inferSelect
export type User = typeof users.$inferSelect
export type Customer = typeof customers.$inferSelect
export type EquipmentItem = typeof equipmentItems.$inferSelect
export type CustomerPrice = typeof customerPrices.$inferSelect
export type PriceHistoryEntry = typeof priceHistory.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type Quotation = typeof quotations.$inferSelect
export type QuotationLine = typeof quotationLines.$inferSelect
export type Order = typeof orders.$inferSelect
export type OrderLine = typeof orderLines.$inferSelect
export type OutboxEvent = typeof outboxEvents.$inferSelect
export type DeliveryNote = typeof deliveryNotes.$inferSelect
export type DeliveryNoteLine = typeof deliveryNoteLines.$inferSelect
export type RetentionNote = typeof retentionNotes.$inferSelect
export type RetentionNoteLine = typeof retentionNoteLines.$inferSelect
export type StockLedgerEntry = typeof stockLedger.$inferSelect
export type ReorderAlert = typeof reorderAlerts.$inferSelect
export type Discrepancy = typeof discrepancies.$inferSelect
export type DamageClaim = typeof damageClaims.$inferSelect
export type DashboardStockRollup = typeof dashboardStockRollups.$inferSelect
export type DashboardMonthlyRollup = typeof dashboardMonthlyRollups.$inferSelect
export type DashboardDiscrepancyRollup = typeof dashboardDiscrepancyRollups.$inferSelect
export type NoteToken = typeof noteTokens.$inferSelect
