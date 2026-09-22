import type { SessionUser } from '@herms/shared'
import { and, desc, eq, isNotNull } from 'drizzle-orm'

import type { Database } from './client'
import { outboxEvents, users } from './schema'
import { DataConflictError } from './services'

export type FieldStaffRecipient = {
  id: string
  name: string
  phoneMasked: string
}

function maskPhone(phone: string) {
  const visible = phone.slice(-4)
  return visible ? '\u2022\u2022\u2022\u2022 ' + visible : 'Configured'
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

export function createNotificationService(db: Database) {
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
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>
