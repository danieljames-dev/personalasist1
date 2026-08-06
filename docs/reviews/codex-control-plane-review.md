# Codex Control Plane Architecture Review

- Date: 2026-08-06
- Scope: Phase 2.12 control-plane source and local pending-state behavior
- Recommendation: **APPROVE**

## Findings

| Concern | Finding |
|---|---|
| Founder authorization | Preserved by visible, case-sensitive exact-phrase input after scope display and baseline verification |
| Codex self-authorization | Prevented; no Codex transition from pending to authorized exists |
| Stale rerun | Runner requires exact `AUTHORIZED`; post-run success rejects `AUTHORIZED` and `RUNNING` |
| Interrupted run | Prompt is retained; status/handoff/Git evidence is inspected after exit; recovery procedure requires review |
| Git leakage | `.aion-local/` is ignored, tests verify it, and staged review remains mandatory |
| Backup leakage | `.aion-local/` is a forbidden working-data archive pattern; only tracked control-plane source enters Git bundles |
| Owner data in handoffs | Permanently prohibited by AGENTS and templates; hygiene review remains required |
| Push and backup scope | Neither launcher performs them automatically; the active directive must explicitly authorize them |
| Later phases | Generated prompt and permanent rules prohibit automatic continuation |
| Windows paths | Repository-relative defaults and `Join-Path`/literal paths are used; tasks use relative paths |
| Command injection | Directive text is parsed and displayed but never executed; no `Invoke-Expression` or dynamic command construction |
| AGENTS size | Concise and comfortably below the 32 KiB loading limit |
| Handoff evidence | Covers repository, work, verification, Git, backup, privacy, deviations, gates, and next decision |
| Copy/paste reduction | Six VS Code tasks and one persistent local directive replace repeated full directive pasting |
| Disconnected stream | Local prompt and status survive; incomplete state cannot print SUCCESS |
| Credit exhaustion | Documented as BLOCKED with preserved evidence and handoff |
| Git safety | Clean synchronized baseline, approved origin, exact HEAD, and no automatic repair are enforced |
| Phase 3 | Prepared only as `PENDING_OWNER_AUTHORIZATION`; not executed |

## Residual limitations

- Local ignored state is not part of code backups by design; workstation loss can lose pending directives and handoffs.
- An interactive Codex process can still be interrupted before it changes `AUTHORIZED` to `RUNNING`; the operator must
  inspect the retained prompt, transcript, directive, and Git state before retrying.
- Authentication validity proves CLI access, not authorization for any external AION action.
- Founder review of sensitive interactive approvals remains indispensable.

## Recommendation

APPROVE
