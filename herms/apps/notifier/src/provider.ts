import type { WhatsAppNotification } from '@herms/shared'

export type WhatsAppProvider = {
  send(notification: WhatsAppNotification): Promise<void>
}

export type WebhookWhatsAppProviderConfig = {
  url: string
  accessToken: string
  senderId: string
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>
}

export function createWebhookWhatsAppProvider(
  config: WebhookWhatsAppProviderConfig,
): WhatsAppProvider {
  const providerFetch = config.fetch ?? globalThis.fetch
  return {
    async send(notification) {
      const response = await providerFetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.accessToken,
          'Content-Type': 'application/json',
          'Idempotency-Key': notification.idempotencyKey,
          'X-Request-ID': notification.requestId,
        },
        body: JSON.stringify({
          senderId: config.senderId,
          recipient: {
            phone: notification.recipient.phone,
            name: notification.recipient.name,
          },
          templateKey: notification.templateKey,
          text: notification.text,
          variables: notification.variables,
          document: notification.document,
        }),
      })
      if (!response.ok) {
        throw new Error('WhatsApp provider rejected the message with status ' + response.status)
      }
    },
  }
}

export function createMockWhatsAppProvider(
  sent: WhatsAppNotification[] = [],
): WhatsAppProvider & { sent: WhatsAppNotification[] } {
  const delivered = new Set(sent.map((notification) => notification.idempotencyKey))
  return {
    sent,
    async send(notification) {
      if (delivered.has(notification.idempotencyKey)) return
      delivered.add(notification.idempotencyKey)
      sent.push(notification)
    },
  }
}
