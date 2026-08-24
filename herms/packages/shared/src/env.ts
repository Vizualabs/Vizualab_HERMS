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
})

export const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_URL: postgresUrl,
})

export const seedEnvSchema = migrationEnvSchema.extend({
  SEED_USER_PASSWORD: z.string().min(12, 'SEED_USER_PASSWORD must contain at least 12 characters'),
  SEED_STORE_NAME: z.string().trim().min(1).max(160).default('HERMS Main Store'),
  SEED_STORE_ADDRESS: z.string().trim().max(500).optional(),
})

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>
export type ApiEnv = z.infer<typeof apiEnvSchema>
export type MigrationEnv = z.infer<typeof migrationEnvSchema>
export type SeedEnv = z.infer<typeof seedEnvSchema>

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
