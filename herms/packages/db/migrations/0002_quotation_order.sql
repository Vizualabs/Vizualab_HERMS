CREATE TYPE "quotation_status" AS ENUM ('sent', 'accepted', 'rejected', 'expired');
--> statement-breakpoint
CREATE TYPE "order_status" AS ENUM ('open', 'fully_returned', 'cancelled');
--> statement-breakpoint
CREATE TYPE "outbox_status" AS ENUM ('pending', 'published', 'failed');
--> statement-breakpoint
CREATE SEQUENCE "quotation_number_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE SEQUENCE "order_number_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
CREATE TABLE "quotation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quotation_number" text NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customer"("id"),
  "status" "quotation_status" DEFAULT 'sent' NOT NULL,
  "total_value_cents" integer DEFAULT 0 NOT NULL CHECK ("total_value_cents" >= 0),
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz,
  "expires_at" timestamptz,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quotation_customer_id_idx" ON "quotation" ("customer_id");
--> statement-breakpoint
CREATE INDEX "quotation_status_idx" ON "quotation" ("status");
--> statement-breakpoint
CREATE TABLE "quotation_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quotation_id" uuid NOT NULL REFERENCES "quotation"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "unit_price_cents" integer NOT NULL CHECK ("unit_price_cents" >= 0),
  "line_total_cents" integer NOT NULL CHECK ("line_total_cents" = "quantity" * "unit_price_cents"),
  UNIQUE ("quotation_id", "equipment_item_id")
);
--> statement-breakpoint
CREATE INDEX "quotation_line_quotation_id_idx" ON "quotation_line" ("quotation_id");
--> statement-breakpoint
CREATE TABLE "order" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_number" text NOT NULL UNIQUE,
  "quotation_id" uuid UNIQUE REFERENCES "quotation"("id"),
  "customer_id" uuid NOT NULL REFERENCES "customer"("id"),
  "status" "order_status" DEFAULT 'open' NOT NULL,
  "total_value_cents" integer DEFAULT 0 NOT NULL CHECK ("total_value_cents" >= 0),
  "created_by" uuid REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_customer_id_idx" ON "order" ("customer_id");
--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "order" ("status");
--> statement-breakpoint
CREATE TABLE "order_line" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "order"("id") ON DELETE CASCADE,
  "equipment_item_id" uuid NOT NULL REFERENCES "equipment_item"("id"),
  "quantity" integer NOT NULL CHECK ("quantity" > 0),
  "unit_price_cents" integer NOT NULL CHECK ("unit_price_cents" >= 0),
  "line_total_cents" integer NOT NULL CHECK ("line_total_cents" = "quantity" * "unit_price_cents")
);
--> statement-breakpoint
CREATE INDEX "order_line_order_id_idx" ON "order_line" ("order_id");
--> statement-breakpoint
CREATE TABLE "outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "status" "outbox_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "published_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_status_available_at_idx" ON "outbox" ("status", "available_at");
