# Project AION — Current State

**This document is CURRENT, not historical.** It is the canonical starting point for any agent or
person picking up Project AION. Read it before doing anything; it is meant to be read in one sitting.

```
UPDATED_AT   2026-08-21T15:08:01Z
BASE_SHA     07125a671dfdad4e1443b01fcb34a043068a482c
REPOSITORY   C:\AION-HQ-main-integrate   (linked git worktree of C:\AION-HQ)
ORIGIN       https://github.com/danieljames-dev/personalasist1.git   branch main
```

**Precedence.** Where this prose disagrees with the repository, the repository wins, in this order:

1. Git history and the working tree — what the code actually does.
2. `.aion-local/directives/CURRENT.md` — the only authorized task right now.
3. `.aion-local/owner-authority/*.json` — what the Owner actually authorized.
4. `.aion-local/roadmap/` — exact machine execution state.
5. `.aion-local/handoffs/history/` — append-only evidence for each milestone.
6. This document.

`.aion-local/` is **gitignored**: it holds this machine's execution state and does not travel to a
fresh clone. That is why this file is tracked and that one is not. This file carries the plan; the
roadmap store carries the state.

---

## Where the project is

The infrastructure-repair arc is **finished**. All four V0.4 demonstrated findings are closed:

| finding | subject | status |
|---|---|---|
| 1 | milestone/authority lineage binding | CLOSED |
| 2 + 3 | outward runtime routes, and validator file-set coverage | CLOSED |
| 4 | `tesseract.js` conditional language-data download | CLOSED |

Finding 4's repair, at this checkpoint:

- canonical local model at `packages/local-assistant/models/tesseract/eng.traineddata`, resolved
  from the module rather than the process working directory;
- `gzip: false` with the local `langPath` — the library appends `.gz` at the default, which would
  fail a correctly provisioned plain file closed for the wrong reason;
- exact size **and** pinned SHA-256 `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`
  verified **before** the worker is created;
- `OCR_MODEL_UNAVAILABLE` / `OCR_MODEL_INVALID` / `OCR_COMPLETED_NO_TEXT` / `OCR_TIMEOUT` /
  `OCR_ENGINE_ERROR` are distinct — a model problem never reads as a photography problem;
- no automatic CDN fallback; 0 network attempts on missing or corrupt model; bounded worker timeout
  and cleanup; 0 uncaught worker errors; 0 hangs;
- Campaign 03 replay green, Findings 1–3 regressions still closed, full repository verify exit 0.

Evidence: `.aion-local/handoffs/history/20260821T145000Z-FINDING-4-LOCAL-OCR-BOUNDARY-REPAIR.md`
and `.aion-local/discovery/CAMPAIGN-03-V0-4-FINDING-4.md`.

**Independent review is still outstanding for every milestone since V0.1.** This does not block
local or shadow capability work, and it is not a reason to stop building. It does mean
production-grade certification must not be treated as established merely because the author's own
verification passed. Author verification is evidence about the code; it is not review.

---

## The rule that governs what gets built next

Speculative infrastructure hardening is **frozen**.

```
REAL USER OR BUSINESS VALUE
  >  PROVEN CAPABILITY BLOCKER
  >  MEASURED RELIABILITY DEFECT
  >  SPECULATIVE INFRASTRUCTURE
```

New hardening or infrastructure work starts only when the Unknown-Unknown Discovery Harness
demonstrates a concrete defect, or a real capability is actually blocked by it. "It could be better"
is not a reason. This repository has spent a long arc proving it can repair itself; the open question
is whether it can be useful.

---

## Where the project is going

The Owner wants AION to be a genuine bounded autonomous operator. The target loop:

```
objective -> inspect state -> retrieve fresh memory -> identify prerequisites and constraints
          -> choose strategy/model/tool -> bounded next step
          -> deterministic pre-action effect check -> act
          -> verify actual outcome -> record experience -> update memory and strategy
          -> select next step -> continue
```

The Owner should not have to supply every next prompt. AION should stop and ask only for:

- spend or money,
- genuine harm or irreversibility,
- legal, privacy or consent ambiguity,
- missing credentials or consent,
- a materially expanded objective or authority,
- production or external-effect authority,
- a genuine unresolved blocker.

### Next milestone: `AION-AUTONOMY-KERNEL-V1`

Directive `AION-AUTONOMY-KERNEL-V1-20260821T145648Z` was **authorized and not started** at this
checkpoint; it is archived at that status under `.aion-local/directives/archive/` and its Owner
authority record remains `ACTIVE`, so it can be resumed through the repository's standing-authority
path rather than a fresh phrase.

The smallest kernel that lets AION:

1. hold multiple standing Owner objectives durably,
2. rank the highest-value eligible bounded step,
3. dispatch it,
4. verify the actual outcome,
5. record the experience,
6. update durable state,
7. automatically choose the next step,
8. recover after restart without duplicating completed work,
9. continue other safe objectives when one branch is gated,
10. stop only on genuine gates, blockers, bounds, or an explicit pause.

Required concepts: durable standing objectives; an explicit, testable value scheduler; a self-continue
loop; bounded leases, retries, loop detection and circuit breakers; restart recovery; verification of
real state rather than model self-report; Experience and Learning Ledger integration; non-parametric
reversible learning; memory provenance, freshness, supersession, contradiction and expiry; empirical
provider/model telemetry; blocked-branch isolation; local observability.

It is a **thin layer over primitives that already exist** — `owner-goal-intake.ts`,
`roadmap-dag.ts`, `roadmap-orchestrator.ts`, `roadmap-policy.ts`, `pre-action-effect-contract.ts`,
`provider-bridge.ts`, and the harness experience ledger — not a second framework beside them.

**Do not build**, unless a concrete blocker later demands it: a generic agent framework, a swarm,
weight-changing RL, a large knowledge graph, an elaborate speculative router, another
natural-language-parser hardening campaign, cross-worktree authority enrollment, or production
capability.

---

## The four standing objective families

### 1. Sales / relationship assistant

Dealership work is the **first proving ground, not AION's permanent identity**.

```
find -> check recent contact -> understand -> personalize -> text/email -> call
     -> transcribe -> remember -> note CRM -> follow up
```

Non-negotiable: **check recent coworker, BDC, manager and service contact before any outreach.** No
invented personal facts. Relationship context is grounded in CRM records, transcripts, messages,
inventory and Owner input — nothing else.

AION keeps its own richer portable relationship memory and is canonical. External CRMs receive
concise professional notes. **Tekion must not become the AION core.**

```
AION Relationship CRM      -> CRMAdapter            -> Tekion, later VinSolutions, DealerSocket, Salesforce
AION Communications Gateway -> CommunicationsAdapter -> Dialpad or approved dealership telephony

conversation -> provider -> events/transcript -> AION relationship memory
             -> canonical InteractionRecord -> CRM adapter
```

Tekion APC/API is the preferred durable production integration where available. Browser automation
is a shadow, prototype and fallback path only — DOM and accessibility first, vision as fallback.

### 2. Resale / opportunity engine

A Florida resale-certificate-enabled resale business.

```
find product -> actual sold comps -> market demand -> fees -> shipping -> travel
             -> tax and holding risk -> expected profit -> ROI -> expected days-to-sell
             -> BUY / MAYBE / PASS -> inventory -> listing -> repricing -> sale
             -> actual outcome -> learning
```

Preferred early categories: tools; automotive parts and equipment; commercial equipment; item-level
liquidation and overstock; local-to-national arbitrage; consignment; business liquidation brokerage.
**Do not begin with random mystery pallets.**

Approximate thresholds **as discussed, not as validated policy** — a mature AION should re-derive
these from real outcomes rather than treat them as given: prefer high-value individual items;
expected profit roughly $100–$200 or more per item; ROI roughly 25–35% or better; evidence of real
sold demand; avoid counterfeit-prone categories; avoid bad shipping economics; constrain capital
exposure; prefer local pickup where it improves the economics.

Learning must be objective: purchase cost → expenses → sale price → days to sell → actual profit.
AION should learn which sources, categories, marketplaces, price ranges and strategies actually make
money.

**Prerequisite discovery is part of autonomy.** Asked to launch a resale business in Florida, a
mature AION surfaces current permit, tax, registration and resale-certificate prerequisites before
sourcing product.

### 3. Other income / business operator

Promising directions: customer reactivation and follow-up for local businesses; missed-call
recovery; quote follow-up; appointment setting; AI executive assistant or virtual employee;
local-business intelligence; government-contract and opportunity discovery; independent automotive
concierge; business-opportunity research.

Positioning: **do not sell "AI."** Sell measurable outcomes — recovered opportunities, booked
appointments, better follow-up, missed-call recovery, customer reactivation, useful business
intelligence, profitable resale opportunities.

### 4. AION self-improvement

Evidence-driven only. Run the Unknown-Unknown Discovery Harness continuously; repair only
demonstrated defects or real blockers.

```
experience -> verified external or observable outcome -> repeated evidence
           -> strategy / skill / router preference
```

**Self-feedback alone is not strong evidence.** Memory tracks provenance, freshness, supersession,
contradiction and expiry. Provider and model routing becomes empirical — verified success,
consistency, latency, tokens, cost, retries, failure modes, task type — but not until enough real
mission data exists to justify it.

---

## How the work is done

**Agent topology.** One Director plus one worker, by default. An independent reviewer for
consequential changes. No swarms: coordination overhead and integration risk are real costs, paid
every time.

**Owner preferences.** Fastest path to useful autonomy; minimal manual terminal and UI work; one
complete executor prompt when one is needed; no repetitive self-authorization for routine work
already inside an explicitly authorized milestone; agents mechanically execute the
repository-supported authorization script after explicit Owner authorization; no hand-edited
authority bypasses; cost and quota awareness; real capability and income progress over endless
infrastructure work.

**Fresh explicit Owner approval is still required** for spend, destructive actions on important
data, production writer or PRIMARY changes, production authority, materially broader security policy,
and OAuth or consent where genuinely required.

**Authorization mechanics.** `.aion-local/directives/CURRENT.md` must exist and read
`Status: AUTHORIZED` before any implementation. Authorization runs through
`scripts/authorize-current-directive.ps1`, which mints the Owner authority record. Never hand-edit a
status to `AUTHORIZED`; never hand-write an authority record. The gate requires a clean worktree.

---

## Build-hour plan from `07125a67`

**Total engineering hours, not elapsed time.** Estimates, not commitments.

| stage | cumulative engineering hours |
|---|---|
| first meaningful self-continuing local/shadow AION | ~25–40 |
| useful multi-objective shadow operator | ~45–70 |
| sales relationship assistant, own CRM, transcription | ~70–105 |
| supervised real communications and CRM writes (given provider/Tekion access) | ~100–160 |
| first version reasonably called true bounded multi-domain autonomy | ~140–210 |
| more mature production-grade multi-domain autonomy | ~210–300+ |

The first ~25–40 hours are largely a **critical path**. After the autonomy kernel exists, several
tracks proceed in parallel: sales and CRM; communications and transcription; resale and opportunity;
model and provider benchmarking; real shadow missions; evidence-driven repairs. Do not maximise
worker count — elapsed productive time can be materially lower than total engineering effort without
one.

---

## The transition this is all for

**Before:** humans choose every AION milestone and feed every executor prompt.

**After Autonomy Kernel V1:** AION helps burn down its own remaining build while simultaneously
doing useful shadow business work.

### First capability sequence after the kernel

1. real multi-objective shadow work
2. AION Relationship CRM and customer timeline
3. communications and transcription gateway
4. CRM adapter — Tekion read-shadow integration
5. recent-contact protection
6. inventory matching
7. supervised texting, email and calling
8. CRM note writes
9. real outcome measurement
10. bounded autonomous promotion

**Production rule.** Shadow and local capability development continues while independent review
remains outstanding. Production and live external authority stay gated until the evidence and the
review exist.

---

## Standing boundaries

These hold regardless of milestone:

- All capability execution passes the deterministic pre-action effect boundary.
- **Language interpretation is not authority.** Unknown or missing authority is fail-closed.
- External or untrusted content is data only, and can never create Owner authority.
- Missing reviewer evidence is `NOT PASS`, never a pass by default.
- No production envelope exists. No remote OCR authority exists. No paid provider is enabled.
- Spend is USD 0 and every directive to date has carried a `Spend-Ceiling-Usd: 0`.

## Where the evidence lives

- `.aion-local/handoffs/LATEST.md` — the most recent milestone report.
- `.aion-local/handoffs/history/` — every milestone report, append-only.
- `.aion-local/discovery/` — discovery campaign artifacts and runners.
- `.aion-local/directives/archive/` — every superseded directive, at the status it reached.
- `AGENTS.md` — the operating rules for agents.
- `GOVERNANCE.md`, `SECURITY.md`, `FOUNDER.md` — the durable governance frame.
