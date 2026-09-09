import { describe, expect, test } from 'bun:test'

import { currentColomboMonth } from './reportingTime'

describe('reporting month in Asia/Colombo', () => {
  test('uses Colombo time before the UTC month changes', () => {
    expect(currentColomboMonth(new Date('2026-09-30T18:29:59.000Z'))).toBe('2026-09')
  })

  test('rolls into the next month at Colombo midnight', () => {
    expect(currentColomboMonth(new Date('2026-09-30T18:30:00.000Z'))).toBe('2026-10')
  })

  test('handles the year boundary', () => {
    expect(currentColomboMonth(new Date('2026-12-31T18:30:00.000Z'))).toBe('2027-01')
  })
})
