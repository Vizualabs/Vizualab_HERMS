CREATE TYPE "user_role" AS ENUM (
  'business_owner',
  'sales',
  'field_staff',
  'store_admin',
  'finance',
  'system_admin'
);
--> statement-breakpoint

CREATE TYPE "customer_type" AS ENUM ('recurring', 'new');
--> statement-breakpoint
CREATE TYPE "price_change_reason" AS ENUM ('scheduled_escalation', 'negotiated', 'correction');
--> statement-breakpoint
CREATE TYPE "audit_actor_type" AS ENUM ('user', 'token');
--> statement-breakpoint

CREATE TABLE "store" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "address" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid REFERENCES "store"("id"),
  "name" text NOT NULL,
  "role" "user_role" NOT NULL,
  "is_deputy_admin" boolean DEFAULT false NOT NULL,
  "phone" text,
  "email" text,
  "password_hash" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "user_email_unique" ON "user" (lower("email")) WHERE "email" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "user_store_id_idx" ON "user" ("store_id");
--> statement-breakpoint

CREATE TABLE "customer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL REFERENCES "store"("id"),
  "name" text NOT NULL,
  "type" "customer_type" DEFAULT 'new' NOT NULL,
  "phone" text,
  "email" text,
  "address" text,
  "outstanding_balance_cents" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "customer_store_id_idx" ON "customer" ("store_id");
--> statement-breakpoint

CREATE TABLE "equipment_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "unit_of_measure" text DEFAULT 'unit' NOT NULL,
  "current_unit_price_cents" integer NOT NULL,
  "reorder_threshold" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "customer_price" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "unit_price_cents" integer NOT NULL,
  "effective_from" timestamptz DEFAULT now() NOT NULL,
  "effective_to" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "customer_price_customer_item_effective_unique" UNIQUE (
    "customer_id",
    "equipment_item_id",
    "effective_from"
  )
);
--> statement-breakpoint

CREATE INDEX "customer_price_customer_id_idx" ON "customer_price" ("customer_id");
--> statement-breakpoint
CREATE INDEX "customer_price_equipment_item_id_idx" ON "customer_price" ("equipment_item_id");
--> statement-breakpoint

CREATE TABLE "price_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "old_price_cents" integer,
  "new_price_cents" integer NOT NULL,
  "effective_date" timestamptz NOT NULL,
  "reason" "price_change_reason" NOT NULL,
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "price_history_item_effective_idx" ON "price_history" (
  "equipment_item_id",
  "effective_date"
);
--> statement-breakpoint

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_type" "audit_actor_type" NOT NULL,
  "actor_id" uuid,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "before" jsonb,
  "after" jsonb,
  "request_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "audit_log_actor_idx" ON "audit_log" ("actor_type", "actor_id");
--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");
--> statement-breakpoint

CREATE FUNCTION "reject_immutable_row_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE and DELETE are forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "price_history_append_only"
BEFORE UPDATE OR DELETE ON "price_history"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
--> statement-breakpoint

CREATE TRIGGER "audit_log_append_only"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
