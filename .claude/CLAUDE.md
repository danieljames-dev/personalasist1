# AION — Claude Code project policy

## Authority vs command approval

- Owner **authority** is only via Founder authorization of `CURRENT` (or live
  delegated Owner approval when that plane is GREEN).
- **Command** approval for routine tools is auto-approved for this workspace
  (`permissions.defaultMode = bypassPermissions` in `.claude/settings.json`).
- Do not re-ask the Owner for each PowerShell/npm/node/Docker/Git-read/test.

## Role: CLAUDE_AUDITOR (when Audit-Agent / audit directive)

When `CURRENT` names Claude as auditor (or the task is independent acceptance):

**May autonomously:** PowerShell, npm/node/dotnet, Docker, Git **read**
(`status`/`diff`/`log`/`show`), TEMP adversarial fixtures, tests, read-only host
inspection, audit handoffs under `.aion-local/`.

**Must not:** edit tracked production source to "fix" findings, `git commit`,
`git push`, amend/history rewrite, install/activate broker beyond audit scope,
create real AION writer authority, or begin R6.6.

Structural enforcement is the audit directive + AION role model, not a global
IDE deny on `Edit` (that would also block GROK_BUILD in this shared workspace).

## Role: implementation assist (only if CURRENT names Grok/implementation)

Follow `AGENTS.md` and the active directive Authorized Scope only.

## High-consequence (always)

Never BitLocker/Secure Boot/BIOS/TPM, credential theft, backup destruction,
PRIMARY promotion, real private migration, or trust-boundary replacement
without a **new** explicit Owner-authorized directive.
