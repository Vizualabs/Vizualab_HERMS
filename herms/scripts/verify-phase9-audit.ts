import { createDatabase } from '@herms/db'
import { sql } from 'drizzle-orm'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const databaseUrl = process.env.DATABASE_URL
assert(databaseUrl, 'DATABASE_URL is required')
const db = createDatabase(databaseUrl)

const result = await db.execute<{ checkName: string; missing: number | string }>(sql`
  SELECT 'delivery_note_create' AS "checkName", count(*)::integer AS missing
  FROM delivery_note note
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_log audit
    WHERE audit.entity_type = 'delivery_note' AND audit.entity_id = note.id
      AND audit.action = 'delivery_note.create'
  )
  UNION ALL
  SELECT 'delivery_note_current_state', count(*)::integer
  FROM delivery_note note
  WHERE note.status IN ('pending_approval', 'approved', 'rejected', 'reopened')
    AND NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'delivery_note' AND audit.entity_id = note.id
        AND audit.action = CASE note.status
          WHEN 'pending_approval' THEN 'delivery_note.submit'
          WHEN 'approved' THEN 'delivery_note.approve'
          WHEN 'rejected' THEN 'delivery_note.reject'
          WHEN 'reopened' THEN 'delivery_note.reopen'
        END
    )
  UNION ALL
  SELECT 'retention_note_create', count(*)::integer
  FROM retention_note note
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_log audit
    WHERE audit.entity_type = 'retention_note' AND audit.entity_id = note.id
      AND audit.action = 'retention_note.create'
  )
  UNION ALL
  SELECT 'retention_note_current_state', count(*)::integer
  FROM retention_note note
  WHERE note.status IN ('pending_approval', 'approved', 'rejected', 'reopened')
    AND NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'retention_note' AND audit.entity_id = note.id
        AND audit.action = CASE note.status
          WHEN 'pending_approval' THEN 'retention_note.submit'
          WHEN 'approved' THEN 'retention_note.approve'
          WHEN 'rejected' THEN 'retention_note.reject'
          WHEN 'reopened' THEN 'retention_note.reopen'
        END
    )
  UNION ALL
  SELECT 'stock_ledger', count(*)::integer
  FROM stock_ledger ledger
  WHERE ledger.created_by IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'stock_ledger' AND audit.entity_id = ledger.id
        AND audit.action LIKE 'stock_ledger.%'
    )
  UNION ALL
  SELECT 'discrepancy', count(*)::integer
  FROM discrepancy discrepancy
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_log audit
    WHERE audit.entity_type = 'discrepancy' AND audit.entity_id = discrepancy.id
      AND audit.action IN ('discrepancy.record', 'discrepancy.resolve')
  )
  UNION ALL
  SELECT 'payment', count(*)::integer
  FROM payment payment
  WHERE payment.created_by IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'payment' AND audit.entity_id = payment.id
        AND audit.action = 'payment.create'
    )
  UNION ALL
  SELECT 'expense', count(*)::integer
  FROM expense expense
  WHERE expense.created_by IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'expense' AND audit.entity_id = expense.id
        AND audit.action = 'expense.create'
    )
  UNION ALL
  SELECT 'damage_claim', count(*)::integer
  FROM damage_claim claim
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_log audit
    WHERE audit.entity_type = 'damage_claim' AND audit.entity_id = claim.id
      AND audit.action IN ('damage_claim.draft', 'damage_claim.confirm', 'damage_claim.reject')
  )
  UNION ALL
  SELECT 'reorder_alert_open', count(*)::integer
  FROM reorder_alert alert
  WHERE NOT EXISTS (
    SELECT 1 FROM audit_log audit
    WHERE audit.entity_type = 'reorder_alert' AND audit.entity_id = alert.id
      AND audit.action = 'reorder_alert.open'
  )
  UNION ALL
  SELECT 'reorder_alert_resolve', count(*)::integer
  FROM reorder_alert alert
  WHERE alert.status = 'resolved'
    AND NOT EXISTS (
      SELECT 1 FROM audit_log audit
      WHERE audit.entity_type = 'reorder_alert' AND audit.entity_id = alert.id
        AND audit.action = 'reorder_alert.resolve'
    )
  UNION ALL
  SELECT 'audit_structure', count(*)::integer
  FROM audit_log audit
  WHERE audit.request_id IS NULL OR btrim(audit.request_id) = ''
    OR (audit.actor_type = 'user' AND audit.actor_id IS NULL)
`)

const failures = result.rows
  .map((row) => ({ check: row.checkName, missing: Number(row.missing) }))
  .filter((row) => row.missing > 0)

assert(failures.length === 0, `Audit completeness failed: ${JSON.stringify(failures)}`)
console.log(JSON.stringify({
  event: 'phase_9_audit_verification_complete',
  checks: result.rows.length,
  missingAuditLinks: 0,
}))
