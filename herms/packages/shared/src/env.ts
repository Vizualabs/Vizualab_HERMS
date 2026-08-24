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
})

export const migrationEnvSchema = z.object({
  MIGRATION_DATABASE_URL: postgresUrl,
})

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>
export type ApiEnv = z.infer<typeof apiEnvSchema>
export type MigrationEnv = z.infer<typeof migrationEnvSchema>

export function parseRuntimeEnv(env: Record<string, string | undefined>): RuntimeEnv {
  return runtimeEnvSchema.parse(env)
}

export function parseApiEnv(env: Record<string, string | undefined>): ApiEnv {
  return apiEnvSchema.parse(env)
}

export function parseMigrationEnv(env: Record<string, string | undefined>): MigrationEnv {
  return migrationEnvSchema.parse(env)
}
