ALTER TABLE "note_token" DROP CONSTRAINT IF EXISTS "note_token_note_type_check";
--> statement-breakpoint
ALTER TABLE "note_token" ADD CONSTRAINT "note_token_note_type_check"
  CHECK ("note_type" IN ('delivery_note', 'retention_note', 'quotation'));

