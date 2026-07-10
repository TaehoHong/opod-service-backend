# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed service-backend correctness issues that were not explicitly deferred by the user.

**Architecture:** Keep the existing NestJS service/domain layout and Prisma schema. Enforce invariants at domain boundaries, use PostgreSQL advisory transaction locks and compare-and-set updates for races, and keep inactive character data while removing it from public reads.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, PostgreSQL 16, Jest 29, Supertest.

## Global Constraints

- Preserve the existing JSON refresh-token API; do not add cookies or CORS changes.
- Do not add dependencies, schema changes, migrations, feature flags, or new layers.
- Leave payment-provider signature/amount verification as the existing production-use comment.
- Do not change message-provider partial-save behavior, email verification, account-deletion cleanup, or operational DB procedures.
- Write and run a failing regression test before each production behavior change.
- Do not create a git commit unless the user requests one.

---

### Task 1: Authentication response, input validation, and refresh rotation

**Files:**
- Modify: `src/domain/auth/auth.service.spec.ts`
- Modify: `src/domain/auth/auth.service.ts`
- Modify: `src/service/auth/auth.controller.ts`
- Modify: `test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: Existing `{ user, accessToken, refreshToken }` JSON contract.
- Produces: Consistent public user fields, 400 for missing refresh tokens, and one successful successor per refresh token.

- [ ] Add tests that require `bio`/`profileImageUrl` consistency, reject missing refresh tokens with 400, and run two refreshes concurrently with exactly one success.
- [ ] Run `npm test -- --runInBand src/domain/auth/auth.service.spec.ts` and the focused auth E2E; confirm the new assertions fail for the reported reasons.
- [ ] Add `bio` and `profileImageUrl` to `authUserFields`; validate `refreshToken` with `requiredString`; replace refresh-time read-then-revoke with `updateMany({ tokenHash, revokedAt: null })` and require `count === 1`.
- [ ] Re-run the focused unit and E2E tests and confirm they pass.

### Task 2: UUID boundaries and malformed request bodies

**Files:**
- Modify: `src/domain/database/uuid.ts`
- Modify: `src/domain/characters/characters.service.ts`
- Modify: `src/domain/posts/posts.service.ts`
- Modify: `src/domain/reports/reports.service.ts`
- Modify: `src/domain/notifications/notifications.service.ts`
- Modify: the corresponding service specs and focused E2E specs.

**Interfaces:**
- Consumes: User-controlled path IDs and request bodies.
- Produces: Existing 404/400 domain semantics without Prisma UUID-cast 500 responses.

- [ ] Add focused tests for `bad-id` character, post, report, and notification paths and malformed auth refresh/session bodies.
- [ ] Run the tests and confirm the current code reaches Prisma or Node crypto and returns 500.
- [ ] Change `isUuid` to accept `unknown`; return false/null before Prisma calls in entity lookup methods; pass optional refresh-token body values to the service validator.
- [ ] Re-run focused tests and confirm 4xx responses.

### Task 3: Hide inactive characters from every public surface

**Files:**
- Modify: `src/domain/characters/characters.service.ts`
- Modify: `src/domain/posts/posts.service.ts`
- Modify: `src/domain/stories/stories.service.ts`
- Modify: `src/domain/follows/follows.service.ts`
- Modify: `src/domain/messages/messages.service.ts`
- Modify: the five corresponding service specs.

**Interfaces:**
- Consumes: Existing `Character.status` soft-delete state.
- Produces: Inactive rows remain stored but cannot be read, followed, messaged, boosted, or surfaced through posts/stories/conversations.

- [ ] Change test expectations so all public queries require `character: { status: "active" }` and `hasCharacter`/`findCharacter` require active status.
- [ ] Run the five focused suites and confirm the query-contract tests fail.
- [ ] Apply active relation filters to character existence/detail, posts, stories, followed-character reads, and conversation list/cursor reads.
- [ ] Re-run the five suites and focused visibility E2E coverage.

### Task 4: Make events durable and constrain client-authored events

**Files:**
- Create: `src/domain/events/events.service.spec.ts`
- Modify: `src/domain/events/events.service.ts`
- Modify: `src/service/events/events.controller.ts`
- Modify: `src/domain/follows/follows.service.ts`
- Modify: `src/domain/messages/messages.service.ts`
- Modify: follow/message specs.

**Interfaces:**
- Consumes: Authenticated client view/open events and server-generated follow/message events.
- Produces: A Promise that resolves only after the event row is stored; the public endpoint accepts only `feed_view`/`post_open` for an existing active post.

- [ ] Add tests proving `recordEvent` does not resolve before `userEvent.create`, propagates insert failure, and `recordClientEvent` rejects server-only event types, mismatched target types, and missing targets.
- [ ] Run the event tests and confirm immediate resolution/arbitrary-event acceptance fails them.
- [ ] Remove the in-memory Promise chain; make `recordEvent` async; add `recordClientEvent` with the client allowlist and active post check; await event recording from follow/message services.
- [ ] Re-run event, follow, and message suites.

### Task 5: Serialize the inquiry daily limit

**Files:**
- Modify: `src/domain/inquiries/inquiries.service.spec.ts`
- Modify: `src/domain/inquiries/inquiries.service.ts`
- Modify: `test/inquiries.e2e-spec.ts`

**Interfaces:**
- Consumes: Concurrent inquiry creates for one user and KST day.
- Produces: At most ten stored rows; excess requests receive 429.

- [ ] Add a concurrent HTTP E2E that submits eleven requests and asserts ten successes, one 429, and ten DB rows.
- [ ] Run it against PostgreSQL and confirm more than ten can be stored.
- [ ] Wrap count/create in an interactive transaction and acquire `pg_advisory_xact_lock(hashtextextended(userId + KST date, 0))` before counting.
- [ ] Re-run the unit and E2E concurrency tests.

### Task 6: Enforce credit idempotency and terminal-state races

**Files:**
- Modify: `src/domain/credits/credits.service.spec.ts`
- Modify: `src/domain/credits/credits.service.ts`
- Modify: `test/credits.e2e-spec.ts`

**Interfaces:**
- Consumes: Grant references, payment callbacks, reservation capture/release requests.
- Produces: One grant per cooperating external reference, atomic paid transition/grant, immutable terminal purchase states, and one winning reservation terminal transition.

- [ ] Add tests for concurrent same-reference grants, conflicting reference reuse, payment transition replay/conflict, payment rollback, capture/release competition, and persisted release of expired reservations.
- [ ] Run focused unit/E2E tests and confirm the current check-then-create, unconditional updates, and rollback behavior fail.
- [ ] Extract a transaction-client grant helper; advisory-lock external references; validate an existing grant's user/amount; process payment state and grant in one transaction; reject `refunded` until recovery exists.
- [ ] Change capture to conditional `reserved -> captured` before debit writes; return an expired sentinel from the transaction and throw only after the release commits.
- [ ] Re-run focused credit tests against both fakes and PostgreSQL.

### Task 7: Formatting and full verification

**Files:**
- Format: `src/domain/posts/posts.service.spec.ts`
- Format: `src/domain/stories/stories.service.spec.ts`
- Review: every modified file.

- [ ] Run Prettier on modified files and the two existing format failures.
- [ ] Run `git diff --check` and inspect the complete diff for excluded-scope changes.
- [ ] Run `npm run format`, `npm run lint`, `npm run build`, and `npm test -- --runInBand`.
- [ ] Run `npm run test:e2e -- --runInBand` with Testcontainers and report exact suite/test counts and any remaining unrelated failures.
