import { describe, expect, test } from 'bun:test'

import { REQUEST_ID_HEADER } from '@herms/shared'

import { createApp } from './app'
import type { LogEntry } from './logger'

function createTestLogger() {
  const entries: LogEntry[] = []
  return {
    entries,
    logger: (entry: LogEntry) => entries.push(entry),
  }
}

describe('GET /api/health', () => {
  test('returns the database round-trip time and propagates a request ID', async () => {
    const { logger } = createTestLogger()
    const app = createApp({ healthCheck: async () => 12.34, logger })
    const response = await app.request('/api/health', {
      headers: { [REQUEST_ID_HEADER]: 'phase-0-test' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('phase-0-test')
    expect(await response.json()).toEqual({
      ok: true,
      dbRoundTripMs: 12.34,
      requestId: 'phase-0-test',
    })
  })

  test('replaces an unsafe request ID', async () => {
    const { logger } = createTestLogger()
    const app = createApp({ healthCheck: async () => 1, logger })
    const response = await app.request('/api/health', {
      headers: { [REQUEST_ID_HEADER]: 'unsafe request id' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get(REQUEST_ID_HEADER)).not.toContain(' ')
  })

  test('returns a safe 503 error when Neon is unavailable', async () => {
    const { entries, logger } = createTestLogger()
    const app = createApp({
      healthCheck: async () => {
        throw new Error('connection failed with postgresql://secret-value')
      },
      logger,
    })
    const response = await app.request('/api/health')
    const body = await response.text()

    expect(response.status).toBe(503)
    expect(body).toContain('DATABASE_UNAVAILABLE')
    expect(body).not.toContain('postgresql://')
    expect(JSON.stringify(entries)).not.toContain('secret-value')
  })
})
