import { describe, expect, test } from 'bun:test'

import type { NotificationQueueMessage } from '@herms/shared'

import type { Database } from './client'
import { createOutboxPublisher } from './outbox'

const claimedEvent = {
  id: '10000000-0000-4000-8000-000000000001',
  eventType: 'quotation_created',
  aggregateType: 'quotation',
  aggregateId: '20000000-0000-4000-8000-000000000001',
  payload: { requestId: 'phase-5-publisher-test' },
  idempotencyKey: 'quotation_created:20000000-0000-4000-8000-000000000001',
  attempts: 1,
  createdAt: new Date('2026-08-26T00:00:00.000Z'),
}

function fakeDatabase(event = claimedEvent) {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    execute: async () => ({ rows: [event] }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values)
        return {
          where: () => {
            const result = Promise.resolve(undefined) as Promise<undefined> & {
              returning: () => Promise<Array<{ id: string }>>
            }
            result.returning = async () => [{ id: event.id }]
            return result
          },
        }
      },
    }),
  } as unknown as Database
  return { db, updates }
}

describe('Phase 5 outbox publisher', () => {
  test('publishes a valid queue envelope and completes the outbox row', async () => {
    const { db, updates } = fakeDatabase()
    const sent: NotificationQueueMessage[] = []
    const publisher = createOutboxPublisher(db, {
      send: async (message) => {
        sent.push(message)
      },
    }, { batchSize: 10, maxAttempts: 5, leaseSeconds: 240 })

    const result = await publisher.publishBatch(new Date('2026-08-26T01:00:00.000Z'))

    expect(result).toEqual({ claimed: 1, published: 1, failed: 0 })
    expect(sent[0]?.eventType).toBe('quotation_created')
    expect(sent[0]?.requestId).toBe('phase-5-publisher-test')
    expect(updates[0]?.status).toBe('published')
  })

  test('marks the fifth failed receive as terminal', async () => {
    const { db, updates } = fakeDatabase({ ...claimedEvent, attempts: 5 })
    const publisher = createOutboxPublisher(db, {
      send: async () => {
        throw new Error('provider unavailable')
      },
    }, { batchSize: 10, maxAttempts: 5, leaseSeconds: 240 })

    const result = await publisher.publishBatch(new Date('2026-08-26T01:00:00.000Z'))

    expect(result).toEqual({ claimed: 1, published: 0, failed: 1 })
    expect(updates[0]?.status).toBe('failed')
  })
})
