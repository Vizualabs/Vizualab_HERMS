const MAX_MINOR_UNITS = 2_000_000_000

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

// HERMS uses round-half-up whenever a percentage creates a fractional cent.
export function calculateEscalatedPriceCents(currentPriceCents: number) {
  if (!Number.isSafeInteger(currentPriceCents) || currentPriceCents < 0) {
    throw new RangeError('Current price must be a non-negative safe integer')
  }
  const escalated = (BigInt(currentPriceCents) * 110n + 50n) / 100n
  return checkedMinorUnits(escalated, 'Escalated price')
}

