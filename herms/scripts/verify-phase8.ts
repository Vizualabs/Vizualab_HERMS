import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createDatabase } from '@herms/db'
import { parseApiEnv, parseSeedEnv, type UserRole } from '@herms/shared'
import { sql } from 'drizzle-orm'

import app from '../apps/api/src/index'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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

async function login(role: Extract<UserRole, 'business_owner' | 'finance' | 'sales'>) {
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

function request(path: string, cookie: string) {
  return app.request(path, { headers: { Cookie: cookie } })
}

const month = businessMonth(new Date(), apiEnv.BUSINESS_TIMEZONE)
const ownerCookie = await login('business_owner')
const financeCookie = await login('finance')
const salesCookie = await login('sales')

const stockMismatch = await db.execute<{ mismatches: number | string }>(sql`
  WITH source AS (
    SELECT equipment_item_id, sum(quantity_delta)::bigint AS quantity
    FROM stock_ledger
    GROUP BY equipment_item_id
  )
  SELECT count(*)::integer AS mismatches
  FROM source
  FULL JOIN dashboard_stock_rollup rollup
    ON rollup.equipment_item_id = source.equipment_item_id
  WHERE coalesce(source.quantity, 0) <> coalesce(rollup.quantity, 0)
`)
assert(Number(stockMismatch.rows[0]?.mismatches ?? 0) === 0, 'Stock rollup does not reconcile')

const monthlyMismatch = await db.execute<{ mismatches: number | string }>(sql`
  WITH source_events AS (
    SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Colombo')::date AS month_start,
      total_value_cents::bigint AS invoiced, 0::bigint AS claims,
      0::bigint AS payments, 0::bigint AS expenses
    FROM "order" WHERE status <> 'cancelled'
    UNION ALL
    SELECT date_trunc('month', confirmed_at AT TIME ZONE 'Asia/Colombo')::date,
      0, claim_amount_cents::bigint, 0, 0
    FROM damage_claim WHERE status = 'confirmed' AND confirmed_at IS NOT NULL
    UNION ALL
    SELECT date_trunc('month', payment_date AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, amount_cents::bigint, 0 FROM payment
    UNION ALL
    SELECT date_trunc('month', expense_date AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, 0, amount_cents::bigint FROM expense
  ), source AS (
    SELECT month_start, sum(invoiced)::bigint AS invoiced,
      sum(claims)::bigint AS claims, sum(payments)::bigint AS payments,
      sum(expenses)::bigint AS expenses
    FROM source_events GROUP BY month_start
  )
  SELECT count(*)::integer AS mismatches
  FROM source
  FULL JOIN dashboard_monthly_rollup rollup USING (month_start)
  WHERE coalesce(source.invoiced, 0) <> coalesce(rollup.invoiced_amount_cents, 0)
    OR coalesce(source.claims, 0) <> coalesce(rollup.confirmed_claim_amount_cents, 0)
    OR coalesce(source.payments, 0) <> coalesce(rollup.received_payment_amount_cents, 0)
    OR coalesce(source.expenses, 0) <> coalesce(rollup.expense_amount_cents, 0)
`)
assert(Number(monthlyMismatch.rows[0]?.mismatches ?? 0) === 0, 'Monthly rollup does not reconcile')

const discrepancyMismatch = await db.execute<{ mismatches: number | string }>(sql`
  WITH expected AS (
    SELECT discrepancy.id, discrepancy.status, discrepancy.quantity,
      discrepancy.quantity::bigint * coalesce(
        damage_price.new_price_cents, item.current_unit_price_cents
      )::bigint AS value_cents
    FROM discrepancy
    JOIN equipment_item item ON item.id = discrepancy.equipment_item_id
    LEFT JOIN delivery_note delivery
      ON discrepancy.source_type = 'delivery_note'
      AND delivery.id = discrepancy.source_note_id AND delivery.status = 'approved'
    LEFT JOIN retention_note retention
      ON discrepancy.source_type = 'retention_note'
      AND retention.id = discrepancy.source_note_id AND retention.status = 'approved'
    LEFT JOIN LATERAL (
      SELECT history.new_price_cents
      FROM price_history history
      WHERE history.equipment_item_id = discrepancy.equipment_item_id
        AND history.effective_date <= discrepancy.created_at
      ORDER BY history.effective_date DESC, history.created_at DESC
      LIMIT 1
    ) damage_price ON true
    WHERE discrepancy.discrepancy_type IN ('missing', 'damaged')
      AND (delivery.id IS NOT NULL OR retention.id IS NOT NULL)
  )
  SELECT count(*)::integer AS mismatches
  FROM expected
  FULL JOIN dashboard_discrepancy_rollup rollup
    ON rollup.discrepancy_id = expected.id
  WHERE expected.id IS NULL OR rollup.discrepancy_id IS NULL
    OR expected.status <> rollup.status
    OR expected.quantity <> rollup.quantity
    OR expected.value_cents <> rollup.value_cents
`)
assert(
  Number(discrepancyMismatch.rows[0]?.mismatches ?? 0) === 0,
  'Approved discrepancy rollup does not reconcile',
)

const paths = [
  '/api/dashboard/filter-options',
  '/api/dashboard/stock',
  `/api/dashboard/payments?month=${month}`,
  `/api/dashboard/income-expenses?month=${month}`,
  `/api/dashboard/discrepancies?month=${month}`,
  `/api/dashboard/rankings?month=${month}`,
]
const startedAt = performance.now()
const ownerResponses = await Promise.all(paths.map((path) => request(path, ownerCookie)))
const elapsedMs = performance.now() - startedAt
assert(ownerResponses.every((response) => response.status === 200), 'Owner dashboard request failed')
assert(elapsedMs < 3_000, `Dashboard exceeded 3-second NFR: ${elapsedMs.toFixed(1)}ms`)
for (const path of paths) {
  assert((await request(path, financeCookie)).status === 200, `Finance access failed for ${path}`)
  assert((await request(path, salesCookie)).status === 403, `Sales accessed ${path}`)
}
assert(
  (await request('/api/dashboard/escalations', ownerCookie)).status === 200,
  'Owner escalation dashboard failed',
)
assert(
  (await request('/api/dashboard/escalations', financeCookie)).status === 403,
  'Finance accessed owner-only escalation reporting',
)

const paymentsResponse = await request(`/api/dashboard/payments?month=${month}`, ownerCookie)
const paymentData = (await paymentsResponse.json()) as {
  data: { current: { pendingAmountCents: number; receivedAmountCents: number } }
}
const sourceFinance = await db.execute<{
  pendingAmountCents: number | string
  receivedAmountCents: number | string
}>(sql`
  WITH boundary AS (
    SELECT ${`${month}-01`}::date AS month_start,
      (${`${month}-01`}::date + interval '1 month')::timestamp
        AT TIME ZONE ${apiEnv.BUSINESS_TIMEZONE} AS month_end
  )
  SELECT (
    coalesce((SELECT sum(total_value_cents) FROM "order", boundary
      WHERE status <> 'cancelled' AND created_at < boundary.month_end), 0)
    + coalesce((SELECT sum(claim_amount_cents) FROM damage_claim, boundary
      WHERE status = 'confirmed' AND confirmed_at < boundary.month_end), 0)
    - coalesce((SELECT sum(amount_cents) FROM payment, boundary
      WHERE payment_date < boundary.month_end), 0)
  )::bigint AS "pendingAmountCents",
  coalesce((SELECT sum(amount_cents) FROM payment, boundary
    WHERE payment_date >= boundary.month_start::timestamp AT TIME ZONE ${apiEnv.BUSINESS_TIMEZONE}
      AND payment_date < boundary.month_end), 0)::bigint AS "receivedAmountCents"
`)
assert(
  paymentData.data.current.pendingAmountCents
    === Number(sourceFinance.rows[0]?.pendingAmountCents ?? 0),
  'Pending payment total does not reconcile to invoice and confirmed-claim balances',
)
assert(
  paymentData.data.current.receivedAmountCents
    === Number(sourceFinance.rows[0]?.receivedAmountCents ?? 0),
  'Received payment total does not reconcile',
)

const pdfResponse = await request(
  `/api/dashboard/export?format=pdf&month=${month}`,
  ownerCookie,
)
const xlsxResponse = await request(
  `/api/dashboard/export?format=xlsx&month=${month}`,
  financeCookie,
)
assert(pdfResponse.status === 200, 'PDF export failed')
assert(xlsxResponse.status === 200, 'Excel export failed')
const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer())
const xlsxBytes = new Uint8Array(await xlsxResponse.arrayBuffer())
assert(new TextDecoder().decode(pdfBytes.slice(0, 4)) === '%PDF', 'PDF signature is invalid')
assert(xlsxBytes[0] === 0x50 && xlsxBytes[1] === 0x4b, 'Excel signature is invalid')

const outputDirectory = resolve(import.meta.dir, '../../tmp/phase8')
await mkdir(outputDirectory, { recursive: true })
const pdfPath = resolve(outputDirectory, `herms-management-${month}.pdf`)
const xlsxPath = resolve(outputDirectory, `herms-management-${month}.xlsx`)
await Promise.all([Bun.write(pdfPath, pdfBytes), Bun.write(xlsxPath, xlsxBytes)])

console.log(JSON.stringify({
  event: 'phase_8_verification_complete',
  month,
  rollupsReconciled: true,
  pendingPaymentsReconciled: true,
  ownerAndFinanceAccess: true,
  escalationOwnerOnly: true,
  rankingLimit: 10,
  dashboardLoadMs: Number(elapsedMs.toFixed(1)),
  pdfPath,
  xlsxPath,
}))
