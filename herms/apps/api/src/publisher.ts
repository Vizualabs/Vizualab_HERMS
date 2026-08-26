import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import {
  createDatabase,
  createOutboxPublisher,
  type NotificationQueue,
} from '@herms/db'
import {
  parseOutboxPublisherEnv,
  type NotificationQueueMessage,
} from '@herms/shared'

type SqsSender = {
  send(command: SendMessageCommand): Promise<unknown>
}

export function createSqsNotificationQueue(
  client: SqsSender,
  queueUrl: string,
): NotificationQueue {
  return {
    async send(message: NotificationQueueMessage) {
      const fifo = queueUrl.endsWith('.fifo')
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        ...(fifo ? {
          MessageGroupId: message.aggregateType + ':' + message.aggregateId,
          MessageDeduplicationId: message.idempotencyKey,
        } : {}),
        MessageAttributes: {
          requestId: { DataType: 'String', StringValue: message.requestId },
          eventType: { DataType: 'String', StringValue: message.eventType },
          outboxId: { DataType: 'String', StringValue: message.outboxId },
        },
      }))
    },
  }
}

export async function handler() {
  const env = parseOutboxPublisherEnv(process.env)
  const db = createDatabase(env.DATABASE_URL)
  const queue = createSqsNotificationQueue(new SQSClient({}), env.SQS_NOTIFICATION_QUEUE_URL)
  const publisher = createOutboxPublisher(db, queue, {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    leaseSeconds: env.OUTBOX_LEASE_SECONDS,
  })
  const result = await publisher.publishBatch()
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'herms-outbox-publisher',
    event: 'outbox_batch_published',
    ...result,
  }))
  return result
}
