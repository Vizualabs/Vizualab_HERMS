import { describe, expect, test } from 'bun:test'

import { calculateEscalatedPriceCents, multiplyMinorUnits } from './money'

describe('integer minor-unit arithmetic', () => {
  test('uses BigInt-backed multiplication and percentage rounding', () => {
    expect(multiplyMinorUnits(999, 4)).toBe(3996)
    expect(calculateEscalatedPriceCents(15)).toBe(17)
  })

  test('rejects fractional and negative monetary inputs', () => {
    expect(() => multiplyMinorUnits(1.5, 2)).toThrow()
    expect(() => calculateEscalatedPriceCents(-1)).toThrow()
  })
})
