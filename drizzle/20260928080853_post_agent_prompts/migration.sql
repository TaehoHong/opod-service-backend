CREATE TYPE "opod"."ai_model_type" AS ENUM('llm', 'image');--> statement-breakpoint
CREATE TYPE "opod"."post_agent_stage" AS ENUM('post_plan', 'image_plan', 'image_prompt', 'generation', 'caption');--> statement-breakpoint
CREATE TABLE "opod"."ai_models" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."ai_models_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "opod"."ai_model_type" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_provider_check" CHECK (btrim("provider") <> ''),
	CONSTRAINT "ai_models_model_check" CHECK (btrim("model") <> '')
);
--> statement-breakpoint
CREATE TABLE "opod"."post_agent_prompts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opod"."post_agent_prompts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stage" "opod"."post_agent_stage" NOT NULL,
	"revision" integer NOT NULL,
	"system_prompt" text,
	"output_schema" jsonb,
	"ai_model_id" bigint NOT NULL,
	"model" text,
	"created_at" timestamp(6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_agent_prompts_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "post_agent_prompts_model_check" CHECK ("model" IS NULL OR btrim("model") <> ''),
	CONSTRAINT "post_agent_prompts_stage_content_check" CHECK (
    ("stage" = 'generation' AND "system_prompt" IS NULL AND "output_schema" IS NULL)
    OR ("stage" <> 'generation' AND "system_prompt" IS NOT NULL AND btrim("system_prompt") <> ''
    AND "output_schema" IS NOT NULL AND jsonb_typeof("output_schema") = 'object'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "post_agent_prompts_stage_revision_unique" ON "opod"."post_agent_prompts" ("stage","revision");--> statement-breakpoint
ALTER TABLE "opod"."post_agent_prompts" ADD CONSTRAINT "post_agent_prompts_ai_model_id_ai_models_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "opod"."ai_models"("id") ON DELETE RESTRICT;