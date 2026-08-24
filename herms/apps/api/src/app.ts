import type { DbHealthCheck } from '@herms/db'
import { REQUEST_ID_HEADER } from '@herms/shared'
import { Hono } from 'hono'

import { jsonLogger, type AppLogger } from './logger'
import { requestContext, type AppEnv } from './request-context'

export type AppDependencies = {
  healthCheck: DbHealthCheck
  logger?: AppLogger
}

export function createApp({ healthCheck, logger = jsonLogger }: AppDependencies) {
  const app = new Hono<AppEnv>()

  app.use('*', requestContext(logger))

  const routes = app
    .get('/', (c) =>
      c.json({
        name: 'HERMS API',
        phase: 0,
        health: '/api/health',
      }),
    )
    .get('/api/health', async (c) => {
      const requestId = c.get('requestId')

      try {
        const dbRoundTripMs = await healthCheck()

        return c.json({
          ok: true as const,
          dbRoundTripMs,
          requestId,
        })
      } catch (error) {
        logger({
          level: 'error',
          event: 'database_health_check_failed',
          requestId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        })

        return c.json(
          {
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: 'Database health check failed',
              request_id: requestId,
            },
          },
          503,
        )
      }
    })

  app.notFound((c) => {
    const requestId = c.get('requestId')

    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found',
          request_id: requestId,
        },
      },
      404,
    )
  })

  app.onError((error, c) => {
    const requestId = c.get('requestId')

    logger({
      level: 'error',
      event: 'unhandled_request_error',
      requestId,
      errorType: error.name,
    })
    c.header(REQUEST_ID_HEADER, requestId)

    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          request_id: requestId,
        },
      },
      500,
    )
  })

  return routes
}

export type AppType = ReturnType<typeof createApp>
