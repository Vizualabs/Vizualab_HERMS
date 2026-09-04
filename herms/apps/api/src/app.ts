import {
  DataConflictError,
  DataNotFoundError,
  type DbHealthCheck,
  type ClaimService,
  type CommercialService,
  type DeliveryService,
  type DashboardService,
  type FinanceService,
  type IdentityService,
  type MasterDataService,
  type NotificationService,
  type PriceEscalationService,
  type RetentionService,
} from '@herms/db'
import {
  customerInputSchema,
  customerUpdateSchema,
  dashboardExportQuerySchema,
  dashboardFilterQuerySchema,
  dashboardMonthQuerySchema,
  equipmentInputSchema,
  equipmentUpdateSchema,
  expenseInputSchema,
  financeMonthSchema,
  isSuperUser,
  loginInputSchema,
  noteLinkRecipientSchema,
  priceChangeInputSchema,
  paymentInputSchema,
  quotationInputSchema,
  recurringCustomerInputSchema,
  deliveryNoteSubmissionSchema,
  deliveryNoteCountSchema,
  deliveryNoteCreateSchema,
  retentionNoteCountSchema,
  retentionNoteCreateSchema,
  retentionNoteSubmissionSchema,
  writeOffReversalSchema,
  REQUEST_ID_HEADER,
} from '@herms/shared'
import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'
import { HTTPException } from 'hono/http-exception'
import type { ZodType } from 'zod'

import {
  authenticate,
  clearSession,
  establishSession,
  requireRoles,
  requireStoreApprover,
  requireDeliveryLinkAccess,
  type AuthConfig,
} from './auth'
import { jsonLogger, type AppLogger } from './logger'
import { requestContext, type AppEnv } from './request-context'
import { createQuotationPdf } from './quotation-pdf'
import { createDashboardPdf, createDashboardXlsx } from './dashboard-export'
import { createDeliveryNotePdf, createRetentionNotePdf } from './note-pdf'

export type AppDependencies = {
  healthCheck: DbHealthCheck
  identity: IdentityService
  masterData: MasterDataService
  notifications: NotificationService
  commercial: CommercialService
  delivery: DeliveryService
  dashboard: DashboardService
  finance: FinanceService
  claims: ClaimService
  priceEscalation: PriceEscalationService
  retention: RetentionService
  auth: AuthConfig
  logger?: AppLogger
}

function errorResponse(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
  code: string,
  message: string,
  details?: Array<{ field: string; code: string; message: string }>,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        request_id: c.get('requestId'),
      },
    },
    status,
  )
}

async function validatedJson<T>(c: Context<AppEnv>, schema: ZodType<T>) {
  const raw = await c.req.json().catch(() => null)
  const result = schema.safeParse(raw)
  if (result.success) return { data: result.data }
  return {
    response: errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      'The request contains invalid data',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        code: issue.code,
        message: issue.message,
      })),
    ),
  }
}

function actor(c: Context<AppEnv>) {
  return { ...c.get('user'), requestId: c.get('requestId') }
}

export function createApp({
  healthCheck,
  identity,
  masterData,
  notifications,
  commercial,
  delivery,
  dashboard,
  finance,
  claims,
  priceEscalation,
  retention,
  auth,
  logger = jsonLogger,
}: AppDependencies) {
  const app = new Hono<AppEnv>()

  app.use('*', requestContext(logger))
  app.use('*', secureHeaders())
  app.use('/api/*', csrf())

  const routes = app
    .get('/', (c) =>
      c.json({
        name: 'HERMS API',
        phase: 9,
        health: '/api/health',
      }),
    )
    .get('/api/health', async (c) => {
      const requestId = c.get('requestId')
      try {
        const dbRoundTripMs = await healthCheck()
        return c.json({ ok: true as const, dbRoundTripMs, requestId })
      } catch (error) {
        logger({
          level: 'error',
          event: 'database_health_check_failed',
          requestId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        })
        return errorResponse(c, 503, 'DATABASE_UNAVAILABLE', 'Database health check failed')
      }
    })
    .post('/api/auth/login', async (c) => {
      const parsed = await validatedJson(c, loginInputSchema)
      if ('response' in parsed) return parsed.response
      const user = await identity.authenticate(parsed.data.email, parsed.data.password)
      if (!user) {
        return errorResponse(c, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
      }
      await establishSession(c, user, auth)
      return c.json({ data: user })
    })

  const publicRoutes = routes
    .get('/api/notes/token/:token', async (c) => {
      const token = c.req.param('token')
      const requestId = c.get('requestId')
      const noteType = await delivery.resolveTokenType(token, requestId)
      const data = noteType === 'retention_note'
        ? await retention.readByToken(token, requestId)
        : await delivery.readByToken(token, requestId)
      return c.json({ data })
    })
    .post('/api/notes/token/:token/submit', async (c) => {
      const token = c.req.param('token')
      const requestId = c.get('requestId')
      const noteType = await delivery.resolveTokenType(token, requestId)
      if (noteType === 'retention_note') {
        const parsed = await validatedJson(c, retentionNoteSubmissionSchema)
        if ('response' in parsed) return parsed.response
        const note = await retention.submitByToken(token, parsed.data, requestId)
        return c.json({
          data: { ...note, approvalPath: '/approvals' as const },
        })
      }
      const parsed = await validatedJson(c, deliveryNoteSubmissionSchema)
      if ('response' in parsed) return parsed.response
      const note = await delivery.submitByToken(token, parsed.data, requestId)
      return c.json({
        data: { ...note, approvalPath: '/approvals' as const },
      })
    })

  app.use('/api/*', authenticate(identity, auth))

  const protectedRoutes = publicRoutes
    .post('/api/auth/logout', (c) => {
      clearSession(c, auth)
      return c.json({ ok: true as const })
    })
    .get('/api/me', (c) => c.json({ data: c.get('user') }))

  app.use('/api/customers', requireRoles('business_owner', 'sales'))
  const customerRoutes = protectedRoutes
    .get('/api/customers', async (c) =>
      c.json({ data: await masterData.listCustomers(c.get('user')) }),
    )
    .post('/api/customers', async (c) => {
      const parsed = await validatedJson(c, customerInputSchema)
      if ('response' in parsed) return parsed.response
      const customer = await masterData.createCustomer(parsed.data, actor(c))
      return c.json({ data: customer }, 201)
    })
    .get('/api/customers/:id', requireRoles('business_owner', 'sales'), async (c) =>
      c.json({ data: await masterData.getCustomer(c.req.param('id'), c.get('user')) }),
    )
    .put('/api/customers/:id', requireRoles('business_owner', 'sales'), async (c) => {
      const parsed = await validatedJson(c, customerUpdateSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.updateCustomer(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .put('/api/customers/:id/recurring', requireRoles('business_owner', 'sales'), async (c) => {
      const parsed = await validatedJson(c, recurringCustomerInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.setRecurringCustomer(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .get('/api/customers/:id/prices', requireRoles('business_owner', 'sales'), async (c) => {
      const customer = await masterData.getCustomer(c.req.param('id'), c.get('user'))
      return c.json({ data: customer.prices })
    })
    .put('/api/customers/:id/prices', requireRoles('business_owner', 'sales'), async (c) => {
      const parsed = await validatedJson(c, recurringCustomerInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.setRecurringCustomer(c.req.param('id'), parsed.data, actor(c)),
      })
    })

  app.use('/api/items', requireRoles('business_owner', 'sales', 'system_admin'))
  app.use('/api/items/*', requireRoles('business_owner', 'sales', 'system_admin'))

  const itemRoutes = customerRoutes
    .get('/api/items', async (c) => c.json({ data: await masterData.listItems() }))
    .post('/api/items', async (c) => {
      const parsed = await validatedJson(c, equipmentInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await masterData.createItem(parsed.data, actor(c)) }, 201)
    })
    .get('/api/items/:id', async (c) =>
      c.json({ data: await masterData.getItem(c.req.param('id')) }),
    )
    .put('/api/items/:id', async (c) => {
      const parsed = await validatedJson(c, equipmentUpdateSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.updateItem(c.req.param('id'), parsed.data, actor(c)),
      })
    })

  app.use('/api/items/:id/price', requireRoles('business_owner', 'sales'))
  app.use('/api/items/:id/price-history', requireRoles('business_owner', 'sales'))

  const priceRoutes = itemRoutes
    .post('/api/items/:id/price', async (c) => {
      const parsed = await validatedJson(c, priceChangeInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.changeItemPrice(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .get('/api/items/:id/price-history', async (c) =>
      c.json({ data: await masterData.listPriceHistory(c.req.param('id')) }),
    )

  const commercialRoutes = priceRoutes
    .get('/api/quotations', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.listQuotations(c.get('user')) }),
    )
    .post('/api/quotations', requireRoles('sales'), async (c) => {
      const parsed = await validatedJson(c, quotationInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await commercial.createQuotation(parsed.data, actor(c)) }, 201)
    })
    .get('/api/quotations/:id/pdf', requireRoles('sales'), async (c) => {
      const quotation = await commercial.getQuotation(c.req.param('id'), c.get('user'))
      const pdf = await createQuotationPdf(quotation)
      c.header('Content-Type', 'application/pdf')
      c.header('Content-Disposition', `attachment; filename="${quotation.quotationNumber}.pdf"`)
      return c.body(pdf.buffer as ArrayBuffer)
    })
    .get('/api/quotations/:id', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.getQuotation(c.req.param('id'), c.get('user')) }),
    )
    .post('/api/quotations/:id/accept', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.acceptQuotation(c.req.param('id'), actor(c)) }),
    )
    .post('/api/quotations/:id/reject', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.rejectQuotation(c.req.param('id'), actor(c)) }),
    )
    .post('/api/quotations/:id/expire', requireRoles('sales', 'system_admin'), async (c) =>
      c.json({ data: await commercial.expireQuotation(c.req.param('id'), actor(c)) }),
    )
    .get('/api/orders', requireRoles('sales', 'store_admin', 'finance'), async (c) =>
      c.json({ data: await commercial.listOrders(c.get('user')) }),
    )
    .get('/api/orders/:id', requireRoles('sales', 'store_admin', 'finance'), async (c) =>
      c.json({ data: await commercial.getOrder(c.req.param('id'), c.get('user')) }),
    )

  const financeRoutes = commercialRoutes
    .get('/api/orders/:id/invoice', requireRoles('finance', 'sales'), async (c) =>
      c.json({ data: await finance.getInvoice(c.req.param('id'), c.get('user')) }),
    )
    .post('/api/payments', requireRoles('finance'), async (c) => {
      const parsed = await validatedJson(c, paymentInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await finance.recordPayment(parsed.data, actor(c)) }, 201)
    })
    .get('/api/customers/:id/balance', requireRoles('finance'), async (c) =>
      c.json({ data: await finance.getCustomerBalance(c.req.param('id'), c.get('user')) }),
    )
    .post('/api/expenses', requireRoles('finance'), async (c) => {
      const parsed = await validatedJson(c, expenseInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await finance.recordExpense(parsed.data, actor(c)) }, 201)
    })
    .get('/api/finance/monthly', requireRoles('finance', 'business_owner'), async (c) => {
      const parsed = financeMonthSchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          'VALIDATION_ERROR',
          'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })),
        )
      }
      return c.json({ data: await finance.getMonthly(parsed.data.month) })
    })

  const claimRoutes = financeRoutes
    .get('/api/price-escalation', requireRoles('business_owner'), async (c) =>
      c.json({ data: await priceEscalation.preview() }),
    )
    .post('/api/price-escalation', requireRoles('business_owner'), async (c) =>
      c.json({ data: await priceEscalation.apply(actor(c)) }),
    )
    .get('/api/discrepancies/claimable', requireRoles('finance'), async (c) =>
      c.json({ data: await claims.listClaimableDiscrepancies(c.get('user')) }),
    )
    .post('/api/discrepancies/:id/claim', requireRoles('finance'), async (c) =>
      c.json({ data: await claims.draftClaim(c.req.param('id'), actor(c)) }, 201),
    )
    .get('/api/claims', requireRoles('finance', 'business_owner'), async (c) =>
      c.json({ data: await claims.listClaims(c.get('user')) }),
    )
    .post('/api/claims/:id/confirm', requireRoles('finance'), async (c) =>
      c.json({ data: await claims.confirmClaim(c.req.param('id'), actor(c)) }),
    )
    .post('/api/claims/:id/reject', requireRoles('finance'), async (c) =>
      c.json({ data: await claims.rejectClaim(c.req.param('id'), actor(c)) }),
    )

  const dashboardRoutes = claimRoutes
    .get('/api/dashboard/filter-options', requireRoles('business_owner', 'finance'), async (c) =>
      c.json({ data: await dashboard.getFilterOptions() }),
    )
    .get('/api/dashboard/stock', requireRoles('business_owner', 'finance'), async (c) =>
      c.json({ data: await dashboard.getStock() }),
    )
    .get('/api/dashboard/payments', requireRoles('business_owner', 'finance'), async (c) => {
      const parsed = dashboardMonthQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(c, 400, 'VALIDATION_ERROR', 'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })))
      }
      return c.json({ data: await dashboard.getPayments(parsed.data.month) })
    })
    .get('/api/dashboard/income-expenses', requireRoles('business_owner', 'finance'), async (c) => {
      const parsed = dashboardMonthQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(c, 400, 'VALIDATION_ERROR', 'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })))
      }
      return c.json({ data: await dashboard.getIncomeExpenses(parsed.data.month) })
    })
    .get('/api/dashboard/discrepancies', requireRoles('business_owner', 'finance'), async (c) => {
      const parsed = dashboardFilterQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(c, 400, 'VALIDATION_ERROR', 'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })))
      }
      return c.json({ data: await dashboard.getDiscrepancies(parsed.data) })
    })
    .get('/api/dashboard/rankings', requireRoles('business_owner', 'finance'), async (c) => {
      const parsed = dashboardFilterQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(c, 400, 'VALIDATION_ERROR', 'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })))
      }
      return c.json({ data: await dashboard.getRankings(parsed.data) })
    })
    .get('/api/dashboard/escalations', requireRoles('business_owner'), async (c) =>
      c.json({ data: await dashboard.getEscalations() }),
    )
    .get('/api/dashboard/export', requireRoles('business_owner', 'finance'), async (c) => {
      const parsed = dashboardExportQuerySchema.safeParse(c.req.query())
      if (!parsed.success) {
        return errorResponse(c, 400, 'VALIDATION_ERROR', 'The request contains invalid data',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'query',
            code: issue.code,
            message: issue.message,
          })))
      }
      const report = await dashboard.getReport(
        parsed.data,
        c.get('user').role === 'business_owner' || isSuperUser(c.get('user').role),
      )
      const isPdf = parsed.data.format === 'pdf'
      const body = isPdf
        ? await createDashboardPdf(report)
        : await createDashboardXlsx(report)
      const download = Uint8Array.from(body)
      const extension = isPdf ? 'pdf' : 'xlsx'
      return c.body(download, 200, {
        'Content-Type': isPdf
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="herms-management-${report.filters.month}.${extension}"`,
        'Cache-Control': 'private, no-store',
      })
    })

  const deliveryRoutes = dashboardRoutes
    .get('/api/notification-recipients/field-staff', requireRoles('sales', 'store_admin'), async (c) =>
      c.json({ data: await notifications.listFieldStaff(c.get('user')) }),
    )
    .post('/api/orders/:id/delivery-notes', requireRoles('sales'), async (c) => {
      const parsed = await validatedJson(c, deliveryNoteCreateSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await delivery.createFromOrder(c.req.param('id'), parsed.data, actor(c)) }, 201)
    })
    .get('/api/orders/:id/delivery-notes', requireRoles('sales'), async (c) =>
      c.json({ data: await delivery.listForOrder(c.req.param('id'), c.get('user')) }),
    )
    .post('/api/orders/:id/retention-notes', requireRoles('sales'), async (c) => {
      const parsed = await validatedJson(c, retentionNoteCreateSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await retention.createFromOrder(c.req.param('id'), parsed.data, actor(c)),
      }, 201)
    })
    .get('/api/orders/:id/retention-notes', requireRoles('sales'), async (c) =>
      c.json({ data: await retention.listForOrder(c.req.param('id'), c.get('user')) }),
    )
    .get('/api/delivery-notes/:id/pdf', requireDeliveryLinkAccess(), async (c) => {
      const note = await delivery.getDeliveryNote(c.req.param('id'), c.get('user'))
      const body = await createDeliveryNotePdf(note)
      return c.body(Uint8Array.from(body), 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${note.dnNumber}.pdf"`,
        'Cache-Control': 'private, no-store',
      })
    })
    .get('/api/delivery-notes/:id', requireDeliveryLinkAccess(), async (c) =>
      c.json({ data: await delivery.getDeliveryNote(c.req.param('id'), c.get('user')) }),
    )
    .get('/api/delivery-notes/:id/link', requireDeliveryLinkAccess(), async (c) =>
      c.json({ data: await delivery.getLink(c.req.param('id'), actor(c)) }),
    )
    .post('/api/delivery-notes/:id/resend-link', requireDeliveryLinkAccess(), async (c) => {
      const parsed = await validatedJson(c, noteLinkRecipientSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await delivery.regenerateLink(c.req.param('id'), parsed.data, actor(c)) })
    })
    .get('/api/retention-notes/:id/pdf', requireDeliveryLinkAccess(), async (c) => {
      const note = await retention.getRetentionNote(c.req.param('id'), c.get('user'))
      const body = await createRetentionNotePdf(note)
      return c.body(Uint8Array.from(body), 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${note.rnNumber}.pdf"`,
        'Cache-Control': 'private, no-store',
      })
    })
    .get('/api/retention-notes/:id', requireDeliveryLinkAccess(), async (c) =>
      c.json({ data: await retention.getRetentionNote(c.req.param('id'), c.get('user')) }),
    )
    .get('/api/retention-notes/:id/link', requireDeliveryLinkAccess(), async (c) =>
      c.json({ data: await retention.getLink(c.req.param('id'), actor(c)) }),
    )
    .post('/api/retention-notes/:id/resend-link', requireDeliveryLinkAccess(), async (c) => {
      const parsed = await validatedJson(c, noteLinkRecipientSchema)
      if ('response' in parsed) return parsed.response
      return c.json({ data: await retention.regenerateLink(c.req.param('id'), parsed.data, actor(c)) })
    })
    .get('/api/approvals', requireStoreApprover(), async (c) => {
      const [deliveryRows, retentionRows] = await Promise.all([
        delivery.listApprovals(c.get('user')),
        retention.listApprovals(c.get('user')),
      ])
      const data = [
        ...deliveryRows.map((row) => ({ ...row, noteType: 'delivery_note' as const })),
        ...retentionRows,
      ].sort((left, right) =>
        new Date(right.submittedAt ?? right.createdAt).getTime()
        - new Date(left.submittedAt ?? left.createdAt).getTime())
      return c.json({ data })
    })
    .get('/api/approvals/metrics', requireStoreApprover(), async (c) => {
      const [deliveryMetrics, retentionMetrics] = await Promise.all([
        delivery.approvalMetrics(c.get('user')),
        retention.approvalMetrics(c.get('user')),
      ])
      return c.json({
        data: {
          pendingApproval: deliveryMetrics.pendingApproval + retentionMetrics.pendingApproval,
          approvedToday: deliveryMetrics.approvedToday + retentionMetrics.approvedToday,
          mismatchesFlagged:
            deliveryMetrics.mismatchesFlagged + retentionMetrics.mismatchesFlagged,
        },
      })
    })
    .get('/api/approvals/:noteId', requireStoreApprover(), async (c) => {
      const noteId = c.req.param('noteId')
      const data = await retention.ownsNote(noteId, c.get('user'))
        ? retention.getRetentionNote(noteId, c.get('user'))
        : delivery.getDeliveryNote(noteId, c.get('user'))
      return c.json({ data: await data })
    })
    .post('/api/approvals/:noteId/count', requireStoreApprover(), async (c) => {
      const noteId = c.req.param('noteId')
      const isRetention = await retention.ownsNote(noteId, c.get('user'))
      if (isRetention) {
        const parsed = await validatedJson(c, retentionNoteCountSchema)
        if ('response' in parsed) return parsed.response
        return c.json({
          data: await retention.countNote(noteId, parsed.data, actor(c)),
        })
      }
      const parsed = await validatedJson(c, deliveryNoteCountSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await delivery.countNote(noteId, parsed.data, actor(c)),
      })
    })
    .post('/api/approvals/:noteId/approve', requireStoreApprover(), async (c) => {
      const noteId = c.req.param('noteId')
      const data = await retention.ownsNote(noteId, c.get('user'))
        ? retention.approveNote(noteId, actor(c))
        : delivery.approveNote(noteId, actor(c))
      return c.json({ data: await data })
    })
    .post('/api/approvals/:noteId/reject', requireStoreApprover(), async (c) => {
      const noteId = c.req.param('noteId')
      const data = await retention.ownsNote(noteId, c.get('user'))
        ? retention.rejectNote(noteId, actor(c))
        : delivery.rejectNote(noteId, actor(c))
      return c.json({ data: await data })
    })
    .post('/api/approvals/:noteId/reopen', requireStoreApprover(), async (c) => {
      const noteId = c.req.param('noteId')
      const data = await retention.ownsNote(noteId, c.get('user'))
        ? retention.reopenNote(noteId, actor(c))
        : delivery.reopenNote(noteId, actor(c))
      return c.json({ data: await data })
    })
    .post('/api/orders/:id/close', requireRoles('store_admin'), async (c) =>
      c.json({ data: await retention.closeOrder(c.req.param('id'), actor(c)) }),
    )
    .post('/api/discrepancies/:id/write-off-reverse', requireRoles('store_admin', 'system_admin'), async (c) => {
      const parsed = await validatedJson(c, writeOffReversalSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await retention.reverseWriteOff(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .get('/api/stock/movements', requireStoreApprover(), async (c) =>
      c.json({ data: await delivery.listStockMovements(c.get('user')) }),
    )
    .get('/api/stock', requireStoreApprover(), async (c) =>
      c.json({ data: await delivery.listStock(c.get('user')) }),
    )

  app.use('/api/audit-logs', requireRoles('business_owner', 'system_admin'))

  const finalRoutes = deliveryRoutes.get('/api/audit-logs', async (c) =>
    c.json({ data: await masterData.listAuditLogs() }),
  )

  app.notFound((c) =>
    errorResponse(c, 404, 'NOT_FOUND', 'The requested resource was not found'),
  )

  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 403) {
      return errorResponse(c, 403, 'CSRF_REJECTED', 'The request origin could not be verified')
    }
    if (error instanceof DataNotFoundError) {
      return errorResponse(c, 404, 'NOT_FOUND', error.message)
    }
    if (error instanceof DataConflictError) {
      return errorResponse(c, 409, 'CONFLICT', error.message)
    }
    const requestId = c.get('requestId')
    logger({
      level: 'error',
      event: 'unhandled_request_error',
      requestId,
      errorType: error.name,
    })
    c.header(REQUEST_ID_HEADER, requestId)
    return errorResponse(c, 500, 'INTERNAL_ERROR', 'An unexpected error occurred')
  })

  return finalRoutes
}

export type AppType = ReturnType<typeof createApp>
