CREATE TABLE "opod"."character_persona_canon_links" (
	"fragment_id" uuid,
	"memory_id" uuid,
	CONSTRAINT "character_persona_canon_links_pkey" PRIMARY KEY("fragment_id","memory_id")
);
--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "source_refs" jsonb;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "occurred_label" text;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "occurred_precision" text;--> statement-breakpoint
ALTER TABLE "opod"."character_persona_canon_links" ADD CONSTRAINT "character_persona_canon_links_fragment_id_fkey" FOREIGN KEY ("fragment_id") REFERENCES "opod"."character_persona_fragments"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_persona_canon_links" ADD CONSTRAINT "character_persona_canon_links_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "opod"."character_memories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_source_refs_check" CHECK ("source_refs" IS NULL OR jsonb_typeof("source_refs") = 'array');--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_occurred_precision_check" CHECK ("occurred_precision" IS NULL OR "occurred_precision" IN ('year', 'month', 'day', 'instant', 'approximate'));--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_occurred_fields_check" CHECK (("occurred_precision" IS NULL AND "occurred_label" IS NULL)
        OR ("occurred_precision" IS NOT NULL AND "occurred_label" IS NOT NULL
          AND length(trim("occurred_label")) > 0
          AND (("occurred_precision" = 'instant' AND "occurred_at" IS NOT NULL)
            OR ("occurred_precision" <> 'instant' AND "occurred_at" IS NULL))));