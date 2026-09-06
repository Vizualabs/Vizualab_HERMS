import { describe, expect, test } from 'bun:test'

import { quotationInputSchema } from '@herms/shared'

import { resolveQuotationPricing } from './commercial'
import { DataConflictError } from './services'

const itemId = '10000000-0000-4000-8000-000000000001'

describe('Phase 2 quotation pricing', () => {
  test('uses the effective standard price and ignores manual pricing', () => {
    const priced = resolveQuotationPricing(
      'standard',
      [{ equipmentItemId: itemId, quantity: 3, manualUnitPriceCents: 99999 }],
      new Map([[itemId, 2500]]),
    )
    expect(priced).toEqual({
      lines: [{ equipmentItemId: itemId, quantity: 3, unitPriceCents: 2500, lineTotalCents: 7500 }],
      totalValueCents: 7500,
    })
  })

  test('requires a registered standard price for every item', () => {
    expect(() => resolveQuotationPricing(
      'standard',
      [{ equipmentItemId: itemId, quantity: 1 }],
      new Map(),
    )).toThrow(DataConflictError)
  })

  test('uses an explicit custom price for any customer', () => {
    expect(resolveQuotationPricing(
      'custom',
      [{ equipmentItemId: itemId, quantity: 2, manualUnitPriceCents: 3100 }],
      new Map([[itemId, 2500]]),
    )).toEqual({
      lines: [{ equipmentItemId: itemId, quantity: 2, unitPriceCents: 3100, lineTotalCents: 6200 }],
      totalValueCents: 6200,
    })
  })

  test('requires an explicit positive manual price in custom mode', () => {
    expect(() => resolveQuotationPricing(
      'custom',
      [{ equipmentItemId: itemId, quantity: 1 }],
      new Map(),
    )).toThrow('manual unit price')
  })

  test('rejects duplicate equipment lines at the contract boundary', () => {
    const result = quotationInputSchema.safeParse({
      customerId: '20000000-0000-4000-8000-000000000001',
      pricingMode: 'custom',
      lines: [
        { equipmentItemId: itemId, quantity: 1, manualUnitPriceCents: 100 },
        { equipmentItemId: itemId, quantity: 2, manualUnitPriceCents: 100 },
      ],
    })
    expect(result.success).toBe(false)
  })
})
