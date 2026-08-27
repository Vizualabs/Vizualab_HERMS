import { describe, expect, test } from 'bun:test'

import { calculateInvoiceTotals } from './finance'
import { DataConflictError } from './services'

describe('Phase 6 invoice arithmetic', () => {
  test('uses frozen line totals and keeps partial-payment balances exact to the cent', () => {
    expect(calculateInvoiceTotals([
      { lineTotalCents: 10_001 },
      { lineTotalCents: 20_002 },
    ], 12_003)).toEqual({
      orderValueCents: 30_003,
      claimAmountCents: 0,
      invoiceValueCents: 30_003,
      paidAmountCents: 12_003,
      outstandingBalanceCents: 18_000,
    })
  })

  test('adds confirmed damage claims without changing frozen order-line values', () => {
    expect(calculateInvoiceTotals([{ lineTotalCents: 10_000 }], 2_500, 1_500)).toEqual({
      orderValueCents: 10_000,
      claimAmountCents: 1_500,
      invoiceValueCents: 11_500,
      paidAmountCents: 2_500,
      outstandingBalanceCents: 9_000,
    })
  })

  test('rejects payment totals above the historical invoice value', () => {
    expect(() => calculateInvoiceTotals(
      [{ lineTotalCents: 10_000 }],
      10_001,
    )).toThrow(DataConflictError)
  })

  test('rejects unsafe integer money arithmetic', () => {
    expect(() => calculateInvoiceTotals([
      { lineTotalCents: Number.MAX_SAFE_INTEGER },
      { lineTotalCents: 1 },
    ], 0)).toThrow('integer money range')
  })
})
