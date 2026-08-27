import { and, count, eq } from 'drizzle-orm'

import {
  auditLogs,
  createDatabase,
  payments,
} from '@herms/db'
import { parseApiEnv, parseSeedEnv, type UserRole } from '@herms/shared'

import app from '../apps/api/src/index'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)
const customerId = '30000000-0000-4000-8000-000000000002'
const equipmentItemId = '40000000-0000-4000-8000-000000000005'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function login(role: Extract<UserRole, 'sales' | 'finance' | 'business_owner'>) {
  const email = role === 'business_owner' ? 'owner@herms.local' : `${role}@herms.local`
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

function businessMonth(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: timezone,
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  assert(year && month, 'Could not resolve the business reporting month')
  return `${year}-${month}`
}

const salesCookie = await login('sales')
const financeCookie = await login('finance')
const ownerCookie = await login('business_owner')
const now = new Date()
const month = businessMonth(now, apiEnv.BUSINESS_TIMEZONE)

const balanceBeforeResponse = await request(
  `/api/customers/${customerId}/balance`,
  financeCookie,
)
assert(balanceBeforeResponse.status === 200, 'Initial customer balance lookup failed')
const balanceBefore = (await balanceBeforeResponse.json()) as {
  data: { outstandingBalanceCents: number }
}

const monthlyBeforeResponse = await request(
  `/api/finance/monthly?month=${month}`,
  ownerCookie,
)
assert(monthlyBeforeResponse.status === 200, 'Initial monthly finance lookup failed')
const monthlyBefore = (await monthlyBeforeResponse.json()) as {
  data: { incomeCents: number; expenseCents: number; netPositionCents: number }
}

const quotationResponse = await request('/api/quotations', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    customerId,
    lines: [{
      equipmentItemId,
      quantity: 3,
      manualUnitPriceCents: 12_345,
    }],
  }),
})
assert(quotationResponse.status === 201, 'Quotation creation failed')
const quotation = (await quotationResponse.json()) as { data: { id: string } }

const orderResponse = await request(
  `/api/quotations/${quotation.data.id}/accept`,
  salesCookie,
  { method: 'POST', body: '{}' },
)
assert(orderResponse.status === 200, 'Quotation acceptance failed')
const order = (await orderResponse.json()) as { data: { id: string } }
const invoiceValueCents = 37_035

const invoiceResponse = await request(
  `/api/orders/${order.data.id}/invoice`,
  financeCookie,
)
assert(invoiceResponse.status === 200, 'Invoice lookup failed')
const initialInvoice = (await invoiceResponse.json()) as {
  data: {
    invoiceValueCents: number
    paidAmountCents: number
    outstandingBalanceCents: number
    lines: Array<{ unitPriceCents: number; lineTotalCents: number }>
  }
}
assert(
  initialInvoice.data.invoiceValueCents === invoiceValueCents
    && initialInvoice.data.lines[0]?.unitPriceCents === 12_345
    && initialInvoice.data.lines[0]?.lineTotalCents === invoiceValueCents,
  'Invoice did not use the frozen order-line price',
)

const balanceAfterOrderResponse = await request(
  `/api/customers/${customerId}/balance`,
  financeCookie,
)
const balanceAfterOrder = (await balanceAfterOrderResponse.json()) as {
  data: { outstandingBalanceCents: number }
}
assert(
  balanceAfterOrder.data.outstandingBalanceCents
    === balanceBefore.data.outstandingBalanceCents + invoiceValueCents,
  'Order acceptance did not transactionally increase the customer balance',
)

const paymentAmounts = [10_000, 10_000, 17_035]
const paymentIds: string[] = []
let expectedOutstanding = invoiceValueCents
for (const amountCents of paymentAmounts) {
  const response = await request('/api/payments', financeCookie, {
    method: 'POST',
    body: JSON.stringify({
      orderId: order.data.id,
      amountCents,
      paymentDate: now.toISOString(),
      method: 'bank_transfer',
    }),
  })
  assert(response.status === 201, `Partial payment failed: ${response.status}`)
  const created = (await response.json()) as { data: { id: string } }
  paymentIds.push(created.data.id)
  expectedOutstanding -= amountCents

  const refreshedResponse = await request(
    `/api/orders/${order.data.id}/invoice`,
    financeCookie,
  )
  const refreshed = (await refreshedResponse.json()) as {
    data: { invoiceValueCents: number; outstandingBalanceCents: number }
  }
  assert(
    refreshed.data.invoiceValueCents === invoiceValueCents
      && refreshed.data.outstandingBalanceCents === expectedOutstanding,
    'Partial payment did not leave the exact expected order balance',
  )
}

const overpayment = await request('/api/payments', financeCookie, {
  method: 'POST',
  body: JSON.stringify({
    orderId: order.data.id,
    amountCents: 1,
    paymentDate: now.toISOString(),
    method: 'cash',
  }),
})
assert(overpayment.status === 409, 'An overpayment was accepted')

const salesPayment = await request('/api/payments', salesCookie, {
  method: 'POST',
  body: JSON.stringify({
    orderId: order.data.id,
    amountCents: 1,
    paymentDate: now.toISOString(),
    method: 'cash',
  }),
})
assert(salesPayment.status === 403, 'Sales was allowed to record a payment')

const expenseAmountCents = 4_000
const expenseResponse = await request('/api/expenses', financeCookie, {
  method: 'POST',
  body: JSON.stringify({
    category: 'Phase 6 verification',
    amountCents: expenseAmountCents,
    expenseDate: now.toISOString(),
    description: 'Verification expense row',
  }),
})
assert(expenseResponse.status === 201, 'Expense creation failed')
const expense = (await expenseResponse.json()) as { data: { id: string } }

const finalBalanceResponse = await request(
  `/api/customers/${customerId}/balance`,
  financeCookie,
)
const finalBalance = (await finalBalanceResponse.json()) as {
  data: { outstandingBalanceCents: number }
}
assert(
  finalBalance.data.outstandingBalanceCents === balanceBefore.data.outstandingBalanceCents,
  'Three partial payments did not restore the customer balance to its baseline',
)

const monthlyAfterResponse = await request(
  `/api/finance/monthly?month=${month}`,
  ownerCookie,
)
const monthlyAfter = (await monthlyAfterResponse.json()) as {
  data: { incomeCents: number; expenseCents: number; netPositionCents: number }
}
assert(
  monthlyAfter.data.incomeCents - monthlyBefore.data.incomeCents === invoiceValueCents,
  'Monthly income does not equal the sum of the verification payments',
)
assert(
  monthlyAfter.data.expenseCents - monthlyBefore.data.expenseCents === expenseAmountCents,
  'Monthly expenses do not equal the verification expense row',
)
assert(
  monthlyAfter.data.netPositionCents - monthlyBefore.data.netPositionCents
    === invoiceValueCents - expenseAmountCents,
  'Monthly net position is not income minus expenses',
)

const [paymentAuditCount] = await db
  .select({ value: count() })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, 'payment.create'),
    eq(auditLogs.entityType, 'payment'),
  ))
const [expenseAuditCount] = await db
  .select({ value: count() })
  .from(auditLogs)
  .where(and(
    eq(auditLogs.action, 'expense.create'),
    eq(auditLogs.entityId, expense.data.id),
  ))
assert(
  (paymentAuditCount?.value ?? 0) >= paymentIds.length,
  'Payment audit rows are missing',
)
assert(expenseAuditCount?.value === 1, 'Expense audit row is missing')

let immutablePaymentRejected = false
try {
  await db
    .update(payments)
    .set({ amountCents: 1 })
    .where(eq(payments.id, paymentIds[0]!))
} catch {
  immutablePaymentRejected = true
}
assert(immutablePaymentRejected, 'The database allowed an existing payment to be updated')

console.log(JSON.stringify({
  event: 'phase_6_verification_complete',
  orderId: order.data.id,
  invoiceValueCents,
  partialPayments: paymentAmounts.length,
  finalOrderBalanceCents: expectedOutstanding,
  overpaymentRejected: true,
  immutablePaymentRejected,
  expenseAmountCents,
  monthlyNetDeltaCents: invoiceValueCents - expenseAmountCents,
  paymentAuditsPresent: true,
  expenseAudited: true,
}))
