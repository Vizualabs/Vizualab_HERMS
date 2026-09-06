CREATE TYPE "quotation_pricing_mode" AS ENUM ('standard', 'custom');
--> statement-breakpoint
ALTER TABLE "quotation" ADD COLUMN "pricing_mode" "quotation_pricing_mode";
--> statement-breakpoint
UPDATE "quotation" AS q
SET "pricing_mode" = CASE
  WHEN c."type" = 'new' THEN 'custom'::"quotation_pricing_mode"
  ELSE 'standard'::"quotation_pricing_mode"
END
FROM "customer" AS c
WHERE c."id" = q."customer_id";
--> statement-breakpoint
ALTER TABLE "quotation" ALTER COLUMN "pricing_mode" SET DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE "quotation" ALTER COLUMN "pricing_mode" SET NOT NULL;
