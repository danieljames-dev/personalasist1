# AION Codex Control Plane

Status: Operational workflow, 2026-08-06
Owner: Founder/CTO

## Purpose and roles

The control plane reduces repeated prompt copying without delegating authority. The Founder is the
only authorization authority. Repository ADRs and CTO decisions define architecture. The browser
ChatGPT CTO can prepare and review direction but cannot directly control the local machine. Codex
inside the VS Code integrated terminal is the execution agent. `.aion-local/handoffs/LATEST.md` is
the evidence bridge back to CTO review.

Root `AGENTS.md` supplies permanent repository rules. It never authorizes a task. The only current
task is `.aion-local/directives/CURRENT.md`, and it is runnable only at exact status `AUTHORIZED`.
Codex cannot change a pending directive to that status; only the interactive Founder authorization
script can.

## Directive lifecycle

```text
PENDING_OWNER_AUTHORIZATION --Founder script--> AUTHORIZED
AUTHORIZED --Codex begins--> RUNNING
RUNNING --> AWAITING_CTO_REVIEW | BLOCKED | FAILED
PENDING_OWNER_AUTHORIZATION --> SUPERSEDED (Founder/CTO preparation only)
```

No other status is valid. A completed or stopped directive must not remain `AUTHORIZED` or
`RUNNING`. Prior directives and roadmap phases provide context, not continuing authority.

To prepare a future directive, copy `docs/directives/CURRENT.template.md` into the ignored current
path, assign a stable ID, exact expected commit, exact authorization phrase, narrow scopes, gates,
verification, commit/push/backup authority, stop conditions, handoff requirements, and a later-phase
prohibition. Keep it pending. To supersede a pending directive, preserve its text in an appropriate
local record, mark it `SUPERSEDED`, then install a new pending directive; never silently reuse an ID.

## Exact authorization and execution

In VS Code select:

```text
Terminal
→ Run Task
→ AION: Authorize Current Directive
```

Review the displayed identity, title, baseline, scopes, and required phrase. Type the exact visible
phrase. `Y`, `yes`, blank input, partial text, and case variants fail. The script then requires clean
synchronized `main`, the approved origin, exact baseline, and passing `npm run verify`. It changes
only the ignored local directive and does not launch Codex.

On Windows, the repository gate invokes the native `npm.cmd` entry point explicitly. This avoids
PowerShell-version-dependent behavior in third-party `npm.ps1` shims while preserving the same npm
verification command, exit-code check, strict mode, and fail-closed repository gates. Run
`npm run control-plane:test-real-gate` from a clean synchronized `main` to exercise the authorization
script against the actual repository gate with a temporary ignored directive.

Directive metadata fields are line-oriented. A directive or tracked directive template must contain
exactly one line beginning with `Status:`; instructional prose must use wording such as
`Final required state:` so it cannot be parsed as a second status field.

PowerShell pipelines emit no object for a zero-item result, so assigning an `if` expression whose
empty branch contains `@()` can still produce `$null`. Collection comparisons therefore initialize
non-null .NET lists and normalize both inputs to explicit `System.Object[]` instances before calling
`Compare-Object`. The collection matrix and real-gate tests run locally and in every isolated backup
restore. The native Windows `npm.cmd` selection remains required. These tests use synthetic ignored
control state; Sprint 3 Phase 3 remains archived and unexecuted.

Then select:

```text
Terminal
→ Run Task
→ AION: Run Current Directive
```

The runner checks Codex availability and login, `AGENTS.md`, directive status, clean synchronized
Git state, and baseline. It writes a timestamped ignored prompt and launches the installed Codex CLI
interactively with existing configuration. It does not select danger-full-access, enable search,
alter authentication, answer approvals, commit, push, or back up automatically. The Founder still
approves any sensitive interactive command. A post-run SUCCESS message requires a terminal directive
status and a non-empty latest handoff.

## Handoffs, interruption, and credits

Every run writes `LATEST.md` and a timestamped history handoff using
`docs/handoffs/HANDOFF.template.md`. Handoffs record evidence and remaining authority without raw
owner data, credentials, or tokens. They remain local because operational streams can contain
machine paths and provisional findings; CTO review decides what belongs in durable documentation.

After an interruption, do not rerun blindly. Inspect CURRENT status, the newest prompt and handoff,
Git status, and the Codex transcript. If status is `RUNNING`, write or complete a `BLOCKED` handoff
before deciding whether a new directive is required. If Codex credits are exhausted, preserve the
prompt and worktree evidence, mark the run `BLOCKED`, write the handoff, and request a specific CTO
decision; never label the run successful.

## Failure and security boundaries

All mismatches fail closed. Scripts never evaluate directive text as PowerShell, use
`Invoke-Expression`, construct shell commands from directive sections, force-push, or rewrite
history. Push and external-backup writes occur only when the authorized directive explicitly permits
them. Later phases never begin automatically.

`.aion-local/` is Git-ignored and rejected by working-data backup archives. It contains local
directives, handoffs, prompts, and logs—not source history. Tracked templates, scripts,
documentation, `AGENTS.md`, and VS Code tasks remain in Git and therefore in durable-ref backups.
Real owner data must never enter local handoffs or control-plane state.

## Instruction-source inspection

Before execution, inspect repository and ancestor `AGENTS.md` or `AGENTS.override.md`, the current
local directive, recorded ADR/CTO authority, and any explicit session instructions. Report conflicts
and stop rather than choosing silently. Global Codex configuration controls the CLI environment but
does not authorize AION work and must not be modified by this workflow.

## Verification and recovery

Run `npm run control-plane:test` after control-script changes. It uses only temporary synthetic Git
repositories, never launches a model, and performs no network access. A failed test preserves its
temporary evidence. Recover local state from the ignored files and terminal transcript; recover
tracked control-plane source from the verified mirror or bundle. Local handoffs are intentionally
not included in code/documentation backups.
