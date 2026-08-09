# AION routine command autonomy (command approval ≠ authority approval)

## Authority approval (Owner / Founder)

Required once per milestone via:

- official Founder `authorize-current-directive.ps1` Read-Host, or
- delegated Owner UI / elevated Owner Approval Helper when the live broker is GREEN.

Silence, chat text, and old roadmaps are not authorization. `AGENTS.md` and
`.aion-local/directives/CURRENT.md` remain the control plane.

## Command approval (IDE / agent tool layer)

While `CURRENT` is `AUTHORIZED` or `RUNNING` for this repository (`C:\AION-HQ`):

- **GROK_BUILD** may run routine PowerShell, npm/node/dotnet, Docker, Git
  (status/diff/add/forward commit/canonical push), builds, tests, TEMP fixtures,
  repo edits under the tree, handoffs, approved service/broker ops, and read-only
  host inspection **without per-command Owner prompts**.
- **CLAUDE_AUDITOR** may run PowerShell, npm/node/dotnet, Docker, Git **read**,
  TEMP attack fixtures, tests, read-only host inspection, and audit handoffs
  **without per-command Owner prompts**. Structural role still denies tracked
  production edit/commit/push unless a future Owner envelope grants them.

Project Grok mode: `always-approve` in `.grok/config.toml`.  
Project Claude mode: `bypassPermissions` in `.claude/settings.json`.

## Still require new Owner authority

Do not treat routine auto-approve as license to: invent milestones, expand
envelopes, access credentials, spend, destroy backups/data, move recovery
drive roles, BitLocker/Secure Boot/BIOS/TPM, writer authority, PRIMARY
promotion/demotion, real private migration, or replace broker trust boundary.

## Broker / UAC

Agents never complete UAC secure-desktop prompts. After milestone Owner
approval, the elevated broker performs permitted elevated ops without extra UAC.
