import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))
const files = await readdir(migrationsFolder)
const migrations = files.filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()

if (migrations.length === 0) {
  throw new Error('No forward-only SQL migrations were found')
}

for (const migration of migrations) {
  if (migration.toLowerCase().includes('down')) {
    throw new Error(`Down migration is not allowed: ${migration}`)
  }
}

console.log(JSON.stringify({ event: 'migration_check_complete', count: migrations.length }))
