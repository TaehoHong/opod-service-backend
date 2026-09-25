# Character social schema foundation

## Approved scope

- Add the nullable character IANA timezone transition column.
- Add character social policies, post views, follows, and durable activity jobs.
- Add character reaction uniqueness and single-actor integrity.
- Generate one Drizzle migration and synchronize the admin schema mirror.
- Protect upgrades and database constraints with disposable PostgreSQL tests.
- Document future runtime calendar-day/DST interpretation and migration preflight.

Runtime workers, APIs, UI, scheduling decisions, LLM behavior, and live database application are out of scope.

## Checklist

- [x] Canonical schema and generated migration → verify with schema unit test and migration SQL review.
- [x] Migration ledger and constraint integration tests → parent full Testcontainers E2E passed 14 suites / 106 tests, including final identity-order and finished-at assertions.
- [x] Architecture/codebase documentation and admin mirror → backend format/lint/build passed; admin schema sync, scoped schema format/lint, migration generation check and full build passed.

## Acceptance criteria

- Existing characters remain valid with `timezone IS NULL`; non-null timezone text is non-empty and trimmed.
- Policy windows permit midnight wrapping but reject equal endpoints and `24:00`; enabled rows have a next activity instant.
- Views and follows deduplicate by composite key; self-follow is rejected.
- Job IDs are generated-always BIGINT identity values; job state, lease, terminal timestamp, schedule uniqueness, and one-active-job rules are enforced by PostgreSQL.
- Character reactions reject duplicate `(post, character, type)` and mixed user/character actors while preserving the existing user uniqueness and nullable actor compatibility.
- All new foreign keys update-cascade/delete-restrict; no historical cleanup is performed.

## Verification

- `npm run test -- --runInBand src/domain/database/schema.spec.ts`
- `npm run test:e2e -- --runTestsByPath test/character-social-schema.e2e-spec.ts test/drizzle-migrations.e2e-spec.ts`
- `npm run format`, `npm run lint`, `npm run test`, `npm run build`
- In `opod-admin`: `npm run schema:check`, `npm run db:generate`, scoped schema Prettier/ESLint, `npm run build`. Full admin format/lint were not run; unrelated admin work is present and remains untouched.

## Final verification (2026-09-18)

- Parent independently ran backend `npm run test -- --runInBand`: 27 suites / 149 tests passed.
- Parent independently ran backend `npm run test:e2e`: 14 suites / 106 tests passed on disposable PostgreSQL 16 containers.
- Parent independently ran backend `npm run build`, `npm run lint`, `npm run format`, and `git diff --check`: passed.
- Parent independently ran admin `npm run schema:check`: passed. Sol also verified exact mirror equality, scoped schema format/lint, full admin build, and no schema drift on migration generation.
- Final SQL/schema diff reviewed against approved table/column names, BIGINT identity, nullable character timezone, new RESTRICT foreign keys, and character reaction constraints.
- No persistent local/development database was migrated and no commit was created. Runtime workers and APIs are not implemented by this schema slice.
- Verified; human review required before merge. Review historical reaction preflight, FK delete compatibility, and nullable timezone transition before shared-database application.
