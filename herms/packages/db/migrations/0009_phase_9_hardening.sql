CREATE TABLE "reorder_alert" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "store"("id"),
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "opened_ledger_id" uuid REFERENCES "stock_ledger"("id"),
  "resolved_ledger_id" uuid REFERENCES "stock_ledger"("id"),
  "threshold" integer NOT NULL,
  "opened_quantity" integer NOT NULL,
  "resolved_quantity" integer,
  "status" text DEFAULT 'open' NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "reorder_alert_threshold_non_negative" CHECK ("threshold" >= 0),
  CONSTRAINT "reorder_alert_status_check" CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "reorder_alert_resolution_check" CHECK (
    ("status" = 'open' AND "resolved_at" IS NULL AND "resolved_quantity" IS NULL)
    OR
    ("status" = 'resolved' AND "resolved_at" IS NOT NULL AND "resolved_quantity" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "reorder_alert_one_open_per_store_item"
  ON "reorder_alert" ("store_id", "equipment_item_id")
  WHERE "status" = 'open';

CREATE INDEX "reorder_alert_store_status_idx"
  ON "reorder_alert" ("store_id", "status", "opened_at");

CREATE INDEX "reorder_alert_item_idx"
  ON "reorder_alert" ("equipment_item_id", "opened_at");
