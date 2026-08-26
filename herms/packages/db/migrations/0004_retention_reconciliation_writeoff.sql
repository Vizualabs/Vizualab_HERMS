CREATE SEQUENCE "retention_note_number_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE TABLE "retention_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rn_number" text NOT NULL UNIQUE,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
  "delivery_note_id" uuid REFERENCES "delivery_note"("id"),
  "store_id" uuid REFERENCES "store"("id"),
  "status" "note_status" DEFAULT 'draft' NOT NULL,
  "submitted_by" uuid REFERENCES "user"("id"),
  "approved_by" uuid REFERENCES "user"("id"),
  "submitted_at" timestamptz,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "retention_note_order_id_idx" ON "retention_note" ("order_id");
--> statement-breakpoint
CREATE INDEX "retention_note_store_status_idx" ON "retention_note" ("store_id", "status");
--> statement-breakpoint
CREATE TABLE "retention_note_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "retention_note_id" uuid NOT NULL REFERENCES "retention_note"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "returned_qty" integer DEFAULT 0 NOT NULL CHECK ("returned_qty" >= 0),
  "balance_qty" integer DEFAULT 0 NOT NULL CHECK ("balance_qty" >= 0),
  "missing_damaged_qty" integer DEFAULT 0 NOT NULL CHECK ("missing_damaged_qty" >= 0),
  "counted_returned_qty" integer CHECK ("counted_returned_qty" >= 0),
  "mismatch_reason" "discrepancy_type",
  "responsible_party" "responsible_party",
  "reason_detail" text,
  CONSTRAINT "retention_note_line_item_unique" UNIQUE ("retention_note_id", "equipment_item_id"),
  CONSTRAINT "retention_note_line_shortfall_check" CHECK (
    ("missing_damaged_qty" = 0 AND "mismatch_reason" IS NULL AND "responsible_party" IS NULL)
    OR
    ("missing_damaged_qty" > 0 AND "mismatch_reason" IN ('missing', 'damaged', 'other') AND "responsible_party" IS NOT NULL)
  ),
  CONSTRAINT "retention_note_line_other_detail_check" CHECK (
    "mismatch_reason" <> 'other' OR length(btrim("reason_detail")) > 0
  )
);
--> statement-breakpoint
CREATE INDEX "retention_note_line_note_id_idx" ON "retention_note_line" ("retention_note_id");
--> statement-breakpoint
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_source_item_unique";
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "reversal_of_id" uuid REFERENCES "stock_ledger"("id");
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD COLUMN "reversal_reason" text;
--> statement-breakpoint
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_source_type_check";
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_source_type_check" CHECK (
  "source_type" IN ('delivery_note', 'retention_note', 'opening_balance', 'write_off_reversal')
);
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_reversal_shape_check" CHECK (
  ("source_type" = 'write_off_reversal' AND "direction" = 'in' AND "reversal_of_id" IS NOT NULL AND length(btrim("reversal_reason")) > 0)
  OR
  ("source_type" <> 'write_off_reversal' AND "reversal_of_id" IS NULL AND "reversal_reason" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_source_item_direction_unique" UNIQUE (
  "source_type", "source_note_id", "equipment_item_id", "direction"
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_ledger_reversal_of_unique" ON "stock_ledger" ("reversal_of_id") WHERE "reversal_of_id" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION require_approved_stock_source() RETURNS trigger AS $$
DECLARE
  original stock_ledger%ROWTYPE;
  actor_role user_role;
  actor_store uuid;
BEGIN
  IF NEW.source_type = 'delivery_note' AND NOT EXISTS (
    SELECT 1 FROM delivery_note WHERE id = NEW.source_note_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'delivery note must be approved before stock posting' USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'retention_note' AND NOT EXISTS (
    SELECT 1 FROM retention_note WHERE id = NEW.source_note_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'retention note must be approved before stock posting' USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'write_off_reversal' THEN
    SELECT * INTO original FROM stock_ledger WHERE id = NEW.reversal_of_id;
    SELECT role, store_id INTO actor_role, actor_store FROM "user" WHERE id = NEW.created_by AND active = true;
    IF original.id IS NULL OR original.direction <> 'write_off'
      OR NEW.equipment_item_id <> original.equipment_item_id
      OR NEW.store_id IS DISTINCT FROM original.store_id
      OR NEW.quantity_delta <> -original.quantity_delta THEN
      RAISE EXCEPTION 'write-off reversal must exactly offset its original ledger row' USING ERRCODE = '23514';
    END IF;
    IF actor_role NOT IN ('store_admin', 'system_admin')
      OR (actor_role = 'store_admin' AND (actor_store IS DISTINCT FROM original.store_id OR now() > original.created_at + interval '7 days')) THEN
      RAISE EXCEPTION 'write-off reversal is outside the permitted role or time window' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
