import { describe, expect, test } from 'bun:test'

import { previousDashboardMonth, resolveDashboardFilters } from './dashboard'

describe('Phase 8 dashboard period handling', () => {
  test('uses the current Asia/Colombo calendar month', () => {
    expect(resolveDashboardFilters(
      {},
      'Asia/Colombo',
      new Date('2026-08-31T20:00:00.000Z'),
    )).toEqual({
      month: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
      customerId: null,
      itemId: null,
    })
  })

  test('handles the previous month across a year boundary', () => {
    expect(previousDashboardMonth('2026-01')).toBe('2025-12')
  })

  test('preserves explicit date and entity filters', () => {
    expect(resolveDashboardFilters({
      month: '2026-08',
      from: '2026-08-10',
      to: '2026-08-20',
      customerId: '20000000-0000-4000-8000-000000000001',
      itemId: '50000000-0000-4000-8000-000000000001',
    }, 'Asia/Colombo')).toEqual({
      month: '2026-08',
      from: '2026-08-10',
      to: '2026-08-20',
      customerId: '20000000-0000-4000-8000-000000000001',
      itemId: '50000000-0000-4000-8000-000000000001',
    })
  })
})
