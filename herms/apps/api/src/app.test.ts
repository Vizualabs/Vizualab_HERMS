import { describe, expect, test } from 'bun:test'

import type { IdentityService, MasterDataService } from '@herms/db'
import { REQUEST_ID_HEADER, type SessionUser, type UserRole } from '@herms/shared'

import { createApp } from './app'
import type { LogEntry } from './logger'

const TEST_AUTH = {
  secret: 'phase-1-test-secret-that-is-at-least-32-characters',
  ttlSeconds: 28_800,
  secureCookie: false,
}

function user(role: UserRole): SessionUser {
  return {
    id: `00000000-0000-4000-8000-${role.padEnd(12, '0').slice(0, 12)}`,
    storeId:
      role === 'business_owner' || role === 'system_admin'
        ? null
        : '10000000-0000-4000-8000-000000000001',
    name: role,
    role,
    isDeputyAdmin: false,
    email: `${role}@example.test`,
  }
}

function createTestLogger() {
  const entries: LogEntry[] = []
  return {
    entries,
    logger: (entry: LogEntry) => entries.push(entry),
  }
}

function createServices() {
  const users = new Map<UserRole, SessionUser>(
    (
      [
        'business_owner',
        'sales',
        'field_staff',
        'store_admin',
        'finance',
        'system_admin',
      ] as const
    ).map((role) => [role, user(role)]),
  )
  const byId = new Map([...users.values()].map((entry) => [entry.id, entry]))

  const identity = {
    authenticate: async (email: string, password: string) => {
      const match = [...users.values()].find((entry) => entry.email === email)
      return password === 'correct-password' ? match ?? null : null
    },
    findActiveUser: async (id: string) => byId.get(id) ?? null,
  } as IdentityService

  const masterData = {
    listCustomers: async () => [],
    getCustomer: async (id: string) => ({
      id,
      storeId: '10000000-0000-4000-8000-000000000001',
      name: 'Customer',
      type: 'new',
      phone: null,
      email: null,
      address: null,
      outstandingBalanceCents: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      prices: [],
    }),
    createCustomer: async (input: { name: string }) => ({ id: 'customer-1', ...input }),
    updateCustomer: async (id: string, input: object) => ({ id, ...input }),
    setRecurringCustomer: async (id: string, input: object) => ({ id, ...input }),
    listItems: async () => [],
    getItem: async (id: string) => ({ id }),
    createItem: async (input: object) => ({ id: 'item-1', ...input }),
    updateItem: async (id: string, input: object) => ({ id, ...input }),
    changeItemPrice: async (id: string, input: object) => ({ id, ...input }),
    listPriceHistory: async () => [],
    listAuditLogs: async () => [],
  } as unknown as MasterDataService

  return { identity, masterData }
}

function createTestApp(healthCheck: () => Promise<number> = async () => 12.34) {
  const { logger } = createTestLogger()
  const services = createServices()
  return createApp({
    healthCheck,
    ...services,
    auth: TEST_AUTH,
    logger,
  })
}

async function sessionCookie(app: ReturnType<typeof createTestApp>, role: UserRole) {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `${role}@example.test`,
      password: 'correct-password',
    }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=Strict')
  return cookie!.split(';')[0]!
}

describe('Phase 1 API', () => {
  test('returns database health and propagates a safe request ID', async () => {
    const app = createTestApp()
    const response = await app.request('/api/health', {
      headers: { [REQUEST_ID_HEADER]: 'phase-1-test' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('phase-1-test')
    expect(await response.json()).toEqual({
      ok: true,
      dbRoundTripMs: 12.34,
      requestId: 'phase-1-test',
    })
  })

  test('returns a safe 503 without leaking database details', async () => {
    const { entries, logger } = createTestLogger()
    const services = createServices()
    const app = createApp({
      healthCheck: async () => {
        throw new Error('connection failed with postgresql://secret-value')
      },
      ...services,
      auth: TEST_AUTH,
      logger,
    })
    const response = await app.request('/api/health')
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(body).toContain('DATABASE_UNAVAILABLE')
    expect(body).not.toContain('postgresql://')
    expect(JSON.stringify(entries)).not.toContain('secret-value')
  })

  test('logs in, reads the current user, and logs out', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'sales')
    const me = await app.request('/api/me', { headers: { Cookie: cookie } })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { data: SessionUser }
    expect(meBody.data.role).toBe('sales')

    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('rejects invalid credentials and malformed input', async () => {
    const app = createTestApp()
    const invalid = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sales@example.test', password: 'wrong' }),
    })
    expect(invalid.status).toBe(401)

    const malformed = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(malformed.status).toBe(400)
    const malformedBody = (await malformed.json()) as { error: { code: string } }
    expect(malformedBody.error.code).toBe('VALIDATION_ERROR')
  })

  test('requires the recurring transition endpoint for recurring customers', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'sales')
    const response = await app.request('/api/customers', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Invalid recurring customer', type: 'recurring' }),
    })
    expect(response.status).toBe(400)
  })

  test('enforces the Sales authorization boundary', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/customers', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/items', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/audit-logs', { headers: { Cookie: cookie } })).status).toBe(403)
  })

  test('denies Field Staff all back-office master-data routes', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'field_staff')
    expect((await app.request('/api/customers', { headers: { Cookie: cookie } })).status).toBe(403)
    expect((await app.request('/api/items', { headers: { Cookie: cookie } })).status).toBe(403)
    expect((await app.request('/api/audit-logs', { headers: { Cookie: cookie } })).status).toBe(403)
  })

  test('allows System Admin equipment access but not customer access', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'system_admin')
    expect((await app.request('/api/items', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/customers', { headers: { Cookie: cookie } })).status).toBe(403)
    expect((await app.request('/api/audit-logs', { headers: { Cookie: cookie } })).status).toBe(200)
  })
})
