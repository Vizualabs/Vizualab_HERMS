import { parseMigrationEnv } from '@herms/shared'

parseMigrationEnv(process.env)

console.log(
  JSON.stringify({
    event: 'seed_completed',
    inserted: 0,
    reason: 'Phase 0 contains no business tables or seed data',
  }),
)
