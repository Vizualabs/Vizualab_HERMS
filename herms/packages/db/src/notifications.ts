import { Buffer } from 'node:buffer'

import type {
  NotificationQueueMessage,
  SessionUser,
  WhatsAppNotification,
} from '@herms/shared'
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'

import type { Database } from './client'
import {
  customers,
  deliveryNotes,
  orders,
  outboxEvents,
  quotations,
  retentionNotes,
  users,
} from './schema'
import { DataConflictError, DataNotFoundError } from './services'

export type NotificationConfig = {
  businessCurrency: string
  noteTokenSecret: string
  publicAppUrl: string
}

export type FieldStaffRecipient = {
  id: string
  name: string
  phoneMasked: string
}

function maskPhone(phone: string) {
  const visible = phone.slice(-4)
  return visible ? '•••• ' + visible : 'Configured'
}

function requiredPayloadString(message: NotificationQueueMessage, key: string) {
  const value = message.payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new DataConflictError('Notification payload is missing ' + key)
  }
  return value
}

function requiredPayloadNumber(message: NotificationQueueMessage, key: string) {
  const value = message.payload[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataConflictError('Notification payload is missing ' + key)
  }
  return value
}

async function signToken(secret: string, value: string) {
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

function formatMoney(value: number, currency: string) {
  return currency + ' ' + new Intl.NumberFormat('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

export async function requireActiveFieldStaff(
  db: Database,
  fieldStaffUserId: string,
  storeId: string,
) {
  const [recipient] = await db
    .select({ id: users.id, name: users.name, phone: users.phone })
    .from(users)
    .where(and(
      eq(users.id, fieldStaffUserId),
      eq(users.storeId, storeId),
      eq(users.role, 'field_staff'),
      eq(users.active, true),
      isNotNull(users.phone),
    ))
    .limit(1)
  if (!recipient?.phone) {
    throw new DataConflictError('Select an active field staff member with a WhatsApp phone number')
  }
  return { ...recipient, phone: recipient.phone }
}

export async function resolveFieldStaffRecipient(
  db: Database,
  requestedUserId: string | undefined,
  noteId: string,
  storeId: string,
) {
  let fieldStaffUserId = requestedUserId
  if (!fieldStaffUserId) {
    const previous = await db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, noteId))
      .orderBy(desc(outboxEvents.createdAt))
      .limit(10)
    fieldStaffUserId = previous
      .map((event) => event.payload.recipientUserId)
      .find((value): value is string => typeof value === 'string')
  }
  if (!fieldStaffUserId) {
    throw new DataConflictError('Select a field staff recipient before resending the note link')
  }
  return requireActiveFieldStaff(db, fieldStaffUserId, storeId)
}

export function createNotificationService(db: Database, config: NotificationConfig) {

  async function resolveQuotation(message: NotificationQueueMessage): Promise<WhatsAppNotification[]> {
    const quotationId = requiredPayloadString(message, 'quotationId')
    const [row] = await db
      .select({
        quotationId: quotations.id,
        quotationNumber: quotations.quotationNumber,
        totalValueCents: quotations.totalValueCents,
        customerId: customers.id,
        customerName: customers.name,
        customerPhone: customers.phone,
      })
      .from(quotations)
      .innerJoin(customers, eq(quotations.customerId, customers.id))
      .where(eq(quotations.id, quotationId))
      .limit(1)
    if (!row) throw new DataNotFoundError('Quotation notification source was not found')
    if (!row.customerPhone) throw new DataConflictError('The quotation customer has no WhatsApp phone number')
    const total = formatMoney(row.totalValueCents, config.businessCurrency)
    return [{
      idempotencyKey: message.idempotencyKey + ':' + row.customerId,
      requestId: message.requestId,
      recipient: {
        kind: 'customer',
        id: row.customerId,
        name: row.customerName,
        phone: row.customerPhone,
      },
      templateKey: 'quotation_created',
      text: 'Hello ' + row.customerName + ', your quotation ' + row.quotationNumber + ' for ' + total + ' is ready.',
      variables: {
        customerName: row.customerName,
        quotationNumber: row.quotationNumber,
        total,
      },
      document: {
        kind: 'quotation_pdf',
        quotationId: row.quotationId,
        filename: row.quotationNumber + '.pdf',
      },
    }]
  }

  async function resolveNoteLink(message: NotificationQueueMessage): Promise<WhatsAppNotification[]> {
    const tokenId = requiredPayloadString(message, 'tokenId')
    const fieldStaffUserId = requiredPayloadString(message, 'recipientUserId')
    const isDelivery = message.eventType.startsWith('delivery_note_')
    const noteTable = isDelivery ? deliveryNotes : retentionNotes
    const numberColumn = isDelivery ? deliveryNotes.dnNumber : retentionNotes.rnNumber
    const [note] = await db
      .select({
        id: noteTable.id,
        noteNumber: numberColumn,
        storeId: noteTable.storeId,
        orderNumber: orders.orderNumber,
      })
      .from(noteTable)
      .innerJoin(orders, eq(noteTable.orderId, orders.id))
      .where(eq(noteTable.id, message.aggregateId))
      .limit(1)
    if (!note?.storeId) throw new DataNotFoundError('Note notification source was not found')
    const recipient = await requireActiveFieldStaff(db, fieldStaffUserId, note.storeId)
    const rawToken = tokenId + '.' + await signToken(config.noteTokenSecret, tokenId)
    const link = config.publicAppUrl.replace(/\/$/, '') + '/notes/' + rawToken
    const noteLabel = isDelivery ? 'Delivery Note' : 'Retention Note'
    return [{
      idempotencyKey: message.idempotencyKey + ':' + recipient.id,
      requestId: message.requestId,
      recipient: {
        kind: 'user',
        id: recipient.id,
        name: recipient.name,
        phone: recipient.phone,
      },
      templateKey: 'note_link',
      text: noteLabel + ' ' + note.noteNumber + ' for order ' + note.orderNumber + ' is ready: ' + link,
      variables: {
        noteType: noteLabel,
        noteNumber: note.noteNumber,
        orderNumber: note.orderNumber,
        link,
      },
    }]
  }

  async function resolveRoleAlert(
    message: NotificationQueueMessage,
    kind: 'pending' | 'approved',
  ): Promise<WhatsAppNotification[]> {
    const storeId = requiredPayloadString(message, 'storeId')
    const noteNumber = requiredPayloadString(message, 'noteNumber')
    const noteType = requiredPayloadString(message, 'noteType')
    const roleCondition = kind === 'pending'
      ? or(eq(users.role, 'store_admin'), eq(users.isDeputyAdmin, true))
      : inArray(users.role, ['sales', 'finance'])
    const recipients = await db
      .select({ id: users.id, name: users.name, phone: users.phone })
      .from(users)
      .where(and(
        eq(users.storeId, storeId),
        eq(users.active, true),
        isNotNull(users.phone),
        roleCondition,
      ))
    if (recipients.length === 0) {
      throw new DataConflictError(
        kind === 'pending'
          ? 'No active Store Admin or deputy has a WhatsApp phone number'
          : 'No active Sales or Finance user has a WhatsApp phone number',
      )
    }
    const readableType = noteType === 'delivery_note' ? 'Delivery Note' : 'Retention Note'
    const statusText = kind === 'pending' ? 'is awaiting approval' : 'was approved'
    const approvalUrl = config.publicAppUrl.replace(/\/$/, '') + '/approvals/' + message.aggregateId
    return recipients.flatMap((recipient) => recipient.phone ? [{
      idempotencyKey: message.idempotencyKey + ':' + recipient.id,
      requestId: message.requestId,
      recipient: {
        kind: 'user' as const,
        id: recipient.id,
        name: recipient.name,
        phone: recipient.phone,
      },
      templateKey: kind === 'pending' ? 'note_pending_approval' as const : 'note_approved' as const,
      text: kind === 'pending'
        ? readableType + ' ' + noteNumber + ' ' + statusText + ': ' + approvalUrl
        : readableType + ' ' + noteNumber + ' ' + statusText + '.',
      variables: {
        noteType: readableType,
        noteNumber,
        status: kind,
        ...(kind === 'pending' ? { approvalUrl } : {}),
      },
    }] : [])
  }

  async function resolveReorderAlert(
    message: NotificationQueueMessage,
  ): Promise<WhatsAppNotification[]> {
    const storeId = requiredPayloadString(message, 'storeId')
    const equipmentName = requiredPayloadString(message, 'equipmentName')
    const currentQuantity = requiredPayloadNumber(message, 'currentQuantity')
    const threshold = requiredPayloadNumber(message, 'threshold')
    const recipients = await db
      .select({ id: users.id, name: users.name, phone: users.phone })
      .from(users)
      .where(and(
        eq(users.storeId, storeId),
        eq(users.active, true),
        isNotNull(users.phone),
        or(eq(users.role, 'store_admin'), eq(users.isDeputyAdmin, true)),
      ))
    if (recipients.length === 0) {
      throw new DataConflictError('No active Store Admin or deputy has a WhatsApp phone number')
    }
    const stockUrl = config.publicAppUrl.replace(/\/$/, '') + '/stock'
    return recipients.flatMap((recipient) => recipient.phone ? [{
      idempotencyKey: message.idempotencyKey + ':' + recipient.id,
      requestId: message.requestId,
      recipient: {
        kind: 'user' as const,
        id: recipient.id,
        name: recipient.name,
        phone: recipient.phone,
      },
      templateKey: 'reorder_threshold' as const,
      text: equipmentName + ' is below its reorder threshold (' + currentQuantity + '/' + threshold + '). Review stock: ' + stockUrl,
      variables: {
        equipmentName,
        currentQuantity: String(currentQuantity),
        threshold: String(threshold),
        stockUrl,
      },
    }] : [])
  }

  return {
    async listFieldStaff(actor: SessionUser): Promise<FieldStaffRecipient[]> {
      if (!actor.storeId) throw new DataConflictError('A store-scoped Sales user is required')
      const recipients = await db
        .select({ id: users.id, name: users.name, phone: users.phone })
        .from(users)
        .where(and(
          eq(users.storeId, actor.storeId),
          eq(users.role, 'field_staff'),
          eq(users.active, true),
          isNotNull(users.phone),
        ))
        .orderBy(users.name)
      return recipients.flatMap((recipient) => recipient.phone ? [{
        id: recipient.id,
        name: recipient.name,
        phoneMasked: maskPhone(recipient.phone),
      }] : [])
    },

    async requireFieldStaff(fieldStaffUserId: string, storeId: string) {
      return requireActiveFieldStaff(db, fieldStaffUserId, storeId)
    },

    async resolve(message: NotificationQueueMessage): Promise<WhatsAppNotification[]> {
      if (message.eventType === 'quotation_created') return resolveQuotation(message)
      if (message.eventType === 'reorder_threshold_breached') return resolveReorderAlert(message)
      if (message.eventType.endsWith('_link_created') || message.eventType.endsWith('_link_regenerated')) {
        return resolveNoteLink(message)
      }
      if (message.eventType.endsWith('_pending_approval')) return resolveRoleAlert(message, 'pending')
      if (message.eventType.endsWith('_approved')) return resolveRoleAlert(message, 'approved')
      throw new DataConflictError('Unsupported notification event: ' + message.eventType)
    },
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>
