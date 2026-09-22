const MAX_MINOR_UNITS = 2_000_000_000
export const MIN_OWNER_ESCALATION_PERCENT = 0.01
export const MAX_OWNER_ESCALATION_PERCENT = 100

function checkedMinorUnits(value: bigint, label: string) {
  if (value < 0n || value > BigInt(MAX_MINOR_UNITS)) {
    throw new RangeError(`${label} exceeds the supported integer money range`)
  }
  return Number(value)
}

export function multiplyMinorUnits(unitPriceCents: number, quantity: number) {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new RangeError('Unit price must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError('Quantity must be a positive safe integer')
  }
  return checkedMinorUnits(BigInt(unitPriceCents) * BigInt(quantity), 'Money total')
}

/** Percent stored as integer hundredths: 10% → 1000, 12.5% → 1250 */
export function escalationPercentToHundredths(percent: number) {
  if (!Number.isFinite(percent)) {
    throw new RangeError('Increase percent must be a finite number')
  }
  const hundredths = Math.round(percent * 100)
  if (Math.abs(percent * 100 - hundredths) > 1e-8) {
    throw new RangeError('Increase percent may have at most two decimal places')
  }
  if (hundredths < 1 || hundredths > MAX_OWNER_ESCALATION_PERCENT * 100) {
    throw new RangeError(
      `Increase percent must be between ${MIN_OWNER_ESCALATION_PERCENT} and ${MAX_OWNER_ESCALATION_PERCENT}`,
    )
  }
  return hundredths
}

export function parseOwnerEscalationPercent(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return escalationPercentToHundredths(Number(trimmed)) / 100
  } catch {
    return null
  }
}

export function formatEscalationPercent(percent: number) {
  const hundredths = escalationPercentToHundredths(percent)
  if (hundredths % 100 === 0) return String(hundredths / 100)
  return (hundredths / 100).toFixed(2).replace(/0$/, '')
}

export function escalationSqlMultiplier(percent: number) {
  return 10_000 + escalationPercentToHundredths(percent)
}

// HERMS uses round-half-up whenever a percentage creates a fractional cent.
export function calculateEscalatedPriceCents(currentPriceCents: number, percent: number) {
  if (!Number.isSafeInteger(currentPriceCents) || currentPriceCents < 0) {
    throw new RangeError('Current price must be a non-negative safe integer')
  }
  const multiplier = BigInt(escalationSqlMultiplier(percent))
  const escalated = (BigInt(currentPriceCents) * multiplier + 5000n) / 10000n
  return checkedMinorUnits(escalated, 'Escalated price')
}
