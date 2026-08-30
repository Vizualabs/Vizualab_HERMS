import { sql, type SQL } from 'drizzle-orm'

import {
  auditLogs,
  equipmentItems,
  outboxEvents,
  reorderAlerts,
  stockLedger,
  stores,
} from './schema'
import type { AuditActor } from './services'

type ReorderScope = SQL<unknown>

function reconciliationSql(scope: ReorderScope, actor: AuditActor, now: Date) {
  return sql`
    WITH affected AS (${scope}),
    locked AS (
      SELECT affected.*,
        pg_advisory_xact_lock(hashtext(
          affected.store_id::text || ':' || affected.equipment_item_id::text
        )) AS alert_lock
      FROM affected
    ),
    current_stock AS (
      SELECT locked.equipment_item_id, locked.store_id, locked.trigger_ledger_id,
        item.name AS equipment_name, item.reorder_threshold,
        COALESCE((
          SELECT SUM(ledger.quantity_delta)
          FROM ${stockLedger} ledger
          WHERE ledger.equipment_item_id = locked.equipment_item_id
            AND ledger.store_id = locked.store_id
        ), 0)::integer AS quantity
      FROM locked
      JOIN ${equipmentItems} item ON item.id = locked.equipment_item_id
    ),
    resolved AS (
      UPDATE ${reorderAlerts} alert
      SET status = 'resolved',
        resolved_ledger_id = current_stock.trigger_ledger_id,
        resolved_quantity = current_stock.quantity,
        resolved_at = ${now}
      FROM current_stock
      WHERE alert.store_id = current_stock.store_id
        AND alert.equipment_item_id = current_stock.equipment_item_id
        AND alert.status = 'open'
        AND (
          current_stock.reorder_threshold IS NULL
          OR current_stock.quantity >= current_stock.reorder_threshold
        )
      RETURNING alert.*
    ),
    opened AS (
      INSERT INTO ${reorderAlerts} (
        id, store_id, equipment_item_id, opened_ledger_id, threshold,
        opened_quantity, status, opened_at
      )
      SELECT gen_random_uuid(), current_stock.store_id, current_stock.equipment_item_id,
        current_stock.trigger_ledger_id, current_stock.reorder_threshold,
        current_stock.quantity, 'open', ${now}
      FROM current_stock
      WHERE current_stock.reorder_threshold IS NOT NULL
        AND current_stock.quantity < current_stock.reorder_threshold
        AND NOT EXISTS (
          SELECT 1 FROM ${reorderAlerts} existing
          WHERE existing.store_id = current_stock.store_id
            AND existing.equipment_item_id = current_stock.equipment_item_id
            AND existing.status = 'open'
        )
      ON CONFLICT (store_id, equipment_item_id) WHERE status = 'open' DO NOTHING
      RETURNING *
    ),
    queued AS (
      INSERT INTO ${outboxEvents} (
        id, event_type, aggregate_type, aggregate_id, payload,
        idempotency_key, status, attempts, available_at, created_at
      )
      SELECT gen_random_uuid(), 'reorder_threshold_breached', 'reorder_alert', opened.id,
        jsonb_build_object(
          'reorderAlertId', opened.id,
          'storeId', opened.store_id,
          'equipmentItemId', opened.equipment_item_id,
          'equipmentName', item.name,
          'currentQuantity', opened.opened_quantity,
          'threshold', opened.threshold,
          'requestId', ${actor.requestId}
        ),
        'reorder_threshold_breached:' || opened.id::text,
        'pending'::outbox_status, 0, ${now}, ${now}
      FROM opened
      JOIN ${equipmentItems} item ON item.id = opened.equipment_item_id
      RETURNING id
    )
    INSERT INTO ${auditLogs} (
      actor_type, actor_id, action, entity_type, entity_id,
      before, after, request_id
    )
    SELECT 'user'::audit_actor_type, ${actor.id}::uuid,
      'reorder_alert.open', 'reorder_alert', opened.id,
      NULL, to_jsonb(opened.*), ${actor.requestId}
    FROM opened
    UNION ALL
    SELECT 'user'::audit_actor_type, ${actor.id}::uuid,
      'reorder_alert.resolve', 'reorder_alert', resolved.id,
      jsonb_build_object('status', 'open'), to_jsonb(resolved.*), ${actor.requestId}
    FROM resolved
  `
}

export function reconcileReorderAlertsForLedger(
  sourceType: 'delivery_note' | 'retention_note' | 'write_off_reversal',
  sourceNoteId: string,
  ledgerCreatedAt: Date,
  actor: AuditActor,
) {
  const scope = sql`
    SELECT ledger.equipment_item_id, ledger.store_id,
      (array_agg(ledger.id ORDER BY ledger.id::text))[1] AS trigger_ledger_id
    FROM ${stockLedger} ledger
    WHERE ledger.source_type = ${sourceType}
      AND ledger.source_note_id = ${sourceNoteId}::uuid
      AND ledger.created_at = ${ledgerCreatedAt}
      AND ledger.store_id IS NOT NULL
    GROUP BY ledger.equipment_item_id, ledger.store_id
  `
  return reconciliationSql(scope, actor, ledgerCreatedAt)
}

export function reconcileReorderAlertsForItem(
  equipmentItemId: string,
  actor: AuditActor,
  now: Date,
) {
  const scope = sql`
    SELECT item.id AS equipment_item_id, store.id AS store_id,
      NULL::uuid AS trigger_ledger_id
    FROM ${equipmentItems} item
    CROSS JOIN ${stores} store
    WHERE item.id = ${equipmentItemId}::uuid
      AND item.updated_at = ${now}
  `
  return reconciliationSql(scope, actor, now)
}
