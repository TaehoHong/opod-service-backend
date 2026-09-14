ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "embedding_source_sha256" text;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "source_session_id" text;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "source_messages" jsonb;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "memory_type" text;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD COLUMN "occurred_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "embedding_source_sha256" text;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "occurred_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "opod"."character_persona_fragments" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "opod"."character_persona_fragments" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "opod"."character_persona_fragments" ADD COLUMN "embedding_source_sha256" text;--> statement-breakpoint
ALTER TABLE "opod"."character_persona_fragments" ADD COLUMN "embedded_at" timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD CONSTRAINT "agent_archival_memories_source_messages_check" CHECK ("source_messages" IS NULL OR jsonb_typeof("source_messages") = 'array');--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" ADD CONSTRAINT "agent_archival_memories_memory_type_check" CHECK ("memory_type" IS NULL OR "memory_type" IN ('user_fact', 'shared_episode', 'interpretation'));