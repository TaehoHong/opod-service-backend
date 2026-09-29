# AGENTS.md

## Project Scope

- Project: `opod-service-backend`
- Role: public/user-facing NestJS service backend.
- Owns service HTTP APIs under `src/<feature>/`.
- Owns shared service domain code and the canonical Drizzle schema under
  `src/core/database/schema.ts`.
- Owns Drizzle migration generation and application under `drizzle`.
- Does not own admin APIs, admin UI, admin media upload, admin credit grants,
  generation job operation, or other `/admin/*` routes.

## Local Commands

- Install: `npm install`
- Generate migration: `npm run db:generate`
- Apply local migrations: `npm run db:migrate`
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

## DB 환경 용어 (정본: `docs/02-development-rules.md`)

DB를 가리킬 때 아래 네 단어만 쓴다. 파괴적 작업의 대상이 흐려지지 않게 한다.

- **로컬 DB** — 개별 PC의 localhost(`npm run db:up`, 5433). `db:push`가
  허용되는 유일한 대상.
- **개발 DB** — `dev-run-taeho` 서버의 DB. `deploy.sh`가 배포하는 대상. 공용이라
  파괴적 작업 금지.
- **운영 DB** — 아직 없다. 다른 환경을 "운영"이라 부르지 않는다.
- **테스트 DB** — Testcontainers 일회용 컨테이너. 상태가 남지 않는다.

## Mandatory Repository Dependency Rule

- 이 규칙은 `opod-service-backend`와 `opod-admin`의 절대 규칙이다.
- Repository는 테이블당 하나이며, A Repository에 의존할 수 있는 것은 A Domain Service뿐이다.
- B Domain Service는 A Repository에 접근할 때 반드시 A Domain Service를 거친다.
- Application / Facade / UseCase Service는 Domain Service만 조합하며 Repository를 직접 의존하지 않는다.
- Controller, Worker, Scheduler 및 다른 Repository의 직접 Repository 접근도 금지한다.
- Repository/DB client 노출, 직접 SQL, 동적 DI 조회로 이 경계를 우회하지 않는다.
- 트랜잭션을 공유할 때도 소유 Domain Service 경유 원칙을 지킨다.
- 기존 미준수 코드는 예외나 정본 예시가 아니다. 요청 범위 밖 코드는 자동 수정하지 않는다.
- 상세 정본: [개발 규칙](docs/02-development-rules.md)의 “Repository 의존 절대 규칙”.

## Boundaries

- Do not add `src/admin` or admin UI code here.
- Public controllers and DB-backed business logic stay in `src/<feature>/`.
- HTTP DTOs live in `src/<feature>/dto/`; infrastructure lives in `src/core/`
  and cross-cutting helpers in `src/shared/`.
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
