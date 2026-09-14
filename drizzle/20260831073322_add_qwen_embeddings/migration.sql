CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;--> statement-breakpoint
ALTER TABLE "opod"."character_location_references" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "opod"."character_location_references" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "opod"."character_location_references" ADD COLUMN "embedded_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "embedded_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profile_references" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profile_references" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profile_references" ADD COLUMN "embedded_at" timestamp(6) with time zone;
