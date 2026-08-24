import { describe, expect, test } from 'bun:test'

import type { CommercialService, IdentityService, MasterDataService } from '@herms/db'
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

  const quotation = {
    id: '30000000-0000-4000-8000-000000000001',
    quotationNumber: 'QT-2026-000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    customerName: 'Customer',
    customerType: 'new' as const,
    customerPhone: null,
    customerEmail: null,
    customerAddress: null,
    storeName: 'HERMS Main Store',
    storeAddress: null,
    status: 'sent' as const,
    totalValueCents: 2500,
    createdBy: user('sales').id,
    createdAt: new Date('2026-08-24T00:00:00Z'),
    sentAt: new Date('2026-08-24T00:00:00Z'),
    expiresAt: new Date('2026-09-07T00:00:00Z'),
    updatedAt: new Date('2026-08-24T00:00:00Z'),
    currency: 'LKR',
    timezone: 'Asia/Colombo',
    lines: [{
      id: '40000000-0000-4000-8000-000000000001',
      equipmentItemId: '50000000-0000-4000-8000-000000000001',
      equipmentName: 'Test item',
      unitOfMeasure: 'unit',
      quantity: 1,
      unitPriceCents: 2500,
      lineTotalCents: 2500,
    }],
  }
  const order = {
    id: '60000000-0000-4000-8000-000000000001',
    orderNumber: 'ORD-2026-000001',
    quotationId: quotation.id,
    customerId: quotation.customerId,
    customerName: quotation.customerName,
    status: 'open' as const,
    totalValueCents: quotation.totalValueCents,
    createdBy: user('sales').id,
    createdAt: quotation.createdAt,
    updatedAt: quotation.updatedAt,
    currency: 'LKR',
    timezone: 'Asia/Colombo',
    lines: quotation.lines,
  }
  const commercial = {
    listQuotations: async () => [quotation],
    getQuotation: async () => quotation,
    createQuotation: async () => quotation,
    acceptQuotation: async () => order,
    rejectQuotation: async () => ({ ...quotation, status: 'rejected' as const }),
    expireQuotation: async () => ({ ...quotation, status: 'expired' as const }),
    listOrders: async () => [order],
    getOrder: async () => order,
  } as unknown as CommercialService

  return { identity, masterData, commercial }
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

describe('Phase 2 API', () => {
  test('allows Sales quotation/order access and produces a downloadable PDF', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/quotations', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/orders', { headers: { Cookie: cookie } })).status).toBe(200)
    const pdf = await app.request('/api/quotations/30000000-0000-4000-8000-000000000001/pdf', {
      headers: { Cookie: cookie },
    })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toContain('QT-2026-000001.pdf')
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
  })

  test('rejects duplicate quotation lines before the service', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'sales')
    const itemId = '50000000-0000-4000-8000-000000000001'
    const response = await app.request('/api/quotations', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: '20000000-0000-4000-8000-000000000001',
        lines: [
          { equipmentItemId: itemId, quantity: 1, manualUnitPriceCents: 100 },
          { equipmentItemId: itemId, quantity: 1, manualUnitPriceCents: 100 },
        ],
      }),
    })
    expect(response.status).toBe(400)
  })

  test('denies non-Sales roles and only exposes expiry to System Admin', async () => {
    const app = createTestApp()
    const fieldCookie = await sessionCookie(app, 'field_staff')
    expect((await app.request('/api/quotations', { headers: { Cookie: fieldCookie } })).status).toBe(403)
    const systemCookie = await sessionCookie(app, 'system_admin')
    expect((await app.request('/api/quotations', { headers: { Cookie: systemCookie } })).status).toBe(403)
    expect((await app.request('/api/quotations/id/expire', {
      method: 'POST', headers: { Cookie: systemCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
  })
})
