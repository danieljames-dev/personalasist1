# Project AION Agent Instructions

## Authority

- The Founder is the final approval authority.
- Repository ADRs and recorded CTO decisions define architecture.
- The current local directive defines the only authorized task.
- Prior completed directives do not imply continuing authorization.
- Silence, old chat messages, roadmaps, or TODOs are not authorization.

## Current Directive

Before doing any work, read `.aion-local/directives/CURRENT.md` in full. It must exist and
contain `Status: AUTHORIZED`. If missing or different, do not modify files or run implementation
commands; report that no authorized directive exists and stop. Execute only its Authorized Scope.
Do not begin later phases merely because they appear elsewhere.

## Required Start Gate

Before edits, confirm the repository root; inspect Git status, branch, and HEAD; confirm the
canonical origin and ahead/behind state; run required verification; and compare actual state with
the directive baseline. Stop on unexplained differences. Never discard, reset, stash, overwrite,
or repair unexplained work automatically.

## Scope Control

- Implement the smallest change satisfying the active directive; do not expand into adjacent systems.
- Future roadmap items are not current work.
- Do not lift freezes or close gates without explicit authorization.
- Do not create production claims from specifications, benchmarks, or reference candidates.

## Personal Data

- Never scan the computer for owner data or infer file locations.
- Never inspect Desktop, Documents, Downloads, email, browsers, phones, cloud drives, external
  drives, or unrelated repositories without explicit current authorization.
- Never commit private owner data or place it in fixtures, tests, examples, logs, handoffs, or backups.
- Redact personal values from handoffs. Synthetic examples must not resemble the Founder’s history.

## Network and External Actions

Unless explicitly authorized: no web, APIs, email, job boards, account access, deployments,
application submission, Git push, or external backup writes. Never force-push or rewrite shared history.

## Verification

- Run all directive-required verification and preserve existing tests.
- Report actual failed, skipped, unavailable, contradictory, and passing evidence.
- Inspect staged files before every commit; confirm no secrets or private data are staged.

## Failure Handling

On any stop condition, stop the assignment, preserve evidence, do not begin the next phase, do not
label the run successful, and write a failure handoff.

## Handoff

Before ending every authorized run, write `.aion-local/handoffs/LATEST.md` and a timestamped copy
under `.aion-local/handoffs/history/`. Include directive ID; starting and ending branch/HEAD; files
changed; commands/tests; commit/push; backup/restore; privacy/hygiene; failures/deviations; gate and
ADR statuses; remaining unauthorized work; and the exact next Founder/CTO decision. Never include
secrets or private owner data.

## Completion State

After completing or stopping, change the local directive from `RUNNING` to exactly one of
`AWAITING_CTO_REVIEW`, `FAILED`, or `BLOCKED`. Do not leave it `AUTHORIZED` or `RUNNING`.
Codex may change only `AUTHORIZED → RUNNING`, then `RUNNING →` one of those completion states.
Only the Founder authorization script may change `PENDING_OWNER_AUTHORIZATION → AUTHORIZED`.

## Review Rules

Review architecture boundaries, unsupported claims, hidden network behavior, personal-data leakage,
path traversal, scope expansion, missing provenance, nondeterminism, unsafe Git actions, vacuous
tests, and discrepancies between reports and repository state.
