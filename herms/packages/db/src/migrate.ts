import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/neon-http/migrator'

import { parseMigrationEnv } from '@herms/shared'

import { createDatabase } from './client'

const { MIGRATION_DATABASE_URL } = parseMigrationEnv(process.env)
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
const db = createDatabase(MIGRATION_DATABASE_URL)

console.log(JSON.stringify({ event: 'migration_started' }))
await migrate(db, { migrationsFolder })
console.log(JSON.stringify({ event: 'migration_completed' }))
