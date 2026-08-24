import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

describe('Phase 3 stock write boundary', () => {
  test('keeps the only application stock-ledger insert in the approval service', async () => {
    const files = new Bun.Glob('**/*.ts').scan({ cwd: fileURLToPath(new URL('../../..', import.meta.url)) })
    const insertLocations: string[] = []
    for await (const file of files) {
      const normalized = file.replaceAll('\\', '/')
      if (!normalized.startsWith('packages/db/src/') && !normalized.startsWith('apps/api/src/')) continue
      if (normalized.endsWith('.test.ts')) continue
      const source = await Bun.file(file).text()
      if (source.includes('INSERT INTO ${stockLedger}') || source.includes('.insert(stockLedger)')) insertLocations.push(normalized)
    }
    expect(insertLocations).toEqual(expect.arrayContaining([expect.stringContaining('packages/db/src/delivery.ts')]))
    expect(insertLocations).toHaveLength(1)
  })
})
