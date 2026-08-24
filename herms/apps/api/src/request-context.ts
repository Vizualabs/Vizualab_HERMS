import { REQUEST_ID_HEADER, resolveRequestId } from '@herms/shared'
import { createMiddleware } from 'hono/factory'

import type { AppLogger } from './logger'

export type AppEnv = {
  Variables: {
    requestId: string
  }
}

export function requestContext(logger: AppLogger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER))
    const startedAt = performance.now()

    c.set('requestId', requestId)

    try {
      await next()
    } finally {
      c.header(REQUEST_ID_HEADER, requestId)
      logger({
        level: 'info',
        event: 'request_completed',
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })
    }
  })
}
