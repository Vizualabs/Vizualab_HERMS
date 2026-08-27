import { z } from 'zod'

const postgresUrl = z
  .string()
  .min(1, 'Database URL is required')
  .regex(/^postgres(?:ql)?:\/\//, 'Database URL must use postgresql:// or postgres://')

export const runtimeEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
})

export const apiEnvSchema = runtimeEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must contain at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(28_800),
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BUSINESS_TIMEZONE: z.string().min(1).default('Asia/Colombo'),
  BUSINESS_CURRENCY: z.string().length(3).default('LKR'),
  QUOTATION_EXPIRY_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  QUOTATION_NUMBER_PREFIX: z.string().trim().min(1).max(12).default('QT'),
  ORDER_NUMBER_PREFIX: z.string().trim().min(1).max(12).default('ORD'),
  DELIVERY_NOTE_NUMBER_PREFIX: z.string().trim().min(1).max(12).default('DN'),
  RETENTION_NOTE_NUMBER_PREFIX: z.string().trim().min(1).max(12).default('RN'),
  NOTE_TOKEN_SECRET: z.string().min(32, 'NOTE_TOKEN_SECRET must contain at least 32 characters'),
  NOTE_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(259_200),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
})

export const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_URL: postgresUrl,
})

export const seedEnvSchema = migrationEnvSchema.extend({
  SEED_USER_PASSWORD: z.string().min(12, 'SEED_USER_PASSWORD must contain at least 12 characters'),
  SEED_STORE_NAME: z.string().trim().min(1).max(160).default('HERMS Main Store'),
  SEED_STORE_ADDRESS: z.string().trim().max(500).optional(),
})

export const outboxPublisherEnvSchema = runtimeEnvSchema.extend({
  SQS_NOTIFICATION_QUEUE_URL: z.string().url(),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(240),
})

export const priceEscalationEnvSchema = runtimeEnvSchema.extend({
  PRICE_ESCALATION_EFFECTIVE_DATE: z.string().datetime({ offset: true }),
  PRICE_ESCALATION_MODE: z.enum(['automatic', 'approval_required']).default('automatic'),
})

export const notifierEnvSchema = runtimeEnvSchema.extend({
  BUSINESS_CURRENCY: z.string().length(3).default('LKR'),
  NOTE_TOKEN_SECRET: z.string().min(32, 'NOTE_TOKEN_SECRET must contain at least 32 characters'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  WHATSAPP_PROVIDER_MODE: z.enum(['mock', 'webhook']).default('mock'),
  WHATSAPP_PROVIDER_URL: z.string().url().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_SENDER_ID: z.string().trim().min(1).max(160).optional(),
}).superRefine((value, context) => {
  if (value.WHATSAPP_PROVIDER_MODE !== 'webhook') return
  if (!value.WHATSAPP_PROVIDER_URL) {
    context.addIssue({ code: 'custom', path: ['WHATSAPP_PROVIDER_URL'], message: 'Webhook provider URL is required' })
  }
  if (!value.WHATSAPP_ACCESS_TOKEN) {
    context.addIssue({ code: 'custom', path: ['WHATSAPP_ACCESS_TOKEN'], message: 'Webhook access token is required' })
  }
  if (!value.WHATSAPP_SENDER_ID) {
    context.addIssue({ code: 'custom', path: ['WHATSAPP_SENDER_ID'], message: 'WhatsApp sender ID is required' })
  }
})

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>
export type ApiEnv = z.infer<typeof apiEnvSchema>
export type MigrationEnv = z.infer<typeof migrationEnvSchema>
export type SeedEnv = z.infer<typeof seedEnvSchema>
export type OutboxPublisherEnv = z.infer<typeof outboxPublisherEnvSchema>
export type PriceEscalationEnv = z.infer<typeof priceEscalationEnvSchema>
export type NotifierEnv = z.infer<typeof notifierEnvSchema>

export function parseRuntimeEnv(env: Record<string, string | undefined>): RuntimeEnv {
  return runtimeEnvSchema.parse(env)
}

export function parseApiEnv(env: Record<string, string | undefined>): ApiEnv {
  return apiEnvSchema.parse(env)
}

export function parseMigrationEnv(env: Record<string, string | undefined>): MigrationEnv {
  return migrationEnvSchema.parse(env)
}

export function parseSeedEnv(env: Record<string, string | undefined>): SeedEnv {
  return seedEnvSchema.parse(env)
}

export function parseOutboxPublisherEnv(env: Record<string, string | undefined>): OutboxPublisherEnv {
  return outboxPublisherEnvSchema.parse(env)
}

export function parsePriceEscalationEnv(
  env: Record<string, string | undefined>,
): PriceEscalationEnv {
  return priceEscalationEnvSchema.parse(env)
}

export function parseNotifierEnv(env: Record<string, string | undefined>): NotifierEnv {
  return notifierEnvSchema.parse(env)
}
