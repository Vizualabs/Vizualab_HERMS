import { describe, expect, test } from 'bun:test'

import type { NotificationQueueMessage, WhatsAppNotification } from '@herms/shared'
import type { SQSEvent, SQSRecord } from 'aws-lambda'

import { createNotifierHandler } from './index'
import { createMockWhatsAppProvider, createWebhookWhatsAppProvider } from './provider'

const message: NotificationQueueMessage = {
  version: 1,
  outboxId: '10000000-0000-4000-8000-000000000001',
  eventType: 'delivery_note_link_created',
  aggregateType: 'delivery_note',
  aggregateId: '20000000-0000-4000-8000-000000000001',
  payload: {
    tokenId: '30000000-0000-4000-8000-000000000001',
    recipientUserId: '40000000-0000-4000-8000-000000000001',
  },
  idempotencyKey: 'delivery-note-link',
  requestId: 'phase-5-request',
  occurredAt: '2026-08-26T00:00:00.000Z',
}

const notification: WhatsAppNotification = {
  idempotencyKey: 'delivery-note-link:field-staff',
  requestId: message.requestId,
  recipient: {
    kind: 'user',
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Field Staff',
    phone: '+94770000000',
  },
  templateKey: 'note_link',
  text: 'Delivery Note DN-1 is ready',
  variables: { noteNumber: 'DN-1' },
}

function record(id: string, body = JSON.stringify(message)): SQSRecord {
  return {
    messageId: id,
    receiptHandle: 'receipt',
    body,
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: 'hash',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:region:account:queue',
    awsRegion: 'region',
  }
}

function event(...records: SQSRecord[]): SQSEvent {
  return { Records: records }
}

describe('Phase 5 notifier', () => {
  test('deduplicates repeated notification messages by idempotency key', async () => {
    const provider = createMockWhatsAppProvider()
    const handler = createNotifierHandler({
      notifications: { resolve: async () => [notification] },
      provider,
      logger: () => undefined,
    })
    expect(await handler(event(record('one'), record('two')))).toEqual({ batchItemFailures: [] })
    expect(provider.sent).toEqual([notification])
  })

  test('returns partial batch failures so SQS can retry and route to the DLQ', async () => {
    const handler = createNotifierHandler({
      notifications: { resolve: async () => [notification] },
      provider: { send: async () => { throw new Error('provider unavailable') } },
      logger: () => undefined,
    })
    expect(await handler(event(record('failed')))).toEqual({
      batchItemFailures: [{ itemIdentifier: 'failed' }],
    })
  })

  test('passes provider-neutral payload and trace headers to a webhook adapter', async () => {
    let request: Request | undefined
    const provider = createWebhookWhatsAppProvider({
      url: 'https://provider.example.test/messages',
      accessToken: 'test-token',
      senderId: 'herms',
      fetch: async (input, init) => {
        request = input instanceof Request ? input : new Request(String(input), init)
        return new Response(null, { status: 202 })
      },
    })
    await provider.send(notification)
    expect(request?.headers.get('Idempotency-Key')).toBe(notification.idempotencyKey)
    expect(request?.headers.get('X-Request-ID')).toBe(notification.requestId)
    expect(await request?.json()).toMatchObject({
      senderId: 'herms',
      templateKey: 'note_link',
      recipient: { phone: '+94770000000' },
    })
  })
})
