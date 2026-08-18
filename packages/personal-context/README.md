# @aion/personal-context

What AION is allowed to know about the Owner, where each claim came from, and how current it is.

This package exists so that a later recommender — job discovery, career planning, anything that acts
on "what the Owner does" — reasons from approved, attributed, dated evidence instead of from one
stale resume that happened to be in a folder.

## The shape of it

```
registry  →  bounded sync  →  extraction  →  freshness  →  reconciliation  →  local store  →  retrieval
```

- **Registry** (`enrollment.ts`, `enrollment-defaults.ts`, `contracts.ts`) — `ContextSourceV1`. AION
  may read a source only if it is a row here and that row is `ACTIVE`. Enrollment is data, not code.
  The Owner supplies where a source is and what it is; defaults supply the rest, local-only for
  anything personal.
- **Ceiling** (`authority.ts`) — what class may be enrolled is read from the durable Owner authority
  record, not from a constant here. `sensitiveDataPermission: "YES"` permits `CONFIDENTIAL`; anything
  unusable fails closed to `INTERNAL`.
- **Owner entry** (`owner-entry.ts`) — the Owner states their current job with no file and no schema.
  Facts are marked `OWNER_ENTERED`; unsupplied values stay unsupplied.
- **Bounded sync** (`sync.ts`, `path-boundary.ts`) — walk the approved root inside depth, file and
  byte ceilings; refuse anything that resolves outside it; fingerprint from metadata so an unchanged
  source costs no reads.
- **Extraction** (`extraction.ts`) — declaration-driven. Structured context documents become facts.
  Prose becomes nothing, and the receipt says so.
- **Freshness** (`freshness.ts`) — computed from the claim's own dates. A filesystem modification
  time is recorded as provenance and never used as evidence of currency.
- **Reconciliation** (`reconcile.ts`) — a source revising itself supersedes; two sources disagreeing
  conflict; claims about different periods do neither. Nothing is ever overwritten.
- **Store** (`store.ts`) — plain JSON under `.aion-local/personal-context`. Local only. A malformed
  record raises and names its file rather than quietly vanishing.
- **Retrieval** (`retrieval.ts`, `disclosure.ts`) — `getContextForJob` returns the smallest set that
  satisfies the request, with provenance, conflict warnings, and an itemised list of what was left
  out and why.
- **Review** (`report.ts`) — the Owner-facing picture: what is known, what conflicts, what is stale,
  what is missing, and what each provider would be shown. Origin is labelled on every fact.
- **Git identity** (`git-identity.ts`) — repository and commit provenance, read from the checkout
  rather than by running `git`.

## Three rules that shape everything else

**Knowledge is not permission.** No fact grants access to anything.
`authorityFromPersonalContext` is the only answer to "may I act on this", and it is always no.

**Unknown stays unknown.** A claim with no supporting date is `UNKNOWN_FRESHNESS`, not "probably
current". A document the extractor cannot support yields zero facts, not a plausible guess.

**Failover changes the executor, never the disclosure.** Provider eligibility is recomputed from the
facts for whichever provider will actually receive them, so a takeover cannot carry a payload built
for a more-eligible model.

## Using it

```bash
node scripts/owner-context.mjs status
node scripts/owner-context.mjs set-current-job --title "..." --skills "a;b" --dry-run
node scripts/owner-context.mjs report

node scripts/register-context-source.mjs defaults
node scripts/register-context-source.mjs list
node scripts/register-context-source.mjs register --sourceId resume-2026 --sourceType RESUME_CV \
  --location "C:\path\to\approved\folder" --displayName "Resume" --purpose "Career evidence"
node scripts/register-context-source.mjs sync --sourceId resume-2026
node scripts/register-context-source.mjs state --sourceId resume-2026 --state REVOKED
```

```bash
npm run test --workspace @aion/personal-context   # focused suite
node scripts/personal-context-acceptance.mjs      # real sync over the project fixture
```

## What this package does not claim

Proving the engine over `fixtures/aion-project-context` shows the machinery works. It says nothing
about whether AION knows anything about the Owner. That depends entirely on which real sources the
Owner has enrolled, and the acceptance harness prints both facts separately for exactly that reason.
