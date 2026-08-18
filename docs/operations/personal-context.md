# Personal Context V1 — operations

Personal Context is the controlled picture AION holds of the Owner's approved personal and work
information. It exists so downstream objectives reason from current, attributed evidence rather than
from whatever document happened to be lying around.

Milestone: `PERSONAL-CONTEXT-SYNC-V1`
Owner authorization: `PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z`
Implementation: `packages/personal-context`
Store: `.aion-local/personal-context` (local, untracked, never uploaded)

## The one rule an operator has to hold

**AION reads only what is in the source registry, and only inside the scope that row approves.**

There is no drive scan, no "find the Owner's documents", no walking outward from an approved folder.
A path that resolves outside its approved root is refused even when the link that got there lived
inside the root. If a source is not enrolled, it does not exist as far as this system is concerned.

## Enrolling a source

Enrollment is one command and one registry row. Nothing in the package changes when a source is
added, which is what keeps "AION may read this" reviewable as a list rather than as a diff.

```bash
node scripts/register-context-source.mjs register \
  --sourceId current-job-2026 \
  --sourceType OWNER_ENTERED_CURRENT_JOB \
  --location "C:\approved\folder" \
  --displayName "Current job record" \
  --purpose "Owner-supplied current employment facts" \
  --sensitivityClass INTERNAL \
  --syncMode ON_DEMAND \
  --recursive false --maxDepth 1 --maxFiles 20
```

Registering reads nothing. It records that the Owner approved a root, a scope, a class, a provider
set and a sync mode. Synchronization is a separate, explicit step:

```bash
node scripts/register-context-source.mjs sync --sourceId current-job-2026
node scripts/register-context-source.mjs sync            # every readable source
node scripts/register-context-source.mjs list
```

Re-synchronizing an already-approved source is routine and needs no further Owner decision. Adding a
source, widening its root, or raising its sensitivity class is a new decision.

### What the sensitivity ceiling means here

The authorizing directive carries `Sensitive-Data-Permission: NO`, so this milestone enrolls sources
up to `INTERNAL` only. A `CONFIDENTIAL` or `RESTRICTED` source is refused at enrollment with
`SENSITIVITY_ABOVE_MILESTONE_CEILING`. That refusal is the correct outcome, not an obstacle to route
around: raising it is an Owner decision, made by authorizing a directive that grants it.

## Supplying facts: declarations, not guesses

A file yields facts only when it is a structured declaration. Free prose — a resume as written, a
README, notes — is read and produces **nothing**, recorded in the receipt as `UNSUPPORTED_CONTENT`.

This is deliberate. A parser that infers "current employer" from the topmost dated block on a resume
is right most of the time and confidently wrong the rest, and a confident wrong answer is exactly
what this system exists to keep away from a recommender. The visible gap is fixable by the Owner; an
invisible fabrication is not.

A declaration looks like this:

```json
{
  "schema": "aion.personalContext.declaration.v1",
  "subject": "owner",
  "documentId": "current-job-2026",
  "facts": [
    {
      "category": "CURRENT_EMPLOYMENT",
      "predicate": "employer",
      "value": "<employer>",
      "temporalState": "CURRENT",
      "validFrom": "2024-02-01T00:00:00Z",
      "lastConfirmedAt": "2026-08-01T00:00:00Z",
      "confidence": "HIGH",
      "sensitivity": "INTERNAL",
      "evidenceReference": "offer letter, page 1",
      "eligibleUses": ["JOB_MATCHING", "CAREER_SUMMARY"]
    }
  ]
}
```

Fields that carry weight:

- `temporalState` — `CURRENT`, `HISTORICAL` or `UNKNOWN`. An old resume is `HISTORICAL`.
- `lastConfirmedAt` / `observedAt` — when the claim was true. **Omitting both means the fact is
  `UNKNOWN_FRESHNESS` forever**, no matter how recently the file was saved. File modification time is
  recorded as provenance and is never treated as evidence that a claim is current.
- `eligibleUses` — what the fact may be used for. Every allowed value is an analysis; there is no
  action use, and one would be rejected.
- `sensitivity` — may narrow, never widen, the source's enrolled class.

Credential-shaped material (passwords, tokens, account or card numbers, SSNs) is refused at
validation. It never enters the store, so no retrieval path can leak it.

## Reading context back

Director asks for the smallest set it needs:

```js
getContextForJob({
  jobId, objective, subject: "owner",
  categories: ["CURRENT_EMPLOYMENT", "SKILL"],
  provider: "claude",
  sensitivityCeiling: "INTERNAL",
  minimumFreshness: "RECENT",
  maxItems: 25, maxCharacters: 8000,
  allowedUses: ["JOB_MATCHING"],
}, { store });
```

The response carries the selected facts with provenance, conflict warnings, a context fingerprint,
and `omissions` — an itemised account of everything withheld and why. Treat the omission list as part
of the answer: a job that knows six facts were withheld for staleness should behave differently from
one that believes it saw everything.

### Providers

A stored fact is not automatically sendable to every model. Eligibility comes from Provider Bridge
V1's sensitivity table, intersected with the source's own provider list. When a job fails over to a
different executor, disclosure is **recomputed** for the new provider — it is never inherited from
the payload built for the previous one. If the remaining executor is not eligible for a fact's class,
the fact is withheld and the job proceeds without it, or another eligible executor is chosen.

## Disabling and revoking

```bash
node scripts/register-context-source.mjs state --sourceId <id> --state DISABLED
node scripts/register-context-source.mjs state --sourceId <id> --state REVOKED
```

Both stop future reads and stop future disclosure immediately. Neither deletes the facts already
derived: revocation stamps `revokedAt` and retrieval starts omitting them with reason
`SOURCE_REVOKED`, while the rows survive so the provenance of anything a past job already saw is
still answerable. Physical deletion policy is a later milestone.

## Reading a sync receipt

Every sync writes one, under `.aion-local/personal-context/receipts`.

| Outcome | Meaning |
| --- | --- |
| `COMPLETED` | Everything in the approved scope was read. Nothing refused, truncated or errored. |
| `SKIPPED_UNCHANGED` | The fingerprint matched. No file was read. |
| `PARTIAL` | Some of the scope was read; something else was refused, truncated or errored. |
| `FAILED` | Nothing usable was read — typically an unresolvable root. |
| `DENIED` | The source was not eligible to be read: inactive, revoked, expired or unregistered. |

`COMPLETED` is re-derived from the receipt's own contents before it is stored, so a receipt cannot
claim success while recording failures. Worth watching:

- `boundaryEscapeAttempts` — non-zero means something inside an approved root pointed outside it.
  That is a security observation, not a routine bound.
- `truncatedBy` — a ceiling stopped the walk; coverage is incomplete by that much.
- `filesUnsupported` — files read that produced no facts, usually prose. A high count against a
  source the Owner expected facts from means a declaration is missing.

## Verifying

```bash
npm run test --workspace @aion/personal-context   # focused suite, fake filesystem, hostile paths
node scripts/personal-context-acceptance.mjs      # real sync over the project fixture
npm run verify                                    # whole repository
```

The acceptance harness prints `SYNC_ENGINE_PROVEN` and `OWNER_CONTEXT_COMPLETE` as separate lines.
They are separate questions. The engine being proven over AION project data says nothing about
whether AION knows anything about the Owner — that depends entirely on which real sources have been
enrolled.

## Not authorized by this milestone

Email, browser data, phone data, call transcripts, Tekion, Informativ, Google Drive or any cloud
storage, unapproved GitHub or remote repositories, the historical AI-assistant archive, OAuth or
account consent, any external write, and job discovery or matching. Each needs its own Owner
decision.

And the invariant that outlives this milestone: **knowing something is not permission to act on it.**
A fact that the Owner uses a system does not authorize logging into it; a stored address does not
authorize sending anything to it. `authorityFromPersonalContext` always answers no, and authority
comes from the control plane instead.
