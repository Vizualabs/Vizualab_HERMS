CREATE OR REPLACE FUNCTION reject_stock_ledger_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('herms.allow_equipment_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stock_ledger is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_price_history_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('herms.allow_equipment_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'price_history is append-only; UPDATE and DELETE are forbidden' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "price_history_append_only" ON "price_history";
--> statement-breakpoint

CREATE TRIGGER "price_history_append_only"
BEFORE UPDATE OR DELETE ON "price_history"
FOR EACH ROW EXECUTE FUNCTION reject_price_history_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION purge_unused_equipment_item(
  target_id uuid,
  actor_id uuid,
  request_id text,
  before_json jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_id uuid;
BEGIN
  PERFORM set_config('herms.allow_equipment_purge', 'on', true);

  DELETE FROM "reorder_alert" WHERE "equipment_item_id" = target_id;
  DELETE FROM "customer_price" WHERE "equipment_item_id" = target_id;
  DELETE FROM "price_history" WHERE "equipment_item_id" = target_id;
  DELETE FROM "dashboard_stock_rollup" WHERE "equipment_item_id" = target_id;
  DELETE FROM "dashboard_discrepancy_rollup" WHERE "equipment_item_id" = target_id;
  DELETE FROM "opening_balance_note_line" WHERE "equipment_item_id" = target_id;
  DELETE FROM "stock_ledger" WHERE "equipment_item_id" = target_id;

  DELETE FROM "equipment_item" WHERE "id" = target_id RETURNING "id" INTO deleted_id;
  IF deleted_id IS NULL THEN
    RAISE EXCEPTION 'equipment item was not deleted' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO "audit_log" (
    id, actor_type, actor_id, action, entity_type, entity_id, before, after, request_id
  ) VALUES (
    gen_random_uuid(),
    'user',
    actor_id,
    'equipment_item.delete',
    'equipment_item',
    target_id,
    before_json,
    NULL,
    request_id
  );

  RETURN deleted_id;
END;
$$;
