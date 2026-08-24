import { defineConfig } from 'drizzle-kit'

import { parseMigrationEnv } from '@herms/shared'

const env = parseMigrationEnv(process.env)

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: env.MIGRATION_DATABASE_URL,
  },
  strict: true,
  verbose: true,
})
