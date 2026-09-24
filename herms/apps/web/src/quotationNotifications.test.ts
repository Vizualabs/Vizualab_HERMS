import { describe, expect, test } from 'bun:test'

import {
  markQuotationResponsesSeen,
  seedSeenResponsesIfNeeded,
  unseenQuotationResponseCount,
} from './quotationNotifications'

const accepted = { id: 'q-1', status: 'accepted' as const }
const rejected = { id: 'q-2', status: 'rejected' as const }
const sent = { id: 'q-3', status: 'sent' as const }

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial }
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
  }
}

describe('quotation response notifications', () => {
  test('counts accepted and rejected quotations that have not been seen', () => {
    expect(unseenQuotationResponseCount([accepted, rejected, sent], [])).toBe(2)
    expect(unseenQuotationResponseCount([accepted, rejected, sent], ['q-1'])).toBe(1)
    expect(unseenQuotationResponseCount([accepted, rejected, sent], ['q-1', 'q-2'])).toBe(0)
  })

  test('does not notify for historical responses on first load', () => {
    const storage = memoryStorage()
    expect(unseenQuotationResponseCount([accepted, rejected], null)).toBe(0)
    expect(seedSeenResponsesIfNeeded('user-1', [accepted, rejected], storage)).toEqual(['q-1', 'q-2'])
    expect(unseenQuotationResponseCount([accepted, rejected], seedSeenResponsesIfNeeded('user-1', [accepted, rejected], storage))).toBe(0)
  })

  test('marks newly responded quotations as seen after the list is opened', () => {
    const storage = memoryStorage()
    seedSeenResponsesIfNeeded('user-1', [], storage)
    expect(unseenQuotationResponseCount([accepted, rejected], seedSeenResponsesIfNeeded('user-1', [accepted, rejected], storage))).toBe(2)
    const seen = markQuotationResponsesSeen('user-1', [accepted, rejected], storage)
    expect(unseenQuotationResponseCount([accepted, rejected], seen)).toBe(0)
  })
})
