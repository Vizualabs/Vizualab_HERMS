import { describe, expect, test } from 'bun:test'

import {
  calculateEscalatedPriceCents,
  formatEscalationPercent,
  multiplyMinorUnits,
  parseOwnerEscalationPercent,
} from './money'

describe('integer minor-unit arithmetic', () => {
  test('uses BigInt-backed multiplication and percentage rounding', () => {
    expect(multiplyMinorUnits(999, 4)).toBe(3996)
    expect(calculateEscalatedPriceCents(15, 10)).toBe(17)
    expect(calculateEscalatedPriceCents(100, 12.5)).toBe(113)
    expect(calculateEscalatedPriceCents(10_000, 15)).toBe(11_500)
  })

  test('rejects fractional and negative monetary inputs', () => {
    expect(() => multiplyMinorUnits(1.5, 2)).toThrow()
    expect(() => calculateEscalatedPriceCents(-1, 10)).toThrow()
    expect(() => calculateEscalatedPriceCents(100, 0)).toThrow()
    expect(() => calculateEscalatedPriceCents(100, 100.01)).toThrow()
  })

  test('parses owner-entered increase percents', () => {
    expect(parseOwnerEscalationPercent('15')).toBe(15)
    expect(parseOwnerEscalationPercent('12.5')).toBe(12.5)
    expect(parseOwnerEscalationPercent('')).toBeNull()
    expect(parseOwnerEscalationPercent('0')).toBeNull()
    expect(formatEscalationPercent(10)).toBe('10')
    expect(formatEscalationPercent(12.5)).toBe('12.5')
  })
})
