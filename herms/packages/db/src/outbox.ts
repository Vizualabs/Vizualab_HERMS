import {
  notificationQueueMessageSchema,
  type NotificationQueueMessage,
} from '@herms/shared'
import { and, eq, sql } from 'drizzle-orm'

import type { Database } from './client'
import { outboxEvents } from './schema'

type ClaimedOutboxEvent = {
  id: string
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  idempotencyKey: string
  attempts: number
  createdAt: Date
}

export type NotificationQueue = {
  send(message: NotificationQueueMessage): Promise<void>
}

export type OutboxPublisherConfig = {
  batchSize: number
  maxAttempts: number
  leaseSeconds: number
}

function requestId(event: ClaimedOutboxEvent) {
  const value = event.payload.requestId
  return typeof value === 'string' && value.length > 0 ? value : 'outbox-' + event.id
}

function retryDelaySeconds(attempts: number) {
  return Math.min(900, 2 ** Math.min(attempts, 9))
}

export function createOutboxPublisher(
  db: Database,
  queue: NotificationQueue,
  config: OutboxPublisherConfig,
) {
  return {
    async publishBatch(now = new Date()) {
      const leaseUntil = new Date(now.getTime() + config.leaseSeconds * 1_000)
      const claimed = await db.execute<ClaimedOutboxEvent>(sql`
        WITH candidates AS (
          SELECT id
          FROM ${outboxEvents}
          WHERE status = 'pending' AND available_at <= ${now}
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${config.batchSize}
        )
        UPDATE ${outboxEvents} event
        SET attempts = event.attempts + 1, available_at = ${leaseUntil}
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING
          event.id,
          event.event_type AS eventType,
          event.aggregate_type AS aggregateType,
          event.aggregate_id AS aggregateId,
          event.payload,
          event.idempotency_key AS idempotencyKey,
          event.attempts,
          event.created_at AS createdAt
      `)

      let published = 0
      let failed = 0
      for (const event of claimed.rows) {
        try {
          const message = notificationQueueMessageSchema.parse({
            version: 1,
            outboxId: event.id,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: event.payload,
            idempotencyKey: event.idempotencyKey,
            requestId: requestId(event),
            occurredAt: new Date(event.createdAt).toISOString(),
          })
          await queue.send(message)
          const [updated] = await db
            .update(outboxEvents)
            .set({ status: 'published', publishedAt: new Date(), availableAt: now })
            .where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, 'pending')))
            .returning({ id: outboxEvents.id })
          if (updated) published += 1
        } catch {
          failed += 1
          const terminal = event.attempts >= config.maxAttempts
          const availableAt = new Date(now.getTime() + retryDelaySeconds(event.attempts) * 1_000)
          await db
            .update(outboxEvents)
            .set({ status: terminal ? 'failed' : 'pending', availableAt })
            .where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, 'pending')))
        }
      }

      return { claimed: claimed.rows.length, published, failed }
    },
  }
}

export type OutboxPublisher = ReturnType<typeof createOutboxPublisher>
