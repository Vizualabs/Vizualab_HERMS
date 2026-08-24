import { resolveRequestId } from '@herms/shared'

export type NotificationSkeletonEvent = {
  requestId?: string
}

export async function handler(event: NotificationSkeletonEvent) {
  const requestId = resolveRequestId(event.requestId)

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'herms-notifier',
      event: 'notification_skeleton_invoked',
      requestId,
      message: 'Provider delivery is intentionally deferred to Phase 5',
    }),
  )

  return { ok: true, requestId }
}
