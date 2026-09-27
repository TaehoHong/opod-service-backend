CREATE TABLE "opod"."character_content_profiles" (
	"character_id" uuid PRIMARY KEY,
	"account_concept" text DEFAULT '' NOT NULL,
	"image_style" text DEFAULT '' NOT NULL,
	"caption_style" text DEFAULT '' NOT NULL,
	"constraints" text DEFAULT '' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opod"."character_content_profiles" ADD CONSTRAINT "character_content_profiles_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;