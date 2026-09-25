# Character social activity runtime

## Scope and decisions

- User requested continuation of the approved schema work using PAVE and Sol implementers.
- D1 (user-confirmed, active): no LLM; views, likes and follows only.
- D2 (user-confirmed, active): match character interests to post hashtags, process at most five unseen posts per run, like with the policy probability, follow after three distinct liked posts by an author.
- D3 (user-confirmed, active): common character timezone; local calendar day quotas with DST support; retain approved BIGINT identity jobs and existing UUID entity references.
- D4 (agent-assumed, active): opt-in worker loop, default disabled; no persistent database application or deployment. Existing settings have no automatic backfill.
- D5 (agent-assumed, active): use the current character timezone at execution, including after timezone edits; validate it when enabling. No inferred timezone from location or language.
- D6 (repo-evidenced, active): existing human analytics and public counts remain unchanged. Views and follows are dedicated character records; likes use existing post_reactions.
- In scope: backend scheduler/executor, administrative timezone and social policy API, real database regression tests, ownership and runtime docs.
- Deferred: admin UI, comments, unfollow, live DB application, deployment, changes to public view/follower totals.
- No new schema or migration edits.

## Existing owners

- owner-found: DatabaseService/schema for persistence; existing character repository/service/DTO/controller for common character fields; AdminJwtGuard/CSRF for admin permissions.
- owner-found: PostsService reads post_reactions for reaction totals. Human reaction and follow writes take user IDs and do not own character automation.
- owner-absent: scheduling and writes for character_social_activity tables. Searches for table consumers and social worker symbols found schema tests only. New backend character-social domain owns them.
- owner-absent: character-local day/window rules. Searches for timezone, Intl.DateTimeFormat and AT TIME ZONE found only fixed-KST check-in behavior. PostgreSQL timezone conversion belongs in the new repository.

## Checklist / acceptance

- [x] Backend `src/domain/character-social/*`, module registration and test env: due schedules create one durable job, concurrent workers never duplicate actions, lease fencing and bounded recovery work. Runtime E2E: 17 scenarios passed, including transaction rollback after real lock contention outlives the lease.
- [x] Admin `src/characters/*` and social policy E2E: authenticated admins can read/write policies and character timezone; invalid inputs fail; disabling cancels unfinished work atomically. Admin social policy E2E: 6 scenarios passed.
- [x] Parent `test/character-social-runtime.e2e-spec.ts`: real DB proof for filters, quotas, DST, retry/recovery, lease fencing and concurrent calls. No mock-call or coverage-only tests.
- [x] Relevant architecture/codebase docs updated from verified implementation. Existing unrelated admin edits preserved.
- [x] Fresh backend and admin build, lint, format, unit/E2E suites; reviewed both diffs and recorded exact outcomes.

## Verification / operations boundary

Only disposable Testcontainers databases may receive the existing migrations during verification. No local or development data changes, commits or deployment are included. Worker activation requires explicit environment opt-in after migration and per-character configuration. Reverting runtime files and disabling the worker stops future runs; already persisted activities are retained.

## Review focus

Character lock and lease fencing, local-day quota calculation, admin policy/character mutation consistency. Human review required before merge.

## Fresh verification

- Backend: parent ran unit suite (27 suites / 149 tests), disposable PostgreSQL E2E (15 suites / 123 tests), lint, format, build: all passed.
- Real PostgreSQL tests caught timestamp arithmetic parameter inference and raw Drizzle timestamp string decoding errors. Both were fixed before the full successful run.
- Parent reviewed Sol's backend diff and added the real lock/lease-expiry rollback regression test.
- Admin: parent ran unit suite (48 suites / 462 tests), disposable PostgreSQL E2E (9 suites / 30 tests), lint, format, full frontend/backend build, schema mirror check: all passed. The first sandboxed unit run could not bind HTTP test ports; the identical command passed with the required local-port permission.
- Parent reviewed both Sol implementations, including actor lock sharing, timezone canonicalization and PostgreSQL availability, cancelled job leases, and idempotent manual reactions.
- Integration correction: the existing posting-policy reader had used the social jobs table as a posting-run ledger. It now preserves null until a true posting-run owner is connected. API integration coverage replaces the obsolete SQL-shape test.
- Knowledge Delta (repo-evidenced): backend `docs/06-architecture.md` and both `docs/07-codebase-guide.md` files now describe runtime ownership, configuration, transaction/lease rules, local-day semantics, admin API ownership and targeted tests. D2's algorithm is user-confirmed.
- No schema/DDL was changed in this runtime slice. Only disposable test databases received the previously approved migration; no persistent local/development database, deployment, worker activation or commit occurred.
- Verified; human review required before merge. Focus on local-day semantics after timezone edits, actor locking/lease expiry, and admin stop/idempotency integration.
