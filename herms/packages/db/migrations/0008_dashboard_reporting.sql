CREATE TABLE "dashboard_stock_rollup" (
  "equipment_item_id" uuid PRIMARY KEY REFERENCES "equipment_item"("id") ON DELETE CASCADE,
  "quantity" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "dashboard_monthly_rollup" (
  "month_start" date PRIMARY KEY,
  "invoiced_amount_cents" bigint DEFAULT 0 NOT NULL,
  "confirmed_claim_amount_cents" bigint DEFAULT 0 NOT NULL,
  "received_payment_amount_cents" bigint DEFAULT 0 NOT NULL,
  "expense_amount_cents" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "dashboard_discrepancy_rollup" (
  "discrepancy_id" uuid PRIMARY KEY REFERENCES "discrepancy"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "order"("id"),
  "customer_id" uuid REFERENCES "customer"("id"),
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "discrepancy_type" "discrepancy_type" NOT NULL,
  "status" "discrepancy_status" NOT NULL,
  "responsible_party" "responsible_party",
  "quantity" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "value_cents" bigint NOT NULL,
  "reason" text,
  "source_type" text NOT NULL,
  "source_note_id" uuid NOT NULL,
  "recorded_at" timestamptz NOT NULL,
  "approved_at" timestamptz NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "dashboard_discrepancy_recorded_idx"
  ON "dashboard_discrepancy_rollup" ("recorded_at");
--> statement-breakpoint
CREATE INDEX "dashboard_discrepancy_customer_recorded_idx"
  ON "dashboard_discrepancy_rollup" ("customer_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX "dashboard_discrepancy_item_recorded_idx"
  ON "dashboard_discrepancy_rollup" ("equipment_item_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX "dashboard_discrepancy_status_type_idx"
  ON "dashboard_discrepancy_rollup" ("status", "discrepancy_type");
--> statement-breakpoint

INSERT INTO "dashboard_stock_rollup" ("equipment_item_id", "quantity", "updated_at")
SELECT "equipment_item_id", sum("quantity_delta")::bigint, max("created_at")
FROM "stock_ledger"
GROUP BY "equipment_item_id";
--> statement-breakpoint

INSERT INTO "dashboard_monthly_rollup" (
  "month_start", "invoiced_amount_cents", "confirmed_claim_amount_cents",
  "received_payment_amount_cents", "expense_amount_cents", "updated_at"
)
SELECT month_start,
  sum(invoiced_amount_cents)::bigint,
  sum(confirmed_claim_amount_cents)::bigint,
  sum(received_payment_amount_cents)::bigint,
  sum(expense_amount_cents)::bigint,
  now()
FROM (
  SELECT date_trunc('month', "created_at" AT TIME ZONE 'Asia/Colombo')::date AS month_start,
    "total_value_cents"::bigint AS invoiced_amount_cents,
    0::bigint AS confirmed_claim_amount_cents,
    0::bigint AS received_payment_amount_cents,
    0::bigint AS expense_amount_cents
  FROM "order"
  WHERE "status" <> 'cancelled'
  UNION ALL
  SELECT date_trunc('month', "confirmed_at" AT TIME ZONE 'Asia/Colombo')::date,
    0, "claim_amount_cents"::bigint, 0, 0
  FROM "damage_claim"
  WHERE "status" = 'confirmed' AND "confirmed_at" IS NOT NULL
  UNION ALL
  SELECT date_trunc('month', "payment_date" AT TIME ZONE 'Asia/Colombo')::date,
    0, 0, "amount_cents"::bigint, 0
  FROM "payment"
  UNION ALL
  SELECT date_trunc('month', "expense_date" AT TIME ZONE 'Asia/Colombo')::date,
    0, 0, 0, "amount_cents"::bigint
  FROM "expense"
) source
GROUP BY month_start;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_adjust_monthly_rollup(
  target_month date,
  invoice_delta bigint DEFAULT 0,
  claim_delta bigint DEFAULT 0,
  payment_delta bigint DEFAULT 0,
  expense_delta bigint DEFAULT 0
) RETURNS void AS $$
BEGIN
  IF target_month IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO "dashboard_monthly_rollup" (
    "month_start", "invoiced_amount_cents", "confirmed_claim_amount_cents",
    "received_payment_amount_cents", "expense_amount_cents", "updated_at"
  ) VALUES (
    target_month, invoice_delta, claim_delta, payment_delta, expense_delta, now()
  )
  ON CONFLICT ("month_start") DO UPDATE SET
    "invoiced_amount_cents" = "dashboard_monthly_rollup"."invoiced_amount_cents" + EXCLUDED."invoiced_amount_cents",
    "confirmed_claim_amount_cents" = "dashboard_monthly_rollup"."confirmed_claim_amount_cents" + EXCLUDED."confirmed_claim_amount_cents",
    "received_payment_amount_cents" = "dashboard_monthly_rollup"."received_payment_amount_cents" + EXCLUDED."received_payment_amount_cents",
    "expense_amount_cents" = "dashboard_monthly_rollup"."expense_amount_cents" + EXCLUDED."expense_amount_cents",
    "updated_at" = now();
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_stock_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO "dashboard_stock_rollup" ("equipment_item_id", "quantity", "updated_at")
    VALUES (OLD."equipment_item_id", -OLD."quantity_delta", now())
    ON CONFLICT ("equipment_item_id") DO UPDATE SET
      "quantity" = "dashboard_stock_rollup"."quantity" + EXCLUDED."quantity",
      "updated_at" = now();
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO "dashboard_stock_rollup" ("equipment_item_id", "quantity", "updated_at")
    VALUES (NEW."equipment_item_id", NEW."quantity_delta", now())
    ON CONFLICT ("equipment_item_id") DO UPDATE SET
      "quantity" = "dashboard_stock_rollup"."quantity" + EXCLUDED."quantity",
      "updated_at" = now();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_stock_rollup_sync"
  AFTER INSERT OR UPDATE OR DELETE ON "stock_ledger"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_stock_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_order_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."status" <> 'cancelled' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', OLD."created_at" AT TIME ZONE 'Asia/Colombo')::date,
      -OLD."total_value_cents"::bigint
    );
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."status" <> 'cancelled' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', NEW."created_at" AT TIME ZONE 'Asia/Colombo')::date,
      NEW."total_value_cents"::bigint
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_order_rollup_sync"
  AFTER INSERT OR UPDATE OF "status", "total_value_cents", "created_at" OR DELETE ON "order"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_order_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_claim_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."status" = 'confirmed' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', OLD."confirmed_at" AT TIME ZONE 'Asia/Colombo')::date,
      0, -OLD."claim_amount_cents"::bigint
    );
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."status" = 'confirmed' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', NEW."confirmed_at" AT TIME ZONE 'Asia/Colombo')::date,
      0, NEW."claim_amount_cents"::bigint
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_claim_rollup_sync"
  AFTER INSERT OR UPDATE OF "status", "claim_amount_cents", "confirmed_at" OR DELETE ON "damage_claim"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_claim_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_payment_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', OLD."payment_date" AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, -OLD."amount_cents"::bigint
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', NEW."payment_date" AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, NEW."amount_cents"::bigint
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_payment_rollup_sync"
  AFTER INSERT OR UPDATE OF "amount_cents", "payment_date" OR DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_payment_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_expense_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', OLD."expense_date" AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, 0, -OLD."amount_cents"::bigint
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM dashboard_adjust_monthly_rollup(
      date_trunc('month', NEW."expense_date" AT TIME ZONE 'Asia/Colombo')::date,
      0, 0, 0, NEW."amount_cents"::bigint
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_expense_rollup_sync"
  AFTER INSERT OR UPDATE OF "amount_cents", "expense_date" OR DELETE ON "expense"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_expense_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_refresh_discrepancy(target_id uuid) RETURNS void AS $$
BEGIN
  DELETE FROM "dashboard_discrepancy_rollup" WHERE "discrepancy_id" = target_id;
  INSERT INTO "dashboard_discrepancy_rollup" (
    "discrepancy_id", "order_id", "customer_id", "equipment_item_id",
    "discrepancy_type", "status", "responsible_party", "quantity",
    "unit_price_cents", "value_cents", "reason", "source_type", "source_note_id",
    "recorded_at", "approved_at", "updated_at"
  )
  SELECT discrepancy."id", discrepancy."order_id", rental_order."customer_id",
    discrepancy."equipment_item_id", discrepancy."discrepancy_type", discrepancy."status",
    discrepancy."responsible_party", discrepancy."quantity",
    COALESCE(damage_price."new_price_cents", item."current_unit_price_cents"),
    discrepancy."quantity"::bigint * COALESCE(
      damage_price."new_price_cents", item."current_unit_price_cents"
    )::bigint,
    discrepancy."reason", discrepancy."source_type", discrepancy."source_note_id",
    discrepancy."created_at",
    COALESCE(delivery."approved_at", retention."approved_at"),
    now()
  FROM "discrepancy" discrepancy
  LEFT JOIN "order" rental_order ON rental_order."id" = discrepancy."order_id"
  JOIN "equipment_item" item ON item."id" = discrepancy."equipment_item_id"
  LEFT JOIN "delivery_note" delivery
    ON discrepancy."source_type" = 'delivery_note'
    AND delivery."id" = discrepancy."source_note_id"
    AND delivery."status" = 'approved'
  LEFT JOIN "retention_note" retention
    ON discrepancy."source_type" = 'retention_note'
    AND retention."id" = discrepancy."source_note_id"
    AND retention."status" = 'approved'
  LEFT JOIN LATERAL (
    SELECT history."new_price_cents"
    FROM "price_history" history
    WHERE history."equipment_item_id" = discrepancy."equipment_item_id"
      AND history."effective_date" <= discrepancy."created_at"
    ORDER BY history."effective_date" DESC, history."created_at" DESC
    LIMIT 1
  ) damage_price ON true
  WHERE discrepancy."id" = target_id
    AND discrepancy."discrepancy_type" IN ('missing', 'damaged')
    AND (delivery."id" IS NOT NULL OR retention."id" IS NOT NULL);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_discrepancy_rollup() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "dashboard_discrepancy_rollup" WHERE "discrepancy_id" = OLD."id";
    RETURN OLD;
  END IF;
  PERFORM dashboard_refresh_discrepancy(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_discrepancy_rollup_sync"
  AFTER INSERT OR UPDATE OR DELETE ON "discrepancy"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_discrepancy_rollup();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_note_discrepancies() RETURNS trigger AS $$
DECLARE
  discrepancy_row record;
BEGIN
  FOR discrepancy_row IN
    SELECT "id" FROM "discrepancy"
    WHERE "source_type" = TG_ARGV[0] AND "source_note_id" = NEW."id"
  LOOP
    PERFORM dashboard_refresh_discrepancy(discrepancy_row."id");
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_delivery_discrepancy_sync"
  AFTER UPDATE OF "status", "approved_at" ON "delivery_note"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_note_discrepancies('delivery_note');
--> statement-breakpoint
CREATE TRIGGER "dashboard_retention_discrepancy_sync"
  AFTER UPDATE OF "status", "approved_at" ON "retention_note"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_note_discrepancies('retention_note');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION dashboard_sync_price_discrepancies() RETURNS trigger AS $$
DECLARE
  target_item_id uuid;
  discrepancy_row record;
BEGIN
  target_item_id := COALESCE(NEW."equipment_item_id", OLD."equipment_item_id");
  FOR discrepancy_row IN
    SELECT "id" FROM "discrepancy" WHERE "equipment_item_id" = target_item_id
  LOOP
    PERFORM dashboard_refresh_discrepancy(discrepancy_row."id");
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "dashboard_price_discrepancy_sync"
  AFTER INSERT OR UPDATE OR DELETE ON "price_history"
  FOR EACH ROW EXECUTE FUNCTION dashboard_sync_price_discrepancies();
--> statement-breakpoint

DO $$
DECLARE
  discrepancy_row record;
BEGIN
  FOR discrepancy_row IN SELECT "id" FROM "discrepancy" LOOP
    PERFORM dashboard_refresh_discrepancy(discrepancy_row."id");
  END LOOP;
END;
$$;
