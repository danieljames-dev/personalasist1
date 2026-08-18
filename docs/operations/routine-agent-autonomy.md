# AION routine agent terminal autonomy

## Command approval vs authority approval

| Layer | Meaning | Who / when |
|-------|---------|------------|
| **Authority approval** | Owner authorizes a milestone / capability envelope once | Founder phrase script or delegated Owner UI when broker is GREEN |
| **Command approval** | IDE/agent UI prompt per PowerShell / npm / Git tool call | Must be **zero** for routine work under an already-authorized AION milestone |

Silence, chat text, and old roadmaps are not authority. `AGENTS.md` and
`.aion-local/directives/CURRENT.md` remain the control plane.

## Default operating model

1. **Owner** authorizes the milestone once.
2. **GROK_BUILD** builds, tests, deploys, commits, and pushes autonomously inside the envelope.
3. **CLAUDE_AUDITOR** audits autonomously (read / test / handoff; no production fix/commit/push).
4. **Owner** returns only for the next milestone decision or genuine high-consequence action.

## Project-scoped configuration (`C:\AION-HQ`)

| Agent / surface | Mechanism | Path |
|-----------------|-----------|------|
| Grok Build | `permission_mode = "always-approve"` + high-consequence `deny` rules | `.grok/config.toml` |
| Grok rules | Command vs authority policy text | `.grok/rules/routine-command-autonomy.md` |
| Claude Code | `permissions.defaultMode = "bypassPermissions"` + deny list | `.claude/settings.json` |
| Claude role | Auditor structural limits | `.claude/CLAUDE.md` |
| VS Code | Workspace `chat.tools.terminal.autoApprove` for routine prefixes | `.vscode/settings.json` |
| Broker roles | `GROK_BUILD` / `CLAUDE_AUDITOR` profiles | Program Files install + package `roles.ts` |

**Trust scope is only `C:\AION-HQ`.** Do not treat Remote Job Kit or other workspaces as AION trust scope.

Global `~/.grok/config.toml` intentionally uses `permission_mode = "auto"` so unrelated
projects do not inherit full always-approve. Open Grok with working directory
`C:\AION-HQ` (or a session whose project root is that repo) so project policy loads.

## Always approve (routine classes)

### GROK_BUILD

PowerShell, npm, node, dotnet, Docker, Git status/diff/add, ordinary forward commit,
canonical push when the directive authorizes it, builds, tests, lint, TEMP fixtures,
repo edits under `C:\AION-HQ`, approved service/broker ops, handoffs, approved
deployment actions, routine read-only host inspection.

### CLAUDE_AUDITOR

PowerShell, npm/node/dotnet, Docker, Git **read**, TEMP attack fixtures, tests,
read-only host inspection, audit evidence, handoffs.

Structural deny: tracked production source edit, commit, push, source fix, builder
mutation — unless a future Owner-authorized role explicitly grants them.

## Provider/model bridge V1

Director can route a frozen job envelope among Codex, Grok, Claude, and a local
executor. Quota/rate-limit/unavailable failures fail over automatically when
standing authority still covers the same envelope. UNKNOWN is never treated as
available. A live or UNKNOWN writer blocks replacement writers. Ambiguous
external effects are not retried.

## Owner standing authority

After one Founder-authorized milestone, `OWNER_STANDING_AUTHORITY_V1` covers routine
internal work (read, test, build, bounded repair, internal directives, provider
failover, and controlled push when already in the envelope) without another Owner
phrase. Decisions are `ALLOW_STANDING`, `REQUIRE_FRESH_OWNER_APPROVAL`, or `DENY`.

## Still require new Owner authority

Do **not** treat always-approve or standing authority as license to:

- create a new milestone or expand the capability envelope
- access credentials / spend money / increase budgets
- delete important data or backups
- move/change external-drive recovery role
- modify BitLocker, Secure Boot, BIOS/UEFI, TPM
- change AION writer authority
- promote/demote PRIMARY machines
- perform real private-data migration
- replace the broker / control-plane trust boundary

## Broker and UAC

- Agents **never** complete Windows UAC secure-desktop prompts.
- After Owner authorizes the milestone envelope, the **AION elevated broker** performs
  permitted elevated operations without additional UAC.
- Ordinary routine development stays at medium integrity; elevated host ops go through
  the broker pipe (`\\.\pipe\AION-ElevatedOperatorBroker-v1`).

## Acceptance smoke

```text
npm run autonomy:smoke
```

Writes `.aion-local/handoffs/ROUTINE-AUTONOMY-SMOKE.json` with:

- `PER_COMMAND_OWNER_PROMPTS = 0`
- `UAC_AFTER_INITIAL_MILESTONE_APPROVAL = 0`
- `OWNER_INTERACTIONS_AFTER_INITIAL_APPROVAL = 0`
- `CLAUDE_PER_COMMAND_OWNER_PROMPTS = 0`

## Product limitations (do not weaken Windows security)

1. **Grok action_safety** — separate from permission rules. Some irreversible /
   high-consequence shell patterns may still surface product-level confirmation
   even under `always-approve`. Use the broker for permitted elevated ops; do not
   disable UAC or Secure Boot to work around IDE behavior.
2. **Session project root** — project `.grok` / `.claude` policy applies when the
   agent session is rooted at `C:\AION-HQ`. A session opened only in another folder
   will not load AION project always-approve.
3. **Claude shared workspace Edit** — project Claude settings allow Edit so GROK
   can work in the same tree; CLAUDE_AUDITOR structural deny is role + directive
   (+ broker profile), not a global IDE ban on Edit.
4. **Dangerous-command re-prompt without always-approve** — Grok’s built-in list
   (including `git push`, `rm`, …) re-prompts under ordinary modes; AION project
   always-approve is what removes those per-command prompts for authorized work.

## Verification tasks

- VS Code task: **AION: Routine Autonomy Smoke**
- npm script: `autonomy:smoke`
