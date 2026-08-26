import { and, count, eq } from 'drizzle-orm'

import {
  auditLogs,
  createDatabase,
  discrepancies,
  retentionNotes,
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

async function login(role: Extract<UserRole, 'sales' | 'store_admin'>) {
  const email = role === 'sales' ? 'sales@herms.local' : 'store-admin@herms.local'
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

const quotationResponse = await request('/api/quotations', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    customerId: '30000000-0000-4000-8000-000000000002',
    lines: [{
      equipmentItemId: '40000000-0000-4000-8000-000000000005',
      quantity: 100,
      manualUnitPriceCents: 68_000,
    }],
  }),
})
assert(quotationResponse.status === 201, `Quotation creation failed: ${quotationResponse.status}`)
const quotation = (await quotationResponse.json()) as { data: { id: string } }

const acceptedResponse = await request(
  `/api/quotations/${quotation.data.id}/accept`,
  salesCookie,
  { method: 'POST', body: '{}' },
)
assert(acceptedResponse.status === 200, `Order creation failed: ${acceptedResponse.status}`)
const accepted = (await acceptedResponse.json()) as {
  data: { id: string; lines: Array<{ equipmentItemId: string }> }
}
const orderId = accepted.data.id
const equipmentItemId = accepted.data.lines[0]?.equipmentItemId
assert(equipmentItemId, 'Accepted order did not contain the verification item')

const deliveryCreate = await request(`/api/orders/${orderId}/delivery-notes`, salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    fieldStaffUserId,
    lines: [{ equipmentItemId, issuedQty: 100 }],
  }),
})
assert(deliveryCreate.status === 201, `Delivery note creation failed: ${deliveryCreate.status}`)
const delivery = (await deliveryCreate.json()) as {
  data: {
    id: string
    submissionLink: string
    lines: Array<{ id: string }>
  }
}
const deliveryToken = tokenFromLink(delivery.data.submissionLink)
const deliverySubmit = await request(
  `/api/notes/token/${encodeURIComponent(deliveryToken)}/submit`,
  undefined,
  {
    method: 'POST',
    body: JSON.stringify({
      lines: [{ lineId: delivery.data.lines[0]!.id, handedOverQty: 100 }],
    }),
  },
)
assert(deliverySubmit.status === 200, `Delivery submit failed: ${deliverySubmit.status}`)
assert((await request(`/api/approvals/${delivery.data.id}/count`, storeCookie, {
  method: 'POST',
  body: JSON.stringify({
    lines: [{ lineId: delivery.data.lines[0]!.id, countedQty: 100 }],
  }),
})).status === 200, 'Delivery physical count failed')
assert((await request(`/api/approvals/${delivery.data.id}/approve`, storeCookie, {
  method: 'POST',
  body: '{}',
})).status === 200, 'Delivery approval failed')

async function createAndApproveRetention(input: {
  returnedQty: number
  missingDamagedQty: number
  mismatchReason?: 'missing' | 'damaged'
  responsibleParty?: 'customer' | 'staff_member'
}) {
  const createdResponse = await request(
    `/api/orders/${orderId}/retention-notes`,
    salesCookie,
    {
      method: 'POST',
      body: JSON.stringify({
        fieldStaffUserId,
        lines: [{ equipmentItemId }],
      }),
    },
  )
  assert(createdResponse.status === 201, `Retention note creation failed: ${createdResponse.status}`)
  const created = (await createdResponse.json()) as {
    data: {
      id: string
      rnNumber: string
      submissionLink: string
      lines: Array<{ id: string }>
    }
  }
  assert(/^RN-\d{4}-\d{6,}$/.test(created.data.rnNumber), 'Retention note number format is invalid')
  const token = tokenFromLink(created.data.submissionLink)
  const tokenRead = await request(`/api/notes/token/${encodeURIComponent(token)}`)
  assert(tokenRead.status === 200, 'Retention token read failed')
  const tokenPayload = (await tokenRead.json()) as { data: { noteType: string } }
  assert(tokenPayload.data.noteType === 'retention_note', 'Token did not resolve to a retention note')
  const lineId = created.data.lines[0]?.id
  assert(lineId, 'Retention note did not contain a line')

  if (input.missingDamagedQty > 0) {
    const withoutResponsibleParty = await request(
      `/api/notes/token/${encodeURIComponent(token)}/submit`,
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({
          lines: [{
            lineId,
            returnedQty: input.returnedQty,
            balanceQty: 0,
            missingDamagedQty: input.missingDamagedQty,
            mismatchReason: input.mismatchReason,
          }],
        }),
      },
    )
    assert(withoutResponsibleParty.status === 400, 'Shortfall without a responsible party was accepted')
  }

  const submitResponse = await request(
    `/api/notes/token/${encodeURIComponent(token)}/submit`,
    undefined,
    {
      method: 'POST',
      body: JSON.stringify({
        lines: [{
          lineId,
          returnedQty: input.returnedQty,
          balanceQty: 0,
          missingDamagedQty: input.missingDamagedQty,
          mismatchReason: input.mismatchReason ?? null,
          responsibleParty: input.responsibleParty ?? null,
          reasonDetail: input.missingDamagedQty > 0 ? 'Phase 4 verification shortfall' : null,
        }],
      }),
    },
  )
  assert(submitResponse.status === 200, `Retention submit failed: ${submitResponse.status}`)
  const submitPayload = (await submitResponse.json()) as { data: { status: string } }
  assert(submitPayload.data.status === 'pending_approval', 'Retention note did not enter approval')

  const approveWithoutCount = await request(
    `/api/approvals/${created.data.id}/approve`,
    storeCookie,
    { method: 'POST', body: '{}' },
  )
  assert(approveWithoutCount.status === 409, 'Retention approval without a physical count was accepted')
  const countResponse = await request(
    `/api/approvals/${created.data.id}/count`,
    storeCookie,
    {
      method: 'POST',
      body: JSON.stringify({
        lines: [{ lineId, countedReturnedQty: input.returnedQty }],
      }),
    },
  )
  assert(countResponse.status === 200, `Retention physical count failed: ${countResponse.status}`)
  const approveResponse = await request(
    `/api/approvals/${created.data.id}/approve`,
    storeCookie,
    { method: 'POST', body: '{}' },
  )
  assert(approveResponse.status === 200, `Retention approval failed: ${approveResponse.status}`)
  return created.data
}

const firstReturn = await createAndApproveRetention({
  returnedQty: 60,
  missingDamagedQty: 0,
})
const closeAt60 = await request(`/api/orders/${orderId}/close`, storeCookie, {
  method: 'POST',
  body: '{}',
})
assert(closeAt60.status === 409, 'Order closed with only 60 of 100 accounted for')

const secondReturn = await createAndApproveRetention({
  returnedQty: 30,
  missingDamagedQty: 8,
  mismatchReason: 'missing',
  responsibleParty: 'customer',
})
const closeAt98 = await request(`/api/orders/${orderId}/close`, storeCookie, {
  method: 'POST',
  body: '{}',
})
assert(closeAt98.status === 409, 'Order closed with only 98 of 100 accounted for')

const thirdReturn = await createAndApproveRetention({
  returnedQty: 0,
  missingDamagedQty: 2,
  mismatchReason: 'damaged',
  responsibleParty: 'staff_member',
})
const closeAt100 = await request(`/api/orders/${orderId}/close`, storeCookie, {
  method: 'POST',
  body: '{}',
})
assert(closeAt100.status === 200, `Fully reconciled order did not close: ${closeAt100.status}`)
const closePayload = (await closeAt100.json()) as {
  data: {
    order: { status: string }
    reconciliation: Array<{
      deliveredQty: number
      returnedQty: number
      missingDamagedQty: number
      accountedQty: number
    }>
  }
}
assert(closePayload.data.order.status === 'fully_returned', 'Closed order has the wrong status')
const reconciliation = closePayload.data.reconciliation[0]
assert(
  reconciliation?.deliveredQty === 100
    && reconciliation.returnedQty === 90
    && reconciliation.missingDamagedQty === 10
    && reconciliation.accountedQty === 100,
  'Cumulative reconciliation totals are incorrect',
)

const retentionLedgerRows = await db.select().from(stockLedger)
  .where(and(
    eq(stockLedger.sourceType, 'retention_note'),
    eq(stockLedger.equipmentItemId, equipmentItemId),
  ))
const relevantNoteIds = new Set([firstReturn.id, secondReturn.id, thirdReturn.id])
const relevantLedger = retentionLedgerRows.filter((row) => relevantNoteIds.has(row.sourceNoteId))
const returnedTotal = relevantLedger
  .filter((row) => row.direction === 'in')
  .reduce((total, row) => total + row.quantityDelta, 0)
const writtenOffTotal = relevantLedger
  .filter((row) => row.direction === 'write_off')
  .reduce((total, row) => total + row.quantityDelta, 0)
assert(returnedTotal === 90, 'Approved returns did not post 90 stock-in units')
assert(writtenOffTotal === -10, 'Approved shortfalls did not post 10 write-off units')

const [customerShortfall] = await db.select().from(discrepancies).where(and(
  eq(discrepancies.sourceType, 'retention_note'),
  eq(discrepancies.sourceNoteId, secondReturn.id),
))
assert(
  customerShortfall?.status === 'written_off'
    && customerShortfall.quantity === 8
    && customerShortfall.responsibleParty === 'customer',
  'Customer-responsible shortfall was not written off correctly',
)

const reversalResponse = await request(
  `/api/discrepancies/${customerShortfall.id}/write-off-reverse`,
  storeCookie,
  {
    method: 'POST',
    body: JSON.stringify({ reason: 'Verification recount found the equipment' }),
  },
)
assert(reversalResponse.status === 200, `Write-off reversal failed: ${reversalResponse.status}`)
const reversalPayload = (await reversalResponse.json()) as {
  data: { reversalLedgerId: string }
}
const [reversalLedger] = await db.select().from(stockLedger)
  .where(eq(stockLedger.id, reversalPayload.data.reversalLedgerId))
assert(
  reversalLedger?.sourceType === 'write_off_reversal'
    && reversalLedger.direction === 'in'
    && reversalLedger.quantityDelta === 8
    && reversalLedger.reversalOfId,
  'Write-off reversal did not append the exact restoring ledger row',
)
const [resolvedDiscrepancy] = await db.select().from(discrepancies)
  .where(eq(discrepancies.id, customerShortfall.id))
assert(resolvedDiscrepancy?.status === 'resolved', 'Reversal did not resolve the discrepancy')
const duplicateReversal = await request(
  `/api/discrepancies/${customerShortfall.id}/write-off-reverse`,
  storeCookie,
  {
    method: 'POST',
    body: JSON.stringify({ reason: 'Duplicate reversal must fail' }),
  },
)
assert(duplicateReversal.status === 409, 'A discrepancy was reversed twice')

const [approvedRetentionCount] = await db.select({ value: count() }).from(retentionNotes)
  .where(and(eq(retentionNotes.orderId, orderId), eq(retentionNotes.status, 'approved')))
assert(approvedRetentionCount?.value === 3, 'Expected three approved partial retention notes')
const [reversalAuditCount] = await db.select({ value: count() }).from(auditLogs)
  .where(and(
    eq(auditLogs.action, 'stock_ledger.write_off_reverse'),
    eq(auditLogs.entityId, reversalPayload.data.reversalLedgerId),
  ))
assert(reversalAuditCount?.value === 1, 'Write-off reversal audit row is missing')

console.log(JSON.stringify({
  event: 'phase_4_verification_complete',
  orderId,
  partialReturnsApproved: 3,
  prematureCloseAt60Rejected: true,
  incompleteCloseAt98Rejected: true,
  delivered: 100,
  returned: 90,
  missing: 8,
  damaged: 2,
  orderClosed: true,
  stockInPosted: returnedTotal,
  writeOffPosted: -writtenOffTotal,
  reversalRestored: reversalLedger.quantityDelta,
  reversalAudited: true,
}))
