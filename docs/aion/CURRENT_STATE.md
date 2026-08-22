# Project AION — Current State

**This document is CURRENT, not historical.** It is the canonical starting point for any agent or
person picking up Project AION. Read it before doing anything; it is meant to be read in one sitting.

```
UPDATED_AT   2026-08-21T20:05:00Z
BASE_SHA     __NEW_SHA__
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

### And the rule for evidence

**When authoritative evidence contradicts an earlier summary: stop, preserve both sources, mark the
conflict, ask the smallest high-value question, and do not invent a resolution.**

This is not caution for its own sake. A Business Evidence and Revenue Discovery build was specified
on 2026-08-21 and **stopped before a line was written**, because source discovery contradicted the
premise it had been specified on. Building it would have recorded a contradicted claim as a permanent
`KnownFact` with provenance attached, and everything downstream would have inherited it as settled.
Stopping was the system working.

A corollary worth keeping: **an artifact is not knowledge.** Writing a file about a business does not
mean anything is known about it, and `understandsBusiness` exists to refuse that confusion.

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

The registration question is **answered**: the certificate is issued, covering Hardee, Highlands,
Hillsborough, Manatee and Polk. Two remain.

1. **Is LakelandFinds the same business as LocalFinds?** Assets exist under one name and the
   portfolio lists the other. They have not been merged, and one sentence settles it.
2. **What is Daniel's relationship and authority with Compassionate Choice Home Services LLC?** The
   documents name Kristina Leach as owner and founder. "Our business" is not enough to infer an
   ownership share, a management role or any control right, and AION will not infer one. This governs
   what AION may do on the business's behalf, so it matters before any outward step.

Minor, and cheap to supply when convenient: the certificate's effective date, and the same
what-does-it-sell / where-does-revenue-come-from questions for LocalFinds, Talk to Caleb and
AIService Co once identity is settled.

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

A discovery pass on 2026-08-21 located real source material for some of these. What follows is what
the **evidence** supports, with its date. Documented-as-of-a-date is not current truth.

| business | status | evidence state |
|---|---|---|
| **Compassionate Choice** | ACTIVE | **registered and revenue-ready in five counties**; two conflicts remain |
| **Talk to Caleb** | ACTIVE | real content operation evidenced; business model UNKNOWN |
| **AIService Co** | ACTIVE | project and tooling assets evidenced; business model UNKNOWN |
| **LocalFinds** | ACTIVE | no corpus under that name; identity question open |

**Compassionate Choice — what the documents establish** (source dated 2026-05-17; corpus location
recorded in the checkpoint handoff, on an offline drive, not in this repository):

Non-medical homemaker and companion care under Florida **§400.509 / FAC 59A-8.025**, Lakeland and
Polk County. Documented allowed activity: companionship, housekeeping, meal preparation, laundry,
shopping, errands, casual cosmetic assistance, steadying while walking. Documented **excluded**
hands-on personal care: bathing, feeding, dressing, toileting, transferring, medication.

**Legal scope and business policy are different things and are not merged here.** Transportation is
documented as *legally allowed* under the scope **and** declined by an internal business decision on
liability grounds. Also documented: the registration number must appear in advertising once
applicable; Level 2 background screening; a W-2 rather than 1099 employment model; local business tax
receipt context. All of it is subject to the source date and needs re-verification before being
treated as current.

### Registration and geographic authority — KNOWN

**The AHCA §400.509 Certificate of Registration has been issued.** Source: Owner clarification,
2026-08-21. This resolves the conflict this document previously carried, and the superseded sources
are kept in history rather than deleted.

**Current service area — KNOWN, and it is a hard boundary:**

| county | authority |
|---|---|
| Hardee, Highlands, Hillsborough, Manatee, **Polk** | named on the issued certificate |

Anywhere else is **PENDING_FORMAL_APPROVAL**. Additional areas are being pursued, but that expansion
is **not yet formalized in writing** and confers no authority today.

AION **may**: research possible expansion markets in shadow, hold a pending-expansion objective,
track the approval, and compare expansion opportunities as hypotheses.

AION **may not**: represent Compassionate Choice as authorized statewide; advertise outside the five
counties; accept a client, schedule a service, or model actionable revenue outside them; or convert
the pending expansion into active authority without direct written evidence. When formal AHCA
documentation arrives it is ingested as new official evidence and the five-county certificate is kept
as historical evidence — the gate lifts only for areas actually approved.

**Sources, ordered by weight.** The issued certificate and the Owner's current clarification govern
present operating decisions. Two earlier sources are superseded for that purpose and preserved as
history:

- the **2026-05-17 regulatory profile**, which said the certificate must be issued before the LLC
  could market or accept paying clients, and which anticipated designating a *single* health service
  planning district. Both were true of the plan at the time; the issued certificate supersedes them.
- any **July report of the registration being "cleared"**, which is secondary and not sufficient
  current authority on its own.

**One accuracy note, recorded rather than smoothed over.** The Owner referred to a 7 July
regulatory-profile note saying registration was "cleared STATEWIDE". **AION could not locate such a
note.** The corpus contains no statewide claim at all — its only use of the word concerns FDLE
background-screening tiers. What AION did locate was a **9 July machine-transcribed conversation**
containing approximately "AHCA Reg number cleared", with **no geographic claim in it**. Either way
the conclusion is the same and is the Owner's: any statewide reading is historical, secondary, and
superseded by the certificate. The discrepancy is recorded because a source AION never found should
not be written down as though it had been.

**Revenue readiness:** READY_FOR_REVENUE_DISCOVERY inside the five counties. Revenue work should
prioritise those markets and is **not** blocked by the pending expansion. Anything outside them is
FUTURE_EXPANSION / HYPOTHESIS / NOT CURRENTLY ACTIONABLE.

Still unknown here: the certificate's effective date, and its number (which is not recorded in this
document by policy).

**Two conflicts remain open:**

1. **Ownership — UNRESOLVED.** Documents name **Kristina Leach** as owner and founder. The Owner
   calls it "our business." No share, authority, partnership, employment or control right is inferred.
2. **Legal name against brand name — UNRESOLVED.** Documents name **Compassionate Choice Home
   Services LLC** and record an open DBA question about the shorter consumer-facing name.

**Unknown for Compassionate Choice** and not to be invented: the certificate effective date,
insurance status, home-based or commercial office, client count, pricing,
revenue, margins, staffing, capacity, acquisition channels, referral relationships, utilisation,
retention, operating hours, payroll structure in practice.

**LocalFinds and LakelandFinds have not been merged.** Assets exist under *LakelandFinds* — logo,
covers, two lead files — sitting inside an AIService Co folder. Same brand, renamed brand,
predecessor, AIService Co product or a separate project all remain possible. Merging them on a name
resemblance would create a false identity that everything downstream would inherit.

For AIService Co, "AI-assisted business services" remains **a hypothesis, not a description**.

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

## Build-hour plan

**Total engineering hours, not elapsed time. Estimates, not commitments.**

From `f21035c`, to a first revenue-directed autonomous experiment:

**~20–30 focused hours.** The registration is issued, so the launch-completion branch — which would
have cost roughly 35–50 — does not apply. Asking before building was worth about fifteen hours and a
different month of work.

Longer horizons, unchanged in shape: supervised outward actions ~60–90; true bounded multi-domain
autonomy ~110–170. After the kernel, tracks proceed in parallel — business evidence, communications
and transcription, resale and opportunity, provider benchmarking, real shadow missions. Do not
maximise worker count; elapsed productive time can be materially lower than total effort without it.

## The transition this is all for

**Before:** humans choose every AION milestone and feed every executor prompt.

**After Autonomy Kernel V1:** AION helps burn down its own remaining build while simultaneously
doing useful shadow business work.

### First capability sequence after the kernel

1. **Business Evidence + Owner Answer Intake** — `NOT_STARTED`. Dry-run before import, source
   provenance and timestamp, conflict preservation, supersession, idempotent re-import, workspace
   isolation, KNOWN / UNKNOWN / HYPOTHESIS separation, private-source handling, no silent overwrite,
   and no permanent `KnownFact` from contradicted evidence. Architecture — generalise the
   `career-evidence` primitives or build a sibling — is deliberately **not yet decided**.
2. ingest the located Compassionate Choice corpus through it, recording the conflicts *as* conflicts
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
