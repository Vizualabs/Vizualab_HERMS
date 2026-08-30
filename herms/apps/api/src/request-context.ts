import { REQUEST_ID_HEADER, resolveRequestId, type SessionUser } from '@herms/shared'
import { createMiddleware } from 'hono/factory'

import type { AppLogger } from './logger'

export type AppEnv = {
  Variables: {
    requestId: string
    user: SessionUser
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
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100
      const path = c.req.path.replace(/(\/api\/notes\/token\/)[^/]+/g, '$1[REDACTED]')
      const sloName = path.startsWith('/api/dashboard') ? 'dashboard_response' : 'api_availability'
      const sloTargetMs = sloName === 'dashboard_response' ? 3_000 : undefined
      c.header(REQUEST_ID_HEADER, requestId)
      c.header('Server-Timing', `app;dur=${durationMs}`)
      logger({
        level: c.res.status >= 500 ? 'error' : 'info',
        event: 'request_completed',
        requestId,
        method: c.req.method,
        path,
        status: c.res.status,
        durationMs,
        sloName,
        ...(sloTargetMs ? { sloTargetMs, sloBreached: durationMs > sloTargetMs } : {}),
      })
    }
  })
}
