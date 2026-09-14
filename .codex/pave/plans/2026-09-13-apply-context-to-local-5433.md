# Apply improved character context to original local DB 5433

User-approved: 2026-09-13, `5433에 DDL 포함 적용`.

Target: localhost:5433/ai_sns. Source: localhost:55433/opod_persona_memory_local.
Owner-found: canonical schema and scripts/db-migrations.mjs in this repository.
No application logic change, no LLM calls, no development-server operations.

- [x] Back up both DBs and preserve original 5433 container/volume.
- [x] Replace only the local 5433 runtime with PostgreSQL 16 + pgvector; apply canonical migrations to its fresh volume.
- [x] Preserve original local seed rows and legacy migration history; copy four characters, personas/fragments/canon and the requested admin account. All profile image references are NULL; no media transfer needed.
- [x] Verify exact copied data, original data preservation, schema compatibility, and migration idempotency.
- [x] Point local agent, playground, service and admin at 5433; verify health and character retrieval without sending chat requests.

Inspection: original 5433 has no characters/users/admins/messages/settings; only 4 credit products, 4 payment mappings, and 28 legacy migration entries are populated. Original image lacks vector extension. Preserve old container/volume rather than reusing its Alpine data directory with the pgvector image.
Rollback: stop the replacement; restore original container name and start its unchanged volume. Dumps provide independent logical backups. 55433 remains unchanged. Do not transfer synthetic user memories or unrelated source admin accounts.

Verification uses real DB comparisons and read-only API requests, not a new unit test; the risk is operational data loss or wrong connection, not changed application logic.

Result: copied 69 persona rows (40 active), 78 fragments, 125 active canon memories, 4 characters, and admin@opod.com. Exact row equality and source/target column types/nullability verified. Preserved 4 products, 4 mappings, 28 legacy migration records. Canonical 5 migrations applied and rerun successfully; vector 0.8.6 enabled. Admin login 201, all four character persona/memory endpoints 200, agent health/service listing/playground 200.

Evidence and private backups: `/Users/hongtaeho/opod/local-db-transfer-20260913-OjcWxB/README.md` and sibling verification JSON files. Existing application changes were not edited; only local environment files and Compose port/volume configuration changed. Full application suites were not rerun for this operational migration.

Follow-up completed on explicit user request: copied six agent chat/embedding settings from the development DB to 5433 only. Source read-only; no planner/image/worker settings copied. Chat model xiaomi/mimo-v2.5-pro (OpenRouter), embedding model text-embedding-3-small (OpenAI). Verified exact inserted values and the product settings loader using a non-network provider double; no secret output or paid API calls. This is not a naturalness or answer-quality PASS.
