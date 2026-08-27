CREATE TYPE "claim_status" AS ENUM ('drafted', 'confirmed', 'rejected');
--> statement-breakpoint

CREATE TABLE "damage_claim" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "discrepancy_id" uuid NOT NULL UNIQUE REFERENCES "discrepancy"("id"),
  "order_id" uuid REFERENCES "order"("id"),
  "customer_id" uuid NOT NULL REFERENCES "customer"("id"),
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "quantity" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "claim_amount_cents" integer NOT NULL,
  "status" "claim_status" DEFAULT 'drafted' NOT NULL,
  "confirmed_by" uuid REFERENCES "user"("id"),
  "confirmed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "damage_claim_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "damage_claim_unit_price_non_negative" CHECK ("unit_price_cents" >= 0),
  CONSTRAINT "damage_claim_amount_matches" CHECK (
    "claim_amount_cents" >= 0
    AND "claim_amount_cents"::bigint = "quantity"::bigint * "unit_price_cents"::bigint
  ),
  CONSTRAINT "damage_claim_confirmation_fields" CHECK (
    ("status" = 'confirmed' AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    OR ("status" <> 'confirmed' AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL)
  )
);
--> statement-breakpoint

CREATE INDEX "damage_claim_status_idx" ON "damage_claim" ("status");
--> statement-breakpoint
CREATE INDEX "damage_claim_customer_id_idx" ON "damage_claim" ("customer_id");
--> statement-breakpoint
CREATE INDEX "damage_claim_order_id_idx" ON "damage_claim" ("order_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "price_history_scheduled_effective_unique"
ON "price_history" ("equipment_item_id", "effective_date")
WHERE "reason" = 'scheduled_escalation';

