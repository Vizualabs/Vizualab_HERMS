import { expect, test } from 'bun:test'

import type { NotificationQueueMessage } from '@herms/shared'

import { createSqsNotificationQueue } from './publisher'

test('publishes a traceable FIFO message with deterministic deduplication', async () => {
  let input: Record<string, unknown> | undefined
  const queue = createSqsNotificationQueue({
    async send(command) {
      input = command.input as unknown as Record<string, unknown>
    },
  }, 'https://sqs.example.test/123/herms-notifications.fifo')
  const message: NotificationQueueMessage = {
    version: 1,
    outboxId: '10000000-0000-4000-8000-000000000001',
    eventType: 'quotation_created',
    aggregateType: 'quotation',
    aggregateId: '20000000-0000-4000-8000-000000000001',
    payload: { quotationId: '20000000-0000-4000-8000-000000000001' },
    idempotencyKey: 'quotation_created:20000000-0000-4000-8000-000000000001',
    requestId: 'phase-5-publisher',
    occurredAt: '2026-08-26T00:00:00.000Z',
  }
  await queue.send(message)
  expect(input).toMatchObject({
    MessageDeduplicationId: message.idempotencyKey,
    MessageGroupId: 'quotation:' + message.aggregateId,
    QueueUrl: 'https://sqs.example.test/123/herms-notifications.fifo',
  })
  expect(JSON.parse(String(input?.MessageBody))).toEqual(message)
})
