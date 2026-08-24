import { neon } from '@neondatabase/serverless'

export type DbHealthCheck = () => Promise<number>

export function createDbHealthCheck(databaseUrl: string): DbHealthCheck {
  const query = neon(databaseUrl)

  return async () => {
    const startedAt = performance.now()
    const rows = await query`select 1::integer as ok`

    if (rows[0]?.ok !== 1) {
      throw new Error('Database round trip returned an unexpected result')
    }

    return Math.round((performance.now() - startedAt) * 100) / 100
  }
}
