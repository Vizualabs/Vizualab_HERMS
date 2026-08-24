import {
  DataConflictError,
  DataNotFoundError,
  type DbHealthCheck,
  type CommercialService,
  type IdentityService,
  type MasterDataService,
} from '@herms/db'
import {
  customerInputSchema,
  customerUpdateSchema,
  equipmentInputSchema,
  equipmentUpdateSchema,
  loginInputSchema,
  priceChangeInputSchema,
  quotationInputSchema,
  recurringCustomerInputSchema,
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
  type AuthConfig,
} from './auth'
import { jsonLogger, type AppLogger } from './logger'
import { requestContext, type AppEnv } from './request-context'
import { createQuotationPdf } from './quotation-pdf'

export type AppDependencies = {
  healthCheck: DbHealthCheck
  identity: IdentityService
  masterData: MasterDataService
  commercial: CommercialService
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
  commercial,
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
        phase: 2,
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

  app.use('/api/*', authenticate(identity, auth))

  const protectedRoutes = routes
    .post('/api/auth/logout', (c) => {
      clearSession(c, auth)
      return c.json({ ok: true as const })
    })
    .get('/api/me', (c) => c.json({ data: c.get('user') }))

  app.use('/api/customers', requireRoles('business_owner', 'sales'))
  app.use('/api/customers/*', requireRoles('business_owner', 'sales'))

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
    .get('/api/customers/:id', async (c) =>
      c.json({ data: await masterData.getCustomer(c.req.param('id'), c.get('user')) }),
    )
    .put('/api/customers/:id', async (c) => {
      const parsed = await validatedJson(c, customerUpdateSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.updateCustomer(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .put('/api/customers/:id/recurring', async (c) => {
      const parsed = await validatedJson(c, recurringCustomerInputSchema)
      if ('response' in parsed) return parsed.response
      return c.json({
        data: await masterData.setRecurringCustomer(c.req.param('id'), parsed.data, actor(c)),
      })
    })
    .get('/api/customers/:id/prices', async (c) => {
      const customer = await masterData.getCustomer(c.req.param('id'), c.get('user'))
      return c.json({ data: customer.prices })
    })
    .put('/api/customers/:id/prices', async (c) => {
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
    .get('/api/orders', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.listOrders(c.get('user')) }),
    )
    .get('/api/orders/:id', requireRoles('sales'), async (c) =>
      c.json({ data: await commercial.getOrder(c.req.param('id'), c.get('user')) }),
    )

  app.use('/api/audit-logs', requireRoles('business_owner', 'system_admin'))

  const finalRoutes = commercialRoutes.get('/api/audit-logs', async (c) =>
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
