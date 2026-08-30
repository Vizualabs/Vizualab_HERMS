import { describe, expect, test } from 'bun:test'

import { notificationQueueMessageSchema, whatsAppNotificationSchema } from './notifications'

describe('Phase 9 notification contracts', () => {
  test('accepts reorder-threshold queue messages and provider-neutral notifications', () => {
    expect(notificationQueueMessageSchema.parse({
      version: 1,
      outboxId: '10000000-0000-4000-8000-000000000001',
      eventType: 'reorder_threshold_breached',
      aggregateType: 'reorder_alert',
      aggregateId: '20000000-0000-4000-8000-000000000001',
      payload: { currentQuantity: 2, threshold: 5 },
      idempotencyKey: 'reorder-alert:one',
      requestId: 'phase-9-test',
      occurredAt: '2026-08-30T00:00:00.000Z',
    }).eventType).toBe('reorder_threshold_breached')

    expect(whatsAppNotificationSchema.parse({
      idempotencyKey: 'reorder-alert:one:admin',
      requestId: 'phase-9-test',
      recipient: {
        kind: 'user',
        id: '30000000-0000-4000-8000-000000000001',
        name: 'Store Admin',
        phone: '+94770000000',
      },
      templateKey: 'reorder_threshold',
      text: 'Test item is below its reorder threshold (2/5).',
      variables: { equipmentName: 'Test item', currentQuantity: '2', threshold: '5' },
    }).templateKey).toBe('reorder_threshold')
  })
})
