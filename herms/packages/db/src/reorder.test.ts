import { describe, expect, test } from 'bun:test'

describe('Phase 9 reorder alert boundaries', () => {
  test('reconciles alerts after every application stock-ledger mutation path', async () => {
    const deliverySource = await Bun.file(new URL('./delivery.ts', import.meta.url)).text()
    const retentionSource = await Bun.file(new URL('./retention.ts', import.meta.url)).text()
    const serviceSource = await Bun.file(new URL('./services.ts', import.meta.url)).text()

    expect(deliverySource).toContain(
      "reconcileReorderAlertsForLedger('delivery_note', id, now, actor)",
    )
    expect(retentionSource).toContain(
      "reconcileReorderAlertsForLedger('retention_note', id, now, actor)",
    )
    expect(retentionSource).toContain(
      "reconcileReorderAlertsForLedger('write_off_reversal', discrepancyId, now, actor)",
    )
    expect(serviceSource.match(/reconcileReorderAlertsForItem/g)).toHaveLength(3)
  })

  test('enforces one open alert per store and item without backup tables', async () => {
    const migration = await Bun.file(
      new URL('../migrations/0009_phase_9_hardening.sql', import.meta.url),
    ).text()
    expect(migration).toContain('reorder_alert_one_open_per_store_item')
    expect(migration).toContain('WHERE "status" = \'open\'')
    expect(migration.toLowerCase()).not.toContain('backup')
    expect(migration.toLowerCase()).not.toContain('snapshot')
  })
})
