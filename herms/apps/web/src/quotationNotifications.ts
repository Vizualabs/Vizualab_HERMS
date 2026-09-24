import type { QuotationStatus } from '@herms/shared'

const storageKey = (userId: string) => `herms.quotation-responses-seen:${userId}`

type RespondedQuotation = { id: string; status: QuotationStatus }

export function respondedQuotationIds(rows: RespondedQuotation[]) {
  return rows
    .filter((row) => row.status === 'accepted' || row.status === 'rejected')
    .map((row) => row.id)
}

export function loadSeenResponseIds(userId: string, storage: Pick<Storage, 'getItem'> = localStorage) {
  const raw = storage.getItem(storageKey(userId))
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function saveSeenResponseIds(
  userId: string,
  ids: string[],
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  storage.setItem(storageKey(userId), JSON.stringify([...new Set(ids)]))
}

export function unseenQuotationResponseCount(rows: RespondedQuotation[], seenIds: string[] | null) {
  if (seenIds === null) return 0
  const seen = new Set(seenIds)
  return respondedQuotationIds(rows).filter((id) => !seen.has(id)).length
}

export function seedSeenResponsesIfNeeded(
  userId: string,
  rows: RespondedQuotation[],
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  const existing = loadSeenResponseIds(userId, storage)
  if (existing !== null) return existing
  const seeded = respondedQuotationIds(rows)
  saveSeenResponseIds(userId, seeded, storage)
  return seeded
}

export function markQuotationResponsesSeen(
  userId: string,
  rows: RespondedQuotation[],
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  const next = [...new Set([
    ...(loadSeenResponseIds(userId, storage) ?? []),
    ...respondedQuotationIds(rows),
  ])]
  saveSeenResponseIds(userId, next, storage)
  return next
}
