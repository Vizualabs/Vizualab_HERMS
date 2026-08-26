import { asc, inArray } from 'drizzle-orm'

import {
  createDatabase,
  createNotificationService,
  outboxEvents,
} from '@herms/db'
import {
  parseApiEnv,
  parseSeedEnv,
  type NotificationEventType,
  type UserRole,
} from '@herms/shared'

import app from '../apps/api/src/index'
import { createNotifierHandler } from '../apps/notifier/src/index'
import { createMockWhatsAppProvider } from '../apps/notifier/src/provider'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function login(role: Extract<UserRole, 'sales' | 'store_admin'>) {
  const email = role === 'sales' ? 'sales@herms.local' : 'store-admin@herms.local'
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: seedEnv.SEED_USER_PASSWORD }),
  })
  assert(response.status === 200, role + ' login failed: ' + response.status)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert(cookie, role + ' login did not set a cookie')
  return cookie
}

async function request(path: string, cookie?: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
}

function tokenFromLink(link: string) {
  const token = new URL(link).pathname.split('/').filter(Boolean).at(-1)
  assert(token, 'Submission link did not contain a token')
  return decodeURIComponent(token)
}

const salesCookie = await login('sales')
const storeCookie = await login('store_admin')
const recipientResponse = await request('/api/notification-recipients/field-staff', salesCookie)
assert(recipientResponse.status === 200, 'Field staff recipient lookup failed')
const recipientPayload = (await recipientResponse.json()) as {
  data: Array<{ id: string; name: string; phoneMasked: string }>
}
const fieldStaff = recipientPayload.data[0]
assert(fieldStaff, 'Seed an active field staff user with a WhatsApp phone number')
assert(!fieldStaff.phoneMasked.startsWith('+'), 'Recipient API exposed a full phone number')

const quotationResponse = await request('/api/quotations', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    customerId: '30000000-0000-4000-8000-000000000002',
    lines: [{
      equipmentItemId: '40000000-0000-4000-8000-000000000005',
      quantity: 2,
      manualUnitPriceCents: 68_000,
    }],
  }),
})
assert(quotationResponse.status === 201, 'Quotation creation failed')
const quotation = (await quotationResponse.json()) as { data: { id: string } }

const orderResponse = await request('/api/quotations/' + quotation.data.id + '/accept', salesCookie, {
  method: 'POST',
  body: '{}',
})
assert(orderResponse.status === 200, 'Quotation acceptance failed')
const order = (await orderResponse.json()) as {
  data: { id: string; lines: Array<{ equipmentItemId: string }> }
}
const equipmentItemId = order.data.lines[0]?.equipmentItemId
assert(equipmentItemId, 'Order has no equipment line')

const deliveryResponse = await request('/api/orders/' + order.data.id + '/delivery-notes', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    fieldStaffUserId: fieldStaff.id,
    lines: [{ equipmentItemId, issuedQty: 2 }],
  }),
})
assert(deliveryResponse.status === 201, 'Delivery note creation failed')
let delivery = (await deliveryResponse.json()) as {
  data: { id: string; submissionLink: string; lines: Array<{ id: string }> }
}
const deliveryResend = await request('/api/delivery-notes/' + delivery.data.id + '/resend-link', salesCookie, {
  method: 'POST',
  body: '{}',
})
assert(deliveryResend.status === 200, 'Delivery link resend failed')
const deliveryResendPayload = (await deliveryResend.json()) as {
  data: { submissionLink: string }
}
delivery = {
  ...delivery,
  data: { ...delivery.data, submissionLink: deliveryResendPayload.data.submissionLink },
}
const deliveryToken = tokenFromLink(delivery.data.submissionLink)
const deliveryLineId = delivery.data.lines[0]?.id
assert(deliveryLineId, 'Delivery note has no line')
assert((await request('/api/notes/token/' + encodeURIComponent(deliveryToken) + '/submit', undefined, {
  method: 'POST',
  body: JSON.stringify({ lines: [{ lineId: deliveryLineId, handedOverQty: 2 }] }),
})).status === 200, 'Delivery submission failed')
assert((await request('/api/approvals/' + delivery.data.id + '/count', storeCookie, {
  method: 'POST',
  body: JSON.stringify({ lines: [{ lineId: deliveryLineId, countedQty: 2 }] }),
})).status === 200, 'Delivery count failed')
assert((await request('/api/approvals/' + delivery.data.id + '/approve', storeCookie, {
  method: 'POST',
  body: '{}',
})).status === 200, 'Delivery approval failed')

const retentionResponse = await request('/api/orders/' + order.data.id + '/retention-notes', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    fieldStaffUserId: fieldStaff.id,
    lines: [{ equipmentItemId }],
  }),
})
assert(retentionResponse.status === 201, 'Retention note creation failed')
let retention = (await retentionResponse.json()) as {
  data: { id: string; submissionLink: string; lines: Array<{ id: string }> }
}
const retentionResend = await request('/api/retention-notes/' + retention.data.id + '/resend-link', salesCookie, {
  method: 'POST',
  body: '{}',
})
assert(retentionResend.status === 200, 'Retention link resend failed')
const retentionResendPayload = (await retentionResend.json()) as {
  data: { submissionLink: string }
}
retention = {
  ...retention,
  data: { ...retention.data, submissionLink: retentionResendPayload.data.submissionLink },
}
const retentionToken = tokenFromLink(retention.data.submissionLink)
const retentionLineId = retention.data.lines[0]?.id
assert(retentionLineId, 'Retention note has no line')
assert((await request('/api/notes/token/' + encodeURIComponent(retentionToken) + '/submit', undefined, {
  method: 'POST',
  body: JSON.stringify({
    lines: [{
      lineId: retentionLineId,
      returnedQty: 1,
      balanceQty: 1,
      missingDamagedQty: 0,
      mismatchReason: null,
      responsibleParty: null,
      reasonDetail: null,
    }],
  }),
})).status === 200, 'Retention submission failed')
assert((await request('/api/approvals/' + retention.data.id + '/count', storeCookie, {
  method: 'POST',
  body: JSON.stringify({ lines: [{ lineId: retentionLineId, countedReturnedQty: 1 }] }),
})).status === 200, 'Retention count failed')
assert((await request('/api/approvals/' + retention.data.id + '/approve', storeCookie, {
  method: 'POST',
  body: '{}',
})).status === 200, 'Retention approval failed')

const aggregateIds = [quotation.data.id, delivery.data.id, retention.data.id]
const rows = await db.select().from(outboxEvents)
  .where(inArray(outboxEvents.aggregateId, aggregateIds))
  .orderBy(asc(outboxEvents.createdAt))
const expectedTypes: NotificationEventType[] = [
  'quotation_created',
  'delivery_note_link_created',
  'delivery_note_link_regenerated',
  'delivery_note_pending_approval',
  'delivery_note_approved',
  'retention_note_link_created',
  'retention_note_link_regenerated',
  'retention_note_pending_approval',
  'retention_note_approved',
]
for (const expectedType of expectedTypes) {
  assert(rows.some((row) => row.eventType === expectedType), 'Missing outbox event: ' + expectedType)
}

const notifications = createNotificationService(db, {
  businessCurrency: apiEnv.BUSINESS_CURRENCY,
  noteTokenSecret: apiEnv.NOTE_TOKEN_SECRET,
  publicAppUrl: apiEnv.PUBLIC_APP_URL,
})
const provider = createMockWhatsAppProvider()
const notifier = createNotifierHandler({
  notifications,
  provider,
  logger: () => undefined,
})
const event = {
  Records: rows.map((row) => ({
    messageId: row.id,
    body: JSON.stringify({
      version: 1,
      outboxId: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      payload: row.payload,
      idempotencyKey: row.idempotencyKey,
      requestId: typeof row.payload.requestId === 'string'
        ? row.payload.requestId
        : 'phase-5-verification',
      occurredAt: row.createdAt.toISOString(),
    }),
  })),
}
const firstResult = await notifier(event as never)
assert(firstResult.batchItemFailures.length === 0, 'Notifier failed to resolve an application event')
assert(provider.sent.some((item) => item.templateKey === 'quotation_created' && item.document), 'Quotation WhatsApp payload is missing its PDF descriptor')
assert(provider.sent.some((item) => item.templateKey === 'note_link' && item.recipient.id === fieldStaff.id), 'Field staff did not receive a note link')
assert(provider.sent.some((item) => item.templateKey === 'note_pending_approval'), 'Store approval recipients were not resolved')
assert(provider.sent.some((item) => item.templateKey === 'note_approved'), 'Sales and Finance recipients were not resolved')
const deliveredOnce = provider.sent.length
const secondResult = await notifier(event as never)
assert(secondResult.batchItemFailures.length === 0, 'Duplicate notifier invocation failed')
assert(provider.sent.length === deliveredOnce, 'Duplicate notifier invocation sent messages twice')

console.log(JSON.stringify({
  event: 'phase_5_verification_complete',
  providerMode: 'mock',
  fieldStaffSelection: true,
  outboxEventTypesVerified: expectedTypes.length,
  whatsappMessagesResolved: deliveredOnce,
  duplicateDeliverySuppressed: true,
  cloudInfrastructureDeferred: true,
}))
