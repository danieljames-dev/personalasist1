# Career data threat model

## Scope and assets

The boundary covers the explicit local Career CLI, CareerSource, CareerFact, CareerProfile,
JobPosting, JobMatchReport, ApplicationDraft, relationships, private config, and local exports.
Career data, provenance, Identity references, preferences, conflicts, and drafts are private assets.

## Threats and controls

| Threat | Control | Residual risk |
|---|---|---|
| Accidental owner-file discovery | absolute explicit roots/files; containment checks; no enumeration or implicit traversal | owner can explicitly select the wrong in-root file |
| Path traversal or link escape | privacy boundary authorization plus recheck and bounded file repositories | OS/filesystem behavior remains platform-dependent |
| Invented or conflicted claims | positive claims require clean matched fact citations; unknown/conflict becomes checklist | owner must review factual relevance and wording |
| Misleading score | visible integer weights, component reasons, unknown handling, limitations | deterministic lexical matching is semantically limited |
| Stale or substituted evidence | pinned Object revisions, source digests, deterministic IDs, fail-closed retry | no authenticity proof for owner-supplied source bytes |
| External disclosure | no network dependencies or domain network calls; local exports require explicit paths | other local software and OS compromise remain out of scope |
| Autonomous consequential action | submission, email, forms, signing and attestation do not exist | owner can manually use a draft without adequate review |
| Oversize/malformed canonical data | ACJ-1 and accepted resource limits reject before integrity output | DG-4b workload evidence remains absent |
| Backup leakage | source mirror/bundle exclude `private/` and `.aion-local/`; restored tree is checked | owner-managed private exports need a separate protection policy |

Architecture tests forbid network/process-spawn/model/external-action dependencies. Temporary demo
state is deleted in `finally`; restore tests assert that no repository-private state remains. This
review does not authorize real owner data. DG-3 and DG-4b remain Open.
