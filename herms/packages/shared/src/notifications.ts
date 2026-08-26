import { z } from 'zod'

export const NOTIFICATION_EVENT_TYPES = [
  'quotation_created',
  'delivery_note_link_created',
  'delivery_note_link_regenerated',
  'retention_note_link_created',
  'retention_note_link_regenerated',
  'delivery_note_pending_approval',
  'retention_note_pending_approval',
  'delivery_note_approved',
  'retention_note_approved',
] as const

export const notificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES)

export const notificationQueueMessageSchema = z.object({
  version: z.literal(1),
  outboxId: z.string().uuid(),
  eventType: notificationEventTypeSchema,
  aggregateType: z.string().trim().min(1).max(80),
  aggregateId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().min(1).max(255),
  requestId: z.string().trim().min(1).max(128),
  occurredAt: z.string().datetime(),
})

export const WHATSAPP_TEMPLATE_KEYS = [
  'quotation_created',
  'note_link',
  'note_pending_approval',
  'note_approved',
] as const

export const whatsAppNotificationSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(320),
  requestId: z.string().trim().min(1).max(128),
  recipient: z.object({
    kind: z.enum(['customer', 'user']),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(1).max(40),
  }),
  templateKey: z.enum(WHATSAPP_TEMPLATE_KEYS),
  text: z.string().trim().min(1).max(4_096),
  variables: z.record(z.string(), z.string()),
  document: z.object({
    kind: z.literal('quotation_pdf'),
    quotationId: z.string().uuid(),
    filename: z.string().trim().min(1).max(180),
  }).optional(),
})

export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>
export type NotificationQueueMessage = z.infer<typeof notificationQueueMessageSchema>
export type WhatsAppNotification = z.infer<typeof whatsAppNotificationSchema>
