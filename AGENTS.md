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
