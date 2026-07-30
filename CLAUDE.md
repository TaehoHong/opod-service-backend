# PAVE Agent Contract for Claude Code

Claude Code entrypoint for `opod-service-backend` (PAVE: Plan, Approve, Verify,
Execute).

After reading this file, read in order:

1. `AGENTS.md` — project scope, commands, boundaries, PAVE contract.
2. `.codex/pave/config.md` — repo-local PAVE policy.
3. `.codex/pave/adapters/claude-code.md` — Claude Code adapter notes.

For code work, read `docs/07-codebase-guide.md` **before** source discovery and
follow its context-retrieval protocol (check only relevant entries' evidence
paths for staleness, then read target + callers/callees + tests + canonical
examples). Product/policy direction lives in `docs/00-overview.md` and
`docs/01-roadmap.md`; detailed policy in `docs/credit-policy.md`,
`consent-policy.md`, `account-support-policy.md`, `db-management.md`,
`affinity-policy.md` (draft).

Use `/pave` when available (`.claude/commands/pave.md`). The shared PAVE source
of truth stays in `.codex/pave/`. Use `.claude/agents/` for bounded PM,
planning, UI/UX, fullstack, and QA subagent discovery.

## Repo Facts (quick)

- NestJS 10 + Prisma 7 + PostgreSQL(schema `opod`), TypeScript strict.
- Layers: `src/service` (HTTP) → `src/domain` (DB logic) → `prisma` (canonical
  schema). Enforced by `src/architecture.spec.ts`.
- This repo owns user-facing APIs + canonical schema. Admin lives in
  `opod-admin`; chat generation + relationship memory in `opod-agent`; frontend
  in `opod-web`. Do not add `src/admin` or import admin here.
- Verification: `npm run build` / `lint` / `test` / `test:e2e` (e2e needs
  Docker). See `AGENTS.md` "Declared Verification Commands".

## Open Items (see docs/01-roadmap.md)

- Policy↔code drift decided 2026-07-29 but not yet implemented: email
  retention + block re-registration; remove inquiry daily limit; indefinite
  retention. Do not assume current code matches these until reconciled.
- Unresolved: `chat_reply` cost basis (price unconfirmed); payment / adult-
  verification provider direction; staging/rollback/backup/monitoring.
