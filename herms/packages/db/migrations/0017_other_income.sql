CREATE TABLE "income" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL CHECK (length(btrim("category")) > 0),
  "amount_cents" integer NOT NULL CHECK ("amount_cents" > 0),
  "income_date" timestamptz NOT NULL,
  "description" text,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "income_income_date_idx" ON "income" ("income_date");
--> statement-breakpoint

ALTER TABLE "dashboard_monthly_rollup"
  ADD COLUMN "other_income_amount_cents" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_adjust_other_income_rollup(
  target_month date,
  other_income_delta bigint
) RETURNS void AS $$
BEGIN
  IF target_month IS NULL OR other_income_delta = 0 THEN
    RETURN;
  END IF;
  INSERT INTO "dashboard_monthly_rollup" (
    "month_start", "invoiced_amount_cents", "confirmed_claim_amount_cents",
    "received_payment_amount_cents", "expense_amount_cents",
    "other_income_amount_cents", "updated_at"
  ) VALUES (
    target_month, 0, 0, 0, 0, other_income_delta, now()
  )
  ON CONFLICT ("month_start") DO UPDATE SET
    "other_income_amount_cents" = "dashboard_monthly_rollup"."other_income_amount_cents"
      + EXCLUDED."other_income_amount_cents",
    "updated_at" = now();
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_income_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM dashboard_adjust_other_income_rollup(
      date_trunc('month', OLD."income_date" AT TIME ZONE 'Asia/Colombo')::date,
      -OLD."amount_cents"::bigint
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM dashboard_adjust_other_income_rollup(
      date_trunc('month', NEW."income_date" AT TIME ZONE 'Asia/Colombo')::date,
      NEW."amount_cents"::bigint
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_income_rollup_sync"
  AFTER INSERT OR UPDATE OF "amount_cents", "income_date" OR DELETE ON "income"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_income_rollup();
--> statement-breakpoint

INSERT INTO "dashboard_monthly_rollup" (
  "month_start", "invoiced_amount_cents", "confirmed_claim_amount_cents",
  "received_payment_amount_cents", "expense_amount_cents",
  "other_income_amount_cents", "updated_at"
)
SELECT date_trunc('month', "income_date" AT TIME ZONE 'Asia/Colombo')::date,
  0, 0, 0, 0, sum("amount_cents")::bigint, now()
FROM "income"
GROUP BY 1
ON CONFLICT ("month_start") DO UPDATE SET
  "other_income_amount_cents" = "dashboard_monthly_rollup"."other_income_amount_cents"
    + EXCLUDED."other_income_amount_cents",
  "updated_at" = now();
