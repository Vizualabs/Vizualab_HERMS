import { count, eq, sql } from 'drizzle-orm'

import {
  auditLogs,
  createDatabase,
  customers,
  equipmentItems,
  priceHistory,
  users,
} from '@herms/db'
import { parseApiEnv, parseSeedEnv, USER_ROLES, type UserRole } from '@herms/shared'

import app from '../apps/api/src/index'

const apiEnv = parseApiEnv(process.env)
const seedEnv = parseSeedEnv(process.env)
const db = createDatabase(apiEnv.DATABASE_URL)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('cause' in error) return errorCode(error.cause)
  return undefined
}

async function login(role: UserRole) {
  const localPart = {
    business_owner: 'owner',
    sales: 'sales',
    field_staff: 'field',
    store_admin: 'store-admin',
    finance: 'finance',
    system_admin: 'system-admin',
  }[role]
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': `verify-login-${role}` },
    body: JSON.stringify({
      email: `${localPart}@herms.local`,
      password: seedEnv.SEED_USER_PASSWORD,
    }),
  })
  assert(response.status === 200, `Login failed for ${role}: ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert(cookie, `Login did not set a cookie for ${role}`)
  return cookie
}

async function status(path: string, cookie: string, init?: RequestInit) {
  const response = await app.request(path, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  return response
}

const [userCount] = await db.select({ value: count() }).from(users)
const [customerCount] = await db.select({ value: count() }).from(customers)
const [itemCount] = await db.select({ value: count() }).from(equipmentItems)
assert(userCount?.value === 6, 'Expected six seeded users')
assert(customerCount?.value === 3, 'Expected three seeded customers')
assert(itemCount?.value === 8, 'Expected eight seeded equipment items')

const roleRows = await db.select({ role: users.role, value: count() }).from(users).groupBy(users.role)
for (const role of USER_ROLES) {
  assert(roleRows.some((row) => row.role === role && row.value === 1), `Expected one ${role} user`)
}

for (const role of USER_ROLES) await login(role)

const salesCookie = await login('sales')
assert((await status('/api/customers', salesCookie)).status === 200, 'Sales must access customers')
assert((await status('/api/items', salesCookie)).status === 200, 'Sales must access equipment')
assert((await status('/api/audit-logs', salesCookie)).status === 403, 'Sales must not access audit logs')

const fieldCookie = await login('field_staff')
assert((await status('/api/customers', fieldCookie)).status === 403, 'Field Staff must not access customers')
assert((await status('/api/items', fieldCookie)).status === 403, 'Field Staff must not access equipment')

const systemCookie = await login('system_admin')
assert((await status('/api/items', systemCookie)).status === 200, 'System Admin must access equipment')
assert((await status('/api/customers', systemCookie)).status === 403, 'System Admin must not access customers')
assert((await status('/api/audit-logs', systemCookie)).status === 200, 'System Admin must access audit logs')

const [demoCustomer] = await db.select().from(customers).orderBy(customers.createdAt).limit(1)
assert(demoCustomer, 'A seeded customer is required')
const [auditBefore] = await db.select({ value: count() }).from(auditLogs)
const updateCustomer = await status(`/api/customers/${demoCustomer.id}`, salesCookie, {
  method: 'PUT',
  body: JSON.stringify({ name: demoCustomer.name }),
  headers: { 'X-Request-ID': 'verify-customer-audit' },
})
assert(updateCustomer.status === 200, `Customer update failed: ${updateCustomer.status}`)
const [auditAfter] = await db.select({ value: count() }).from(auditLogs)
assert(
  auditAfter && auditBefore && auditAfter.value === auditBefore.value + 1,
  'Customer mutation did not create exactly one audit row',
)

const [item] = await db.select().from(equipmentItems).orderBy(equipmentItems.createdAt).limit(1)
assert(item, 'A seeded equipment item is required')
const [historyBefore] = await db
  .select({ value: count() })
  .from(priceHistory)
  .where(eq(priceHistory.equipmentItemId, item.id))
const temporaryPrice = item.currentUnitPriceCents + 1
const change = await status(`/api/items/${item.id}/price`, salesCookie, {
  method: 'POST',
  body: JSON.stringify({ newPriceCents: temporaryPrice, reason: 'correction' }),
  headers: { 'X-Request-ID': 'verify-price-forward' },
})
assert(change.status === 200, `Forward price change failed: ${change.status}`)
const restore = await status(`/api/items/${item.id}/price`, salesCookie, {
  method: 'POST',
  body: JSON.stringify({ newPriceCents: item.currentUnitPriceCents, reason: 'correction' }),
  headers: { 'X-Request-ID': 'verify-price-restore' },
})
assert(restore.status === 200, `Price restoration failed: ${restore.status}`)
const [historyAfter] = await db
  .select({ value: count() })
  .from(priceHistory)
  .where(eq(priceHistory.equipmentItemId, item.id))
assert(
  historyBefore && historyAfter && historyAfter.value === historyBefore.value + 2,
  'Atomic price changes did not append two history entries',
)

for (const [name, table] of [
  ['price_history', priceHistory],
  ['audit_log', auditLogs],
] as const) {
  let rejected = false
  try {
    await db.execute(sql`UPDATE ${table} SET created_at = created_at WHERE id = (SELECT id FROM ${table} LIMIT 1)`)
  } catch (error) {
    rejected = errorCode(error) === '55000'
  }
  assert(rejected, `${name} accepted UPDATE`)
}

const logout = await status('/api/auth/logout', salesCookie, { method: 'POST', body: '{}' })
assert(logout.status === 200, 'Logout failed')

console.log(
  JSON.stringify({
    event: 'phase_1_verification_complete',
    users: userCount.value,
    customers: customerCount.value,
    equipmentItems: itemCount.value,
    rolesVerified: USER_ROLES.length,
    auditMutationVerified: true,
    atomicPriceChangeVerified: true,
    appendOnlyTriggersVerified: 2,
  }),
)
