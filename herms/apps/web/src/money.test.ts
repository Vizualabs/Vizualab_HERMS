import { describe, expect, test } from 'bun:test'

import { parseMajorCurrencyToMinorUnits } from './money'

describe('major currency amount input', () => {
  test.each([
    ['1500', 150_000],
    ['1500.5', 150_050],
    ['1500.50', 150_050],
    ['0.01', 1],
    ['.25', 25],
  ])('converts %s to exact minor units', (value, expected) => {
    expect(parseMajorCurrencyToMinorUnits(value)).toBe(expected)
  })

  test.each(['', '0', '0.00', '-1.00', '1.234', 'one'])('rejects invalid amount %s', (value) => {
    expect(parseMajorCurrencyToMinorUnits(value)).toBeNull()
  })
})
