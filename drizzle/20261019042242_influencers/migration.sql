CREATE TABLE "opod"."character_influencers" (
	"character_id" uuid,
	"influencer_id" bigint,
	CONSTRAINT "character_influencers_pkey" PRIMARY KEY("character_id","influencer_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."influencer_media" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."influencer_media_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"influencer_id" bigint NOT NULL,
	"post_id" text NOT NULL,
	"post_url" text NOT NULL,
	"slide_index" integer NOT NULL,
	"asset_type" text NOT NULL,
	"media_key" text NOT NULL,
	"sha256" text NOT NULL,
	"analysis" jsonb,
	"analysis_model" text,
	"analysis_version" text,
	"embedding" vector(1024),
	"embedding_model" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."influencers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."influencers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"platform" text NOT NULL,
	"username" text NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "influencer_media_source_key" ON "opod"."influencer_media" ("influencer_id","post_id","slide_index");--> statement-breakpoint
CREATE UNIQUE INDEX "influencers_platform_username_key" ON "opod"."influencers" ("platform","username");--> statement-breakpoint
ALTER TABLE "opod"."character_influencers" ADD CONSTRAINT "character_influencers_character_id_characters_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_influencers" ADD CONSTRAINT "character_influencers_influencer_id_influencers_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "opod"."influencers"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "opod"."influencer_media" ADD CONSTRAINT "influencer_media_influencer_id_influencers_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "opod"."influencers"("id") ON DELETE RESTRICT;
--> statement-breakpoint
LOCK TABLE opod.character_reference_links IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE influencer_link_migration ON COMMIT DROP AS
SELECT character_id,
       lower(substring(trim(url) FROM
         '(?i)^https?://(?:www[.])?instagram[.]com/([a-z0-9_.]{1,30})/?(?:[?#].*)?$')) AS username
FROM opod.character_reference_links;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM influencer_link_migration
    WHERE username IS NULL OR username IN
      ('p','reel','reels','stories','explore','accounts','direct','about','developer','legal')
  ) THEN
    RAISE EXCEPTION 'Unsupported reference URL; migration aborted';
  END IF;
END $$;
INSERT INTO opod.influencers(platform, username, url)
SELECT DISTINCT 'instagram', username, 'https://www.instagram.com/' || username || '/'
FROM influencer_link_migration
ON CONFLICT (platform, username) DO NOTHING;
INSERT INTO opod.character_influencers(character_id, influencer_id)
SELECT DISTINCT m.character_id, i.id
FROM influencer_link_migration m
JOIN opod.influencers i ON i.platform = 'instagram' AND i.username = m.username
ON CONFLICT DO NOTHING;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM influencer_link_migration m
    WHERE NOT EXISTS (
      SELECT 1 FROM opod.character_influencers ci
      JOIN opod.influencers i ON i.id = ci.influencer_id
      WHERE ci.character_id = m.character_id
        AND i.platform = 'instagram' AND i.username = m.username
    )
  ) THEN
    RAISE EXCEPTION 'Reference mapping missing; migration aborted';
  END IF;
END $$;
DROP TABLE opod.character_reference_links;
