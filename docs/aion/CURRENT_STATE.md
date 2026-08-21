# Project AION — Current State

**This document is CURRENT, not historical.** It is the canonical starting point for any agent or
person picking up Project AION. Read it before doing anything; it is meant to be read in one sitting.

```
UPDATED_AT   2026-08-21T17:50:08Z
BASE_SHA     bdb0944886cc331f77a3b6c0ef6b0c711e73a999
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

### AION now starts itself

**Autonomy Kernel V3 is delivered and runtime-wired.** `AION-BUSINESS-DISCOVERY-RUNTIME-V1` gave it
an entry point, so the loop no longer waits for anyone to call it.

What runs today, without a prompt per step:

1. the Owner's four businesses register durably, with deterministic ids and no duplicates on restart;
2. each business AION cannot describe gets a discovery objective in the Owner's own framing;
3. the scheduler picks the highest-value eligible step across the whole portfolio;
4. a discovery step reads what is recorded and writes an artifact — known facts with provenance,
   unknowns marked blocking or not, hypotheses labelled as hypotheses, nothing invented;
5. verification reads that artifact back off disk; a claim without a file is not a completion;
6. the outcome and its business context go into the durable experience ledger and the telemetry rows;
7. the loop moves to the next business;
8. businesses that can only advance on something the Owner knows are **parked** with the exact
   questions attached, and the rest of the portfolio keeps going;
9. a restart resumes from disk without repeating completed work;
10. `autonomy.status`, `autonomy.start`, `autonomy.pause` and `autonomy.resume` are the whole
    client surface. None of them lets a caller name an objective, a provider, an authority or a piece
    of evidence — what runs comes from durable state the Owner authorized.

**Business Discovery Operator V1 is running and has learned nothing yet, which is the correct
result.** All four businesses returned `NEED_OWNER_INFORMATION`. AION recorded one fact about each —
that it is an Owner-controlled business — and four blocking questions it cannot answer for itself.
Writing an artifact is deliberately not the same as understanding a business, and `understandsBusiness`
is the function that refuses to confuse them.

### What AION needs from the Owner

The same four questions for each of Compassionate Choice, LocalFinds, Talk to Caleb and AIService Co:

1. What does this business actually do — what does it sell or deliver, and to whom?
2. Where does its revenue come from today, if any?
3. Which recurring work takes the most of the Owner's time?
4. What is currently blocking it from doing more of what works?

A fifth, non-blocking: are there legal, licensing or compliance prerequisites in play?

Until these are answered no opportunity across the portfolio can be ranked honestly, because every
value estimate would be built on an invented premise.

### Governance state

`AION-AUTONOMY-KERNEL-V1` and `V2` were authorized, never started, superseded, and their authority
records are now `REVOKED` through `Set-AionOwnerAuthorityState` on the Owner's instruction. `V3`'s
record stays `ACTIVE`. Note for the record: there is no `SUPERSEDED` authority state — the supported
set is `ACTIVE | SUSPENDED | REVOKED | EXPIRED` — so `REVOKED` is what "withdrawn" means here.

The kernel remains a **thin layer over primitives that already exist** — `owner-goal-intake.ts`,
`roadmap-dag.ts`, `roadmap-orchestrator.ts`, `roadmap-policy.ts`, `pre-action-effect-contract.ts`,
`provider-bridge.ts` — not a second framework beside them.

**Do not build**, unless a concrete blocker later demands it: a generic agent framework, a swarm,
weight-changing RL, a large knowledge graph, an elaborate speculative router, another
natural-language-parser hardening campaign, cross-worktree authority enrollment, or production
capability.

---

## AION is a multi-business portfolio operator

AION is **not** being built around one employer, one dealership, or one business. Daniel owns and
controls several businesses, brands and venture concepts, and AION's job is to help operate, compare,
grow and prioritise across all of them.

The conceptual model:

```
AION Business Operator
  -> Portfolio
     -> Business / Brand Workspace
        -> Objectives -> Tasks -> Opportunities -> Relationships
        -> Products / Services -> Experiments -> Metrics -> Memory -> Outcomes
```

Nothing in the autonomy system may be hard-coded around any single brand. Each business is a
distinct workspace under a generic portfolio model. **This is not an ERP and not a CRM** — for the
Autonomy Kernel, build only the minimum structure prioritisation and durable context actually
require. Detailed business operations belong to later capability layers.

### Business fact discipline — the rule that matters most here

The Owner has told us these businesses **exist** and are Owner-controlled. He has not told us what
they do.

**Do not invent** what any of them does, sells, or charges; who its customers are; its revenue,
products already sold, legal structure, workflows, software, pricing, business model, employees or
partners. Unknown business facts stay **UNKNOWN**, and the data model must let them stay unknown
rather than presenting a field somebody feels obliged to fill.

The correct first objective for a business AION knows nothing about is *discovery*:

> "Understand this business and identify the highest-value next actions."

AION must be able to hold and work that objective without filling in a single missing fact. Any
financial projection is an estimate, never a fact.

---

## The portfolio

### Owner-controlled businesses and brands

| business | status | what we have recorded about what it does |
|---|---|---|
| **Compassionate Choice** | ACTIVE | nothing yet — discovery first |
| **LocalFinds** | ACTIVE | nothing yet — discovery first |
| **Talk to Caleb** | ACTIVE | nothing yet — discovery first |
| **AIService Co** | ACTIVE | nothing yet — discovery first |

**Compassionate Choice is our business.** It is not Daniel's employer, and must never be described
as one.

For AIService Co, "AI-assisted business services" is a plausible direction and **a hypothesis, not a
description**. It does not become a fact until the Owner says so.

The first objective for each is the same: understand the actual business model, current products or
services, customers, workflows, revenue-generating work, repetitive work, bottlenecks, useful
automation, opportunities to increase revenue or reduce workload, and any legal or operational
prerequisites. Discover, then operate.

### Active portfolio directions

**Product development and sales.** Identify a problem or opportunity → research the market → define
a product hypothesis → identify prerequisites → prototype → validate demand → estimate unit
economics → launch a bounded test → collect actual outcomes → improve, stop or scale. Physical,
digital, software, service or bundled — do not assume which until it is specified.

**Resale / arbitrage / opportunity engine.**

```
find -> prerequisites, permits, compliance discovery -> sold comps -> demand
     -> acquisition cost -> fees -> shipping and travel -> holding cost -> risk
     -> expected profit -> ROI -> expected days-to-sell -> BUY / MAYBE / PASS
     -> actual outcome -> learning
```

Candidate categories — **candidates, not policy**: tools; automotive parts and equipment;
commercial equipment; item-level liquidation and overstock; local-to-national arbitrage;
consignment; business liquidation brokerage. Previously discussed profit and ROI thresholds
(roughly $100–$200 per item, roughly 25–35% ROI) are **hypotheses to be re-derived from actual
results**, not constants to schedule against. Learning must be objective: purchase cost → expenses →
sale price → days to sell → actual profit.

**Local-business operator services.** Customer reactivation; missed-call recovery; quote follow-up;
appointment setting; lead follow-up; executive-assistant and virtual-employee workflows; business
intelligence; opportunity research; government-contract and opportunity discovery.

Positioning: **do not sell "AI."** Sell measurable outcomes — recovered customers, booked
appointments, recovered missed calls, estimates followed up, opportunities surfaced, hours saved.

**General business and income discovery.** AION may evaluate entirely new ventures, scored on
expected profit or value, probability of success, capital required, Owner time required, time to
first revenue, recurring revenue potential, automation potential, legal and compliance burden,
market demand, competition, downside risk, reversibility, evidence quality, and strategic fit with
existing assets and brands. **Estimated financial projections are not facts.**

### AION autonomy and self-improvement

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

## Cross-business prioritisation is a core requirement

AION must eventually answer: **"What is the highest-value thing we can safely work on across all of
our businesses right now?"**

The scheduler weighs explicit Owner priority; urgency; expected business or user value;
**confidence in that expected value**; time to useful outcome; dependency readiness; capital or
spend required; Owner time required; capability availability; blockers; freshness; retry and failure
history; experiment value and information gain; reversibility; and whether other work can continue
while one branch is gated.

The global rule still holds — real user or business value beats a proven capability blocker, which
beats a measured reliability defect, which beats speculative infrastructure. **It does not mean
"choose the largest dollar estimate."** Confidence and evidence quality are inputs; an unevidenced
large number must not outrank an evidenced small one, or AION will chase fiction.

---

## Generic relationship memory

AION keeps its own portable Relationship / Contact Memory. It is **not** a dealership CRM and not
tied to any vendor:

```
AION Relationship Memory -> optional CRMAdapter -> whatever system a particular business uses
```

The abstraction is kept because it is good architecture. **No CRM integration gets built until a
real business workflow needs one**, and none does today.

---

## DEFERRED / NOT CURRENTLY ACTIVE

Daniel is no longer working in dealership sales. These are historical and deferred, not deleted, and
return only if the Owner explicitly reactivates them:

- dealership relationship assistant, and dealership texting and calling
- Tekion adapter and Tekion APC/API integration
- dealership inventory matching
- BDC, coworker, manager and service recent-contact workflows

The generic ideas they produced survive them: the Relationship Memory above, the `CRMAdapter` shape,
the communications-gateway shape, and the "check recent contact before outreach" discipline, which is
sound for any business that ever contacts a person.

Prior handoffs and history describing this work are intact and are not to be rewritten.

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
| useful multi-business shadow operator across the portfolio | ~45–70 |
| relationship memory, own contact timeline, transcription | ~70–105 |
| supervised real communications and external writes (given provider access) | ~100–160 |
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

1. real multi-business shadow work across the portfolio
2. business discovery for Compassionate Choice, LocalFinds, Talk to Caleb and AIService Co — what
   they actually are, before anything is built for them
3. whichever of **Resale Opportunity Engine V1** or **Business Opportunity / Research Operator V1**
   gives the fastest real-world shadow feedback
4. AION Relationship / Contact Memory and a customer timeline, generic and vendor-free
5. communications and transcription gateway
6. real outcome measurement against verified results
7. supervised outward communication, once a real workflow needs it and the evidence supports it
8. bounded autonomous promotion

A CRM adapter appears in this list only when a real business workflow needs one, and it will be
generic when it does. There is no Tekion step.

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
