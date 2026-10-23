CREATE TABLE "opod"."character_reference_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."character_reference_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" uuid NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "character_reference_links_character_url_key" ON "opod"."character_reference_links" ("character_id","url");--> statement-breakpoint
ALTER TABLE "opod"."character_reference_links" ADD CONSTRAINT "character_reference_links_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;