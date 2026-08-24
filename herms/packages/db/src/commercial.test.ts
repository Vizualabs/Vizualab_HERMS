import { describe, expect, test } from 'bun:test'

import { quotationInputSchema } from '@herms/shared'

import { resolveQuotationPricing } from './commercial'
import { DataConflictError } from './services'

const itemId = '10000000-0000-4000-8000-000000000001'

describe('Phase 2 quotation pricing', () => {
  test('uses the recurring customer fixed price and ignores manual pricing', () => {
    const priced = resolveQuotationPricing(
      'recurring',
      [{ equipmentItemId: itemId, quantity: 3, manualUnitPriceCents: 99999 }],
      new Map([[itemId, 2500]]),
    )
    expect(priced).toEqual({
      lines: [{ equipmentItemId: itemId, quantity: 3, unitPriceCents: 2500, lineTotalCents: 7500 }],
      totalValueCents: 7500,
    })
  })

  test('requires a current fixed price for every recurring-customer item', () => {
    expect(() => resolveQuotationPricing(
      'recurring',
      [{ equipmentItemId: itemId, quantity: 1 }],
      new Map(),
    )).toThrow(DataConflictError)
  })

  test('requires an explicit positive manual price for every new-customer item', () => {
    expect(() => resolveQuotationPricing(
      'new',
      [{ equipmentItemId: itemId, quantity: 1 }],
      new Map(),
    )).toThrow('manual unit price')
  })

  test('rejects duplicate equipment lines at the contract boundary', () => {
    const result = quotationInputSchema.safeParse({
      customerId: '20000000-0000-4000-8000-000000000001',
      lines: [
        { equipmentItemId: itemId, quantity: 1, manualUnitPriceCents: 100 },
        { equipmentItemId: itemId, quantity: 2, manualUnitPriceCents: 100 },
      ],
    })
    expect(result.success).toBe(false)
  })
})
