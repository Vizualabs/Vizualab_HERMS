import { and, count, eq, inArray } from 'drizzle-orm'

import {
  auditLogs,
  createDatabase,
  deliveryNoteLines,
  deliveryNotes,
  discrepancies,
  noteTokens,
  outboxEvents,
  stockLedger,
} from '@herms/db'
import { parseApiEnv, parseSeedEnv, type UserRole } from '@herms/shared'

import app from '../apps/api/src/index'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)
const fieldStaffUserId = '20000000-0000-4000-8000-000000000003'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('cause' in error) return errorCode(error.cause)
  return undefined
}

async function login(role: Extract<UserRole, 'sales' | 'store_admin'>) {
  const email = role === 'sales' ? 'sales@herms.local' : 'store-admin@herms.local'
  const response = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: seedEnv.SEED_USER_PASSWORD }),
  })
  assert(response.status === 200, `${role} login failed: ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert(cookie, `${role} login did not set a cookie`)
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
const quotationResponse = await request('/api/quotations', salesCookie, {
  method: 'POST', body: JSON.stringify({
    customerId: '30000000-0000-4000-8000-000000000002',
    lines: [
      { equipmentItemId: '40000000-0000-4000-8000-000000000005', quantity: 3, manualUnitPriceCents: 68_000 },
      { equipmentItemId: '40000000-0000-4000-8000-000000000006', quantity: 2, manualUnitPriceCents: 95_000 },
    ],
  }),
})
assert(quotationResponse.status === 201, `Verification quotation creation failed: ${quotationResponse.status}`)
const quotation = (await quotationResponse.json()) as { data: { id: string } }
const orderResponseFromAccept = await request(`/api/quotations/${quotation.data.id}/accept`, salesCookie, { method: 'POST', body: '{}' })
assert(orderResponseFromAccept.status === 200, `Verification order creation failed: ${orderResponseFromAccept.status}`)
const acceptedOrder = (await orderResponseFromAccept.json()) as { data: { id: string } }
const openOrder = { id: acceptedOrder.data.id }

const [ledgerBefore] = await db.select({ value: count() }).from(stockLedger)
const orderResponse = await request(`/api/orders/${openOrder.id}`, salesCookie)
assert(orderResponse.status === 200, 'Could not load the verification order')
const orderDetail = (await orderResponse.json()) as { data: { lines: Array<{ equipmentItemId: string; quantity: number }> } }
const createInput = {
  fieldStaffUserId,
  lines: orderDetail.data.lines.map((line) => ({
    equipmentItemId: line.equipmentItemId,
    issuedQty: line.quantity - 1,
  })),
}
const createResponse = await request(`/api/orders/${openOrder.id}/delivery-notes`, salesCookie, { method: 'POST', body: JSON.stringify(createInput) })
assert(createResponse.status === 201, `Delivery note creation failed: ${createResponse.status}`)
const created = (await createResponse.json()) as { data: { id: string; dnNumber: string; submissionLink: string; lines: Array<{ id: string; issuedQty: number; equipmentItemId: string }> } }
assert(/^DN-\d{4}-\d{6,}$/.test(created.data.dnNumber), 'Delivery note number format is invalid')
let token = tokenFromLink(created.data.submissionLink)

const [storedToken] = await db.select().from(noteTokens).where(and(eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, created.data.id), inArray(noteTokens.status, ['active', 'used']))).limit(1)
assert(storedToken && storedToken.tokenHash !== token && !storedToken.tokenHash.includes(token), 'Raw note token was stored in the database')

const resend = await request(`/api/delivery-notes/${created.data.id}/resend-link`, salesCookie, { method: 'POST', body: '{}' })
assert(resend.status === 200, `Delivery link regeneration failed: ${resend.status}`)
const regenerated = (await resend.json()) as { data: { submissionLink: string } }
const revokedToken = token
token = tokenFromLink(regenerated.data.submissionLink)
assert((await request(`/api/notes/token/${encodeURIComponent(revokedToken)}`)).status === 409, 'Regenerated link did not revoke its predecessor')
const [resendOutbox] = await db.select({ value: count() }).from(outboxEvents).where(and(eq(outboxEvents.eventType, 'delivery_note_link_regenerated'), eq(outboxEvents.aggregateId, created.data.id)))
assert(resendOutbox?.value === 1, 'Link regeneration did not append one outbox intent')

const tokenRead = await request(`/api/notes/token/${encodeURIComponent(token)}`)
assert(tokenRead.status === 200, `Valid token read failed: ${tokenRead.status}`)

const first = created.data.lines[0]
assert(first && first.issuedQty > 0, 'Delivery note requires a positive first issued quantity')
const missingReasonLines = created.data.lines.map((line, index) => ({
  lineId: line.id,
  handedOverQty: index === 0 ? line.issuedQty - 1 : line.issuedQty,
}))
const missingReason = await request(`/api/notes/token/${encodeURIComponent(token)}/submit`, undefined, {
  method: 'POST', body: JSON.stringify({ lines: missingReasonLines }),
})
assert(missingReason.status === 409, 'A delivery mismatch without a reason was accepted')

const submittedLines = created.data.lines.map((line, index) => ({
  lineId: line.id,
  handedOverQty: index === 0 ? line.issuedQty - 1 : line.issuedQty,
  ...(index === 0 ? { mismatchReason: 'missing', mismatchDetail: 'One unit was not handed over' } : {}),
}))
const submit = await request(`/api/notes/token/${encodeURIComponent(token)}/submit`, undefined, {
  method: 'POST', body: JSON.stringify({ lines: submittedLines }), headers: { 'X-Request-ID': 'verify-phase3-submit' },
})
assert(submit.status === 200, `Delivery note submission failed: ${submit.status}`)
const submitted = (await submit.json()) as { data: { status: string; lines: Array<{ id: string; handedOverQty: number }> } }
assert(submitted.data.status === 'pending_approval', 'Submitted delivery note did not enter pending approval')

const [ledgerAfterSubmit] = await db.select({ value: count() }).from(stockLedger)
assert(ledgerAfterSubmit?.value === ledgerBefore?.value, 'Submitting a delivery note changed stock')
const [discrepancy] = await db.select().from(discrepancies).where(and(eq(discrepancies.sourceType, 'delivery_note'), eq(discrepancies.sourceNoteId, created.data.id)))
assert(discrepancy?.quantity === 1 && discrepancy.discrepancyType === 'missing' && discrepancy.status === 'open', 'Delivery mismatch did not create the expected discrepancy')

const correction = await request(`/api/notes/token/${encodeURIComponent(token)}/submit`, undefined, {
  method: 'POST', body: JSON.stringify({ lines: submittedLines.map((line, index) => index === 0 ? { ...line, mismatchDetail: 'Corrected field explanation' } : line) }),
})
assert(correction.status === 200, 'Field correction before counting was rejected')

const approveWithoutCount = await request(`/api/approvals/${created.data.id}/approve`, storeCookie, { method: 'POST', body: '{}' })
assert(approveWithoutCount.status === 409, 'Approval without a physical count was accepted')

const counts = submitted.data.lines.map((line) => ({ lineId: line.id, countedQty: line.handedOverQty }))
const countResponse = await request(`/api/approvals/${created.data.id}/count`, storeCookie, {
  method: 'POST', body: JSON.stringify({ lines: counts }), headers: { 'X-Request-ID': 'verify-phase3-count' },
})
assert(countResponse.status === 200, `Physical count failed: ${countResponse.status}`)

const correctionAfterCount = await request(`/api/notes/token/${encodeURIComponent(token)}/submit`, undefined, {
  method: 'POST', body: JSON.stringify({ lines: submittedLines }),
})
assert(correctionAfterCount.status === 409, 'Field correction remained open after counting started')

const approveResponse = await request(`/api/approvals/${created.data.id}/approve`, storeCookie, {
  method: 'POST', body: '{}', headers: { 'X-Request-ID': 'verify-phase3-approve' },
})
assert(approveResponse.status === 200, `Approval failed: ${approveResponse.status}`)
const approved = (await approveResponse.json()) as { data: { status: string; lines: Array<{ equipmentItemId: string; countedQty: number }> } }
assert(approved.data.status === 'approved', 'Delivery note did not enter approved status')

const ledgerRows = await db.select().from(stockLedger).where(and(eq(stockLedger.sourceType, 'delivery_note'), eq(stockLedger.sourceNoteId, created.data.id))).orderBy(stockLedger.equipmentItemId)
const expectedPositiveCounts = approved.data.lines.filter((line) => line.countedQty > 0)
assert(ledgerRows.length === expectedPositiveCounts.length, 'Approval posted the wrong number of ledger rows')
for (const row of ledgerRows) {
  const line = approved.data.lines.find((entry) => entry.equipmentItemId === row.equipmentItemId)
  assert(line && row.direction === 'out' && row.quantityDelta === -line.countedQty, 'Ledger movement does not match the physical count')
}

let updateRejected = false
try {
  await db.update(stockLedger).set({ createdAt: new Date() }).where(eq(stockLedger.id, ledgerRows[0]!.id))
} catch (error) {
  updateRejected = errorCode(error) === '55000'
}
assert(updateRejected, 'stock_ledger accepted UPDATE')
let deleteRejected = false
try {
  await db.delete(stockLedger).where(eq(stockLedger.id, ledgerRows[0]!.id))
} catch (error) {
  deleteRejected = errorCode(error) === '55000'
}
assert(deleteRejected, 'stock_ledger accepted DELETE')

const secondInput = {
  fieldStaffUserId,
  lines: orderDetail.data.lines.map((line) => ({
    equipmentItemId: line.equipmentItemId,
    issuedQty: 1,
  })),
}
const secondCreate = await request(`/api/orders/${openOrder.id}/delivery-notes`, salesCookie, { method: 'POST', body: JSON.stringify(secondInput) })
assert(secondCreate.status === 201, 'Second delivery note creation failed')
const second = (await secondCreate.json()) as { data: { id: string; submissionLink: string; lines: Array<{ id: string; equipmentItemId: string; issuedQty: number }> } }
const overDelivery = await request(`/api/orders/${openOrder.id}/delivery-notes`, salesCookie, { method: 'POST', body: JSON.stringify(secondInput) })
assert(overDelivery.status === 409, 'Cumulative delivery quantities exceeded the order')
let unapprovedPostRejected = false
try {
  await db.insert(stockLedger).values({
    equipmentItemId: second.data.lines[0]!.equipmentItemId,
    storeId: '10000000-0000-4000-8000-000000000001',
    sourceType: 'delivery_note', sourceNoteId: second.data.id, direction: 'out', quantityDelta: -1,
  })
} catch (error) {
  unapprovedPostRejected = errorCode(error) === '23514'
}
assert(unapprovedPostRejected, 'An unapproved delivery note posted stock directly')

const secondToken = tokenFromLink(second.data.submissionLink)
const secondSubmit = await request(`/api/notes/token/${encodeURIComponent(secondToken)}/submit`, undefined, {
  method: 'POST', body: JSON.stringify({ lines: second.data.lines.map((line) => ({ lineId: line.id, handedOverQty: line.issuedQty })) }),
})
assert(secondSubmit.status === 200, 'Second partial note submission failed')
assert((await request(`/api/approvals/${second.data.id}/reject`, storeCookie, { method: 'POST', body: '{}' })).status === 200, 'Delivery note rejection failed')
const reopen = await request(`/api/approvals/${second.data.id}/reopen`, storeCookie, { method: 'POST', body: '{}' })
assert(reopen.status === 200, 'Delivery note reopening failed')
const reopened = (await reopen.json()) as { data: { submissionLink: string } }
const expiredToken = tokenFromLink(reopened.data.submissionLink)
await db.update(noteTokens).set({ expiresAt: new Date(Date.now() - 1_000) }).where(and(eq(noteTokens.noteType, 'delivery_note'), eq(noteTokens.noteId, second.data.id), eq(noteTokens.status, 'active')))
const expiredRead = await request(`/api/notes/token/${encodeURIComponent(expiredToken)}`)
assert(expiredRead.status === 409, 'Expired note token was accepted')

const [tokenAudit] = await db.select({ value: count() }).from(auditLogs).where(and(eq(auditLogs.actorType, 'token'), eq(auditLogs.entityId, created.data.id)))
assert(tokenAudit && tokenAudit.value >= 2, 'Token uses were not attributed in the audit log')
const stockResponse = await request('/api/stock', storeCookie)
assert(stockResponse.status === 200, 'Store Admin stock view failed')

console.log(JSON.stringify({
  event: 'phase_3_verification_complete',
  deliveryNoteNumber: created.data.dnNumber,
  submissionDidNotMoveStock: true,
  mismatchDiscrepancyVerified: true,
  correctionBeforeCountVerified: true,
  countGateVerified: true,
  ledgerRowsPosted: ledgerRows.length,
  ledgerAppendOnlyVerified: true,
  unapprovedSourceRejected: true,
  expiredTokenRejected: true,
  cumulativeOverDeliveryRejected: true,
  linkRegenerationVerified: true,
  rejectReopenVerified: true,
  tokenAuditRows: tokenAudit.value,
}))
