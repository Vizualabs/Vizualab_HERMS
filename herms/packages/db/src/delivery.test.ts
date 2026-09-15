import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { deliveryFieldSubmissionIssue } from './delivery'

describe('Stock write boundary', () => {
  test('keeps application stock-ledger inserts inside receipt, approval, and reversal services', async () => {
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
    expect(insertLocations).toEqual(expect.arrayContaining([expect.stringContaining('packages/db/src/retention.ts')]))
    expect(insertLocations).toEqual(expect.arrayContaining([expect.stringContaining('packages/db/src/services.ts')]))
    expect(insertLocations).toHaveLength(3)
  })

  test('requires approved, repeatable stock receipts before incoming stock is posted', async () => {
    const migration = await Bun.file(
      new URL('../migrations/0013_opening_balance_inventory.sql', import.meta.url),
    ).text()
    const service = await Bun.file(new URL('./delivery.ts', import.meta.url)).text()

    expect(migration).toContain("NEW.source_type = 'opening_balance'")
    expect(migration).toContain("status = 'approved'")
    expect(migration).toContain("'stock_addition'")
    expect(migration).not.toContain('opening_balance_item_unique')
    expect(service).toContain("'opening_balance', note.id, 'in'::stock_direction")
    expect(service).toContain('line.counted_qty')
  })

  test('posts stock additions immediately without adding them to approvals', async () => {
    const masterData = await Bun.file(new URL('./services.ts', import.meta.url)).text()
    const delivery = await Bun.file(new URL('./delivery.ts', import.meta.url)).text()

    expect(masterData).toContain("entryType: 'stock_addition' as const")
    expect(masterData).toContain("status: 'approved' as const")
    expect(masterData).toContain('countedQty: input.quantity')
    expect(masterData).toContain('db.insert(stockLedger).values({')
    expect(masterData).toContain("quantityDelta: input.quantity")
    expect(delivery).toContain("eq(openingBalanceNotes.entryType, 'opening_balance')")
  })
})

describe('Delivery Note field-link boundary', () => {
  test('allows draft and pending notes only before physical counting', () => {
    expect(deliveryFieldSubmissionIssue('draft', false)).toBeNull()
    expect(deliveryFieldSubmissionIssue('pending_approval', false)).toBeNull()
    expect(deliveryFieldSubmissionIssue('pending_approval', true)).toContain('physical counting')
  })

  test('requires rejected notes to be reopened', () => {
    expect(deliveryFieldSubmissionIssue('rejected', false)).toContain('must be reopened')
    expect(deliveryFieldSubmissionIssue('approved', false)).toContain('not open')
  })
})
