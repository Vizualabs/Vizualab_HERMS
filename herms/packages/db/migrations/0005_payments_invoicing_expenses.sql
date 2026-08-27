CREATE TYPE "payment_method" AS ENUM ('cash', 'bank_transfer', 'cheque', 'other');
--> statement-breakpoint
CREATE TABLE "payment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "order"("id"),
  "customer_id" uuid NOT NULL REFERENCES "customer"("id"),
  "amount_cents" integer NOT NULL CHECK ("amount_cents" > 0),
  "payment_date" timestamptz NOT NULL,
  "method" "payment_method" NOT NULL,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payment_order_id_idx" ON "payment" ("order_id");
--> statement-breakpoint
CREATE INDEX "payment_customer_id_idx" ON "payment" ("customer_id");
--> statement-breakpoint
CREATE INDEX "payment_payment_date_idx" ON "payment" ("payment_date");
--> statement-breakpoint
CREATE TABLE "expense" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL CHECK (length(btrim("category")) > 0),
  "amount_cents" integer NOT NULL CHECK ("amount_cents" > 0),
  "expense_date" timestamptz NOT NULL,
  "description" text,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expense_expense_date_idx" ON "expense" ("expense_date");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_payment_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment rows are append-only; record a separate approved reversal instead'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "payment_append_only"
  BEFORE UPDATE OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION reject_payment_mutation();
--> statement-breakpoint
UPDATE "customer" AS customer
SET
  "outstanding_balance_cents" = COALESCE((
    SELECT SUM("order"."total_value_cents")
    FROM "order"
    WHERE "order"."customer_id" = customer."id"
      AND "order"."status" <> 'cancelled'
  ), 0),
  "updated_at" = now();
--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_outstanding_balance_nonnegative"
  CHECK ("outstanding_balance_cents" >= 0);
