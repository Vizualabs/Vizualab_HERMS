import type { SQSBatchResponse, SQSEvent } from 'aws-lambda'

export type ManualOnlyNotifierDependencies = {
  logger?: (entry: Record<string, unknown>) => void
}

/**
 * Safety handler retained for any old queue trigger that has not yet been removed.
 * It deliberately acknowledges records without resolving recipients or contacting
 * an external provider. Sharing is now initiated manually from the web app.
 */
export function createManualOnlyNotifierHandler({
  logger = (entry) => console.log(JSON.stringify(entry)),
}: ManualOnlyNotifierDependencies = {}) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    for (const record of event.Records) {
      logger({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'herms-notifier',
        event: 'automatic_whatsapp_delivery_disabled',
        messageId: record.messageId,
      })
    }
    return { batchItemFailures: [] }
  }
}

const manualOnlyHandler = createManualOnlyNotifierHandler()

export async function handler(event: SQSEvent) {
  return manualOnlyHandler(event)
}
