ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'super_user';
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
