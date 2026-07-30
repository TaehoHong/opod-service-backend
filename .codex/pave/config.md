# PAVE Config

## Runtime

- Interface: one chat session from request to completion when feasible.
- Orchestrator: main agent owns routing, plan approval, verification,
  and final claims.
- Approval gate: ask once immediately before code or test edits.
- Clarification: ask every product or policy question needed to
  remove ambiguity before implementation.
- Durable artifacts: `plans/`, `reports/`, `docs/07-codebase-guide.md`, and
  optional `.wiki/`.

## Context Retrieval

- Read `docs/07-codebase-guide.md` before source discovery.
- Check staleness only for request-relevant entries and their evidence paths.
- Inspect the target, direct callers and callees, relevant tests, shared
  owners, and canonical examples before expanding the search.
- Current code overrides stale guide entries.
- Update affected guide entries when shared structure or conventions change.

## Request Routing

- Project initialization: create PAVE runtime, agent files, docs,
  and declared verification commands.
- Small change: only a direct implementation request within both hard limits
  of two hand-edited files and twenty substantive hand-edited lines can use
  the fast path. State the expected files, line count, and verification before
  writing.
- Feature/change: plan first, apply the Test Value Gate, then use
  Red-Green-Review only for tests with material regression value.
- Bug: investigate root cause before proposing fixes.
- Analysis: scan repo, cite evidence, avoid edits unless requested.
- Review: findings first, severity ordered, with file and line evidence.
- Refactor: preserve behavior and verify with declared commands.
- Docs sync: update docs only from verified repo evidence.
- Continuation: resume from the newest relevant plan in `plans/`.

## Execution Modes

- `go`: run the next unchecked checklist item.
- `batch`: run an approved phase or tier.
- `fast`: run low-risk items automatically when verification is cheap.
- `status`: summarize progress, blockers, and verification state.
- Token-save: disabled.
- Low-cost implementer: not declared.
  When enabled, `/pave` keeps the current configured model for planning and
  final review, and uses the configured low-cost implementer only for bounded
  implementation tasks that do not need architecture, product, security,
  data-integrity, or API-design judgment.

## Subagents

Allowed specialist briefs: product manager, planner, UI/UX designer,
fullstack developer, and QA engineer. Subagents return evidence;
the main agent owns final claims.
