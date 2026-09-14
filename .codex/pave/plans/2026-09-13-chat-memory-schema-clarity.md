# Chat and memory schema clarity

Date: 2026-09-13
Status: implemented and verified

## Goal

Rename the shared chat and memory tables and their ambiguous columns so the
database vocabulary describes ownership and behavior directly. Preserve
existing data, replace the separate core-memory table with always-injected
memory entries, and document every affected table, column, and enum with
PostgreSQL comments.

## Approved behavior

- Keep raw dialogue in `chat_conversations` and `chat_messages`.
- Keep extracted, individually embeddable memories in `chat_memory_entries`.
- Use `chat_memory_entries.context_injection_mode` (`always`, `retrieved`) to
  distinguish stable context from similarity-retrieved memory.
- Migrate legacy core-memory rows into always-injected memory entries, then
  remove the legacy core-memory table and rewrite path.
- Keep public HTTP routes and response field names unchanged.
- Do not add raw-message embeddings or apply the migration to a developer or
  production database in this task.

## Execution and verification

1. Update the canonical backend Drizzle schema and schema contract tests.
2. Generate and review a data-preserving PostgreSQL migration, including
   complete table, column, and enum comments.
3. Sync the admin schema mirror and update repository references.
4. Update agent persistence and context assembly for always/retrieved memory.
5. Run focused unit tests, builds, lint/format checks, schema mirror checks,
   and Docker-backed migration E2E against an isolated test database.
6. Review the final diff for accidental changes and record any residual risk.

## Verification result

- Backend unit tests, lint, build, and all 13 Docker-backed E2E suites passed.
- The migration E2E verified legacy core-memory data preservation, complete
  comments for every affected table and column, enum comments, and removal of
  legacy table, column, index, and constraint names.
- Agent typecheck and 419 runnable tests passed; database-gated integration
  fixtures were updated to use the new physical schema names.
- Admin schema mirror check, lint, build, and focused character tests passed.
