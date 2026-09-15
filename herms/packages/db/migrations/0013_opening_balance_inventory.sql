CREATE SEQUENCE "opening_balance_note_number_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint

CREATE TABLE "opening_balance_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ob_number" text NOT NULL UNIQUE,
  "store_id" uuid NOT NULL REFERENCES "store"("id"),
  "entry_type" text DEFAULT 'opening_balance' NOT NULL,
  "status" "note_status" DEFAULT 'pending_approval' NOT NULL,
  "submitted_by" uuid NOT NULL REFERENCES "user"("id"),
  "approved_by" uuid REFERENCES "user"("id"),
  "submitted_at" timestamptz DEFAULT now() NOT NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "opening_balance_note_status_check" CHECK (
    "status" IN ('pending_approval', 'approved', 'rejected')
  ),
  CONSTRAINT "opening_balance_note_entry_type_check" CHECK (
    "entry_type" IN ('opening_balance', 'stock_addition')
  )
);
--> statement-breakpoint

CREATE INDEX "opening_balance_note_store_status_idx"
  ON "opening_balance_note" ("store_id", "status");
--> statement-breakpoint

CREATE TABLE "opening_balance_note_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "opening_balance_note_id" uuid NOT NULL
    REFERENCES "opening_balance_note"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "requested_qty" integer NOT NULL CHECK ("requested_qty" > 0),
  "counted_qty" integer CHECK ("counted_qty" >= 0),
  CONSTRAINT "opening_balance_note_line_item_unique" UNIQUE (
    "opening_balance_note_id", "equipment_item_id"
  )
);
--> statement-breakpoint

CREATE INDEX "opening_balance_note_line_note_id_idx"
  ON "opening_balance_note_line" ("opening_balance_note_id");
--> statement-breakpoint

CREATE INDEX "opening_balance_note_line_item_id_idx"
  ON "opening_balance_note_line" ("equipment_item_id");
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
  ELSIF NEW.source_type = 'opening_balance' AND NOT EXISTS (
    SELECT 1 FROM opening_balance_note
    WHERE id = NEW.source_note_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'opening balance note must be approved before stock posting'
      USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'write_off_reversal' THEN
    SELECT * INTO original FROM stock_ledger WHERE id = NEW.reversal_of_id;
    SELECT role, store_id INTO actor_role, actor_store FROM "user"
      WHERE id = NEW.created_by AND active = true;
    IF original.id IS NULL OR original.direction <> 'write_off'
      OR NEW.equipment_item_id <> original.equipment_item_id
      OR NEW.store_id IS DISTINCT FROM original.store_id
      OR NEW.quantity_delta <> -original.quantity_delta THEN
      RAISE EXCEPTION 'write-off reversal must exactly offset its original ledger row'
        USING ERRCODE = '23514';
    END IF;
    IF actor_role::text NOT IN ('store_admin', 'system_admin', 'super_user')
      OR (actor_role = 'store_admin'
        AND (actor_store IS DISTINCT FROM original.store_id
          OR now() > original.created_at + interval '7 days')) THEN
      RAISE EXCEPTION 'write-off reversal is outside the permitted role or time window'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
