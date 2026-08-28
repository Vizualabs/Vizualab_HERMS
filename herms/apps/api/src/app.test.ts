import { describe, expect, test } from 'bun:test'

import type {
  CommercialService,
  ClaimService,
  DeliveryService,
  FinanceService,
  IdentityService,
  MasterDataService,
  NotificationService,
  PriceEscalationService,
  RetentionService,
} from '@herms/db'
import { REQUEST_ID_HEADER, type SessionUser, type UserRole } from '@herms/shared'

import { createApp } from './app'
import type { LogEntry } from './logger'

const TEST_AUTH = {
  secret: 'phase-1-test-secret-that-is-at-least-32-characters',
  ttlSeconds: 28_800,
  secureCookie: false,
}

const FIELD_STAFF_ID = '00000000-0000-4000-8000-000000000003'

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

  const notifications = {
    listFieldStaff: async () => [{
      id: FIELD_STAFF_ID,
      name: user('field_staff').name,
      phoneMasked: '•••• 1234',
    }],
  } as unknown as NotificationService

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

  const deliveryNote = {
    id: '70000000-0000-4000-8000-000000000001',
    dnNumber: 'DN-2026-000001',
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    storeId: '10000000-0000-4000-8000-000000000001',
    status: 'pending_approval' as const,
    submittedBy: null,
    approvedBy: null,
    submittedAt: new Date('2026-08-24T01:00:00Z'),
    approvedAt: null,
    createdAt: new Date('2026-08-24T00:30:00Z'),
    updatedAt: new Date('2026-08-24T01:00:00Z'),
    lines: [{
      id: '80000000-0000-4000-8000-000000000001',
      equipmentItemId: quotation.lines[0]!.equipmentItemId,
      equipmentName: 'Test item', unitOfMeasure: 'unit', issuedQty: 1,
      handedOverQty: 1, countedQty: null, mismatchReason: null, mismatchDetail: null,
      countDifference: null,
    }],
  }
  const delivery = {
    resolveTokenType: async () => 'delivery_note' as const,
    createFromOrder: async () => ({ ...deliveryNote, status: 'draft' as const, submissionLink: 'http://localhost:3000/notes/test-token', tokenExpiresAt: new Date() }),
    listForOrder: async () => [deliveryNote],
    getDeliveryNote: async () => deliveryNote,
    getLink: async () => ({ submissionLink: 'http://localhost:3000/notes/test-token', expiresAt: new Date() }),
    regenerateLink: async () => ({ submissionLink: 'http://localhost:3000/notes/new-token', expiresAt: new Date() }),
    readByToken: async () => deliveryNote,
    submitByToken: async () => deliveryNote,
    listApprovals: async () => [deliveryNote],
    countNote: async () => ({ ...deliveryNote, lines: deliveryNote.lines.map((line) => ({ ...line, countedQty: 1, countDifference: 0 })) }),
    approveNote: async () => ({ ...deliveryNote, status: 'approved' as const }),
    rejectNote: async () => ({ ...deliveryNote, status: 'rejected' as const }),
    reopenNote: async () => ({ ...deliveryNote, status: 'reopened' as const, submissionLink: 'http://localhost:3000/notes/reopened-token', tokenExpiresAt: new Date() }),
    listStock: async () => [],
  } as unknown as DeliveryService

  const retentionNote = {
    id: '90000000-0000-4000-8000-000000000001',
    rnNumber: 'RN-2026-000001',
    noteType: 'retention_note' as const,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    deliveryNoteId: null,
    storeId: '10000000-0000-4000-8000-000000000001',
    status: 'pending_approval' as const,
    submittedBy: null,
    approvedBy: null,
    submittedAt: new Date('2026-08-24T02:00:00Z'),
    approvedAt: null,
    createdAt: new Date('2026-08-24T01:30:00Z'),
    updatedAt: new Date('2026-08-24T02:00:00Z'),
    lines: [{
      id: '91000000-0000-4000-8000-000000000001',
      equipmentItemId: quotation.lines[0]!.equipmentItemId,
      equipmentName: 'Test item',
      unitOfMeasure: 'unit',
      deliveredQty: 1,
      returnedQty: 1,
      balanceQty: 0,
      missingDamagedQty: 0,
      countedReturnedQty: null,
      mismatchReason: null,
      responsibleParty: null,
      reasonDetail: null,
      countDifference: null,
      discrepancyId: null,
      discrepancyStatus: null,
      writeOffLedgerId: null,
      writeOffCreatedAt: null,
      writeOffReversed: false,
    }],
  }
  const retention = {
    ownsNote: async (id: string) => id === retentionNote.id,
    createFromOrder: async () => ({
      ...retentionNote,
      status: 'draft' as const,
      submissionLink: 'http://localhost:3000/notes/retention-token',
      tokenExpiresAt: new Date(),
    }),
    listForOrder: async () => [retentionNote],
    getRetentionNote: async () => retentionNote,
    getLink: async () => ({
      submissionLink: 'http://localhost:3000/notes/retention-token',
      expiresAt: new Date(),
    }),
    regenerateLink: async () => ({
      submissionLink: 'http://localhost:3000/notes/new-retention-token',
      expiresAt: new Date(),
    }),
    readByToken: async () => retentionNote,
    submitByToken: async () => retentionNote,
    listApprovals: async () => [retentionNote],
    countNote: async () => ({
      ...retentionNote,
      lines: retentionNote.lines.map((line) => ({
        ...line,
        countedReturnedQty: 1,
        countDifference: 0,
      })),
    }),
    approveNote: async () => ({ ...retentionNote, status: 'approved' as const }),
    rejectNote: async () => ({ ...retentionNote, status: 'rejected' as const }),
    reopenNote: async () => ({
      ...retentionNote,
      status: 'reopened' as const,
      submissionLink: 'http://localhost:3000/notes/reopened-retention-token',
      tokenExpiresAt: new Date(),
    }),
    closeOrder: async () => ({ order: { ...order, status: 'fully_returned' as const }, reconciliation: [] }),
    reverseWriteOff: async (id: string) => ({ discrepancy: { id, status: 'resolved' }, reversalLedgerId: 'ledger-1' }),
    reconciliation: async () => [],
  } as unknown as RetentionService

  const invoice = {
    id: order.id,
    orderNumber: order.orderNumber,
    quotationId: order.quotationId,
    customerId: order.customerId,
    customerName: order.customerName,
    status: order.status,
    createdAt: order.createdAt,
    invoiceValueCents: 2500,
    paidAmountCents: 500,
    outstandingBalanceCents: 2000,
    currency: 'LKR',
    lines: order.lines,
  }
  const finance = {
    getInvoice: async () => invoice,
    recordPayment: async (input: {
      orderId: string
      amountCents: number
      paymentDate: string
      method: string
    }) => ({
      id: '92000000-0000-4000-8000-000000000001',
      customerId: order.customerId,
      createdBy: user('finance').id,
      createdAt: new Date(),
      ...input,
      paymentDate: new Date(input.paymentDate),
    }),
    getCustomerBalance: async () => ({
      id: order.customerId,
      name: order.customerName,
      outstandingBalanceCents: 2000,
      currency: 'LKR',
      orders: [{
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        invoiceValueCents: 2500,
        paidAmountCents: 500,
        outstandingBalanceCents: 2000,
      }],
    }),
    recordExpense: async (input: {
      category: string
      amountCents: number
      expenseDate: string
      description?: string | null
    }) => ({
      id: '93000000-0000-4000-8000-000000000001',
      createdBy: user('finance').id,
      createdAt: new Date(),
      ...input,
      expenseDate: new Date(input.expenseDate),
    }),
    getMonthly: async (month: string) => ({
      month,
      incomeCents: 500,
      expenseCents: 200,
      netPositionCents: 300,
      currency: 'LKR',
      timezone: 'Asia/Colombo',
    }),
  } as unknown as FinanceService

  const damageClaim = {
    id: '94000000-0000-4000-8000-000000000001',
    discrepancyId: '95000000-0000-4000-8000-000000000001',
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    equipmentItemId: quotation.lines[0]!.equipmentItemId,
    equipmentName: 'Test item',
    quantity: 1,
    unitPriceCents: 2500,
    claimAmountCents: 2500,
    status: 'drafted' as const,
    confirmedBy: null,
    confirmedAt: null,
    damageRecordedAt: new Date('2026-08-24T02:00:00Z'),
    reason: 'Broken during use',
    createdAt: new Date('2026-08-25T00:00:00Z'),
    updatedAt: new Date('2026-08-25T00:00:00Z'),
  }
  const claims = {
    getClaim: async () => damageClaim,
    listClaims: async () => [damageClaim],
    listClaimableDiscrepancies: async () => [{
      id: damageClaim.discrepancyId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerName: order.customerName,
      equipmentItemId: damageClaim.equipmentItemId,
      equipmentName: damageClaim.equipmentName,
      quantity: 1,
      reason: damageClaim.reason,
      status: 'written_off' as const,
      damageRecordedAt: damageClaim.damageRecordedAt,
      unitPriceCents: 2500,
      claimAmountCents: 2500,
    }],
    draftClaim: async () => damageClaim,
    confirmClaim: async () => ({
      ...damageClaim,
      status: 'confirmed' as const,
      confirmedBy: user('finance').id,
      confirmedAt: new Date(),
    }),
    rejectClaim: async () => ({ ...damageClaim, status: 'rejected' as const }),
  } as unknown as ClaimService

  const priceEscalation = {
    preview: async () => [{
      itemId: quotation.lines[0]!.equipmentItemId,
      itemName: 'Test item',
      oldPriceCents: 2500,
      newPriceCents: 2750,
    }],
    apply: async () => ({
      effectiveDate: new Date('2026-08-28T00:00:00Z'),
      replayed: false,
      items: [{
        itemId: quotation.lines[0]!.equipmentItemId,
        itemName: 'Test item',
        oldPriceCents: 2500,
        newPriceCents: 2750,
      }],
    }),
  } as unknown as PriceEscalationService

  return {
    identity,
    masterData,
    notifications,
    commercial,
    delivery,
    finance,
    retention,
    claims,
    priceEscalation,
  }
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

describe('Phase 3 API', () => {
  test('opens scoped note-token routes without a login and redacts token paths from logs', async () => {
    const { entries, logger } = createTestLogger()
    const app = createApp({ healthCheck: async () => 1, ...createServices(), auth: TEST_AUTH, logger })
    const response = await app.request('/api/notes/token/highly-sensitive-token-value')
    expect(response.status).toBe(200)
    expect(entries.at(-1)?.path).toBe('/api/notes/token/[REDACTED]')
    expect(JSON.stringify(entries)).not.toContain('highly-sensitive-token-value')
  })

  test('validates public delivery-note submissions', async () => {
    const app = createTestApp()
    const response = await app.request('/api/notes/token/token/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [] }),
    })
    expect(response.status).toBe(400)
  })

  test('allows Sales to create delivery notes but denies Field Staff', async () => {
    const app = createTestApp()
    const salesCookie = await sessionCookie(app, 'sales')
    const created = await app.request('/api/orders/60000000-0000-4000-8000-000000000001/delivery-notes', {
      method: 'POST', headers: { Cookie: salesCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldStaffUserId: FIELD_STAFF_ID, lines: [{ equipmentItemId: '50000000-0000-4000-8000-000000000001', issuedQty: 1 }] }),
    })
    expect(created.status).toBe(201)
    const fieldCookie = await sessionCookie(app, 'field_staff')
    expect((await app.request('/api/orders/id/delivery-notes', {
      method: 'POST', headers: { Cookie: fieldCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldStaffUserId: FIELD_STAFF_ID, lines: [{ equipmentItemId: '50000000-0000-4000-8000-000000000001', issuedQty: 1 }] }),
    })).status).toBe(403)
  })

  test('enforces Store Admin approval and physical-count validation', async () => {
    const app = createTestApp()
    const storeCookie = await sessionCookie(app, 'store_admin')
    expect((await app.request('/api/approvals', { headers: { Cookie: storeCookie } })).status).toBe(200)
    const invalidCount = await app.request('/api/approvals/note/count', {
      method: 'POST', headers: { Cookie: storeCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: [] }),
    })
    expect(invalidCount.status).toBe(400)
    expect((await app.request('/api/approvals/note/approve', {
      method: 'POST', headers: { Cookie: storeCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
    const salesCookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/approvals', { headers: { Cookie: salesCookie } })).status).toBe(403)
  })
})

describe('Phase 4 API', () => {
  test('allows Sales to create retention notes but not Field Staff', async () => {
    const app = createTestApp()
    const salesCookie = await sessionCookie(app, 'sales')
    const created = await app.request(
      '/api/orders/60000000-0000-4000-8000-000000000001/retention-notes',
      {
        method: 'POST',
        headers: { Cookie: salesCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldStaffUserId: FIELD_STAFF_ID,
          lines: [{ equipmentItemId: '50000000-0000-4000-8000-000000000001' }],
        }),
      },
    )
    expect(created.status).toBe(201)
    const fieldCookie = await sessionCookie(app, 'field_staff')
    expect((await app.request('/api/orders/id/retention-notes', {
      method: 'POST',
      headers: { Cookie: fieldCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldStaffUserId: FIELD_STAFF_ID,
        lines: [{ equipmentItemId: '50000000-0000-4000-8000-000000000001' }],
      }),
    })).status).toBe(403)
  })

  test('dispatches retention counts through the reused approval route', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'store_admin')
    const response = await app.request(
      '/api/approvals/90000000-0000-4000-8000-000000000001/count',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: [{
            lineId: '91000000-0000-4000-8000-000000000001',
            countedReturnedQty: 1,
          }],
        }),
      },
    )
    expect(response.status).toBe(200)
  })

  test('restricts order close and write-off reversal to the proper roles', async () => {
    const app = createTestApp()
    const storeCookie = await sessionCookie(app, 'store_admin')
    expect((await app.request('/api/orders/order/close', {
      method: 'POST', headers: { Cookie: storeCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
    expect((await app.request('/api/discrepancies/discrepancy/write-off-reverse', {
      method: 'POST',
      headers: { Cookie: storeCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Count correction' }),
    })).status).toBe(200)
    const salesCookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/orders/order/close', {
      method: 'POST', headers: { Cookie: salesCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(403)
  })
})

describe('Phase 5 API', () => {
  test('lets Sales select an active field staff WhatsApp recipient without exposing the number', async () => {
    const app = createTestApp()
    const salesCookie = await sessionCookie(app, 'sales')
    const response = await app.request('/api/notification-recipients/field-staff', {
      headers: { Cookie: salesCookie },
    })
    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      data: Array<{ id: string; name: string; phoneMasked: string }>
    }
    expect(payload.data).toEqual([{ id: FIELD_STAFF_ID, name: 'field_staff', phoneMasked: '•••• 1234' }])
    expect(JSON.stringify(payload)).not.toContain('+947')

    const fieldCookie = await sessionCookie(app, 'field_staff')
    expect((await app.request('/api/notification-recipients/field-staff', {
      headers: { Cookie: fieldCookie },
    })).status).toBe(403)
  })

  test('validates an explicitly changed recipient when resending note links', async () => {
    const app = createTestApp()
    const salesCookie = await sessionCookie(app, 'sales')
    const response = await app.request(
      '/api/delivery-notes/70000000-0000-4000-8000-000000000001/resend-link',
      {
        method: 'POST',
        headers: { Cookie: salesCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldStaffUserId: 'not-a-uuid' }),
      },
    )
    expect(response.status).toBe(400)
  })
})

describe('Phase 6 API', () => {
  test('allows Finance and Sales to read frozen-price invoices', async () => {
    const app = createTestApp()
    for (const role of ['finance', 'sales'] as const) {
      const cookie = await sessionCookie(app, role)
      const response = await app.request(
        '/api/orders/60000000-0000-4000-8000-000000000001/invoice',
        { headers: { Cookie: cookie } },
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        data: { invoiceValueCents: number; outstandingBalanceCents: number }
      }
      expect(payload.data.invoiceValueCents).toBe(2500)
      expect(payload.data.outstandingBalanceCents).toBe(2000)
    }
    const storeCookie = await sessionCookie(app, 'store_admin')
    expect((await app.request(
      '/api/orders/60000000-0000-4000-8000-000000000001/invoice',
      { headers: { Cookie: storeCookie } },
    )).status).toBe(403)
  })

  test('restricts valid payment and expense creation to Finance', async () => {
    const app = createTestApp()
    const financeCookie = await sessionCookie(app, 'finance')
    const payment = await app.request('/api/payments', {
      method: 'POST',
      headers: { Cookie: financeCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: '60000000-0000-4000-8000-000000000001',
        amountCents: 500,
        paymentDate: '2026-08-27T10:00:00+05:30',
        method: 'bank_transfer',
      }),
    })
    expect(payment.status).toBe(201)

    const expense = await app.request('/api/expenses', {
      method: 'POST',
      headers: { Cookie: financeCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'Transport',
        amountCents: 200,
        expenseDate: '2026-08-27T11:00:00+05:30',
        description: 'Delivery fuel',
      }),
    })
    expect(expense.status).toBe(201)

    const salesCookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/payments', {
      method: 'POST',
      headers: { Cookie: salesCookie, 'Content-Type': 'application/json' },
      body: '{}',
    })).status).toBe(403)
  })

  test('validates finance inputs and exposes role-scoped balance and monthly views', async () => {
    const app = createTestApp()
    const financeCookie = await sessionCookie(app, 'finance')
    expect((await app.request('/api/payments', {
      method: 'POST',
      headers: { Cookie: financeCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'not-a-uuid',
        amountCents: 12.5,
        paymentDate: 'not-a-date',
        method: 'card',
      }),
    })).status).toBe(400)

    expect((await app.request(
      '/api/customers/20000000-0000-4000-8000-000000000001/balance',
      { headers: { Cookie: financeCookie } },
    )).status).toBe(200)
    expect((await app.request('/api/finance/monthly?month=2026-08', {
      headers: { Cookie: financeCookie },
    })).status).toBe(200)
    expect((await app.request('/api/finance/monthly?month=2026-13', {
      headers: { Cookie: financeCookie },
    })).status).toBe(400)

    const ownerCookie = await sessionCookie(app, 'business_owner')
    expect((await app.request('/api/finance/monthly?month=2026-08', {
      headers: { Cookie: ownerCookie },
    })).status).toBe(200)
    expect((await app.request(
      '/api/customers/20000000-0000-4000-8000-000000000001/balance',
      { headers: { Cookie: ownerCookie } },
    )).status).toBe(403)
  })
})

describe('Phase 7 API', () => {
  test('lets Finance draft, confirm, reject, and list damage claims', async () => {
    const app = createTestApp()
    const cookie = await sessionCookie(app, 'finance')
    expect((await app.request('/api/discrepancies/claimable', {
      headers: { Cookie: cookie },
    })).status).toBe(200)
    expect((await app.request('/api/discrepancies/discrepancy/claim', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(201)
    expect((await app.request('/api/claims', { headers: { Cookie: cookie } })).status).toBe(200)
    expect((await app.request('/api/claims/claim/confirm', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
    expect((await app.request('/api/claims/claim/reject', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
  })

  test('allows owners to review claims but keeps claim decisions Finance-only', async () => {
    const app = createTestApp()
    const ownerCookie = await sessionCookie(app, 'business_owner')
    expect((await app.request('/api/claims', { headers: { Cookie: ownerCookie } })).status).toBe(200)
    expect((await app.request('/api/claims/claim/confirm', {
      method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(403)

    expect((await app.request('/api/price-escalation', {
      headers: { Cookie: ownerCookie },
    })).status).toBe(200)
    expect((await app.request('/api/price-escalation', {
      method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(200)
    expect((await app.request('/api/items/item/price', {
      method: 'POST',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPriceCents: 2750, reason: 'owner_escalation' }),
    })).status).toBe(400)

    const financeCookie = await sessionCookie(app, 'finance')
    expect((await app.request('/api/price-escalation', {
      method: 'POST', headers: { Cookie: financeCookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(403)

    const salesCookie = await sessionCookie(app, 'sales')
    expect((await app.request('/api/claims', { headers: { Cookie: salesCookie } })).status).toBe(403)
  })
})
