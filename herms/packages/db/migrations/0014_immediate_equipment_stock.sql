UPDATE "opening_balance_note_line" AS line
SET "counted_qty" = line."requested_qty"
FROM "opening_balance_note" AS note
WHERE note."id" = line."opening_balance_note_id"
  AND line."counted_qty" IS NULL;
--> statement-breakpoint

WITH converted AS (
  UPDATE "opening_balance_note"
  SET "status" = 'approved',
    "approved_by" = COALESCE("approved_by", "submitted_by"),
    "approved_at" = COALESCE("approved_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "status" <> 'approved'
  RETURNING *
)
INSERT INTO "audit_log" (
  "actor_type", "actor_id", "action", "entity_type", "entity_id",
  "before", "after", "request_id"
)
SELECT 'user', converted."submitted_by", 'opening_balance.auto_post',
  'opening_balance_note', converted."id", NULL, to_jsonb(converted.*),
  '0014_immediate_equipment_stock'
FROM converted;
--> statement-breakpoint

INSERT INTO "stock_ledger" (
  "id", "equipment_item_id", "store_id", "source_type", "source_note_id",
  "direction", "quantity_delta", "created_by", "created_at"
)
SELECT gen_random_uuid(), line."equipment_item_id", note."store_id",
  'opening_balance', note."id", 'in', line."counted_qty",
  note."submitted_by", COALESCE(note."approved_at", CURRENT_TIMESTAMP)
FROM "opening_balance_note" AS note
JOIN "opening_balance_note_line" AS line
  ON line."opening_balance_note_id" = note."id"
WHERE note."status" = 'approved'
  AND line."counted_qty" IS NOT NULL
ON CONFLICT (
  "source_type", "source_note_id", "equipment_item_id", "direction"
) DO NOTHING;
--> statement-breakpoint

WITH current_stock AS (
  SELECT ledger."store_id", ledger."equipment_item_id",
    SUM(ledger."quantity_delta")::integer AS quantity,
    (array_agg(ledger."id" ORDER BY ledger."created_at" DESC, ledger."id" DESC))[1]
      AS latest_ledger_id
  FROM "stock_ledger" AS ledger
  WHERE ledger."store_id" IS NOT NULL
  GROUP BY ledger."store_id", ledger."equipment_item_id"
)
UPDATE "reorder_alert" AS alert
SET "status" = 'resolved',
  "resolved_ledger_id" = current_stock.latest_ledger_id,
  "resolved_quantity" = current_stock.quantity,
  "resolved_at" = CURRENT_TIMESTAMP
FROM current_stock
WHERE alert."store_id" = current_stock."store_id"
  AND alert."equipment_item_id" = current_stock."equipment_item_id"
  AND alert."status" = 'open'
  AND current_stock.quantity >= alert."threshold";
--> statement-breakpoint

ALTER TABLE "opening_balance_note"
  ALTER COLUMN "status" SET DEFAULT 'approved';
--> statement-breakpoint

ALTER TABLE "opening_balance_note"
  DROP CONSTRAINT "opening_balance_note_status_check";
--> statement-breakpoint

ALTER TABLE "opening_balance_note"
  ADD CONSTRAINT "opening_balance_note_status_check"
  CHECK ("status" = 'approved');
