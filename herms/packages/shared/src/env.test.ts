import { describe, expect, test } from 'bun:test'

import {
  parseApiEnv,
  parseMigrationEnv,
  parseNotifierEnv,
  parseOutboxPublisherEnv,
  parseRuntimeEnv,
  parseSeedEnv,
} from './env'

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

  test('supports a credential-free mock WhatsApp provider', () => {
    const env = parseNotifierEnv({
      DATABASE_URL: 'postgresql://user:password@example.test/db',
      NOTE_TOKEN_SECRET: 'notification-test-secret-at-least-32-characters',
      WHATSAPP_PROVIDER_MODE: 'mock',
    })
    expect(env.WHATSAPP_PROVIDER_MODE).toBe('mock')
  })

  test('requires provider credentials only in webhook mode', () => {
    expect(() => parseNotifierEnv({
      DATABASE_URL: 'postgresql://user:password@example.test/db',
      NOTE_TOKEN_SECRET: 'notification-test-secret-at-least-32-characters',
      WHATSAPP_PROVIDER_MODE: 'webhook',
    })).toThrow()
  })

  test('applies the approved outbox retry defaults', () => {
    const env = parseOutboxPublisherEnv({
      DATABASE_URL: 'postgresql://user:password@example.test/db',
      SQS_NOTIFICATION_QUEUE_URL: 'https://sqs.example.test/herms-notifications.fifo',
    })
    expect(env.OUTBOX_BATCH_SIZE).toBe(10)
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(5)
    expect(env.OUTBOX_LEASE_SECONDS).toBe(240)
  })
})
