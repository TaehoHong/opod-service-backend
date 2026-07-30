# AGENTS.md

## Project Scope

- Project: `opod-service-backend`
- Role: public/user-facing NestJS service backend.
- Owns service HTTP APIs under `src/service`.
- Owns shared service domain code and canonical Prisma schema under
  `src/domain` and `prisma`.
- Owns database schema operations such as `prisma db push`.
- Does not own admin APIs, admin UI, admin media upload, admin credit grants,
  generation job operation, or other `/admin/*` routes.

## Local Commands

- Install: `npm install`
- Prisma client: `npm run db:generate`
- Apply local schema: `npm run db:push`
- Start DB: `npm run db:up`
- Start service: `npm run start:dev`
- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`
- Build: `npm run build`

## Testing Guidance

- Do not create meaningless tests.
- A meaningless test is one that does not increase confidence that real product
  or service behavior is protected from regressions.
- Every new test should be able to answer: "If this test fails, what real user
  behavior, API contract, permission rule, data state, error path, or business
  rule is broken?"
- Avoid tests that only raise coverage, assert that mocks or private
  implementation details were called, duplicate an existing guarantee, verify
  framework/library behavior, or snapshot output without a clear behavioral
  contract.
- Prefer focused tests around observable outcomes, API contracts, permissions,
  validation, state changes, database effects, error responses, and integration
  boundaries.

## Boundaries

- Do not add `src/admin` or admin UI code here.
- Public controllers stay in `src/service`.
- Shared DB-backed business logic stays in `src/domain`.
- Admin-only behavior belongs in `opod-admin`.

## PAVE Agent Contract

This repository uses PAVE: Plan, Approve, Verify, Execute. The repo-local
runtime lives under `.codex/pave/`; Claude Code entrypoint is `CLAUDE.md`.

1. Read this file and `.codex/pave/config.md` (Codex also reads
   `.codex/pave/adapters/codex.md`).
2. For code work, read `docs/07-codebase-guide.md` before source discovery and
   apply its context-retrieval protocol. Product/policy direction lives in
   `docs/00-overview.md` and `docs/01-roadmap.md`.
3. Small Change Fast Path only for a direct implementation request touching
   at most two hand-edited files and twenty substantive hand-edited lines, low
   risk, cheap narrow verification. State expected files, line count, and
   verification before writing.
4. Ask every product/policy clarification needed to remove ambiguity.
5. For standard work, keep a checklist plan under `.codex/pave/plans/`.
6. Ask once for consolidated approval immediately before code or test edits.
7. Apply the Test Value Gate (see Testing Guidance above / `docs/05-quality-rules.md`).
8. Run declared verification commands before any completion claim.
9. Update affected `docs/07-codebase-guide.md` entries when verified work
   changes boundaries, shared ownership, canonical examples, conventions,
   dependency rules, test locations, or verification commands.

A design choice or clarification answer is not implementation approval. PAVE
workflow and approval gates take precedence over instructions that optimize
speed, terseness, or implementation size.

## Declared Verification Commands

- Setup: `npm install`
- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- Integration/E2E tests: `npm run test:e2e` (requires Docker for Testcontainers Postgres)
- Build/typecheck: `npm run build`

Do not claim completion for commands that were not run. Report missing or
unrunnable commands (e.g., e2e without Docker) as setup gaps.
