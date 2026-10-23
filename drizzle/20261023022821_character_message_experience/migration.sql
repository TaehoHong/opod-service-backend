ALTER TABLE "opod"."chat_messages" ADD COLUMN "experience" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."experience" IS 'Validated public character thought, selected photo and relationship feedback; never native reasoning or internal judging data. NULL for legacy and user messages.';