import { isSuperUser, type SessionUser, type UserRole } from '@herms/shared'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { sign, verify } from 'hono/jwt'

import type { IdentityService } from '@herms/db'
import type { AppEnv } from './request-context'

const SESSION_COOKIE = 'herms_session'
const ISSUER = 'herms-api'
const AUDIENCE = 'herms-web'

export type AuthConfig = {
  secret: string
  ttlSeconds: number
  secureCookie: boolean
}

export async function establishSession(
  c: Context<AppEnv>,
  user: SessionUser,
  config: AuthConfig,
) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = await sign(
    {
      sub: user.id,
      iss: ISSUER,
      aud: AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + config.ttlSeconds,
    },
    config.secret,
    'HS256',
  )
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: 'Strict',
    path: '/',
    maxAge: config.ttlSeconds,
    priority: 'High',
  })
}

export function clearSession(c: Context<AppEnv>, config: AuthConfig) {
  deleteCookie(c, SESSION_COOKIE, {
    path: '/',
    secure: config.secureCookie,
  })
}

export function authenticate(identity: IdentityService, config: AuthConfig): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (!token) {
      return c.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Sign in is required',
            request_id: c.get('requestId'),
          },
        },
        401,
      )
    }

    try {
      const payload = await verify(token, config.secret, 'HS256')
      if (
        payload.iss !== ISSUER ||
        payload.aud !== AUDIENCE ||
        typeof payload.sub !== 'string'
      ) {
        throw new Error('Invalid session claims')
      }
      const user = await identity.findActiveUser(payload.sub)
      if (!user) throw new Error('Inactive or missing user')
      c.set('user', user)
      await next()
    } catch {
      clearSession(c, config)
      return c.json(
        {
          error: {
            code: 'INVALID_SESSION',
            message: 'The session is invalid or expired',
            request_id: c.get('requestId'),
          },
        },
        401,
      )
    }
  })
}

export function requireRoles(...allowed: UserRole[]): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    if (!isSuperUser(user.role) && !allowed.includes(user.role)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Your role does not permit this action',
            request_id: c.get('requestId'),
          },
        },
        403,
      )
    }
    await next()
  })
}

export function requireStoreApprover(): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    if (!isSuperUser(user.role)
      && ((user.role !== 'store_admin' && !user.isDeputyAdmin) || !user.storeId)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Store Admin or Deputy access is required', request_id: c.get('requestId') } }, 403)
    }
    await next()
  })
}

export function requireDeliveryLinkAccess(): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    if (!isSuperUser(user.role)
      && user.role !== 'sales' && user.role !== 'store_admin' && !user.isDeputyAdmin) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Sales, Store Admin, or Deputy access is required', request_id: c.get('requestId') } }, 403)
    }
    await next()
  })
}
