# Sales Assistant — Conversation Intelligence

**Status:** design only. No implementation, no Tekion access, no Informativ, no call capture, no
customer communication. Nothing in this document is built.

**Purpose:** define the data and intelligence layer so that when a browser executor is eventually
built, it inherits a customer model rather than forcing one to be invented at automation time. The
browser agent should be the least intelligent component in the system: it receives a structured,
already-decided proposal and performs it. Every judgement happens before it is reached.

**Baseline:** `origin/main` @ `26f3e35`. Every contract cited below was read at that commit.

---

## 0. The finding that shapes this design

Most of what this workstream needs **already exists in AION**. The temptation is to model calls,
needs, and commitments as a new subsystem; doing so would create a second customer model that drifts
from the first. Three existing contracts already carry the exact semantics being requested:

| Requirement | Existing contract | Fit |
|---|---|---|
| Needs with value/confidence/source/observed/valid-until/superseded | `TemporalFactV1` (`executive-context.ts:212`) | **Near-exact.** Has `confidence`, `observedAt`, `validFrom`, `validUntil`, `lastConfirmedAt`, `supersededAt`, `supersededBy`, `invalidatedAt`, `invalidationReason`, `lineage`, `provenance` |
| Commitments with who-promised-whom | `CommitmentV1` (`commitments.ts:14`) | **Exact.** `committedBy`, `committedTo`, `relationshipId`, `statement`, `dueAt`, `status`, `confidence`, `provenance` — plus `extractCommitmentCandidates()` already exists |
| Match explained as why / why-not / unknown | `CustomerVehicleMatchV1` (`vehicle-intelligence.ts:45`) | **Exact.** `whyMatches`, `knownConflicts`, `unknown`, `score`, `sourceClass` |
| Evidence weighting by channel | `source-trust.ts` 9-tier ladder | **Reusable as-is** |

So this design adds **three** new contracts, not a subsystem. The rest is reuse, with two small
additive fields.

---

### Component audit — verified against `26f3e35`

Every row below was read in source. The pattern is consistent: the pieces exist, and what is missing
is the wiring between them.

| Capability | Exists? | Where | Reuse verdict |
|---|---|---|---|
| Relationships / customers / prospects | **Yes** | `RelationshipV1` (`contracts.ts:352`) with `lifecycle`, `interests`, `objections`, `followUps`, `interactions` | Reuse. Interactions and follow-ups already live on the record |
| Interactions | **Yes** | `RelationshipInteractionV1` | Reuse as the durable per-customer timeline |
| Commitments | **Yes** | `CommitmentV1` (`commitments.ts:14`) + `extractCommitmentCandidates()` | Reuse |
| Commitment actor distinction | **Yes, already built** | `CommitmentActorV1 = "owner" \| "other" \| "uncertain"` and `ExtractedCommitmentV1` with `interpersonal` + `reason` (`connectors/gmail-connector.ts:207`) | **Reuse and generalise.** The "did the Owner promise, or the customer, or is it unclear" judgement is written and applied to email already; transcripts need the same extractor, not a new one |
| Gmail threads | **Partial** | `GmailConnectorConfigV1`, `GmailRelevanceV1`, message fixtures | Reuse relevance + commitment extraction; there is no durable thread entity, and this design does not need one |
| Tasks | **Yes** | `TaskV1` (`contracts.ts`) | Reuse for `CREATE_TASK` proposals |
| Email drafts | **Yes** | `EmailDraftV1`, never auto-sent | Reuse; the DRAFT-ONLY discipline is the precedent for CRM proposals |
| Vehicle inventory | **Yes** | `VehicleRecordV1` with `govVinFacts`, `recallAssessment`, `priceHistory`, presence/temporal state | Reuse |
| Customer interests | **Yes but thin** | `RelationshipInterestV1` — free-text description | Insufficient for matching; superseded by `customer-need:*` temporal facts (§2). Keep the existing field as Owner-authored shorthand |
| Workspaces | **Yes** | `settings.activeWorkspace`, per-record `workspace` | Reuse. Note the active-workspace filter currently hides other workspaces from lookup |
| Provenance / source refs | **Yes** | `ProvenanceV1` + `source-trust.ts` 9-tier ladder + `classifySourceRef` | Reuse unchanged |
| Corrections | **Yes** | `OwnerKnowledgeCorrectionV1`, `applyOwnerPhotoCorrection` pattern | Reuse the pattern: correct forward, never erase the original |
| **Action authority** | **Yes, and stronger than expected** | `authority-envelope.ts` — `AuthorityEnvelopeV1`, `ExternalActionKindV1`, `ExternalActionRecordV1`, `evaluateExternalGate()` returning `{allowed:false, class: KILL\|POLICY\|SPEND\|DEPENDENCY\|AMBIGUITY}`, plus `writer-authority.ts` (`WRITER \| READ_ONLY \| REVOKED`) and `owner-authority-v2.ts` | **Reuse. Do not build a second authority system.** Tekion and Informativ become new `ExternalActionKindV1` values gated by the existing evaluator, with every attempt landing in the existing `ExternalActionRecordV1` log — including `blocked` and `owner_required` outcomes |
| Drafts / never-auto-send | **Yes** | `emailSendSafetyCheck`, `EMAILS_SENT = 0` discipline | Reuse as the model for CRM writes |

Two things this audit changes about the design:

1. **Commitment extraction is not new work.** The Gmail connector already decides actor and whether
   language is a real interpersonal obligation. Transcripts should feed that same extractor; a second
   implementation would drift and produce two different answers about the same promise.
2. **The authority boundary is not new work either.** `evaluateExternalGate` already returns a
   refusal *class*, and `ExternalActionRecordV1` already records blocked and owner-required outcomes
   with evidence. The Tekion/Informativ tiers in §6–§7 are new *kinds* passed to an existing gate —
   not a parallel permission model. This matters: a second authority system is how a "no" in one
   place becomes a "yes" in another.

## CURRENT_AION_COMPONENTS_REUSED

- **`TemporalFactV1` + `source-trust.ts`** — customer needs and preferences. The supersession and
  validity machinery is the hard part of "don't overwrite when a customer changes their mind", and it
  is already written and tested.
- **`CommitmentV1` + `extractCommitmentCandidates()`** — Requirement 3 in full.
- **`RelationshipV1`** (`contracts.ts:352`) — the customer record. Not replaced.
- **`CustomerVehicleMatchV1` + `matchCustomerToVehicles()`** (`vehicle-intelligence.ts:415`) — the
  ranking shape and the why/why-not/unknown split already exist.
- **`VehicleRecordV1`** with `govVinFacts`, `recallAssessment`, `priceHistory` — inventory truth.
- **`photo-vehicle-match.ts`** — the *pattern* for conservative identity resolution: explicit match
  states, auto-link only on strong unique evidence, candidates offered rather than forced, Owner
  correction preserving the original read. Customer identity resolution should mirror this shape
  rather than invent a new one.
- **`attention-engine.ts`** — Owner-must-do vs AION-can-do triage for the read models.
- **`universal-capture.ts`** — existing text→structure capture path.
- **`crm-assistant.ts` routing + `owner-fact-gate` promotion pattern** — the principle that raw
  material is evidence and never automatically becomes an assertion.

## NO_NEW_CONTRACT_REQUIRED_WHERE_POSSIBLE

- Do **not** create a `CustomerNeedV1`. A need is a `TemporalFactV1` about a relationship.
- Do **not** create a parallel commitment type. `CommitmentV1` covers it.
- Do **not** create a new match/score type. `CustomerVehicleMatchV1` covers it.
- Do **not** create a second customer entity. `RelationshipV1` is the customer.
- Do **not** add a vector store, graph database, or new agent framework for any of this.

- **Do not build a second authority system.** `evaluateExternalGate` + `ExternalActionKindV1` +
  `ExternalActionRecordV1` already gate and log external effects with typed refusals. Tekion and
  Informativ are new *kinds*, not a new model.
- **Do not write a second commitment extractor.** `ExtractedCommitmentV1` + `CommitmentActorV1`
  already judge actor and interpersonal-obligation language for email.

## NEW_STRUCTURES_ACTUALLY_REQUIRED

Three contracts, plus two additive fields. Everything else is reuse.

1. `ConversationEventV1` — the evidence envelope (§1)
2. `IdentityResolutionV1` — how an event attaches to a customer (§4)
3. `CrmActionProposalV1` — the contract the future browser executor consumes (§6)

Additive fields:

- `TemporalFactV1.subjectRef?: OpaqueId | null` — which relationship a fact is *about*. Today
  `TemporalFactV1` is scoped by `workspace` and `category` only, with no subject link, so customer
  needs cannot be retrieved per customer. Optional, defaulted forward, no migration.
- `RelationshipV1.externalRefs?: Array<{ system: string; id: string }>` — the Tekion customer ID and
  any other system key, kept as data rather than encoded into a name. Optional, additive.

---

## TRANSCRIPT_EVENT_MODEL

```
ConversationEventV1 {
  id, workspace
  channel: PHONE_CALL | EMAIL | SMS | IN_PERSON_NOTE | CHAT | TEKION_INTERACTION | OWNER_NOTE
  direction: INBOUND | OUTBOUND | INTERNAL
  occurredAt, capturedAt
  participants: [{ role: OWNER | CUSTOMER | THIRD_PARTY, label, identityRef | null }]
  identity: IdentityResolutionV1          // never a bare relationshipId — see §4
  content: { text, redactions[], durationSec?, mediaRef? }
  segments: [{ index, speaker, startMs?, text }]
  extraction: { provider, model, confidence, ok }   // ok:false yields NO derived facts
  derived: { factIds[], commitmentIds[], proposalIds[] }
  provenance, createdAt, updatedAt
}
```

**A transcript is evidence, not truth.** This is the same rule the VIN pipeline learned the hard
way: when the vision provider failed, its diagnostic string was mined for VINs and produced a
candidate assembled from AION's own error text. Here the equivalent failure is a garbled transcript
becoming a customer preference. Therefore:

- `extraction.ok === false` yields **zero** derived facts, commitments, or proposals. A failed
  transcription is not weak evidence about a customer; it is no evidence about a customer.
- Every derived fact carries `sourceRef = conversation:<eventId>#<segmentIndex>`, so any claim can be
  traced to the sentence that produced it and the Owner can hear or read that sentence.
- Raw transcript text is stored under existing private-document handling, never surfaced as an
  assertion.
- Segment-level references matter: "the customer said X" must point at *where*, or the Owner cannot
  check it.

**Retention and consent** are policy inputs, not engineering defaults. Call recording law varies by
state and this design does not assume permission exists. Capture remains out of scope until the Owner
establishes the legal basis; the model is defined now so the shape does not change later.

---

## CUSTOMER_NEEDS_MODEL

A need is a `TemporalFactV1` with `subjectRef` set to the relationship, using a reserved category
namespace so the executive layer can find them without a new store:

```
category: "customer-need:<attribute>"
```

Attributes: `vehicle-type`, `make`, `model`, `trim`, `budget`, `payment-preference`, `condition`,
`color`, `powertrain`, `feature-required`, `feature-nice`, `feature-excluded`, `trade-in`,
`timeline`, `purchase-intent`, `objection`.

**Requirement strength is part of the fact, not inferred at match time**, because "must not be a
hybrid" and "would prefer dark blue" fail a match in completely different ways:

```
strength: HARD_REQUIREMENT | PREFERENCE | EXCLUSION | UNKNOWN
```

Derivation is conservative and explicit: `HARD_REQUIREMENT` only from unambiguous language ("it has
to be", "I won't take", "only"). Everything else is `PREFERENCE`. Hedged language ("maybe", "I was
thinking") does not create a fact at all — it creates a question for the Owner.

**Changing one's mind is a supersession, never an overwrite.** When a customer says a new budget, the
old fact gets `supersededAt` + `supersededBy`; it is not mutated. This is what makes
*"Has Sarah changed what she wants?"* answerable, and it is the single most valuable property of
reusing `TemporalFactV1` — the history is the feature.

**Payment and financing preferences are recorded only when explicitly stated**, never inferred from
budget, and they never imply qualification. See §7.

---

## COMMITMENT_MODEL

Reuse `CommitmentV1`. The classification the Owner asked for maps onto its existing fields:

| Class | Representation |
|---|---|
| OWNER_PROMISED | `committedBy: "owner"`, `committedTo: <customer>` |
| CUSTOMER_PROMISED | `committedBy: <customer>`, `committedTo: "owner"` |
| CUSTOMER_SAID / OWNER_SAID | **not a commitment** — a `TemporalFactV1`, or nothing |
| AION_INFERRED | never a commitment; a proposal at most |

**Vague statements must not become commitments.** "I'll send you pictures this afternoon" is a
candidate with a due time; "let me see what I can do" is not a commitment in any form. AION should
propose the first for confirmation and stay silent on the second. `extractCommitmentCandidates()`
already returns candidates rather than commitments — keep that boundary; the failure mode to avoid is
a follow-up queue full of things the Owner never actually promised, which trains the Owner to ignore
the queue.

A commitment derived from a transcript starts at a confidence below the Owner-asserted tier and
carries its segment reference, so "Who did I promise to follow up with?" can always show the words.

---

## IDENTITY_RESOLUTION_MODEL

Mirrors `photo-vehicle-match.ts` deliberately — that module already solved this problem for vehicles
and the failure modes are identical.

```
IdentityResolutionV1 {
  state: EXACT_EXTERNAL_ID | EXACT_CONTACT_MATCH | OWNER_ASSERTED
       | AMBIGUOUS_CANDIDATES | UNRESOLVED | CONFLICTING_SIGNALS
  relationshipRef: OpaqueId | null      // set only when safe to link automatically
  method: TEKION_ID | EMAIL | PHONE | SESSION | OWNER_ASSERTION | NONE
  confidence: number
  candidates: [{ relationshipRef, label, why }]
  evidence: string[]
}
```

**Strong signals (may auto-link):** exact Tekion customer ID · exact normalized email · exact
normalized phone · explicit Owner assertion · an in-session identity the Owner already confirmed.

**Weak signals (never link, may only rank candidates):** first name · similar vehicle interest · same
salesperson · same city · timing proximity.

**No name-only merge, ever.** Two Sarahs is not a hypothetical in a dealership. When signals are weak
or conflicting, the event stays `UNRESOLVED` and is *still stored* — an unattached conversation is
recoverable; a wrongly attached one silently corrupts a customer's history and the Owner may act on
it in front of that customer.

`CONFLICTING_SIGNALS` (e.g. matching email for one record, matching phone for another) must never
resolve by precedence. It is a question for the Owner.

Owner correction re-points the link and preserves the original resolution, exactly as
`applyOwnerPhotoCorrection` does — a recurring mis-resolution should become visible rather than being
quietly fixed each time.

---

## INVENTORY_MATCH_MODEL

Reuse `CustomerVehicleMatchV1` and extend `matchCustomerToVehicles()` to read `customer-need:*`
temporal facts.

Scoring rules:

1. An unmet **HARD_REQUIREMENT** is disqualifying — it appears in `knownConflicts`, never as a low
   score. A hybrid does not "score 60%" against "non-hybrid required"; it fails.
2. An unmet **EXCLUSION** is disqualifying on the same basis.
3. **PREFERENCE** contributes to score and appears in `whyMatches` when met.
4. **Anything the record cannot confirm goes in `unknown` — never in `whyMatches`.** If the listing
   does not state the interior colour, AION does not know the interior colour. This is where a sales
   tool most easily becomes a liability: a salesperson repeating an invented feature to a customer
   standing at the car.
5. Every line cites its source class — `LIVE_DEALER_INVENTORY`, `GOVERNMENT_VIN_FACT`,
   `GENERAL_MODEL_KNOWLEDGE`, `FIXTURE_DEMO` — and general model knowledge never becomes a claim
   about a specific unit. "Camry XSE typically has X" is not "this car has X".
6. Recall semantics stay as they are: year/make/model campaign lookup never implies VIN-specific
   clearance.

Worked example — *Camry, XSE preferred, under $35k, non-hybrid required, dark colour preferred*:

```
2024 Camry XSE · VIN … · $33,480 · stock L1042        score 82
  WHY MATCHES   model Camry · trim XSE (preferred) · $33,480 under $35,000
                · gasoline, not hybrid (government VIN decode)
  CONFLICTS     none
  UNKNOWN       exterior colour not stated in the listing

2024 Camry SE · VIN … · $31,900                        score 61
  WHY MATCHES   model Camry · $31,900 under $35,000 · gasoline
  CONFLICTS     trim SE, not the preferred XSE          (preference, not disqualifying)
  UNKNOWN       exterior colour not stated

2025 Camry XSE Hybrid · VIN … · $34,100          DISQUALIFIED
  CONFLICTS     hybrid — customer requires non-hybrid   (hard requirement)
```

---

## CRM_ACTION_PROPOSAL_MODEL

The browser executor must never receive "update Tekion". It receives a decided, reviewable object:

```
CrmActionProposalV1 {
  id, workspace
  customerRef: OpaqueId | null
  identity: IdentityResolutionV1          // unresolved identity ⇒ never auto-approvable
  action: ADD_NOTE | LOG_CALL | UPDATE_PREFERENCE | CREATE_TASK
        | SCHEDULE_FOLLOW_UP | UPDATE_STATUS | ATTACH_VEHICLE_INTEREST
  facts: [{ field, value, factRef }]
  sourceRefs: string[]                    // conversation:<id>#<segment>, document:<id>, …
  confidence: number
  ownerApprovalRequired: boolean          // default TRUE
  authorityTier: ROUTINE | CONSEQUENTIAL | ELEVATED
  expectedExternalEffect: string          // plain language: what will change in Tekion
  idempotencyKey: string                  // survives retries and double-submits
  preconditions: [{ check, expected }]    // verified immediately before execution
  status: PROPOSED | APPROVED | REJECTED | EXECUTED | FAILED | SUPERSEDED
  executionLog: [{ at, outcome, externalRef, error }]
}
```

Four properties are load-bearing:

- **`expectedExternalEffect` is written for a human.** The Owner approves a described outcome, not a
  payload. If it cannot be stated plainly, it should not be proposed.
- **`idempotencyKey`** — browser automation retries. Without a key, a retried "log call" silently
  becomes two calls in the customer's history, which is worse than a failure because it looks like
  data.
- **`preconditions` are re-checked at execution.** A proposal approved at 09:00 and executed at 11:00
  may be operating on a record that changed. Fail closed.
- **`ownerApprovalRequired` defaults true.** Autonomy is granted per action type by the Owner over
  time, never assumed by the intelligence layer.

---

## TEKION_WRITE_BOUNDARY

- **Read before write, always.** Any write proposal must be based on a Tekion record AION has just
  read, not on its own assumption of the current state.
- **Additive writes only, at first.** `ADD_NOTE`, `LOG_CALL`, `CREATE_TASK` — actions that append.
  Editing or deleting existing CRM content stays out of scope entirely; a wrong append is noise, a
  wrong edit destroys a colleague's record.
- **No deal, pricing, or status field writes** in the initial boundary.
- **One customer per proposal.** No bulk operations. Bulk is how a single mis-resolution becomes a
  hundred.
- **Credentials never enter this layer.** Session handling belongs to the executor under its own
  authority model; the intelligence layer must not see, store, or transport them.
- Every execution records `externalRef` so an AION-written note is later distinguishable from a
  human-written one — including by AION itself, which must never re-ingest its own note as fresh
  customer evidence.

## INFORMATIV_HIGH_CONSEQUENCE_BOUNDARY

**Browser ability is not authorization.** This is the whole point of the section.

`ELEVATED` authority — design only, not implementable under current authority:

- credit pull or soft-pull of any kind
- representing customer consent
- financial qualification or affordability statements
- fraud or identity decisions
- payment structure, terms, or deal construction

Rules for these:

1. AION never represents consent on a customer's behalf. Consent is an event with its own evidence,
   captured from the customer, not asserted by software.
2. AION never states or implies that a customer is qualified, pre-qualified, or approved.
3. No `ELEVATED` action is ever auto-approvable, regardless of accumulated autonomy elsewhere. There
   is no path by which routine trust escalates into this tier.
4. These actions require a separate, explicit, revocable authority grant naming the action type — not
   a general "AION may use Tekion" permission.
5. A compliance-relevant action that fails must fail loudly and visibly, never silently retry.

---

## QUERY_EXPERIENCE — required read models

| Question | Read model | Built from |
|---|---|---|
| Who should I call? | `CallQueue` | overdue `CommitmentV1` + stale relationships + attention-engine triage |
| Who did I promise to follow up with? | `OwnerCommitments` | `CommitmentV1` where `committedBy=owner`, open/overdue |
| What does Sarah want now? | `CustomerNeedsView` | current `customer-need:*` facts, superseded excluded |
| Has Sarah changed what she wants? | `NeedsHistoryView` | superseded chain — *this is why supersession matters* |
| Which current vehicles fit Sarah? | `CustomerMatchView` | needs × inventory (§5) |
| Who might want this Camry? | `ReverseMatchView` | inventory × all customers' needs |
| What did I tell John yesterday? | `ConversationHistoryView` | `ConversationEventV1` by relationship + date |
| What customers are waiting on me? | `WaitingOnOwnerView` | open Owner commitments + unanswered inbound |
| Who matches newly arrived inventory? | `NewArrivalMatchView` | `NEWLY_SEEN` vehicles × needs |
| Who hasn't heard from me recently? | `QuietCustomersView` | last outbound per relationship |
| What should I prepare before I call? | `CallPrepView` | needs + history + open commitments + matches + explicit unknowns |

`CallPrepView` is the one that decides whether this is a useful product. It must state **what AION
does not know** as prominently as what it does — the unknowns are what the Owner should ask about on
the call, which makes the gaps the most actionable part of the briefing.

---

## EXAMPLE_END_TO_END_CALL

Owner takes a call. Transcript segment 14: *"I really need something under thirty-five, and it can't
be a hybrid — my wife hates them. XSE if you can. I'll be around Saturday."* Segment 22, Owner:
*"I'll send you pictures this afternoon."*

1. **Event** — `ConversationEventV1`, `channel: PHONE_CALL`, `extraction.ok: true`, segments stored.
2. **Identity** — caller number matches Sarah's phone exactly → `EXACT_CONTACT_MATCH`, method
   `PHONE`. Had only the first name matched: `UNRESOLVED`, stored, Owner asked.
3. **Needs** — four facts, all `subjectRef: sarah`, all citing `conversation:<id>#14`:
   budget ≤ $35,000 `HARD_REQUIREMENT` · powertrain non-hybrid `HARD_REQUIREMENT` · trim XSE
   `PREFERENCE` · timeline Saturday `PREFERENCE`. The prior "under $30,000" budget fact is
   **superseded, not overwritten**.
4. **Commitment** — segment 22 → candidate: Owner promised photos, due this afternoon. Proposed for
   confirmation, not silently created.
5. **Match** — the §5 ranking. Hybrids disqualified, not down-ranked.
6. **Proposals** — `LOG_CALL` (summary + refs), `UPDATE_PREFERENCE` ×2 for the hard requirements,
   `SCHEDULE_FOLLOW_UP` for Saturday. All `ownerApprovalRequired: true`, all `ROUTINE`.
7. **Owner review** — approves; the browser executor performs each with its idempotency key and
   re-checked preconditions.
8. **Later** — *"What does Sarah want now?"* answers from current facts; *"Has Sarah changed what she
   wants?"* shows budget moved $30k → $35k on this date, citing the sentence.

Nothing invented: no payment terms, no qualification, no colour AION was never told, no availability
beyond the current observed listing.

---

## CALL_TRANSCRIPTION_BOUNDARY

Ingestion is **modality-neutral**: everything below produces the same `ConversationEventV1`. That is
the point — the intelligence layer must never learn where audio came from, or each new capture path
becomes a new code path through the customer model.

```
audio (any source) → transcript → segments → facts / commitments / proposals
```

The capture paths differ enormously in what they actually permit, and conflating them is how a
roadmap promises something the platform will never allow.

### TECHNICALLY AVAILABLE now

| Path | Reality |
|---|---|
| Recorded audio file uploaded from the phone or laptop | Works today through the existing Chat attachment path. Needs a speech-to-text provider; the local-vision precedent (Ollama, localhost-only, USD 0) applies directly |
| Laptop-side meeting/VoIP audio | Available when the Owner controls the calling application and system audio capture |
| In-person note dictated after the fact | Already possible — voice input exists in the Chat composer and feeds the same pipeline |
| Email | Already live via the Gmail connector, including commitment extraction |

### REQUIRES A CONTROLLED CALLING PATH

| Path | Reality |
|---|---|
| **iOS cellular call audio** | **Not available to third-party apps.** iOS gives no API for tapping an in-progress cellular call. No amount of AION engineering changes this, and any plan that assumes it will fail at contact with the platform |
| Live cellular transcription | Only via a **controlled calling path** — a VoIP or business line the Owner places and receives calls through, where the audio belongs to the application rather than the carrier |
| Two-party recording consent | A legal precondition, not a feature flag. Florida is an all-party-consent state; a dealership call typically involves a customer who has not consented |

**The honest conclusion: live cellular call transcription is not an AION engineering task. It is a
telephony decision** — adopt a VoIP/business line, or do not have this feature. Everything else in
this design works without it, which is why the pipeline is defined modality-neutrally: post-call
upload delivers most of the value and is available immediately.

### Future live copilot — architecture only

```
audio stream → partial transcript → customer context lookup → quiet suggestion → final grounded summary
```

Three constraints that should be settled before any of it is built:

1. **Partial transcript is never durable.** Only the final transcript produces facts or commitments.
   A mid-sentence "under thirty" that resolves to "under thirty-five" must never reach the customer
   record — an interim hypothesis is not evidence.
2. **Suggestions are read-only and silent.** During a live call AION may surface what it already
   knows; it may not write, send, or propose an external action. The Owner is talking to a person and
   cannot adjudicate a permission prompt.
3. **The summary is reviewed after the call, not accepted during it.** The existing DRAFT-ONLY
   discipline applies unchanged.

Latency targets matter only for suggestions (sub-second to be useful, and useless if wrong), and not
at all for the durable path — which should be unhurried and correct.

## TOP_10_IMPLEMENTATION_STEPS_LATER

Ordered so each step is independently useful and independently reversible. Steps 1–4 deliver a
working product with **no** call recording, no Tekion, and no new authority.

1. **Extract intent handlers out of `service.ts`** before anything else. It is ~11,000 lines with a
   ~2,000-line `assistantPrompt` and two executors editing it concurrently. Every step below adds to
   it otherwise.
2. **Add `TemporalFactV1.subjectRef`** (optional, defaulted forward). Nothing else can be
   per-customer until facts can name their subject. No migration.
3. **Add `customer-need:*` fact writing from Owner-typed notes.** No transcription, no audio — the
   Owner says *"Sarah needs under 35, no hybrid"* and it becomes superseding facts. This proves the
   needs model against real use before any capture path exists.
4. **Extend `matchCustomerToVehicles()` to read those facts**, with hard requirements disqualifying
   rather than down-ranking. Now *"Which cars fit Sarah?"* works, on inventory that already exists.
5. **Add the read models** (`CallPrepView`, `WaitingOnOwnerView`, `NeedsHistoryView`, …) as pure
   functions over existing state. This is where the Owner feels the product.
6. **Add `ConversationEventV1`** with the manual paths only — `OWNER_NOTE`, `IN_PERSON_NOTE`, and
   Gmail — routing through the *existing* `ExtractedCommitmentV1` extractor rather than a new one.
7. **Add speech-to-text for uploaded recordings**, localhost-only, USD 0, following the Ollama
   precedent. Still no live capture, no cellular audio.
8. **Add `IdentityResolutionV1`**, mirroring `photo-vehicle-match`. Unresolved events are stored
   unattached and surfaced for Owner resolution.
9. **Add `CrmActionProposalV1` in propose-only mode** — proposals generated, reviewed, and marked
   `APPROVED`, with **no executor**. The Owner performs the action manually. This validates proposal
   quality before any automation exists, and is the cheapest possible way to discover that the
   proposals are wrong.
10. **Only then**, a browser executor for `ADD_NOTE` / `CREATE_TASK` alone, gated through
    `evaluateExternalGate` with new `ExternalActionKindV1` values, idempotency keys, and preconditions
    re-checked at execution. Informativ-class actions remain unimplemented.

Steps 9 and 10 are deliberately separated. A proposal layer with no executor is safe and immediately
informative; the executor is the only step that can act on the world, and it should be reached last
and narrowest.

## MIGRATION_IMPACT

**None required.** All three new contracts are new collections; both field additions are optional and
default forward, matching the existing additive-state convention. No rewrite of `AssistantStateV1`,
no storage migration, no change to any existing record.

State growth is the real consideration: transcripts are large, and there is already a 32 MiB state
limit and a WATCH on size. Transcript bodies belong in private document storage with the event
holding a reference — the event index stays small, the text lives where large content already lives.

## SHARED_FILES_FUTURE

`service.ts` (routing + read models — already contended between executors), `contracts.ts` (two
additive fields), `executive-context.ts` (`subjectRef`), `vehicle-intelligence.ts`
(`matchCustomerToVehicles` reads needs), `commitments.ts` (transcript-sourced candidates), and a
future `apps/aion/server.mjs` dispatch case per action.

`service.ts` is already an ~11,000-line god object with a ~2,000-line `assistantPrompt`, and two
executors edit it concurrently. **Before this workstream is implemented, intent handlers should be
extracted out of `service.ts`** — otherwise this design lands as several thousand more lines in the
most contended file in the repository. That extraction is a shared architectural change and belongs
to whoever holds integrator authority, not to a feature branch.

## RISKS

1. **Wrong-customer attachment** — the most damaging failure. Mitigated by conservative states, no
   name-only merge, and storing unresolved events rather than guessing.
2. **Transcription error becoming durable preference** — mitigated by `extraction.ok`, segment
   citation, and hedged language creating questions rather than facts.
3. **Commitment inflation** — a follow-up queue full of things the Owner never promised trains the
   Owner to ignore it. Mitigated by candidates-not-commitments.
4. **Invented equipment** — mitigated by `unknown` never migrating into `whyMatches`.
5. **Automation retry duplication** — mitigated by idempotency keys.
6. **Autonomy creep** — routine trust must never escalate into `ELEVATED`. Structural, not policy.
7. **AION re-ingesting its own CRM notes** as fresh customer evidence — mitigated by `externalRef`.
8. **Recording legality** — capture stays out of scope until the Owner establishes the legal basis.
9. **State growth** — transcripts by reference, not inline.
10. **`service.ts` contention** — see above.

## QUESTIONS_FOR_LATER

1. What is the legal basis for call recording in the Owner's state, and who must be informed?
2. Is the Tekion customer ID reliably obtainable from the browser session? It is the only strong
   external identity signal in the design.
3. Should AION-written CRM notes be visibly attributed as machine-written to colleagues?
4. How long do customer needs stay valid without reconfirmation? Budget drifts; "non-hybrid" may not.
5. Which action types should become auto-approvable first, and after how much observed accuracy?
6. Does the dealership have a policy on AI-assisted CRM entry that constrains any of this?
7. What happens to derived facts when the Owner deletes a conversation — cascade, or orphan with
   provenance retained?
8. **Is a VoIP or business calling line acceptable to the dealership?** iOS cannot tap cellular call
   audio at all, so this single answer decides whether live call transcription is ever possible —
   it is a telephony decision, not an engineering one.
9. Should reverse matching ("who might want this Camry?") be proactive, given it could generate
   outreach pressure the Owner has not asked for?
