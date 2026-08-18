# Personal Context V1 — operations

Personal Context is the controlled picture AION holds of the Owner's approved personal and work
information. It exists so downstream objectives reason from current, attributed evidence rather than
from whatever document happened to be lying around.

Milestones: `PERSONAL-CONTEXT-SYNC-V1` (engine), `OWNER-CONTEXT-ENROLLMENT-V1` (real enrollment)
Owner authorization: whichever record `CURRENT.md` names — see "The sensitivity ceiling" below
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

### The sensitivity ceiling

The ceiling is **not a constant in the code**. It is read from the durable Owner authority record
that the current directive names (`Owner-Authorization-Id` in `CURRENT.md`, resolved against
`.aion-local/owner-authority/<id>.json`), a file only a verified Founder phrase can create:

| Authority record | Enrollable up to |
| --- | --- |
| `sensitiveDataPermission: "NO"` | `INTERNAL` |
| `sensitiveDataPermission: "YES"` | `CONFIDENTIAL` |
| missing, revoked, suspended, expired or malformed | `INTERNAL` (fail closed) |

`RESTRICTED` is not reachable from an authority record at all; it would need its own governance
change. A source above the ceiling is refused with `SENSITIVITY_ABOVE_MILESTONE_CEILING`, naming the
record that decided it. That refusal is the correct outcome, not an obstacle to route around.

This used to be a constant pinned to one directive, which meant an agent blocked by the refusal had
a one-line edit available that looked like ordinary maintenance in a diff. It is authority-derived
now for exactly that reason.

### Least-disclosure defaults

The Owner supplies **where** a source is and **what** it is. Everything else comes from defaults:

```bash
node scripts/register-context-source.mjs defaults
node scripts/register-context-source.mjs register ... --dry-run
```

Every personal source type — `RESUME_CV`, `WORK_HISTORY`, `OWNER_ENTERED_CURRENT_JOB`,
`APPROVED_LOCAL_FILE`, `APPROVED_LOCAL_FOLDER` — defaults to `CONFIDENTIAL` and
`eligibleProviders: ["local"]`. That is stricter than Provider Bridge V1 would allow, deliberately:
a default that is too tight produces a job saying "I could not see your work history"; a default that
is too loose has already sent it. Widen one source with `--eligibleProviders codex;grok;claude;local`
when you decide it is appropriate.

Registration prints the defaults before it writes the row, so conservative never means surprising.

## Your current job, without a file

Personal Context could always model current employment and, at first, could only accept it inside a
hand-authored JSON declaration — which is why the store stayed empty. It is flags now:

```bash
node scripts/owner-context.mjs status

node scripts/owner-context.mjs set-current-job --employer "..." --title "..." --industry "..." --responsibilities "a;b;c" --tools "a;b" --skills "a;b" --projects "a;b" --startDate 2024-02-01 --dry-run

node scripts/owner-context.mjs report
```

Every flag is optional. **A value you do not give is not stored, not guessed, and not filled with a
placeholder** — the command prints exactly what it did not receive, so the gap stays visible instead
of becoming an invented fact. `--dry-run` shows what would be stored and writes nothing.

Facts entered this way are marked `origin: OWNER_ENTERED`, and the review report never blurs them
with `EXTRACTED` ones. What you said and what a document implied are different kinds of evidence.

Each list item becomes its own fact, so one obsolete tool can be retired without restating the rest.
A second submission is a **full restatement** by default: anything you stated before and did not
repeat is retired — kept, with its provenance, but no longer live. Use `--mode MERGE` to add without
retiring.

The Owner-entry source is created on first use, reads no file, and is `CONFIDENTIAL` / local-only
like every other personal source.

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

## Reading back what AION knows

```bash
node scripts/owner-context.mjs report
node scripts/owner-context.mjs report --stdout
node scripts/owner-context.mjs report --redact
```

The review is written under `.aion-local/personal-context/reports/` — local, untracked, never
uploaded. It contains: current facts, historical facts, skills and technologies, projects,
preferences and constraints, conflicts, stale or unknown-freshness facts, **missing important career
context**, source provenance, and a per-provider disclosure table.

Two things it does on purpose:

- **Origin is labelled on every fact** (`OWNER_ENTERED`, `OWNER_CONFIRMED`, `EXTRACTED`), and the
  `INFERRED` count is printed even though it is always zero — the fact validator refuses to store an
  inferred fact, and the report says so each time it runs. An inferred fact presented as
  Owner-confirmed is the specific failure this whole system exists to prevent.
- **Missing categories are computed from a fixed expectation list**, not from what happens to be
  present. Deriving "what is missing" from "what exists" can only ever report nothing missing.

`--redact` replaces values with lengths and keeps every structural field, for any consumer that is
not you at your own machine.

## Director retrieval: what one job is shown

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

## Git sources

A named repository can be enrolled with `--sourceType APPROVED_GIT_REPOSITORY`. Provenance then
records the repository identity alongside each fact: the remote URL and the commit HEAD resolved to
at sync time, stored on the source row and as `sourceCommit` on every fact from that pass.

Identity is **read, not executed** — from `.git/HEAD`, the loose ref it names, `.git/packed-refs`,
and the `url` in `.git/config`. There is no `git` subprocess, because giving one source adapter the
ability to run processes gives every future adapter the same. A layout this reader cannot resolve
(a linked worktree whose real repository lives outside the approved root, an unborn branch) records
`null` with a reason rather than a plausible-looking commit.

`.git` and build output are excluded from the content walk by default. Repository content is not
treated as career evidence — only declarations inside it are.

## Verifying

```bash
npm run test --workspace @aion/personal-context   # focused suite, fake filesystem, hostile paths
node scripts/personal-context-acceptance.mjs      # real sync, Owner entry and report over fixtures
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
