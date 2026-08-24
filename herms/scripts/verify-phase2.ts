import { mkdir } from 'node:fs/promises'

import { count, eq } from 'drizzle-orm'

import {
  createDatabase,
  orderLines,
  orders,
  outboxEvents,
  quotationLines,
  quotations,
} from '@herms/db'
import { parseApiEnv, parseSeedEnv } from '@herms/shared'

import app from '../apps/api/src/index'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function login() {
  const response = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sales@herms.local', password: seedEnv.SEED_USER_PASSWORD }),
  })
  assert(response.status === 200, `Sales login failed: ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert(cookie, 'Sales login did not set a session cookie')
  return cookie
}

async function request(path: string, cookie: string, init?: RequestInit) {
  return app.request(path, {
    ...init,
    headers: { Cookie: cookie, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
}

const cookie = await login()
const recurringSetup = await request('/api/customers/30000000-0000-4000-8000-000000000001/recurring', cookie, {
  method: 'PUT',
  headers: { 'X-Request-ID': 'verify-phase2-recurring-setup' },
  body: JSON.stringify({ prices: [
    { equipmentItemId: '40000000-0000-4000-8000-000000000001', unitPriceCents: 125_000 },
    { equipmentItemId: '40000000-0000-4000-8000-000000000002', unitPriceCents: 180_000 },
  ] }),
})
assert(recurringSetup.status === 200, `Recurring fixture setup failed: ${recurringSetup.status}`)
const [outboxBefore] = await db.select({ value: count() }).from(outboxEvents)

const recurringResponse = await request('/api/quotations', cookie, {
  method: 'POST',
  headers: { 'X-Request-ID': 'verify-phase2-recurring' },
  body: JSON.stringify({
    customerId: '30000000-0000-4000-8000-000000000001',
    lines: [
      { equipmentItemId: '40000000-0000-4000-8000-000000000001', quantity: 2 },
      { equipmentItemId: '40000000-0000-4000-8000-000000000002', quantity: 3 },
    ],
  }),
})
assert(recurringResponse.status === 201, `Recurring quotation failed: ${recurringResponse.status}`)
const recurring = (await recurringResponse.json()) as { data: { id: string; quotationNumber: string; totalValueCents: number; lines: Array<{ unitPriceCents: number; lineTotalCents: number }> } }
assert(/^QT-\d{4}-\d{6,}$/.test(recurring.data.quotationNumber), 'Quotation number format is invalid')
assert(recurring.data.lines[0]?.unitPriceCents === 125_000, 'Recurring fixed price was not used')
assert(recurring.data.lines[1]?.unitPriceCents === 180_000, 'Second recurring fixed price was not used')
assert(recurring.data.totalValueCents === 790_000, 'Recurring quotation total is incorrect')

const [outboxAfterCreate] = await db.select({ value: count() }).from(outboxEvents)
assert(outboxBefore && outboxAfterCreate && outboxAfterCreate.value === outboxBefore.value + 1, 'Quotation creation did not append exactly one outbox event')
const [createdEvent] = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, recurring.data.id))
assert(createdEvent?.eventType === 'quotation_created' && createdEvent.status === 'pending', 'Quotation outbox event is invalid')

const pdfResponse = await request(`/api/quotations/${recurring.data.id}/pdf`, cookie)
assert(pdfResponse.status === 200, `Quotation PDF failed: ${pdfResponse.status}`)
assert(pdfResponse.headers.get('content-type') === 'application/pdf', 'Quotation PDF content type is invalid')
const pdf = new Uint8Array(await pdfResponse.arrayBuffer())
assert(new TextDecoder().decode(pdf.slice(0, 5)) === '%PDF-', 'Quotation PDF signature is invalid')
await mkdir('tmp/pdfs', { recursive: true })
await Bun.write('tmp/pdfs/phase-2-verification-quotation.pdf', pdf)

const acceptResponse = await request(`/api/quotations/${recurring.data.id}/accept`, cookie, {
  method: 'POST', headers: { 'X-Request-ID': 'verify-phase2-accept' }, body: '{}',
})
assert(acceptResponse.status === 200, `Quotation acceptance failed: ${acceptResponse.status}`)
const acceptedOrder = (await acceptResponse.json()) as { data: { id: string; orderNumber: string; quotationId: string; totalValueCents: number } }
assert(/^ORD-\d{4}-\d{6,}$/.test(acceptedOrder.data.orderNumber), 'Order number format is invalid')
assert(acceptedOrder.data.quotationId === recurring.data.id, 'Order does not reference its quotation')
assert(acceptedOrder.data.totalValueCents === recurring.data.totalValueCents, 'Order total differs from quotation total')

const frozenQuoteLines = await db.select({ equipmentItemId: quotationLines.equipmentItemId, quantity: quotationLines.quantity, unitPriceCents: quotationLines.unitPriceCents, lineTotalCents: quotationLines.lineTotalCents }).from(quotationLines).where(eq(quotationLines.quotationId, recurring.data.id)).orderBy(quotationLines.equipmentItemId)
const frozenOrderLines = await db.select({ equipmentItemId: orderLines.equipmentItemId, quantity: orderLines.quantity, unitPriceCents: orderLines.unitPriceCents, lineTotalCents: orderLines.lineTotalCents }).from(orderLines).where(eq(orderLines.orderId, acceptedOrder.data.id)).orderBy(orderLines.equipmentItemId)
assert(JSON.stringify(frozenOrderLines) === JSON.stringify(frozenQuoteLines), 'Accepted order lines are not a verbatim quotation copy')
const [outboxAfterAccept] = await db.select({ value: count() }).from(outboxEvents)
assert(outboxAfterAccept?.value === outboxAfterCreate?.value, 'Acceptance unexpectedly created a provider outbox event')

const invalidTransition = await request(`/api/quotations/${recurring.data.id}/reject`, cookie, { method: 'POST', body: '{}' })
assert(invalidTransition.status === 409, 'Invalid accepted-to-rejected transition was not rejected')

const manualResponse = await request('/api/quotations', cookie, {
  method: 'POST', headers: { 'X-Request-ID': 'verify-phase2-manual' },
  body: JSON.stringify({ customerId: '30000000-0000-4000-8000-000000000002', lines: [{ equipmentItemId: '40000000-0000-4000-8000-000000000003', quantity: 4, manualUnitPriceCents: 47_500 }] }),
})
assert(manualResponse.status === 201, `Manual quotation failed: ${manualResponse.status}`)
const manual = (await manualResponse.json()) as { data: { id: string; lines: Array<{ unitPriceCents: number; lineTotalCents: number }> } }
assert(manual.data.lines[0]?.unitPriceCents === 47_500 && manual.data.lines[0]?.lineTotalCents === 190_000, 'New-customer manual pricing is incorrect')

const missingManual = await request('/api/quotations', cookie, {
  method: 'POST',
  body: JSON.stringify({ customerId: '30000000-0000-4000-8000-000000000003', lines: [{ equipmentItemId: '40000000-0000-4000-8000-000000000004', quantity: 1 }] }),
})
assert(missingManual.status === 409, 'A new-customer quotation without manual pricing was accepted')

const [storedQuote] = await db.select().from(quotations).where(eq(quotations.id, recurring.data.id))
const [storedOrder] = await db.select().from(orders).where(eq(orders.id, acceptedOrder.data.id))
assert(storedQuote?.status === 'accepted' && storedOrder?.status === 'open', 'Final quotation/order states are invalid')

console.log(JSON.stringify({
  event: 'phase_2_verification_complete',
  recurringPricingVerified: true,
  manualPricingVerified: true,
  quotationNumber: recurring.data.quotationNumber,
  orderNumber: acceptedOrder.data.orderNumber,
  verbatimOrderLines: frozenOrderLines.length,
  outboxOnCreateOnly: true,
  invalidTransitionRejected: true,
  pdfBytes: pdf.length,
  pdfPath: 'tmp/pdfs/phase-2-verification-quotation.pdf',
}))
