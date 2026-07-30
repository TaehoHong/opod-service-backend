# PAVE Runtime

This repository uses PAVE: **Plan, Approve, Verify, Execute**.

PAVE keeps AI-assisted development work organized through planning, one approval gate before edits, verification, and final or blocked reports.

Korean documentation: [README.kr.md](README.kr.md)

## Quick Use

In Codex:

```text
$pave:pave implement this feature
$pave:pave find and fix this bug
$pave:pave review the current changes
$pave:pave continue the previous task
```

In Claude Code:

```text
/pave implement this feature
/pave find and fix this bug
/pave review the current changes
/pave continue the previous task
```

Plans and reports stay in `.codex/pave/` for both Codex and Claude Code.

## Workflow

1. The agent reads `AGENTS.md`, `CLAUDE.md`, and `.codex/pave/config.md`.
2. The agent reads `docs/07-codebase-guide.md`, checks request-relevant
   evidence paths for staleness, and scans only the target code, direct
   dependencies, relevant tests, and canonical examples before expanding.
3. A direct implementation request can use the fast path only when it touches
   no more than two hand-edited files and no more than twenty substantive
   hand-edited lines, is low risk, and has cheap narrow verification.
4. Otherwise the agent asks product, policy, design, deployment, and verification questions before implementation.
5. The agent creates or updates a plan in `.codex/pave/plans/`.
6. The agent asks once for approval immediately before code or test edits. A
   design choice or clarification answer is not implementation approval.
7. The agent applies the Test Value Gate and rejects ceremonial, duplicate,
   implementation-detail, or coverage-only tests.
8. The agent implements with valuable tests or the strongest proportionate
   non-test verification.
9. The agent reviews and verifies.
10. The agent uses bounded specialist subagents when useful.
11. The agent reports verification results and residual risk.
12. The agent writes final or blocked reports in `.codex/pave/reports/` when useful.

## Codex vs Claude Code

| Topic | Codex | Claude Code |
| --- | --- | --- |
| Command | `$pave:pave ...` | `/pave ...` |
| First file | `AGENTS.md` | `CLAUDE.md`, then `AGENTS.md` |
| Runtime path | `.codex/pave/` | `.codex/pave/` |
| Role agents | PAVE skill references | `.claude/agents/` |

## Files Here

- `config.md`: repo-local PAVE policy.
- `../../docs/07-codebase-guide.md`: durable module, shared-code, convention,
  and verification navigation index.
- `plans/`: task plans.
- `reports/`: final and blocked reports.
- `templates/`: plan and report templates.
- `adapters/`: Codex, Claude Code, and generic agent guidance.

## Check This Repo

In Codex, ask:

```text
$pave:pave check this PAVE installation
```

Terminal fallback, from the PAVE source repo:

```bash
./scripts/doctor.js <repo-path>
```
