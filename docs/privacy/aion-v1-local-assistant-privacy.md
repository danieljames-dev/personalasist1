# AION V1 local assistant privacy record

Status: Reference Candidate. Complements
[the personal data boundary](personal-data-boundary.md) and
[the V1 threat model](../security/aion-v1-local-assistant-threat-model.md).

## What was used during development

Only neutral synthetic data created in temporary directories and removed afterwards: invented
conversations, memories, tasks, routines, plans, approvals, ChatGPT/Claude/Grok archive fixtures,
encrypted backups, and the pre-existing neutral synthetic Career demo scenario.

No real résumé, work history, preference, Job Posting, AI-assistant archive, model export, email,
calendar, drive, browser, phone, cloud account, or unrelated repository was opened, searched,
inferred, imported, or modified. The existing real private Identity state was neither read nor
changed. No drive was scanned and no archive was discovered automatically. No live model call was
made; every test and the demo use the offline deterministic provider.

One narrow local environment check was performed, exactly as the directive permits: a fixed list
of documented Codex CLI install locations was probed with one `stat` each, and the resolved
executable was asked for its `--version`. No developer-agent task was executed against the
repository.

## What AION stores and where

| Content | Location | Notes |
| --- | --- | --- |
| Conversations, memories, tasks, routines, plans, actions, approvals, activity, import reports, settings | `private/aion/state-v1.json` | Git-ignored; excluded from source backups; mode `0600` on write |
| Local exports and encrypted private backups | `private/aion/exports/` | Owner-invoked only; no cloud synchronisation |
| Career workspace | the explicit root the owner passes | Owned by the accepted Career engine |

Nothing is written anywhere else. AION creates no user-profile, registry, startup, or service
state.

## What is deliberately not stored

- Provider credentials. Settings hold only the **name** of an environment variable.
- Passphrases and derived backup keys. Neither is persisted or logged.
- Imported document bodies in activity history. Activity holds summaries and references only.
- Absolute local paths in anything that reaches the browser. Errors and Career output are
  path-rewritten first; the state endpoint reports `private/aion` rather than a real path.
- Model-inferred personal traits. AION infers nothing about the owner; a provider-proposed memory
  is stored `unconfirmed` with provider provenance until the owner accepts it.

## Owner control

Every memory can be corrected with its prior content preserved, disabled, deleted, or exported.
Conflicting memories are preserved and flagged rather than silently merged. Conversations can be
renamed, archived, or deleted. Activity retention is an owner setting applied on every write.
Settings offers a complete plaintext export of everything AION holds, and the encrypted private
backup is the portable protected form. Deleting `private/aion` removes all AION state.

## Real-data import remains owner-initiated

The importer is built but never runs by itself. It requires an owner-selected root and selection,
performs a dry run first, reports exact digests and duplicates, can be cancelled, refuses to
proceed if the source changed after the dry run, and never modifies the source. No real owner
archive was imported during this milestone.

## Residual privacy risks

- Live state is protected by OS file permissions and any disk encryption the owner has enabled;
  AION adds no at-rest encryption for `state-v1.json`.
- A plaintext local export is plaintext; the UI states this at the point of export.
- Choosing a remote provider sends conversation content and enabled memory context off the
  machine. That choice is explicit, disclosed, and visible in the header badge.
