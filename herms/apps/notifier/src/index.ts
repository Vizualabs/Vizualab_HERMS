import {
  createDatabase,
  createNotificationService,
  type NotificationService,
} from '@herms/db'
import {
  notificationQueueMessageSchema,
  parseNotifierEnv,
} from '@herms/shared'
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'

import {
  createMockWhatsAppProvider,
  createWebhookWhatsAppProvider,
  type WhatsAppProvider,
} from './provider'

export type NotifierDependencies = {
  notifications: Pick<NotificationService, 'resolve'>
  provider: WhatsAppProvider
  delivered?: Set<string>
  logger?: (entry: Record<string, unknown>) => void
}

export function createNotifierHandler({
  notifications,
  provider,
  delivered = new Set<string>(),
  logger = (entry) => console.log(JSON.stringify(entry)),
}: NotifierDependencies) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = []
    for (const record of event.Records) {
      try {
        const message = notificationQueueMessageSchema.parse(JSON.parse(record.body))
        const resolved = await notifications.resolve(message)
        for (const notification of resolved) {
          if (delivered.has(notification.idempotencyKey)) continue
          await provider.send(notification)
          delivered.add(notification.idempotencyKey)
          logger({
            timestamp: new Date().toISOString(),
            level: 'info',
            service: 'herms-notifier',
            event: 'whatsapp_notification_delivered',
            requestId: notification.requestId,
            outboxId: message.outboxId,
            eventType: message.eventType,
            recipientKind: notification.recipient.kind,
            recipientId: notification.recipient.id,
            idempotencyKey: notification.idempotencyKey,
          })
        }
      } catch (error) {
        batchItemFailures.push({ itemIdentifier: record.messageId })
        logger({
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'herms-notifier',
          event: 'whatsapp_notification_failed',
          messageId: record.messageId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }
    return { batchItemFailures }
  }
}

let productionHandler: ReturnType<typeof createNotifierHandler> | undefined

function configuredHandler() {
  if (productionHandler) return productionHandler
  const env = parseNotifierEnv(process.env)
  const db = createDatabase(env.DATABASE_URL)
  const notifications = createNotificationService(db, {
    businessCurrency: env.BUSINESS_CURRENCY,
    noteTokenSecret: env.NOTE_TOKEN_SECRET,
    publicAppUrl: env.PUBLIC_APP_URL,
  })
  const provider = env.WHATSAPP_PROVIDER_MODE === 'webhook'
    ? createWebhookWhatsAppProvider({
        url: env.WHATSAPP_PROVIDER_URL!,
        accessToken: env.WHATSAPP_ACCESS_TOKEN!,
        senderId: env.WHATSAPP_SENDER_ID!,
      })
    : createMockWhatsAppProvider()
  productionHandler = createNotifierHandler({ notifications, provider })
  return productionHandler
}

export async function handler(event: SQSEvent) {
  return configuredHandler()(event)
}
