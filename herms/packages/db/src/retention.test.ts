import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { fieldSubmissionIssue, reconciliationIsComplete } from './retention'

describe('Phase 4 retention invariants', () => {
  test('reconciles delivered 100 from partial returns 60 + 30 and shortfall 8 + 2', () => {
    expect(reconciliationIsComplete([{
      equipmentItemId: 'item',
      equipmentName: 'Scaffold',
      deliveredQty: 100,
      returnedQty: 90,
      balanceQty: 0,
      missingDamagedQty: 10,
      accountedQty: 100,
    }])).toBe(true)
  })

  test('refuses a 99-of-100 cumulative reconciliation', () => {
    expect(reconciliationIsComplete([{
      equipmentItemId: 'item',
      equipmentName: 'Scaffold',
      deliveredQty: 100,
      returnedQty: 89,
      balanceQty: 0,
      missingDamagedQty: 10,
      accountedQty: 99,
    }])).toBe(false)
  })

  test('keeps reversal enforcement in migration 0004', async () => {
    const migration = await Bun.file(fileURLToPath(
      new URL('../migrations/0004_retention_reconciliation_writeoff.sql', import.meta.url),
    )).text()
    expect(migration).toContain('stock_ledger_reversal_of_unique')
    expect(migration).toContain("original.created_at + interval '7 days'")
    expect(migration).toContain("actor_role NOT IN ('store_admin', 'system_admin')")
    expect(migration).toContain('write-off reversal must exactly offset its original ledger row')
  })

  test('permits Super User write-off reversals without weakening ledger checks', async () => {
    const migration = await Bun.file(fileURLToPath(
      new URL('../migrations/0010_super_user.sql', import.meta.url),
    )).text()
    expect(migration).toContain("'store_admin', 'system_admin', 'super_user'")
    expect(migration).toContain('write-off reversal must exactly offset its original ledger row')
  })
})

describe('Retention Note field-link boundary', () => {
  test('allows partial field corrections only before physical counting', () => {
    expect(fieldSubmissionIssue('draft', false)).toBeNull()
    expect(fieldSubmissionIssue('reopened', false)).toBeNull()
    expect(fieldSubmissionIssue('pending_approval', true)).toContain('physical counting')
  })

  test('requires rejected notes to be reopened', () => {
    expect(fieldSubmissionIssue('rejected', false)).toContain('must be reopened')
    expect(fieldSubmissionIssue('approved', false)).toContain('not open')
  })
})
