import { describe, expect, test } from 'bun:test'
import { calculateEscalatedPriceCents, multiplyMinorUnits } from '@herms/shared'

import { assertClaimEligibility } from './claims'

describe('Phase 7 claim invariants', () => {
  test('rejects staff-responsible damage before claim creation', () => {
    expect(() => assertClaimEligibility({
      discrepancyType: 'damaged',
      responsibleParty: 'staff_member',
      status: 'written_off',
      sourceApproved: true,
    })).toThrow('customer-responsible')
  })

  test('requires the source note approval gate', () => {
    expect(() => assertClaimEligibility({
      discrepancyType: 'damaged',
      responsibleParty: 'customer',
      status: 'open',
      sourceApproved: false,
    })).toThrow('source note must be approved')
  })

  test('keeps claim multiplication in checked integer minor units', () => {
    expect(multiplyMinorUnits(12_345, 3)).toBe(37_035)
    expect(() => multiplyMinorUnits(2_000_000_000, 2)).toThrow('integer money range')
  })
})

describe('Phase 7 escalation rules', () => {
  test('rounds a ten-percent increase half-up in one shared function', () => {
    expect(calculateEscalatedPriceCents(105)).toBe(116)
    expect(calculateEscalatedPriceCents(100)).toBe(110)
  })
})
