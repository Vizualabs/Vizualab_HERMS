import { and, count, eq } from 'drizzle-orm'

import {
  auditLogs,
  createDatabase,
  createEscalationService,
  damageClaims,
  discrepancies,
  priceHistory,
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

async function login(role: Extract<UserRole, 'sales' | 'store_admin' | 'finance' | 'business_owner'>) {
  const email = role === 'business_owner'
    ? 'owner@herms.local'
    : role === 'store_admin'
      ? 'store-admin@herms.local'
      : `${role}@herms.local`
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
const financeCookie = await login('finance')
const ownerCookie = await login('business_owner')
const runKey = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

const customerResponse = await request('/api/customers', salesCookie, {
  method: 'POST',
  body: JSON.stringify({ name: `Phase 7 customer ${runKey}`, type: 'new' }),
})
assert(customerResponse.status === 201, 'Phase 7 customer creation failed')
const customer = (await customerResponse.json()) as { data: { id: string } }

async function createItem(name: string, price: number) {
  const response = await request('/api/items', salesCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: `${name} ${runKey}`,
      category: 'Phase 7 verification',
      unitOfMeasure: 'unit',
      currentUnitPriceCents: price,
    }),
  })
  assert(response.status === 201, `${name} creation failed`)
  return (await response.json()) as { data: { id: string } }
}

const customerItem = await createItem('Customer damage item', 10_000)
const staffItem = await createItem('Staff damage item', 20_000)

const quotationResponse = await request('/api/quotations', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    customerId: customer.data.id,
    lines: [
      { equipmentItemId: customerItem.data.id, quantity: 1, manualUnitPriceCents: 10_000 },
      { equipmentItemId: staffItem.data.id, quantity: 1, manualUnitPriceCents: 20_000 },
    ],
  }),
})
assert(quotationResponse.status === 201, 'Phase 7 quotation creation failed')
const quotation = (await quotationResponse.json()) as { data: { id: string } }
const orderResponse = await request(`/api/quotations/${quotation.data.id}/accept`, salesCookie, {
  method: 'POST', body: '{}',
})
assert(orderResponse.status === 200, 'Phase 7 order creation failed')
const order = (await orderResponse.json()) as { data: { id: string } }

const deliveryResponse = await request(`/api/orders/${order.data.id}/delivery-notes`, salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    fieldStaffUserId,
    lines: [
      { equipmentItemId: customerItem.data.id, issuedQty: 1 },
      { equipmentItemId: staffItem.data.id, issuedQty: 1 },
    ],
  }),
})
assert(deliveryResponse.status === 201, 'Phase 7 delivery note creation failed')
const delivery = (await deliveryResponse.json()) as {
  data: { id: string; submissionLink: string; lines: Array<{ id: string }> }
}
const deliveryToken = tokenFromLink(delivery.data.submissionLink)
assert((await request(`/api/notes/token/${encodeURIComponent(deliveryToken)}/submit`, undefined, {
  method: 'POST',
  body: JSON.stringify({
    lines: delivery.data.lines.map((line) => ({ lineId: line.id, handedOverQty: 1 })),
  }),
})).status === 200, 'Phase 7 delivery submission failed')
assert((await request(`/api/approvals/${delivery.data.id}/count`, storeCookie, {
  method: 'POST',
  body: JSON.stringify({
    lines: delivery.data.lines.map((line) => ({ lineId: line.id, countedQty: 1 })),
  }),
})).status === 200, 'Phase 7 delivery count failed')
assert((await request(`/api/approvals/${delivery.data.id}/approve`, storeCookie, {
  method: 'POST', body: '{}',
})).status === 200, 'Phase 7 delivery approval failed')

const retentionResponse = await request(`/api/orders/${order.data.id}/retention-notes`, salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    fieldStaffUserId,
    lines: [
      { equipmentItemId: customerItem.data.id },
      { equipmentItemId: staffItem.data.id },
    ],
  }),
})
assert(retentionResponse.status === 201, 'Phase 7 retention note creation failed')
const retention = (await retentionResponse.json()) as {
  data: {
    id: string
    submissionLink: string
    lines: Array<{ id: string; equipmentItemId: string }>
  }
}
const retentionToken = tokenFromLink(retention.data.submissionLink)
assert((await request(`/api/notes/token/${encodeURIComponent(retentionToken)}/submit`, undefined, {
  method: 'POST',
  body: JSON.stringify({
    lines: retention.data.lines.map((line) => ({
      lineId: line.id,
      returnedQty: 0,
      balanceQty: 0,
      missingDamagedQty: 1,
      mismatchReason: 'damaged',
      responsibleParty: line.equipmentItemId === customerItem.data.id ? 'customer' : 'staff_member',
      reasonDetail: 'Phase 7 verification damage',
    })),
  }),
})).status === 200, 'Phase 7 retention submission failed')
assert((await request(`/api/approvals/${retention.data.id}/count`, storeCookie, {
  method: 'POST',
  body: JSON.stringify({
    lines: retention.data.lines.map((line) => ({ lineId: line.id, countedReturnedQty: 0 })),
  }),
})).status === 200, 'Phase 7 retention count failed')
assert((await request(`/api/approvals/${retention.data.id}/approve`, storeCookie, {
  method: 'POST', body: '{}',
})).status === 200, 'Phase 7 retention approval failed')

const discrepancyRows = await db.select().from(discrepancies)
  .where(and(
    eq(discrepancies.sourceType, 'retention_note'),
    eq(discrepancies.sourceNoteId, retention.data.id),
  ))
const customerDiscrepancy = discrepancyRows.find((row) => row.responsibleParty === 'customer')
const staffDiscrepancy = discrepancyRows.find((row) => row.responsibleParty === 'staff_member')
assert(customerDiscrepancy && staffDiscrepancy, 'Both verification discrepancies were not recorded')

const staffClaimResponse = await request(
  `/api/discrepancies/${staffDiscrepancy.id}/claim`,
  financeCookie,
  { method: 'POST', body: '{}' },
)
assert(staffClaimResponse.status === 409, 'A staff-responsible discrepancy was accepted as a claim')

const effectiveDate = new Date(customerDiscrepancy.createdAt.getTime() + 1_000)
const escalationRunAt = new Date(effectiveDate.getTime() + 1_000)
const escalation = createEscalationService(db, { effectiveDate, mode: 'automatic' })
const firstRun = await escalation.run(escalationRunAt, `phase7/${runKey}`)
const secondRun = await escalation.run(escalationRunAt, `phase7-retry/${runKey}`)
assert(
  firstRun.escalated.some((row) => row.itemId === customerItem.data.id),
  'The customer damage item was not escalated',
)
assert(secondRun.escalated.length === 0, 'A repeated escalation run created duplicate changes')

const claimableResponse = await request('/api/discrepancies/claimable', financeCookie)
assert(claimableResponse.status === 200, 'Claimable discrepancy lookup failed')
const claimable = (await claimableResponse.json()) as {
  data: Array<{ id: string; unitPriceCents: number; claimAmountCents: number }>
}
const candidate = claimable.data.find((row) => row.id === customerDiscrepancy.id)
assert(candidate?.unitPriceCents === 10_000, 'Claim preview did not use the damage-date price')
assert(!claimable.data.some((row) => row.id === staffDiscrepancy.id), 'Staff damage appeared as claimable')

const balanceBeforeResponse = await request(
  `/api/customers/${customer.data.id}/balance`,
  financeCookie,
)
assert(balanceBeforeResponse.status === 200, 'Initial Phase 7 customer balance lookup failed')
const balanceBefore = (await balanceBeforeResponse.json()) as {
  data: { outstandingBalanceCents: number }
}

const draftResponse = await request(
  `/api/discrepancies/${customerDiscrepancy.id}/claim`,
  financeCookie,
  { method: 'POST', body: '{}' },
)
assert(draftResponse.status === 201, `Claim draft failed: ${draftResponse.status}`)
const draft = (await draftResponse.json()) as {
  data: { id: string; unitPriceCents: number; claimAmountCents: number; status: string }
}
assert(
  draft.data.unitPriceCents === 10_000 && draft.data.claimAmountCents === 10_000,
  'Draft claim did not freeze the damage-date price',
)

const balanceAfterDraftResponse = await request(
  `/api/customers/${customer.data.id}/balance`,
  financeCookie,
)
const balanceAfterDraft = (await balanceAfterDraftResponse.json()) as {
  data: { outstandingBalanceCents: number }
}
assert(
  balanceAfterDraft.data.outstandingBalanceCents === balanceBefore.data.outstandingBalanceCents,
  'Draft claim changed the customer balance before Finance confirmation',
)

assert((await request(`/api/claims/${draft.data.id}/confirm`, ownerCookie, {
  method: 'POST', body: '{}',
})).status === 403, 'Business Owner was allowed to confirm a Finance-gated claim')
const confirmResponse = await request(`/api/claims/${draft.data.id}/confirm`, financeCookie, {
  method: 'POST', body: '{}',
})
assert(confirmResponse.status === 200, `Claim confirmation failed: ${confirmResponse.status}`)

const claimsResponse = await request('/api/claims', financeCookie)
assert(claimsResponse.status === 200, 'Claim register lookup failed')
const claims = (await claimsResponse.json()) as {
  data: Array<{ id: string; status: string; unitPriceCents: number }>
}
assert(
  claims.data.some((claim) => claim.id === draft.data.id
    && claim.status === 'confirmed'
    && claim.unitPriceCents === 10_000),
  'Confirmed damage claim was missing from the claim register',
)

const balanceAfterConfirmResponse = await request(
  `/api/customers/${customer.data.id}/balance`,
  financeCookie,
)
const balanceAfterConfirm = (await balanceAfterConfirmResponse.json()) as {
  data: { outstandingBalanceCents: number }
}
assert(
  balanceAfterConfirm.data.outstandingBalanceCents
    === balanceBefore.data.outstandingBalanceCents + 10_000,
  'Confirmed claim was not added to the customer balance',
)

const invoiceResponse = await request(`/api/orders/${order.data.id}/invoice`, financeCookie)
const invoice = (await invoiceResponse.json()) as {
  data: { orderValueCents: number; claimAmountCents: number; invoiceValueCents: number }
}
assert(
  invoice.data.orderValueCents === 30_000
    && invoice.data.claimAmountCents === 10_000
    && invoice.data.invoiceValueCents === 40_000,
  'Confirmed claim was not integrated into the payable order balance',
)

const [scheduledCount] = await db.select({ value: count() }).from(priceHistory).where(and(
  eq(priceHistory.equipmentItemId, customerItem.data.id),
  eq(priceHistory.effectiveDate, effectiveDate),
  eq(priceHistory.reason, 'scheduled_escalation'),
))
const [claimAuditCount] = await db.select({ value: count() }).from(auditLogs).where(and(
  eq(auditLogs.action, 'damage_claim.confirm'),
  eq(auditLogs.entityId, draft.data.id),
))
const [confirmedClaimCount] = await db.select({ value: count() }).from(damageClaims).where(and(
  eq(damageClaims.id, draft.data.id),
  eq(damageClaims.status, 'confirmed'),
))
assert(scheduledCount?.value === 1, 'Escalation idempotency key did not hold')
assert(claimAuditCount?.value === 1, 'Claim confirmation audit is missing')
assert(confirmedClaimCount?.value === 1, 'Confirmed claim row is missing')

let immutableHistoryRejected = false
try {
  await db.update(priceHistory).set({ newPriceCents: 1 }).where(and(
    eq(priceHistory.equipmentItemId, customerItem.data.id),
    eq(priceHistory.effectiveDate, effectiveDate),
  ))
} catch {
  immutableHistoryRejected = true
}
assert(immutableHistoryRejected, 'The database allowed price history to be updated')

console.log(JSON.stringify({
  event: 'phase_7_verification_complete',
  orderId: order.data.id,
  claimId: draft.data.id,
  damageDatePriceCents: draft.data.unitPriceCents,
  escalatedPriceCents: firstRun.escalated.find((row) => row.itemId === customerItem.data.id)?.newPriceCents,
  staffClaimRejected: true,
  draftBalanceUnchanged: true,
  confirmedBalanceIncreaseCents: 10_000,
  escalationRetryCreatedRows: secondRun.escalated.length,
  immutablePriceHistory: true,
  claimAudited: true,
}))
