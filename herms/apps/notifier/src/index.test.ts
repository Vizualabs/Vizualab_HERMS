import { describe, expect, test } from 'bun:test'

import type { SQSEvent, SQSRecord } from 'aws-lambda'

import { createManualOnlyNotifierHandler } from './index'

function record(id: string): SQSRecord {
  return {
    messageId: id,
    receiptHandle: 'receipt',
    body: '{"legacy":true}',
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

describe('manual-only notifier safety handler', () => {
  test('acknowledges legacy queue records without resolving or sending them', async () => {
    const logs: Array<Record<string, unknown>> = []
    const handler = createManualOnlyNotifierHandler({ logger: (entry) => logs.push(entry) })
    const event: SQSEvent = { Records: [record('one'), record('two')] }

    expect(await handler(event)).toEqual({ batchItemFailures: [] })
    expect(logs).toHaveLength(2)
    expect(logs.every((entry) => entry.event === 'automatic_whatsapp_delivery_disabled')).toBe(true)
  })
})
