CREATE SCHEMA "opod";
--> statement-breakpoint
CREATE TYPE "opod"."agent_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."agent_memory_kind" AS ENUM('observation', 'reflection');--> statement-breakpoint
CREATE TYPE "opod"."character_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "opod"."consent_type" AS ENUM('terms_of_service', 'privacy', 'age_14', 'marketing');--> statement-breakpoint
CREATE TYPE "opod"."credit_kind" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "opod"."credit_ledger_type" AS ENUM('grant', 'usage', 'refund_recovery', 'adjustment');--> statement-breakpoint
CREATE TYPE "opod"."credit_purchase_status" AS ENUM('pending', 'payment_processing', 'completed', 'failed', 'canceled', 'refunded', 'reversed');--> statement-breakpoint
CREATE TYPE "opod"."credit_refund_state" AS ENUM('reserved', 'payment_processing', 'payment_succeeded', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "opod"."credit_reservation_status" AS ENUM('reserved', 'captured', 'released');--> statement-breakpoint
CREATE TYPE "opod"."draft_evaluation_kind" AS ENUM('plan', 'prompt', 'image', 'image_plan');--> statement-breakpoint
CREATE TYPE "opod"."draft_evaluation_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."generation_job_status" AS ENUM('draft', 'queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."inquiry_status" AS ENUM('submitted', 'answered');--> statement-breakpoint
CREATE TYPE "opod"."llm_log_media_role" AS ENUM('input', 'output');--> statement-breakpoint
CREATE TYPE "opod"."llm_log_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "opod"."message_reply_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."message_sender_type" AS ENUM('user', 'character');--> statement-breakpoint
CREATE TYPE "opod"."payment_channel" AS ENUM('web', 'apple', 'google');--> statement-breakpoint
CREATE TYPE "opod"."payment_direction" AS ENUM('inflow', 'outflow');--> statement-breakpoint
CREATE TYPE "opod"."payment_ledger_type" AS ENUM('capture', 'refund', 'chargeback', 'adjustment');--> statement-breakpoint
CREATE TYPE "opod"."payment_provider_event_status" AS ENUM('processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."payment_status" AS ENUM('pending', 'verified', 'processing', 'paid', 'failed', 'canceled', 'partially_refunded', 'refunded', 'reversed');--> statement-breakpoint
CREATE TYPE "opod"."post_content_type" AS ENUM('feed', 'reel');--> statement-breakpoint
CREATE TYPE "opod"."post_draft_status" AS ENUM('planned', 'generating', 'needs_review', 'regenerating', 'approved', 'rejected', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "opod"."post_draft_type" AS ENUM('post', 'story');--> statement-breakpoint
CREATE TYPE "opod"."report_status" AS ENUM('submitted', 'reviewing', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "opod"."report_target_type" AS ENUM('character', 'post', 'message');--> statement-breakpoint
CREATE TABLE "opod"."admin_settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."admins" (
	"id" uuid PRIMARY KEY,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_archival_memories" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"content" text NOT NULL,
	"kind" "opod"."agent_memory_kind" NOT NULL,
	"importance" double precision NOT NULL,
	"embedding" double precision[],
	"evidence" text[] DEFAULT ARRAY[]::text[],
	"operation_key" text,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_accessed_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_core_memories" (
	"user_id" text,
	"character_id" text,
	"content" text NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "agent_core_memories_pkey" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_memory_jobs" (
	"id" uuid PRIMARY KEY,
	"idempotency_key" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" "opod"."agent_job_status" DEFAULT 'queued'::"opod"."agent_job_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp(6) with time zone,
	"error_message" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"character_id" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_memory_operations" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_relationship_state" (
	"user_id" text,
	"character_id" text,
	"importance_since_reflection" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"bond_xp" integer DEFAULT 0 NOT NULL,
	"bond_level" integer DEFAULT 1 NOT NULL,
	"warmth" double precision DEFAULT 20 NOT NULL,
	"last_decay_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"daily_bond_date" text DEFAULT '' NOT NULL,
	"daily_bond_xp" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_relationship_state_pkey" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."agent_summaries" (
	"user_id" text,
	"character_id" text,
	"session_id" text,
	"content" text NOT NULL,
	"turns_covered" integer NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "agent_summaries_pkey" PRIMARY KEY("user_id","character_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."character_action_logs" (
	"id" bigserial PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"target_table" text,
	"target_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."character_location_references" (
	"location_id" uuid,
	"media_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "character_location_references_pkey" PRIMARY KEY("location_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."character_locations" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid,
	"location_key" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"visual_prompt" text NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"deleted_at" timestamp(6) with time zone,
	"reference_negative_prompt" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."character_memories" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"content" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"deleted_at" timestamp(6) with time zone,
	"type" text DEFAULT 'fact' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."character_personas" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"deleted_at" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE TABLE "opod"."character_posting_policies" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"weekly_cadence" integer DEFAULT 3 NOT NULL,
	"hour_start_kst" integer DEFAULT 18 NOT NULL,
	"hour_end_kst" integer DEFAULT 22 NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."character_visual_profile_references" (
	"profile_id" uuid,
	"media_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "character_visual_profile_references_pkey" PRIMARY KEY("profile_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."character_visual_profiles" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"appearance_prompt" text DEFAULT '' NOT NULL,
	"style_prompt" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"provider_config" jsonb,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."characters" (
	"id" uuid PRIMARY KEY,
	"public_id" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text NOT NULL,
	"interests" text[] DEFAULT ARRAY[]::text[],
	"status" "opod"."character_status" DEFAULT 'active'::"opod"."character_status" NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"profile_image_crop_x" double precision DEFAULT 0.5 NOT NULL,
	"profile_image_crop_y" double precision DEFAULT 0.5 NOT NULL,
	"profile_image_crop_zoom" double precision DEFAULT 1 NOT NULL,
	"profile_image_id" uuid,
	"content_language" text DEFAULT 'ko' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."console_logs" (
	"id" bigserial PRIMARY KEY,
	"admin_id" uuid,
	"admin_email" text,
	"action_type" text NOT NULL,
	"target" text,
	"summary" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_check_ins" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"check_in_date" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_ledger" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"type" "opod"."credit_ledger_type" NOT NULL,
	"credit_kind" "opod"."credit_kind",
	"purchase_id" uuid,
	"promotion_code" text,
	"amount" integer NOT NULL,
	"expires_at" timestamp(6) with time zone,
	"reason" text NOT NULL,
	"external_reference" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_products" (
	"id" uuid PRIMARY KEY,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"credit_amount" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_purchases" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"status" "opod"."credit_purchase_status" DEFAULT 'pending'::"opod"."credit_purchase_status" NOT NULL,
	"credit_amount" integer NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"fulfilled_at" timestamp(6) with time zone,
	"idempotency_key" text NOT NULL,
	"product_id" text NOT NULL,
	"credit_product_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_refund" (
	"id" uuid PRIMARY KEY,
	"purchase_id" uuid NOT NULL,
	"status" "opod"."credit_refund_state" DEFAULT 'reserved'::"opod"."credit_refund_state" NOT NULL,
	"reason" text DEFAULT 'user_request' NOT NULL,
	"idempotency_key" text NOT NULL,
	"credit_amount" integer NOT NULL,
	"promotion_amount" integer DEFAULT 0 NOT NULL,
	"locked_amount" integer NOT NULL,
	"recovery_amount" integer NOT NULL,
	"debt_amount" integer DEFAULT 0 NOT NULL,
	"gross_amount" integer NOT NULL,
	"fee_amount" integer NOT NULL,
	"refund_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"provider_refund_id" text,
	"provider_transaction_id" text,
	"completed_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"provider" text NOT NULL,
	"free_promotion_amount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_reservations" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "opod"."credit_reservation_status" DEFAULT 'reserved'::"opod"."credit_reservation_status" NOT NULL,
	"reference" text NOT NULL,
	"expires_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."credit_usage" (
	"usage_ledger_id" uuid,
	"grant_ledger_id" uuid,
	"amount" integer NOT NULL,
	CONSTRAINT "credit_usage_pkey" PRIMARY KEY("usage_ledger_id","grant_ledger_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."draft_evaluations" (
	"id" uuid PRIMARY KEY,
	"draft_id" uuid NOT NULL,
	"kind" "opod"."draft_evaluation_kind" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "opod"."draft_evaluation_status" DEFAULT 'pending'::"opod"."draft_evaluation_status" NOT NULL,
	"lease_expires_at" timestamp(6) with time zone,
	"evaluator_name" text,
	"rubric_version" text NOT NULL,
	"content_language" text DEFAULT 'ko' NOT NULL,
	"overall_score" double precision,
	"scores_json" jsonb,
	"issues_json" jsonb,
	"suggestions_json" jsonb,
	"error_message" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp(6) with time zone
);
--> statement-breakpoint
CREATE TABLE "opod"."evaluation_reports" (
	"id" uuid PRIMARY KEY,
	"period_start" timestamp(6) with time zone NOT NULL,
	"period_end" timestamp(6) with time zone NOT NULL,
	"rubric_version" text NOT NULL,
	"summary_json" jsonb NOT NULL,
	"failure_patterns_json" jsonb,
	"prompt_suggestions_json" jsonb,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."faqs" (
	"id" uuid PRIMARY KEY,
	"category" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."generation_job_outputs" (
	"id" uuid PRIMARY KEY,
	"job_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"candidate_index" integer NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"filter_preset" text,
	CONSTRAINT "generation_job_outputs_filter_preset_check" CHECK (((filter_preset IS NULL) OR (filter_preset = ANY (ARRAY['none'::text, 'film'::text, 'mono-film'::text]))))
);
--> statement-breakpoint
CREATE TABLE "opod"."generation_jobs" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"media_type" "opod"."media_type" NOT NULL,
	"prompt" text NOT NULL,
	"input_prompt" text,
	"candidate_count" integer,
	"status" "opod"."generation_job_status" DEFAULT 'queued'::"opod"."generation_job_status" NOT NULL,
	"output_media_id" uuid,
	"provider" text,
	"params_json" jsonb,
	"provider_request_id" text,
	"lease_expires_at" timestamp(6) with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"origin_job_id" uuid,
	"error_message" text,
	"cost_usd" numeric(10,4),
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"draft_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."hashtags" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."inquiries" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"status" "opod"."inquiry_status" DEFAULT 'submitted'::"opod"."inquiry_status" NOT NULL,
	"answer_body" text,
	"answered_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."llm_log_media" (
	"llm_log_id" bigint,
	"media_id" uuid,
	"role" "opod"."llm_log_media_role",
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_log_media_pkey" PRIMARY KEY("llm_log_id","role","media_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."llm_logs" (
	"id" bigserial PRIMARY KEY,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "opod"."llm_log_status" DEFAULT 'running'::"opod"."llm_log_status" NOT NULL,
	"endpoint" text,
	"is_streaming" boolean DEFAULT false NOT NULL,
	"request_id" text,
	"provider_request_id" text,
	"user_id" text,
	"character_id" text,
	"generation_job_id" uuid,
	"system_prompt_json" jsonb,
	"user_prompt_json" jsonb,
	"request_json" jsonb NOT NULL,
	"response_json" jsonb,
	"metadata_json" jsonb,
	"redacted_paths" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"http_status" integer,
	"error_type" text,
	"error_message" text,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp(6) with time zone,
	"response_model" text,
	"usage_json" jsonb,
	"finish_reason" text,
	"time_to_first_token_ms" integer,
	"cached_input_tokens" integer,
	"cache_write_tokens" integer,
	"reasoning_tokens" integer,
	"cost" numeric(20,10),
	"upstream_cost" numeric(20,10)
);
--> statement-breakpoint
CREATE TABLE "opod"."media" (
	"id" uuid PRIMARY KEY,
	"media_type" "opod"."media_type" NOT NULL,
	"url" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."message_conversations" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_read_at" timestamp(6) with time zone,
	"last_message_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."message_reply_jobs" (
	"id" uuid PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"status" "opod"."message_reply_job_status" DEFAULT 'queued'::"opod"."message_reply_job_status" NOT NULL,
	"reservation_reference" text,
	"ready_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp(6) with time zone,
	"started_at" timestamp(6) with time zone,
	"deadline_at" timestamp(6) with time zone,
	"completed_at" timestamp(6) with time zone,
	"failed_at" timestamp(6) with time zone,
	"failure_reason" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."messages" (
	"id" uuid PRIMARY KEY,
	"conversation_id" uuid NOT NULL,
	"sender_type" "opod"."message_sender_type" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"reply_job_id" uuid
);
--> statement-breakpoint
CREATE TABLE "opod"."notices" (
	"id" uuid PRIMARY KEY,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."notifications" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"target_type" text,
	"target_id" uuid,
	"read_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."payment_ledger" (
	"id" uuid PRIMARY KEY,
	"payment_id" uuid NOT NULL,
	"type" "opod"."payment_ledger_type" NOT NULL,
	"direction" "opod"."payment_direction" NOT NULL,
	"amount" integer,
	"currency" text,
	"provider_transaction_id" text,
	"provider_event_id" text,
	"admin_id" uuid,
	"reason" text,
	"details" jsonb,
	"occurred_at" timestamp(6) with time zone NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."payment_product_mappings" (
	"id" uuid PRIMARY KEY,
	"credit_product_id" uuid NOT NULL,
	"channel" "opod"."payment_channel" NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"price_amount" integer,
	"currency" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."payment_provider_events" (
	"id" uuid PRIMARY KEY,
	"payment_id" uuid,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" "opod"."payment_provider_event_status" DEFAULT 'processing'::"opod"."payment_provider_event_status" NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error_code" text,
	"processed_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."payments" (
	"id" uuid PRIMARY KEY,
	"purchase_id" uuid NOT NULL,
	"channel" "opod"."payment_channel" NOT NULL,
	"provider" text NOT NULL,
	"status" "opod"."payment_status" DEFAULT 'pending'::"opod"."payment_status" NOT NULL,
	"amount" integer,
	"currency" text,
	"provider_checkout_id" text,
	"provider_checkout_url" text,
	"provider_transaction_id" text,
	"provider_transaction_key" text,
	"provider_product_id" text NOT NULL,
	"provider_environment" text,
	"paid_at" timestamp(6) with time zone,
	"refunded_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"net_amount" integer,
	"tax_amount" integer
);
--> statement-breakpoint
CREATE TABLE "opod"."post_comments" (
	"id" uuid PRIMARY KEY,
	"post_id" uuid NOT NULL,
	"character_id" uuid,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."post_drafts" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"draft_type" "opod"."post_draft_type" DEFAULT 'post'::"opod"."post_draft_type" NOT NULL,
	"content_type" "opod"."post_content_type" DEFAULT 'feed'::"opod"."post_content_type" NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT ARRAY[]::text[],
	"concept_json" jsonb,
	"status" "opod"."post_draft_status" DEFAULT 'planned'::"opod"."post_draft_status" NOT NULL,
	"error_message" text,
	"lease_expires_at" timestamp(6) with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp(6) with time zone,
	"published_post_id" uuid,
	"published_story_id" uuid,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	"location_id" uuid
);
--> statement-breakpoint
CREATE TABLE "opod"."post_hashtags" (
	"post_id" uuid,
	"hashtag_id" uuid,
	CONSTRAINT "post_hashtags_pkey" PRIMARY KEY("post_id","hashtag_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."post_media" (
	"post_id" uuid,
	"media_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_media_pkey" PRIMARY KEY("post_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."post_reactions" (
	"id" uuid PRIMARY KEY,
	"post_id" uuid NOT NULL,
	"character_id" uuid,
	"user_id" uuid,
	"reaction_type" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."posts" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"content_type" "opod"."post_content_type" DEFAULT 'feed'::"opod"."post_content_type" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."reports" (
	"id" uuid PRIMARY KEY,
	"reporter_user_id" uuid NOT NULL,
	"target_type" "opod"."report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"resolution" text,
	"status" "opod"."report_status" DEFAULT 'submitted'::"opod"."report_status" NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."service_logs" (
	"id" bigserial PRIMARY KEY,
	"source" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"context_json" jsonb,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."stories" (
	"id" uuid PRIMARY KEY,
	"character_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."terms_documents" (
	"id" uuid PRIMARY KEY,
	"type" "opod"."consent_type" NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_at" timestamp(6) with time zone NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."unsettled_credit_debts" (
	"identity_hash" text PRIMARY KEY,
	"paid_debt" integer NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "unsettled_credit_debts_paid_debt_check" CHECK ((paid_debt > 0))
);
--> statement-breakpoint
CREATE TABLE "opod"."user_accounts" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."user_character_follows" (
	"user_id" uuid,
	"character_id" uuid,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"notified_up_to_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_character_follows_pkey" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."user_consents" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"type" "opod"."consent_type" NOT NULL,
	"version" text NOT NULL,
	"agreed" boolean NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."user_events" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."user_hashtag_preferences" (
	"user_id" uuid,
	"hashtag_id" uuid,
	"score" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "user_hashtag_preferences_pkey" PRIMARY KEY("user_id","hashtag_id")
);
--> statement-breakpoint
CREATE TABLE "opod"."user_refresh_tokens" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."user_withdrawals" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"reason_category" text,
	"reason_text" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opod"."users" (
	"id" uuid PRIMARY KEY,
	"email" text,
	"password_hash" text,
	"password_salt" text,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"profile_image_url" text,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"deleted_at" timestamp(6) with time zone,
	"adult_verified_at" timestamp(6) with time zone,
	"adult_identity_hash" text,
	"debt_identity_hash" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_key" ON "opod"."admins" ("email");--> statement-breakpoint
CREATE INDEX "admins_is_enabled_is_deleted_idx" ON "opod"."admins" ("is_enabled","is_deleted");--> statement-breakpoint
CREATE INDEX "agent_archival_memories_user_id_character_id_kind_created_a_idx" ON "opod"."agent_archival_memories" ("user_id","character_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "agent_archival_memories_user_id_character_id_last_accessed__idx" ON "opod"."agent_archival_memories" ("user_id","character_id","last_accessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_archival_memories_user_id_character_id_operation_key__key" ON "opod"."agent_archival_memories" ("user_id","character_id","operation_key","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_jobs_idempotency_key_key" ON "opod"."agent_memory_jobs" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_memory_jobs_status_lease_expires_at_idx" ON "opod"."agent_memory_jobs" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "agent_memory_jobs_user_id_character_id_status_idx" ON "opod"."agent_memory_jobs" ("user_id","character_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_operations_user_id_character_id_operation_key_key" ON "opod"."agent_memory_operations" ("user_id","character_id","operation_key");--> statement-breakpoint
CREATE INDEX "character_action_logs_character_id_created_at_idx" ON "opod"."character_action_logs" ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "character_location_references_location_id_sort_order_idx" ON "opod"."character_location_references" ("location_id","sort_order");--> statement-breakpoint
CREATE INDEX "character_locations_character_id_deleted_at_created_at_idx" ON "opod"."character_locations" ("character_id","deleted_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_locations_character_id_location_key_key" ON "opod"."character_locations" ("character_id","location_key");--> statement-breakpoint
CREATE UNIQUE INDEX "character_locations_global_location_key_key" ON "opod"."character_locations" ("location_key") WHERE (character_id IS NULL);--> statement-breakpoint
CREATE INDEX "character_memories_character_id_deleted_at_created_at_idx" ON "opod"."character_memories" ("character_id","deleted_at","created_at");--> statement-breakpoint
CREATE INDEX "character_personas_character_id_deleted_at_sort_order_idx" ON "opod"."character_personas" ("character_id","deleted_at","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "character_posting_policies_character_id_key" ON "opod"."character_posting_policies" ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_visual_profiles_character_id_key" ON "opod"."character_visual_profiles" ("character_id");--> statement-breakpoint
CREATE INDEX "characters_profile_image_id_idx" ON "opod"."characters" ("profile_image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_public_id_key" ON "opod"."characters" ("public_id");--> statement-breakpoint
CREATE INDEX "console_logs_action_type_created_at_idx" ON "opod"."console_logs" ("action_type","created_at");--> statement-breakpoint
CREATE INDEX "console_logs_created_at_idx" ON "opod"."console_logs" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_check_ins_user_id_check_in_date_key" ON "opod"."credit_check_ins" ("user_id","check_in_date");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_external_reference_key" ON "opod"."credit_ledger" ("external_reference");--> statement-breakpoint
CREATE INDEX "credit_ledger_purchase_id_idx" ON "opod"."credit_ledger" ("purchase_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "opod"."credit_ledger" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_id_type_credit_kind_expires_at_idx" ON "opod"."credit_ledger" ("user_id","type","credit_kind","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_products_code_key" ON "opod"."credit_products" ("code");--> statement-breakpoint
CREATE INDEX "credit_products_is_active_display_order_idx" ON "opod"."credit_products" ("is_active","display_order");--> statement-breakpoint
CREATE INDEX "credit_purchases_credit_product_id_created_at_idx" ON "opod"."credit_purchases" ("credit_product_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_purchases_status_created_at_idx" ON "opod"."credit_purchases" ("status","created_at");--> statement-breakpoint
CREATE INDEX "credit_purchases_user_id_created_at_idx" ON "opod"."credit_purchases" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_purchases_user_id_idempotency_key_key" ON "opod"."credit_purchases" ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_refund_provider_provider_refund_id_key" ON "opod"."credit_refund" ("provider","provider_refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_refund_purchase_id_idempotency_key_key" ON "opod"."credit_refund" ("purchase_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_refund_purchase_id_status_idx" ON "opod"."credit_refund" ("purchase_id","status");--> statement-breakpoint
CREATE INDEX "credit_refund_status_created_at_idx" ON "opod"."credit_refund" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_reservations_reference_key" ON "opod"."credit_reservations" ("reference");--> statement-breakpoint
CREATE INDEX "credit_reservations_user_id_status_expires_at_idx" ON "opod"."credit_reservations" ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "credit_usage_grant_ledger_id_idx" ON "opod"."credit_usage" ("grant_ledger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_evaluations_draft_id_kind_attempt_key" ON "opod"."draft_evaluations" ("draft_id","kind","attempt");--> statement-breakpoint
CREATE INDEX "draft_evaluations_kind_created_at_idx" ON "opod"."draft_evaluations" ("kind","created_at");--> statement-breakpoint
CREATE INDEX "draft_evaluations_status_lease_expires_at_idx" ON "opod"."draft_evaluations" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "evaluation_reports_created_at_idx" ON "opod"."evaluation_reports" ("created_at");--> statement-breakpoint
CREATE INDEX "faqs_is_published_category_sort_order_idx" ON "opod"."faqs" ("is_published","category","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_job_outputs_job_id_candidate_index_key" ON "opod"."generation_job_outputs" ("job_id","candidate_index");--> statement-breakpoint
CREATE INDEX "generation_job_outputs_media_id_idx" ON "opod"."generation_job_outputs" ("media_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_draft_id_idx" ON "opod"."generation_jobs" ("draft_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_created_at_idx" ON "opod"."generation_jobs" ("status","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_lease_expires_at_idx" ON "opod"."generation_jobs" ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hashtags_name_key" ON "opod"."hashtags" ("name");--> statement-breakpoint
CREATE INDEX "inquiries_status_created_at_idx" ON "opod"."inquiries" ("status","created_at");--> statement-breakpoint
CREATE INDEX "inquiries_user_id_created_at_idx" ON "opod"."inquiries" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_log_media_media_id_idx" ON "opod"."llm_log_media" ("media_id");--> statement-breakpoint
CREATE INDEX "llm_logs_character_id_created_at_idx" ON "opod"."llm_logs" ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_logs_created_at_idx" ON "opod"."llm_logs" ("created_at");--> statement-breakpoint
CREATE INDEX "llm_logs_generation_job_id_idx" ON "opod"."llm_logs" ("generation_job_id");--> statement-breakpoint
CREATE INDEX "llm_logs_provider_request_id_idx" ON "opod"."llm_logs" ("provider_request_id");--> statement-breakpoint
CREATE INDEX "llm_logs_request_id_idx" ON "opod"."llm_logs" ("request_id");--> statement-breakpoint
CREATE INDEX "llm_logs_status_created_at_idx" ON "opod"."llm_logs" ("status","created_at");--> statement-breakpoint
CREATE INDEX "llm_logs_type_created_at_idx" ON "opod"."llm_logs" ("type","created_at");--> statement-breakpoint
CREATE INDEX "llm_logs_user_id_created_at_idx" ON "opod"."llm_logs" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_key" ON "opod"."media" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "message_conversations_user_id_character_id_key" ON "opod"."message_conversations" ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "message_reply_jobs_conversation_id_status_idx" ON "opod"."message_reply_jobs" ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "message_reply_jobs_status_lease_expires_at_idx" ON "opod"."message_reply_jobs" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "message_reply_jobs_status_ready_at_idx" ON "opod"."message_reply_jobs" ("status","ready_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_reply_jobs_turn_id_key" ON "opod"."message_reply_jobs" ("turn_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "opod"."messages" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_reply_job_id_idx" ON "opod"."messages" ("reply_job_id");--> statement-breakpoint
CREATE INDEX "notices_is_pinned_published_at_idx" ON "opod"."notices" ("is_pinned","published_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "opod"."notifications" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "opod"."notifications" ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "payment_ledger_admin_id_occurred_at_idx" ON "opod"."payment_ledger" ("admin_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_ledger_payment_id_occurred_at_idx" ON "opod"."payment_ledger" ("payment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_ledger_provider_transaction_id_idx" ON "opod"."payment_ledger" ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "payment_ledger_type_occurred_at_idx" ON "opod"."payment_ledger" ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_product_mappings_channel_provider_environment_is_ac_idx" ON "opod"."payment_product_mappings" ("channel","provider","environment","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_product_mappings_credit_product_id_channel_provider_key" ON "opod"."payment_product_mappings" ("credit_product_id","channel","provider","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_product_mappings_provider_environment_provider_prod_key" ON "opod"."payment_product_mappings" ("provider","environment","provider_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_external_event_id_key" ON "opod"."payment_provider_events" ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_status_updated_at_idx" ON "opod"."payment_provider_events" ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_provider_checkout_id_key" ON "opod"."payments" ("provider","provider_checkout_id");--> statement-breakpoint
CREATE INDEX "payments_provider_provider_transaction_id_idx" ON "opod"."payments" ("provider","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_provider_transaction_key_key" ON "opod"."payments" ("provider","provider_transaction_key");--> statement-breakpoint
CREATE INDEX "payments_provider_status_created_at_idx" ON "opod"."payments" ("provider","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_purchase_id_key" ON "opod"."payments" ("purchase_id");--> statement-breakpoint
CREATE INDEX "payments_status_updated_at_idx" ON "opod"."payments" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "post_comments_character_id_created_at_idx" ON "opod"."post_comments" ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "post_comments_post_id_created_at_idx" ON "opod"."post_comments" ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_comments_user_id_created_at_idx" ON "opod"."post_comments" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "post_drafts_character_id_created_at_idx" ON "opod"."post_drafts" ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "post_drafts_location_id_created_at_idx" ON "opod"."post_drafts" ("location_id","created_at");--> statement-breakpoint
CREATE INDEX "post_drafts_status_lease_expires_at_idx" ON "opod"."post_drafts" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "post_drafts_status_scheduled_at_idx" ON "opod"."post_drafts" ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "post_hashtags_hashtag_id_idx" ON "opod"."post_hashtags" ("hashtag_id");--> statement-breakpoint
CREATE INDEX "post_reactions_character_id_created_at_idx" ON "opod"."post_reactions" ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "post_reactions_post_id_created_at_idx" ON "opod"."post_reactions" ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_reactions_post_id_user_id_reaction_type_key" ON "opod"."post_reactions" ("post_id","user_id","reaction_type");--> statement-breakpoint
CREATE INDEX "post_reactions_user_id_created_at_idx" ON "opod"."post_reactions" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_idx" ON "opod"."reports" ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_type_target_id_idx" ON "opod"."reports" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "service_logs_created_at_idx" ON "opod"."service_logs" ("created_at");--> statement-breakpoint
CREATE INDEX "service_logs_event_type_created_at_idx" ON "opod"."service_logs" ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "stories_character_id_expires_at_created_at_idx" ON "opod"."stories" ("character_id","expires_at","created_at");--> statement-breakpoint
CREATE INDEX "stories_expires_at_created_at_idx" ON "opod"."stories" ("expires_at","created_at");--> statement-breakpoint
CREATE INDEX "terms_documents_type_effective_at_idx" ON "opod"."terms_documents" ("type","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_documents_type_version_key" ON "opod"."terms_documents" ("type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_provider_provider_account_id_key" ON "opod"."user_accounts" ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "user_accounts_user_id_idx" ON "opod"."user_accounts" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_user_id_provider_key" ON "opod"."user_accounts" ("user_id","provider");--> statement-breakpoint
CREATE INDEX "user_consents_user_id_type_created_at_idx" ON "opod"."user_consents" ("user_id","type","created_at");--> statement-breakpoint
CREATE INDEX "user_events_target_type_target_id_idx" ON "opod"."user_events" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "user_events_user_id_created_at_idx" ON "opod"."user_events" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_hashtag_preferences_hashtag_id_idx" ON "opod"."user_hashtag_preferences" ("hashtag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_refresh_tokens_token_hash_key" ON "opod"."user_refresh_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "user_refresh_tokens_user_id_created_at_idx" ON "opod"."user_refresh_tokens" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_adult_identity_hash_key" ON "opod"."users" ("adult_identity_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_debt_identity_hash_key" ON "opod"."users" ("debt_identity_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "opod"."users" ("email");--> statement-breakpoint
ALTER TABLE "opod"."character_action_logs" ADD CONSTRAINT "character_action_logs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_location_references" ADD CONSTRAINT "character_location_references_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "opod"."character_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_location_references" ADD CONSTRAINT "character_location_references_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_locations" ADD CONSTRAINT "character_locations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_personas" ADD CONSTRAINT "character_personas_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_posting_policies" ADD CONSTRAINT "character_posting_policies_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profile_references" ADD CONSTRAINT "character_visual_profile_references_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "opod"."character_visual_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profile_references" ADD CONSTRAINT "character_visual_profile_references_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_visual_profiles" ADD CONSTRAINT "character_visual_profiles_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."characters" ADD CONSTRAINT "characters_profile_image_id_fkey" FOREIGN KEY ("profile_image_id") REFERENCES "opod"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_check_ins" ADD CONSTRAINT "credit_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_ledger" ADD CONSTRAINT "credit_ledger_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_purchases" ADD CONSTRAINT "credit_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_purchases" ADD CONSTRAINT "credit_purchases_credit_product_id_fkey" FOREIGN KEY ("credit_product_id") REFERENCES "opod"."credit_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_refund" ADD CONSTRAINT "credit_refund_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_reservations" ADD CONSTRAINT "credit_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_usage" ADD CONSTRAINT "credit_usage_usage_ledger_id_fkey" FOREIGN KEY ("usage_ledger_id") REFERENCES "opod"."credit_ledger"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."credit_usage" ADD CONSTRAINT "credit_usage_grant_ledger_id_fkey" FOREIGN KEY ("grant_ledger_id") REFERENCES "opod"."credit_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."draft_evaluations" ADD CONSTRAINT "draft_evaluations_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "opod"."post_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_job_outputs" ADD CONSTRAINT "generation_job_outputs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_job_outputs" ADD CONSTRAINT "generation_job_outputs_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_output_media_id_fkey" FOREIGN KEY ("output_media_id") REFERENCES "opod"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "opod"."post_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."generation_jobs" ADD CONSTRAINT "generation_jobs_origin_job_id_fkey" FOREIGN KEY ("origin_job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."inquiries" ADD CONSTRAINT "inquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."llm_log_media" ADD CONSTRAINT "llm_log_media_llm_log_id_fkey" FOREIGN KEY ("llm_log_id") REFERENCES "opod"."llm_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."llm_log_media" ADD CONSTRAINT "llm_log_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."llm_logs" ADD CONSTRAINT "llm_logs_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "opod"."generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."message_conversations" ADD CONSTRAINT "message_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."message_conversations" ADD CONSTRAINT "message_conversations_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."message_reply_jobs" ADD CONSTRAINT "message_reply_jobs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "opod"."message_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "opod"."message_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."messages" ADD CONSTRAINT "messages_reply_job_id_fkey" FOREIGN KEY ("reply_job_id") REFERENCES "opod"."message_reply_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."payment_ledger" ADD CONSTRAINT "payment_ledger_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "opod"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."payment_ledger" ADD CONSTRAINT "payment_ledger_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "opod"."admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."payment_product_mappings" ADD CONSTRAINT "payment_product_mappings_credit_product_id_fkey" FOREIGN KEY ("credit_product_id") REFERENCES "opod"."credit_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "opod"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."payments" ADD CONSTRAINT "payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_published_post_id_fkey" FOREIGN KEY ("published_post_id") REFERENCES "opod"."posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_published_story_id_fkey" FOREIGN KEY ("published_story_id") REFERENCES "opod"."stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_drafts" ADD CONSTRAINT "post_drafts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "opod"."character_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_hashtags" ADD CONSTRAINT "post_hashtags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_hashtags" ADD CONSTRAINT "post_hashtags_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "opod"."hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_media" ADD CONSTRAINT "post_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "opod"."posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."post_reactions" ADD CONSTRAINT "post_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."posts" ADD CONSTRAINT "posts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."reports" ADD CONSTRAINT "reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."stories" ADD CONSTRAINT "stories_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."stories" ADD CONSTRAINT "stories_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "opod"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_accounts" ADD CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_character_follows" ADD CONSTRAINT "user_character_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_character_follows" ADD CONSTRAINT "user_character_follows_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "opod"."characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_events" ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_hashtag_preferences" ADD CONSTRAINT "user_hashtag_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_hashtag_preferences" ADD CONSTRAINT "user_hashtag_preferences_hashtag_id_fkey" FOREIGN KEY ("hashtag_id") REFERENCES "opod"."hashtags"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."user_refresh_tokens" ADD CONSTRAINT "user_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
-- Seed the initial credit catalog. Production provider mappings are registered
-- through opod-admin after their external product IDs are issued.
INSERT INTO "opod"."credit_products"
    ("id", "code", "name", "credit_amount", "display_order", "updated_at")
VALUES
    ('019fca00-0000-7000-8000-000000000501', 'credits_500', '500 크레딧', 500, 10, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000001050', 'credits_1050', '1,050 크레딧', 1050, 20, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000003300', 'credits_3300', '3,300 크레딧', 3300, 30, CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8000-000000005750', 'credits_5750', '5,750 크레딧', 5750, 40, CURRENT_TIMESTAMP);
--> statement-breakpoint
INSERT INTO "opod"."payment_product_mappings"
    ("id", "credit_product_id", "channel", "provider", "environment", "provider_product_id", "price_amount", "currency", "updated_at")
VALUES
    ('019fca00-0000-7000-8001-000000000501', '019fca00-0000-7000-8000-000000000501', 'web', 'local', 'development', 'credits_500', 4900, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000001050', '019fca00-0000-7000-8000-000000001050', 'web', 'local', 'development', 'credits_1050', 9900, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000003300', '019fca00-0000-7000-8000-000000003300', 'web', 'local', 'development', 'credits_3300', 29000, 'KRW', CURRENT_TIMESTAMP),
    ('019fca00-0000-7000-8001-000000005750', '019fca00-0000-7000-8000-000000005750', 'web', 'local', 'development', 'credits_5750', 49000, 'KRW', CURRENT_TIMESTAMP);
