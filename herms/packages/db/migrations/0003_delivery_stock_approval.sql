CREATE TYPE "note_status" AS ENUM ('draft', 'submitted', 'pending_approval', 'approved', 'rejected', 'reopened');
--> statement-breakpoint
CREATE TYPE "discrepancy_type" AS ENUM ('missing', 'damaged', 'not_accepted', 'other');
--> statement-breakpoint
CREATE TYPE "discrepancy_status" AS ENUM ('open', 'resolved', 'written_off', 'claimed');
--> statement-breakpoint
CREATE TYPE "responsible_party" AS ENUM ('customer', 'staff_member');
--> statement-breakpoint
CREATE TYPE "stock_direction" AS ENUM ('in', 'out', 'write_off');
--> statement-breakpoint
CREATE TYPE "token_status" AS ENUM ('active', 'used', 'revoked');
--> statement-breakpoint
CREATE SEQUENCE "delivery_note_number_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE TABLE "delivery_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dn_number" text NOT NULL UNIQUE,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
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
CREATE INDEX "delivery_note_order_id_idx" ON "delivery_note" ("order_id");
--> statement-breakpoint
CREATE INDEX "delivery_note_store_status_idx" ON "delivery_note" ("store_id", "status");
--> statement-breakpoint
CREATE TABLE "delivery_note_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_note_id" uuid NOT NULL REFERENCES "delivery_note"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "issued_qty" integer NOT NULL CHECK ("issued_qty" >= 0),
  "handed_over_qty" integer NOT NULL CHECK ("handed_over_qty" >= 0),
  "counted_qty" integer CHECK ("counted_qty" >= 0),
  "mismatch_reason" "discrepancy_type",
  "mismatch_detail" text,
  CONSTRAINT "delivery_note_line_item_unique" UNIQUE ("delivery_note_id", "equipment_item_id"),
  CONSTRAINT "delivery_note_line_mismatch_reason_check" CHECK ("issued_qty" = "handed_over_qty" OR "mismatch_reason" IS NOT NULL),
  CONSTRAINT "delivery_note_line_other_detail_check" CHECK ("mismatch_reason" <> 'other' OR length(btrim("mismatch_detail")) > 0)
);
--> statement-breakpoint
CREATE INDEX "delivery_note_line_note_id_idx" ON "delivery_note_line" ("delivery_note_id");
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "store_id" uuid REFERENCES "store"("id"),
  "source_type" text NOT NULL CHECK ("source_type" IN ('delivery_note', 'retention_note', 'opening_balance')),
  "source_note_id" uuid NOT NULL,
  "direction" "stock_direction" NOT NULL,
  "quantity_delta" integer NOT NULL,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "stock_ledger_direction_delta_check" CHECK (("direction" = 'in' AND "quantity_delta" > 0) OR ("direction" IN ('out', 'write_off') AND "quantity_delta" < 0)),
  CONSTRAINT "stock_ledger_source_item_unique" UNIQUE ("source_type", "source_note_id", "equipment_item_id")
);
--> statement-breakpoint
CREATE INDEX "stock_ledger_item_created_idx" ON "stock_ledger" ("equipment_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX "stock_ledger_store_id_idx" ON "stock_ledger" ("store_id");
--> statement-breakpoint
CREATE TABLE "discrepancy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL CHECK ("source_type" IN ('delivery_note', 'retention_note')),
  "source_note_id" uuid NOT NULL,
  "source_line_id" uuid,
  "order_id" uuid REFERENCES "order"("id"),
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "discrepancy_type" "discrepancy_type" NOT NULL,
  "reason" text,
  "responsible_party" "responsible_party",
  "value_cents" integer DEFAULT 0 NOT NULL CHECK ("value_cents" >= 0),
  "status" "discrepancy_status" DEFAULT 'open' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discrepancy_source_line_unique" ON "discrepancy" ("source_type", "source_line_id") WHERE "source_line_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "discrepancy_status_idx" ON "discrepancy" ("status");
--> statement-breakpoint
CREATE INDEX "discrepancy_equipment_item_id_idx" ON "discrepancy" ("equipment_item_id");
--> statement-breakpoint
CREATE INDEX "discrepancy_order_id_idx" ON "discrepancy" ("order_id");
--> statement-breakpoint
CREATE TABLE "note_token" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "note_type" text NOT NULL CHECK ("note_type" IN ('delivery_note', 'retention_note')),
  "note_id" uuid NOT NULL,
  "status" "token_status" DEFAULT 'active' NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "note_token_live_note_unique" ON "note_token" ("note_type", "note_id") WHERE "status" IN ('active', 'used');
--> statement-breakpoint
CREATE INDEX "note_token_note_idx" ON "note_token" ("note_type", "note_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_stock_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_ledger is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_ledger_append_only
BEFORE UPDATE OR DELETE ON "stock_ledger"
FOR EACH ROW EXECUTE FUNCTION reject_stock_ledger_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION require_approved_stock_source() RETURNS trigger AS $$
BEGIN
  IF NEW.source_type = 'delivery_note' AND NOT EXISTS (
    SELECT 1 FROM delivery_note WHERE id = NEW.source_note_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'delivery note must be approved before stock posting' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_ledger_approved_source
BEFORE INSERT ON "stock_ledger"
FOR EACH ROW EXECUTE FUNCTION require_approved_stock_source();
