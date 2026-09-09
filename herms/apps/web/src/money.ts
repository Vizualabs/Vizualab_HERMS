export function parseMajorCurrencyToMinorUnits(value: string) {
  const match = /^(?:(\d+)(?:\.(\d{0,2}))?|\.(\d{1,2}))$/.exec(value.trim())
  if (!match) return null

  const wholeUnits = match[1] ?? '0'
  const fractionalUnits = (match[2] ?? match[3] ?? '').padEnd(2, '0')
  const minorUnits = BigInt(wholeUnits) * 100n + BigInt(fractionalUnits)

  if (minorUnits < 1n || minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(minorUnits)
}
