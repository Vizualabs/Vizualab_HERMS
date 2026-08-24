import { describe, expect, test } from 'bun:test'

import { parseApiEnv, parseMigrationEnv, parseRuntimeEnv, parseSeedEnv } from './env'

describe('environment validation', () => {
  test('accepts PostgreSQL URLs without exposing their values', () => {
    expect(
      parseRuntimeEnv({
        DATABASE_URL: 'postgresql://user:password@example.test/db',
      }).APP_ENV,
    ).toBe('development')
  })

  test('requires the dedicated migration URL', () => {
    expect(() => parseMigrationEnv({})).toThrow()
  })

  test('rejects short authentication and seed secrets', () => {
    expect(() =>
      parseApiEnv({
        DATABASE_URL: 'postgresql://user:password@example.test/db',
        AUTH_SECRET: 'short',
      }),
    ).toThrow()
    expect(() =>
      parseSeedEnv({
        MIGRATION_DATABASE_URL: 'postgresql://user:password@example.test/db',
        SEED_USER_PASSWORD: 'short',
      }),
    ).toThrow()
  })
})
