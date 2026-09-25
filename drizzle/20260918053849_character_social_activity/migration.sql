CREATE TABLE "opod"."character_follows" (
	"follower_character_id" uuid,
	"followed_character_id" uuid,
	"followed_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "character_follows_pkey" PRIMARY KEY("follower_character_id","followed_character_id"),
	CONSTRAINT "character_follows_no_self_check" CHECK ("follower_character_id" <> "followed_character_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."character_post_views" (
	"viewer_character_id" uuid,
	"post_id" uuid,
	"first_viewed_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "character_post_views_pkey" PRIMARY KEY("viewer_character_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."character_social_activity_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."character_social_activity_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" uuid NOT NULL,
	"scheduled_at" timestamp(6) with time zone NOT NULL,
	"next_attempt_at" timestamp(6) with time zone NOT NULL,
	"processing_status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processing_lease_token" uuid,
	"processing_lease_expires_at" timestamp(6) with time zone,
	"last_error_message" text,
	"finished_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "character_social_activity_jobs_status_check" CHECK ("processing_status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "character_social_activity_jobs_attempt_count_check" CHECK ("attempt_count" >= 0),
	CONSTRAINT "character_social_activity_jobs_lease_check" CHECK (("processing_status" = 'running' AND "processing_lease_token" IS NOT NULL AND "processing_lease_expires_at" IS NOT NULL) OR ("processing_status" <> 'running' AND "processing_lease_token" IS NULL AND "processing_lease_expires_at" IS NULL)),
	CONSTRAINT "character_social_activity_jobs_finished_at_check" CHECK (("processing_status" IN ('completed', 'failed', 'cancelled')) = ("finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "opod"."character_social_activity_policies" (
	"character_id" uuid PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"active_start_local_time" time(0) NOT NULL,
	"active_end_local_time" time(0) NOT NULL,
	"activity_interval_minutes" integer NOT NULL,
	"max_daily_post_views" integer NOT NULL,
	"max_daily_post_likes" integer NOT NULL,
	"max_daily_follows" integer NOT NULL,
	"post_like_probability" numeric(4,3) NOT NULL,
	"next_activity_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "character_social_activity_policies_active_time_check" CHECK ("active_start_local_time" < TIME '24:00' AND "active_end_local_time" < TIME '24:00' AND "active_start_local_time" <> "active_end_local_time"),
	CONSTRAINT "character_social_activity_policies_interval_check" CHECK ("activity_interval_minutes" > 0),
	CONSTRAINT "character_social_activity_policies_daily_limits_check" CHECK ("max_daily_post_views" >= 0 AND "max_daily_post_likes" >= 0 AND "max_daily_follows" >= 0),
	CONSTRAINT "character_social_activity_policies_like_probability_check" CHECK ("post_like_probability" >= 0 AND "post_like_probability" <= 1),
	CONSTRAINT "character_social_activity_policies_enabled_schedule_check" CHECK (NOT "enabled" OR "next_activity_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "opod"."characters" ADD COLUMN "timezone" text;--> statement-breakpoint
CREATE INDEX "character_follows_followed_followed_at_idx" ON "opod"."character_follows" ("followed_character_id","followed_at");--> statement-breakpoint
CREATE INDEX "character_follows_follower_followed_at_idx" ON "opod"."character_follows" ("follower_character_id","followed_at");--> statement-breakpoint
CREATE INDEX "character_post_views_post_id_idx" ON "opod"."character_post_views" ("post_id");--> statement-breakpoint
CREATE INDEX "character_post_views_viewer_first_viewed_idx" ON "opod"."character_post_views" ("viewer_character_id","first_viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_social_activity_jobs_character_scheduled_key" ON "opod"."character_social_activity_jobs" ("character_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_social_activity_jobs_active_character_key" ON "opod"."character_social_activity_jobs" ("character_id") WHERE "processing_status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "character_social_activity_jobs_queued_due_idx" ON "opod"."character_social_activity_jobs" ("next_attempt_at","id") WHERE "processing_status" = 'queued';--> statement-breakpoint
CREATE INDEX "character_social_activity_jobs_running_lease_idx" ON "opod"."character_social_activity_jobs" ("processing_lease_expires_at","id") WHERE "processing_status" = 'running';--> statement-breakpoint
CREATE INDEX "character_social_activity_policies_due_idx" ON "opod"."character_social_activity_policies" ("next_activity_at","character_id") WHERE "enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "post_reactions_post_id_character_id_reaction_type_key" ON "opod"."post_reactions" ("post_id","character_id","reaction_type") WHERE "character_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "opod"."character_follows" ADD CONSTRAINT "character_follows_follower_character_id_fkey" FOREIGN KEY ("follower_character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_follows" ADD CONSTRAINT "character_follows_followed_character_id_fkey" FOREIGN KEY ("followed_character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_post_views" ADD CONSTRAINT "character_post_views_viewer_character_id_fkey" FOREIGN KEY ("viewer_character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_post_views" ADD CONSTRAINT "character_post_views_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_social_activity_jobs" ADD CONSTRAINT "character_social_activity_jobs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_social_activity_policies" ADD CONSTRAINT "character_social_activity_policies_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."characters" ADD CONSTRAINT "characters_timezone_check" CHECK ("timezone" IS NULL OR ("timezone" <> '' AND "timezone" = BTRIM("timezone")));--> statement-breakpoint
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_single_actor_check" CHECK ("user_id" IS NULL OR "character_id" IS NULL);--> statement-breakpoint
COMMENT ON COLUMN "opod"."characters"."timezone" IS 'IANA living timezone shared by character capabilities; nullable during transition';--> statement-breakpoint
COMMENT ON TABLE "opod"."character_social_activity_policies" IS 'Per-character social activity schedule and daily limits interpreted in characters.timezone';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_policies"."active_start_local_time" IS 'Inclusive local-time activity window start; windows may wrap midnight';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_policies"."active_end_local_time" IS 'Exclusive local-time activity window end; windows may wrap midnight';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_policies"."activity_interval_minutes" IS 'Positive interval between scheduler opportunities';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_policies"."next_activity_at" IS 'Next scheduler eligibility instant; required while enabled';--> statement-breakpoint
COMMENT ON TABLE "opod"."character_post_views" IS 'Durable first-view deduplication for character viewers';--> statement-breakpoint
COMMENT ON TABLE "opod"."character_follows" IS 'Directed character-to-character follows; self-follows are forbidden';--> statement-breakpoint
COMMENT ON TABLE "opod"."character_social_activity_jobs" IS 'Durable scheduled social activity jobs with one queued or running job per character';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_jobs"."processing_status" IS 'queued, running, completed, failed, or cancelled';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_social_activity_jobs"."processing_lease_token" IS 'Worker lease token; paired with processing_lease_expires_at only while running';--> statement-breakpoint
COMMENT ON COLUMN "opod"."post_reactions"."character_id" IS 'Character actor for a post reaction; mutually exclusive with user_id';
