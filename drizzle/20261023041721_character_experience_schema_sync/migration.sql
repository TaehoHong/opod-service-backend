-- Admin already owns deployed composition data; adopt that nullable column without replacing it.
ALTER TABLE "opod"."character_visual_profile_references" ADD COLUMN IF NOT EXISTS "composition_analysis" jsonb;
--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" ADD COLUMN "experience" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_visual_profile_references"."composition_analysis" IS 'Structured source composition analysis; preserves existing descriptions and previously stored analysis.';
--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."experience" IS 'Validated public character thought, selected photo and relationship feedback; never native reasoning or internal judging data. NULL for legacy and user messages.';
--> statement-breakpoint
COMMENT ON COLUMN "opod"."influencer_media"."source_caption" IS 'Original source caption retained independently of generated character captions.';