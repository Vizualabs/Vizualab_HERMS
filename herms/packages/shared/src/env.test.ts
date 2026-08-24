import { describe, expect, test } from 'bun:test'

import { parseMigrationEnv, parseRuntimeEnv } from './env'

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
})
