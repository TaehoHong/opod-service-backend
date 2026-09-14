CREATE TYPE "opod"."chat_memory_context_injection_mode" AS ENUM('always', 'retrieved');--> statement-breakpoint
ALTER TYPE "opod"."agent_job_status" RENAME TO "chat_memory_consolidation_job_status";--> statement-breakpoint
ALTER TYPE "opod"."agent_memory_kind" RENAME TO "chat_memory_derivation_type";--> statement-breakpoint
ALTER TYPE "opod"."message_reply_job_status" RENAME TO "chat_reply_generation_job_status";--> statement-breakpoint
ALTER TYPE "opod"."message_sender_type" RENAME TO "chat_message_sender_role";--> statement-breakpoint
ALTER TABLE "opod"."agent_archival_memories" RENAME TO "chat_memory_entries";--> statement-breakpoint
ALTER TABLE "opod"."agent_memory_jobs" RENAME TO "chat_memory_consolidation_jobs";--> statement-breakpoint
ALTER TABLE "opod"."agent_memory_operations" RENAME TO "chat_applied_state_changes";--> statement-breakpoint
ALTER TABLE "opod"."agent_relationship_state" RENAME TO "chat_relationship_states";--> statement-breakpoint
ALTER TABLE "opod"."agent_summaries" RENAME TO "chat_memory_session_summaries";--> statement-breakpoint
ALTER TABLE "opod"."character_memories" RENAME TO "character_canon_memories";--> statement-breakpoint
ALTER TABLE "opod"."message_conversations" RENAME TO "chat_conversations";--> statement-breakpoint
ALTER TABLE "opod"."message_reply_jobs" RENAME TO "chat_reply_generation_jobs";--> statement-breakpoint
ALTER TABLE "opod"."messages" RENAME TO "chat_messages";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME CONSTRAINT "agent_archival_memories_pkey" TO "chat_memory_entries_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_consolidation_jobs" RENAME CONSTRAINT "agent_memory_jobs_pkey" TO "chat_memory_consolidation_jobs_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_applied_state_changes" RENAME CONSTRAINT "agent_memory_operations_pkey" TO "chat_applied_state_changes_pkey";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_pkey" TO "character_canon_memories_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_conversations" RENAME CONSTRAINT "message_conversations_pkey" TO "chat_conversations_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME CONSTRAINT "message_reply_jobs_pkey" TO "chat_reply_generation_jobs_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME CONSTRAINT "messages_pkey" TO "chat_messages_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "content" TO "memory_text";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "kind" TO "derivation_type";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "importance" TO "importance_score";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "embedding" TO "memory_embedding";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "embedding_source_sha256" TO "embedded_text_sha256";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "source_messages" TO "source_message_snapshots";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "memory_type" TO "memory_category";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "occurred_at" TO "event_occurred_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "evidence" TO "supporting_memory_ids";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "operation_key" TO "write_operation_key";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "ordinal" TO "write_batch_index";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME COLUMN "last_accessed_at" TO "last_recalled_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_consolidation_jobs" RENAME COLUMN "payload_json" TO "consolidation_request";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_consolidation_jobs" RENAME COLUMN "status" TO "processing_status";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_consolidation_jobs" RENAME COLUMN "lease_expires_at" TO "processing_lease_expires_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_consolidation_jobs" RENAME COLUMN "error_message" TO "last_error_message";--> statement-breakpoint
ALTER TABLE "opod"."chat_applied_state_changes" RENAME COLUMN "operation_key" TO "idempotency_key";--> statement-breakpoint
ALTER TABLE "opod"."chat_applied_state_changes" RENAME COLUMN "created_at" TO "applied_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME COLUMN "importance_since_reflection" TO "unreflected_importance_score";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME COLUMN "bond_xp" TO "bond_experience_points";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME COLUMN "last_decay_at" TO "last_exchange_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME COLUMN "daily_bond_date" TO "daily_bond_experience_date";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME COLUMN "daily_bond_xp" TO "daily_bond_experience_points";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_session_summaries" RENAME COLUMN "content" TO "summary_text";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_session_summaries" RENAME COLUMN "turns_covered" TO "summarized_message_count";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_session_summaries" RENAME COLUMN "revision" TO "revision_number";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "content" TO "canon_text";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "embedding" TO "canon_embedding";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "embedding_source_sha256" TO "embedded_text_sha256";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "occurred_at" TO "event_occurred_at";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "source_refs" TO "source_references";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "occurred_label" TO "event_time_label";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "occurred_precision" TO "event_time_precision";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "embedded_at" TO "embedding_generated_at";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "reason" TO "authoring_reason";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "type" TO "authoring_category";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "kind" TO "temporal_kind";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "injection" TO "context_injection_mode";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME COLUMN "recall_keys" TO "retrieval_keywords";--> statement-breakpoint
ALTER TABLE "opod"."chat_conversations" RENAME COLUMN "last_read_at" TO "user_last_read_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_conversations" RENAME COLUMN "last_message_at" TO "latest_message_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "turn_id" TO "trigger_message_id";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "status" TO "generation_status";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "reservation_reference" TO "credit_reservation_reference";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "ready_at" TO "next_attempt_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "lease_expires_at" TO "processing_lease_expires_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "started_at" TO "first_attempt_started_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME COLUMN "deadline_at" TO "processing_deadline_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME COLUMN "sender_type" TO "sender_role";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME COLUMN "body" TO "message_text";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME COLUMN "created_at" TO "sent_at";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME COLUMN "reply_job_id" TO "reply_generation_job_id";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME CONSTRAINT "agent_archival_memories_source_messages_check" TO "chat_memory_entries_source_message_snapshots_check";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" RENAME CONSTRAINT "agent_archival_memories_memory_type_check" TO "chat_memory_entries_memory_category_check";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_routing_check" TO "character_canon_memories_routing_check";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_source_refs_check" TO "character_canon_memories_source_references_check";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_occurred_precision_check" TO "character_canon_memories_event_time_precision_check";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_occurred_fields_check" TO "character_canon_memories_event_time_fields_check";--> statement-breakpoint
ALTER INDEX "opod"."agent_archival_memories_user_id_character_id_kind_created_a_idx" RENAME TO "chat_memory_entries_user_character_derivation_created_idx";--> statement-breakpoint
ALTER INDEX "opod"."agent_archival_memories_user_id_character_id_last_accessed__idx" RENAME TO "chat_memory_entries_user_character_last_recalled_idx";--> statement-breakpoint
ALTER INDEX "opod"."agent_archival_memories_user_id_character_id_operation_key__key" RENAME TO "chat_memory_entries_user_character_write_operation_batch_key";--> statement-breakpoint
ALTER INDEX "opod"."agent_memory_jobs_idempotency_key_key" RENAME TO "chat_memory_consolidation_jobs_idempotency_key_key";--> statement-breakpoint
ALTER INDEX "opod"."agent_memory_jobs_status_lease_expires_at_idx" RENAME TO "chat_memory_consolidation_jobs_status_lease_idx";--> statement-breakpoint
ALTER INDEX "opod"."agent_memory_jobs_user_id_character_id_status_idx" RENAME TO "chat_memory_consolidation_jobs_user_character_status_idx";--> statement-breakpoint
ALTER INDEX "opod"."agent_memory_operations_user_id_character_id_operation_key_key" RENAME TO "chat_applied_state_changes_user_character_idempotency_key";--> statement-breakpoint
ALTER INDEX "opod"."character_memories_character_id_deleted_at_created_at_idx" RENAME TO "character_canon_memories_character_deleted_created_idx";--> statement-breakpoint
ALTER INDEX "opod"."message_conversations_user_id_character_id_key" RENAME TO "chat_conversations_user_id_character_id_key";--> statement-breakpoint
ALTER INDEX "opod"."message_reply_jobs_conversation_id_status_idx" RENAME TO "chat_reply_generation_jobs_conversation_status_idx";--> statement-breakpoint
ALTER INDEX "opod"."message_reply_jobs_status_lease_expires_at_idx" RENAME TO "chat_reply_generation_jobs_status_lease_idx";--> statement-breakpoint
ALTER INDEX "opod"."message_reply_jobs_status_ready_at_idx" RENAME TO "chat_reply_generation_jobs_status_next_attempt_idx";--> statement-breakpoint
ALTER INDEX "opod"."message_reply_jobs_turn_id_key" RENAME TO "chat_reply_generation_jobs_trigger_message_id_key";--> statement-breakpoint
ALTER INDEX "opod"."messages_conversation_id_created_at_idx" RENAME TO "chat_messages_conversation_sent_at_idx";--> statement-breakpoint
ALTER INDEX "opod"."messages_reply_job_id_idx" RENAME TO "chat_messages_reply_generation_job_id_idx";--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" RENAME CONSTRAINT "character_memories_character_id_fkey" TO "character_canon_memories_character_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_conversations" RENAME CONSTRAINT "message_conversations_user_id_fkey" TO "chat_conversations_user_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_conversations" RENAME CONSTRAINT "message_conversations_character_id_fkey" TO "chat_conversations_character_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_reply_generation_jobs" RENAME CONSTRAINT "message_reply_jobs_conversation_id_fkey" TO "chat_reply_generation_jobs_conversation_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME CONSTRAINT "messages_conversation_id_fkey" TO "chat_messages_conversation_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_messages" RENAME CONSTRAINT "messages_reply_job_id_fkey" TO "chat_messages_reply_generation_job_id_fkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" ADD COLUMN "context_injection_mode" "opod"."chat_memory_context_injection_mode" DEFAULT 'retrieved'::"opod"."chat_memory_context_injection_mode" NOT NULL;--> statement-breakpoint
INSERT INTO "opod"."chat_memory_entries" (
  "id",
  "user_id",
  "character_id",
  "memory_text",
  "derivation_type",
  "importance_score",
  "memory_category",
  "context_injection_mode",
  "supporting_memory_ids",
  "write_operation_key",
  "write_batch_index",
  "created_at",
  "last_recalled_at"
)
SELECT
  gen_random_uuid(),
  "user_id",
  "character_id",
  "content",
  'reflection'::"opod"."chat_memory_derivation_type",
  10,
  'interpretation',
  'always'::"opod"."chat_memory_context_injection_mode",
  ARRAY[]::text[],
  'legacy-core-memory-migration',
  0,
  "updated_at",
  "updated_at"
FROM "opod"."agent_core_memories";--> statement-breakpoint
DROP TABLE "opod"."agent_core_memories";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" RENAME CONSTRAINT "agent_relationship_state_pkey" TO "chat_relationship_states_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_session_summaries" RENAME CONSTRAINT "agent_summaries_pkey" TO "chat_memory_session_summaries_pkey";--> statement-breakpoint
ALTER TABLE "opod"."chat_relationship_states" DROP COLUMN "warmth";--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" DROP CONSTRAINT "chat_memory_entries_source_message_snapshots_check", ADD CONSTRAINT "chat_memory_entries_source_message_snapshots_check" CHECK ("source_message_snapshots" IS NULL OR jsonb_typeof("source_message_snapshots") = 'array');--> statement-breakpoint
ALTER TABLE "opod"."chat_memory_entries" DROP CONSTRAINT "chat_memory_entries_memory_category_check", ADD CONSTRAINT "chat_memory_entries_memory_category_check" CHECK ("memory_category" IS NULL OR "memory_category" IN ('user_fact', 'shared_episode', 'interpretation'));--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" DROP CONSTRAINT "character_canon_memories_routing_check", ADD CONSTRAINT "character_canon_memories_routing_check" CHECK (
      ("temporal_kind" IS NULL AND "context_injection_mode" IS NULL)
      OR ("temporal_kind" IS NOT NULL AND "context_injection_mode" IS NOT NULL
        AND "temporal_kind" IN ('fact', 'event')
        AND "context_injection_mode" IN ('always', 'retrieved')
        AND ("temporal_kind" <> 'event' OR "context_injection_mode" = 'retrieved'))
    );--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" DROP CONSTRAINT "character_canon_memories_source_references_check", ADD CONSTRAINT "character_canon_memories_source_references_check" CHECK ("source_references" IS NULL OR jsonb_typeof("source_references") = 'array');--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" DROP CONSTRAINT "character_canon_memories_event_time_precision_check", ADD CONSTRAINT "character_canon_memories_event_time_precision_check" CHECK ("event_time_precision" IS NULL OR "event_time_precision" IN ('year', 'month', 'day', 'instant', 'approximate'));--> statement-breakpoint
ALTER TABLE "opod"."character_canon_memories" DROP CONSTRAINT "character_canon_memories_event_time_fields_check", ADD CONSTRAINT "character_canon_memories_event_time_fields_check" CHECK (("event_time_precision" IS NULL AND "event_time_label" IS NULL)
        OR ("event_time_precision" IS NOT NULL AND "event_time_label" IS NOT NULL
          AND length(trim("event_time_label")) > 0
          AND (("event_time_precision" = 'instant' AND "event_occurred_at" IS NOT NULL)
            OR ("event_time_precision" <> 'instant' AND "event_occurred_at" IS NULL))));--> statement-breakpoint

COMMENT ON TYPE "opod"."chat_message_sender_role" IS '채팅 메시지를 작성한 주체. user는 사용자, character는 캐릭터를 뜻한다.';--> statement-breakpoint
COMMENT ON TYPE "opod"."chat_reply_generation_job_status" IS '캐릭터 답변 생성 작업의 처리 상태.';--> statement-breakpoint
COMMENT ON TYPE "opod"."chat_memory_derivation_type" IS '메모리가 대화에서 직접 관찰되었는지 또는 여러 메모리에서 추론되었는지를 구분한다.';--> statement-breakpoint
COMMENT ON TYPE "opod"."chat_memory_context_injection_mode" IS '메모리를 매 답변 컨텍스트에 항상 넣을지, 검색된 경우에만 넣을지를 구분한다.';--> statement-breakpoint
COMMENT ON TYPE "opod"."chat_memory_consolidation_job_status" IS '대화 메모리 추출·통합 작업의 처리 상태.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_conversations" IS '한 사용자와 한 캐릭터 사이의 채팅 대화방과 읽음·최신 메시지 시각을 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."id" IS '채팅 대화방의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."user_id" IS '대화에 참여한 사용자의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."character_id" IS '대화에 참여한 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."created_at" IS '채팅 대화방을 만든 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."user_last_read_at" IS '사용자가 이 대화를 마지막으로 읽은 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_conversations"."latest_message_at" IS '이 대화에 가장 최근 메시지가 저장된 시각.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_messages" IS '사용자와 캐릭터가 주고받은 원문 메시지를 메시지 단위로 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."id" IS '채팅 메시지의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."conversation_id" IS '메시지가 속한 채팅 대화방의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."sender_role" IS '메시지를 보낸 주체(user 또는 character).';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."message_text" IS '사용자 또는 캐릭터가 보낸 원문 메시지 본문.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."sent_at" IS '메시지를 저장한 전송 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_messages"."reply_generation_job_id" IS '이 캐릭터 답변을 생성한 작업의 식별자. 사용자 메시지는 null이다.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_reply_generation_jobs" IS '사용자 메시지에 대한 캐릭터 답변을 비동기로 생성하는 작업과 재시도 상태를 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."id" IS '답변 생성 작업의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."conversation_id" IS '답변을 생성할 채팅 대화방의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."trigger_message_id" IS '답변 생성을 촉발한 사용자 메시지의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."generation_status" IS '답변 생성 작업의 현재 상태.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."credit_reservation_reference" IS '답변 생성 비용을 예약한 크레딧 거래 참조값.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."next_attempt_at" IS '대기 중인 작업을 다음으로 시도할 수 있는 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."attempt_count" IS '답변 생성을 시도한 누적 횟수.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."processing_lease_expires_at" IS '현재 워커의 작업 점유권이 만료되는 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."first_attempt_started_at" IS '첫 답변 생성 시도가 시작된 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."processing_deadline_at" IS '답변 생성 작업이 최종적으로 완료되어야 하는 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."completed_at" IS '답변 생성이 성공적으로 완료된 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."failed_at" IS '답변 생성이 최종 실패한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."failure_reason" IS '답변 생성 작업의 최종 실패 사유.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."created_at" IS '답변 생성 작업을 등록한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_reply_generation_jobs"."updated_at" IS '답변 생성 작업을 마지막으로 갱신한 시각.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_memory_entries" IS '사용자와 캐릭터의 대화에서 추출·추론한 장기 기억을 독립적인 검색 단위로 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."id" IS '대화 메모리 항목의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."user_id" IS '메모리가 속한 사용자의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."character_id" IS '메모리를 사용하는 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."memory_text" IS '컨텍스트에 주입하거나 검색할 수 있는 독립적인 메모리 문장.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."derivation_type" IS '대화에서 직접 추출한 observation인지 여러 기억을 종합한 reflection인지 나타낸다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."importance_score" IS '메모리 보존·회고 우선순위를 결정하는 중요도 점수.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."memory_embedding" IS 'memory_text를 의미 검색하기 위한 임베딩 벡터.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."embedding_model" IS 'memory_embedding을 생성한 모델 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."embedded_text_sha256" IS '임베딩 생성에 사용한 memory_text의 SHA-256 해시.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."source_session_id" IS '이 메모리의 근거가 된 채팅 세션 또는 대화방 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."source_message_snapshots" IS '메모리 추출 당시 근거 메시지의 역할·본문 스냅샷 배열.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."memory_category" IS 'user_fact, shared_episode, interpretation 중 메모리의 의미 범주.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."context_injection_mode" IS 'always면 매 답변에, retrieved면 검색에 선택된 경우에만 컨텍스트에 주입한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."event_occurred_at" IS '메모리가 설명하는 사건이 발생한 시각. 시각을 모르면 null이다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."supporting_memory_ids" IS 'reflection을 뒷받침한 다른 대화 메모리 식별자 배열.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."write_operation_key" IS '동일한 메모리 쓰기 작업의 중복 적용을 막기 위한 키.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."write_batch_index" IS '한 쓰기 작업에서 생성된 메모리의 0부터 시작하는 순번.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."created_at" IS '대화 메모리 항목을 생성한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_entries"."last_recalled_at" IS '이 메모리가 답변 컨텍스트에 마지막으로 회상된 시각.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_memory_consolidation_jobs" IS '대화 내용을 장기 기억과 세션 요약으로 통합하는 비동기 작업을 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."id" IS '메모리 통합 작업의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."idempotency_key" IS '동일한 메모리 통합 요청의 중복 등록을 막는 키.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."consolidation_request" IS '메모리 통합에 필요한 대화와 실행 옵션을 담은 요청 JSON.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."processing_status" IS '메모리 통합 작업의 현재 처리 상태.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."attempt_count" IS '메모리 통합을 시도한 누적 횟수.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."processing_lease_expires_at" IS '현재 워커의 메모리 통합 작업 점유권이 만료되는 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."last_error_message" IS '가장 최근 처리 시도에서 발생한 오류 메시지.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."created_at" IS '메모리 통합 작업을 등록한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."updated_at" IS '메모리 통합 작업을 마지막으로 갱신한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."character_id" IS '대화 기억을 갱신할 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_consolidation_jobs"."user_id" IS '대화 기억을 갱신할 사용자의 식별자.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_applied_state_changes" IS '관계 상태 변경 작업이 한 번만 적용되도록 기록하는 멱등성 원장.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_applied_state_changes"."id" IS '적용 완료 기록의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_applied_state_changes"."user_id" IS '상태 변경이 적용된 사용자의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_applied_state_changes"."character_id" IS '상태 변경이 적용된 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_applied_state_changes"."idempotency_key" IS '중복 적용을 판별하는 상태 변경 작업 키.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_applied_state_changes"."applied_at" IS '상태 변경 작업이 최초로 적용된 시각.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_relationship_states" IS '사용자와 캐릭터 조합별 관계 진행도와 회고 누적 상태를 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."user_id" IS '관계 상태의 사용자 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."character_id" IS '관계 상태의 캐릭터 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."unreflected_importance_score" IS '마지막 reflection 이후 아직 반영하지 않은 메모리 중요도 누적값.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."updated_at" IS '관계 상태를 마지막으로 갱신한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."bond_experience_points" IS '사용자와 캐릭터의 누적 유대 경험치.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."bond_level" IS '누적 유대 경험치에서 계산된 관계 레벨.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."last_exchange_at" IS '사용자와 캐릭터가 마지막으로 대화를 주고받은 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."daily_bond_experience_date" IS '일일 유대 경험치 한도를 계산하는 기준 날짜(UTC YYYY-MM-DD).';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_relationship_states"."daily_bond_experience_points" IS '기준 날짜에 획득한 유대 경험치 누적값.';--> statement-breakpoint

COMMENT ON TABLE "opod"."chat_memory_session_summaries" IS '사용자·캐릭터·채팅 세션별 대화 요약과 요약 범위를 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."user_id" IS '요약이 속한 사용자의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."character_id" IS '요약이 속한 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."session_id" IS '요약 대상 채팅 세션 또는 대화방 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."summary_text" IS '이전 대화 흐름을 압축한 세션 요약 본문.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."summarized_message_count" IS '현재 요약에 포함된 메시지 수.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."revision_number" IS '세션 요약을 갱신할 때 증가하는 버전 번호.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."chat_memory_session_summaries"."updated_at" IS '세션 요약을 마지막으로 갱신한 시각.';--> statement-breakpoint

COMMENT ON TABLE "opod"."character_canon_memories" IS '사용자 대화와 무관한 캐릭터의 공식 설정·사건·선호 정보를 검색 가능한 기억으로 저장한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."id" IS '캐릭터 공식 기억의 고유 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."character_id" IS '공식 기억이 속한 캐릭터의 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."canon_text" IS '캐릭터 설정 또는 사건을 서술한 공식 기억 본문.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."canon_embedding" IS 'canon_text를 의미 검색하기 위한 1024차원 임베딩 벡터.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."embedding_model" IS 'canon_embedding을 생성한 모델 식별자.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."embedded_text_sha256" IS '임베딩 생성에 사용한 canon_text의 SHA-256 해시.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."event_occurred_at" IS '공식 기억이 설명하는 사건의 정확한 발생 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."source_references" IS '공식 기억의 출처 문서·필드·식별자를 담은 JSON 배열.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."event_time_label" IS '연도·월·근사 시점처럼 사람이 읽을 수 있는 사건 시점 표현.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."event_time_precision" IS 'event_time_label의 정밀도(year, month, day, instant, approximate).';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."embedding_generated_at" IS 'canon_embedding을 마지막으로 생성한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."authoring_reason" IS '이 공식 기억을 작성하거나 수정한 근거.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."created_at" IS '캐릭터 공식 기억을 생성한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."updated_at" IS '캐릭터 공식 기억을 마지막으로 갱신한 시각.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."deleted_at" IS '소프트 삭제 시각. null이면 활성 상태이다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."authoring_category" IS '작성 관점의 설정 범주(예: fact, event, goal, preference, relationship, routine).';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."temporal_kind" IS '검색 라우팅 관점에서 정적 fact인지 시간성이 있는 event인지 구분한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."context_injection_mode" IS 'always면 매 답변에, retrieved면 관련 질의에서만 캐릭터 설정을 주입한다.';--> statement-breakpoint
COMMENT ON COLUMN "opod"."character_canon_memories"."retrieval_keywords" IS '공식 기억을 어휘 검색으로 찾기 위한 정규화 키워드 배열.';
