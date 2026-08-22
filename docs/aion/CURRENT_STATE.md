# Project AION — Current State

**This document is CURRENT, not historical.** It is the canonical starting point for any agent or
person picking up Project AION. Read it before doing anything; it is meant to be read in one sitting.

```
UPDATED_AT   2026-08-22T05:10:00Z
BASE_SHA     968e2b3dd018e98a28c41d62a53f15f68be1c525
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

Both earlier questions are **closed**: the certificate is issued, and LakelandFinds is LocalFinds.
What is open now is the same shape for three businesses, and AION has recorded the questions durably
rather than asking repeatedly.

For **LocalFinds**, **Talk to Caleb** and **AIService Co**, four questions each:

1. What does it actually do — what does it sell or deliver, and to whom?
2. Where does its revenue come from today, if any?
3. Which recurring work takes the most of your time?
4. What is currently blocking it from doing more of what works?

**Not asked, and deliberately not gated on:** Daniel's exact legal title with Compassionate Choice
Home Services LLC. Kristina Leach is the official owner of record; Daniel has authorized AION to work
the business locally and in shadow, and that is sufficient for everything currently in scope. It
becomes a question only if a real external action needs proof of authority.

For **Compassionate Choice**, revenue discovery has surfaced two more, and these are the ones that
unblock the most:

1. Is the business currently accepting new clients, and is there any companion capacity today?
   This decides whether the first experiment is demand-side or supply-side — it changes the whole plan.
2. Does the business currently carry general liability insurance? This decides whether any
   client-facing validation can proceed at all.

Alongside them sits a capability decision rather than a fact: whether to authorize a **read-only
public web research route**. Without one, the three highest-value revenue questions cannot be asked
by AION at all, and no candidate can be priced or ranked.

Minor, whenever convenient: a machine-readable copy of the AHCA certificate, which would upgrade the
registration facts from an Owner relay to the document itself.

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

### Business evidence is a layer now, not prose

**Business Evidence and Owner Intake V1 is built.** Business facts live in a durable per-workspace
store with source, date and state instead of in sentences here. Two rules are the model:

> **An artifact is not knowledge.** **A summary is never stronger than its source.**

**Epistemic states:** `KNOWN`, `UNKNOWN`, `HYPOTHESIS`, `CONFLICTED`, `SUPERSEDED`, `UNREAD_SOURCE`.
**Source classes, ranked and never flattened:** official regulatory, official local-government, Owner
statement, business document, website, transcript, ASR transcript, research, derived summary. Only
the first four can carry a fact alone; the rest corroborate. A certificate outranks a machine
transcript *structurally*, which is why the July "reg number cleared" recording can be kept without
it ever governing anything.

Supersession is a state, not a deletion. The May "registration pending" record is still there, marked
superseded by the certificate — which is how AION can explain how its picture changed rather than
just asserting the current version.

**Owner Answer Intake** works, with a real trust boundary: the Owner sends a workspace, a question,
an answer and subject/category/value claims. Nothing else is honoured. State, confidence, source
class, supersession target and authority id are all decided server-side, and anything else a caller
sends is reported back as ignored. App verbs: `autonomy.status`, `.start`, `.pause`, `.resume`,
`.answer` — a closed list.

### What AION knows about Compassionate Choice

Recorded with provenance and dates, from the Owner's reading of the issued certificate and the
May regulatory profile:

- **Compassionate Choice LLC** — current official name. The longer earlier form is superseded.
- **REGISTERED**, AHCA §400.509, effective **2026-06-26**, expiring **2028-06-25**.
- Provider type **Homemaker and Companion Services**; hands-on personal care prohibited.
- Service area **Hardee, Highlands, Hillsborough, Manatee, Polk** — a hard boundary.
- **Kristina Diane Leach** is the official owner and administrator of record. Separate from AION's
  operational authorization, which Daniel has given for local and shadow work.
- Legal scope and business policy stay separate records: transportation is *legally permitted* and
  *declined by business decision*.
- W-2 rather than 1099; Level 2 background screening; the registration number must appear in
  advertising.

**`READY_FOR_REVENUE_DISCOVERY`** inside those five counties. Expansion elsewhere is a `HYPOTHESIS`
and confers nothing.

**One gap recorded honestly.** The certificate PDFs are located on an offline drive and AION **cannot
read them** — no PDF text extraction is available here. They are registered as `UNREAD_SOURCE`, so
what AION holds is the Owner relaying an official document, which is strong but is not the document.
A readable copy would outrank the relay automatically.

### The other three

| business | state |
|---|---|
| **LocalFinds** | identity resolved — **LakelandFinds is a legacy alias**, one workspace, question closed and it stays closed |
| **Talk to Caleb** | a real content operation exists; monetisation `UNKNOWN` |
| **AIService Co** | project and tooling assets exist; offers `UNKNOWN` |

All three are `NEEDS_OWNER_INFORMATION` — not blocked, just waiting on answers AION cannot invent.
Assets prove a name was used and a thing was made. They prove nothing about a business model.

### Isolation

Evidence is stored per workspace and read per workspace, so one business's records cannot be read as
another's and an unknown workspace returns nothing. What crosses between businesses is a **minimized
summary** — readiness, counts, information-gain value — with no claim text, value or source reference
in it. Tests pin the field list, so a leak cannot be added quietly.


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

The certificate's effective and expiry dates are now **KNOWN** — 2026-06-26 to 2028-06-25. Its
registration number is deliberately **not** recorded in this document; it lives in the evidence store,
which is gitignored.

**Two questions this document once carried as open conflicts are settled**, and settled in the
evidence store rather than here:

1. **Ownership.** **Kristina Diane Leach** is the official owner and administrator of record. Daniel
   has authorized AION's local and shadow work on the business, which is a separate thing and is
   sufficient for everything in scope. No share, partnership, employment or control right is inferred
   for anyone, and Daniel's exact legal title is not asked and does not gate this work.
2. **Legal name against brand name.** **Compassionate Choice LLC** is the current official name; the
   longer earlier form is held as **SUPERSEDED**, not deleted, so the change is explainable.

**Unknown for Compassionate Choice** and not to be invented: insurance status, home-based or
commercial office, client count, pricing, revenue, margins, staffing, capacity, acquisition channels,
referral relationships, utilisation, retention, operating hours, payroll structure in practice.

**LocalFinds and LakelandFinds are one business** — the Owner closed this, and it stays closed.
LakelandFinds is a legacy alias. The assets found under that name — logo, covers, two lead files,
sitting inside an AIService Co folder — belong to the single LocalFinds workspace.

For AIService Co, "AI-assisted business services" remains **a hypothesis, not a description**.

### Revenue discovery is an operator, and it currently refuses to rank

**Revenue Discovery Operator V1 is built**, and the most important thing about it is what it does
when it does not know: it says so. Run today against everything AION holds on Compassionate Choice,
it produces four candidate revenue models, scores every one of them at **0**, and reports
`rankable: false` — *"no candidate carries any evidence, so any ordering would come from whoever
wrote the hypotheses rather than from the world."* That is the correct output, not a gap in it.

Four design decisions carry that behaviour, and they are worth knowing before changing anything here:

- **A bare number is unrepresentable.** Every money and quantity figure carries a state and a written
  basis, and the constructor throws without them. An `UNKNOWN` figure that also carries a value is
  rejected, as is a half-open or backwards range, a bound that is absent rather than null, and a
  state outside the declared set. There is one construction path, and the Director's verifier
  re-runs it on every figure it reads back from disk — because serialising to JSON and reading it
  again is otherwise a way around the whole contract.
- **Evidence quality is derived, and a claim can only lower it.** A candidate's own
  `evidenceQuality` adjective is a ceiling, never an input: the quality actually used comes from what
  the candidate *cites*. It is applied as a multiplier **after** the weighted score, so no strength
  elsewhere compensates for having no evidence, and `NONE` is 0.
- **A citation has to resolve, and to the right kind of thing.** References are checked against the
  ids the evidence and research stores really hold — a candidate citing its own invented id is
  unevidenced, because self-consistency is not traceability. Each reference carries what it is
  evidence *of* (`CAPABILITY`, `DEMAND`, `PRICE`, `COST`, `CAPITAL`, `OWNER_TIME`,
  `WORKER_HOURS`, `TIME_TO_REVENUE`), and each figure names the kinds that could support it. A
  registration certificate cannot evidence a price, a caregiver wage cannot evidence what a business
  costs to start, and a gross margin needs both sides because it is one divided by the other.
- **Magnitude is not a lever.** A figure scores for being traceable, not for being flattering.
  Nothing verifies a number against the source it names, so an invented $0 capital requirement citing
  a real quote scores exactly what an honest $500–$900 reading of that same quote scores. Rewarding
  the smaller number would only reward whoever was willing to write it.
- **Unit economics return `null` and name what is missing** rather than defaulting. Today the four
  missing inputs are bill rate, caregiver wage, payroll burden and cancellation rate. Ranges pair
  worst-with-worst, so the pessimistic end is genuinely pessimistic.
- **Structure is modelled where data is absent — with its assumptions named.** The same billable
  hours arranged as five scattered one-hour visits versus one five-hour block move utilisation from
  **65.9% to 90.6%**, and ten clients on that shape need about **1.8 caregivers**. Those percentages
  are *not* findings about this business: they rest on an assumed 25 minutes of travel and 6 minutes
  of admin per visit, travel treated as paid, and an assumed 30-hour caregiver week — none of which
  anyone has measured. Only the **direction** survives any plausible substitution, and that direction
  is the useful part: fragmenting a week costs utilisation, and hiring becomes the constraint before
  demand does. The operator now emits those assumptions alongside every number that depends on them,
  because a reader who cannot see them cannot tell an assumption from an observation.

**The capability blocker is closed in code, and waits on authority.** `apps/aion/outward-effect-guard.mjs` had declared
`research.fetch` since Findings 2 and 3 — "governed public-web fetch; read-only externally but still
leaves the machine" — and left it `REQUIRES_INTEGRATION` with no authorizer, while
`apps/aion/research-fetch.mjs` carried a careful implementation that had never run. What was missing
was the join. `research-activation.mjs` supplies it, and `research.fetch` moves from
`TECHNICALLY_DISABLED` to `GATED` only when an authorizer that consults the real effect gate is
registered. A runtime given no Owner authority still has routes that refuse.

**Read-only is structural, not promised.** The Director's port has exactly two verbs — `search` and
`fetchPublic` — and no method, header, cookie, credential, body or socket target is expressible
anywhere on that surface. A POST cannot be written down. Both capabilities are registered as
`EXTERNAL_SEND` with `spend: NONE` and no permission that could change anything on the far side, and
`authorizeEffect` runs immediately before every call, so a revoked envelope stops the next fetch
rather than the next restart.

**What it can reach, proven live:** Florida Statutes §400.509, BLS occupational wage tables, and
public Care.com pages — all without an account. What it refuses, proven against a listening local
server: loopback, RFC1918, link-local, cloud metadata, unique-local, IPv4-mapped IPv6 in both
spellings, single-label hosts, URL credentials, and every scheme but http(s). Redirects are
revalidated at each hop and the connection is pinned to the addresses that were validated, which is
what closes DNS rebinding.

**Search is the half that does not work, and it says so.** There is no zero-cost search provider
available here: `SearxngSearchProviderV1` needs an instance the Owner runs, and the free
DuckDuckGo HTML endpoint serves an anti-bot challenge after a few automated queries. So `search`
refuses with a named dependency rather than returning an empty list — reporting "the market has no
data" when nobody was asked is the failure this milestone is least allowed to commit. Research
proceeds by **seeded fetch** instead, which is what `PublicUrlResearchProviderV1` was written for:
"a search API being unavailable must not mean research is unavailable." A seed is a location, never
a fact. A seed that has moved or 404s produces no record at all — the fetch refuses a non-OK status —
so the mission reports it as a refusal rather than storing an error page as evidence.

**What is reachable today, stated exactly.** The capability is built, gated and proven — but the
Command Center cannot currently turn it on, and that is deliberate rather than an oversight. Every
research call needs an Owner authority envelope, this milestone's directive set
`Grants-Roadmap-Authority-Envelope: NO`, and envelope creation is Founder-script-only. So the
routes stay `TECHNICALLY_DISABLED` on the default path and ranking correctly reports the capability
blocker. The live retrieval below was performed through a harness supplying an explicit envelope, and
the server now threads the same options through, so granting one is the only remaining step. An
independent review caught this being overstated as "the blocker is closed" full stop; it is closed in
code and waiting on authority.

**Compassionate Choice: market evidence 0 → 4.** Three of the five research tasks are now
`SATISFIED` by real retrieved sources. `rankable` is still **false**, and that is correct rather than
disappointing: market evidence existing in the store is not the same as a candidate carrying an
evidenced *price*, and the twenty-two rounds of scoring hardening are untouched. The next step is
extracting priced claims from those sources, not loosening the ranker.

**Area honesty.** Each source declares the area it is actually about. The Florida statute is scoped
to the five counties because it governs the state; the BLS tables and Care.com pages are scoped
`NATIONAL`. One rule distinguishes *somewhere else* (a Miami-Dade rate card — refused) from
*everywhere including here* (a federal wage table — admitted, and never relabelled as local). A page
found by searching is `UNKNOWN_AREA` and is evidence about nowhere.

**Independent review found ten defects, three of them pre-existing security gaps.** DNS rebinding in
the fetch that had been there since Findings 2/3; a JSON-LD date pattern whose backslashes had been
lost, so publication dates were silently never read; and an injected search-provider object that
could have carried any HTTP method past a port whose whole claim is that it cannot. It also caught
the milestone erasing the *asked* versus *unable* distinction by handing ranking a research port even
when nothing was wired — the exact substitution the evidence design exists to prevent.

**One correction worth recording.** The first implementation built a parallel networking stack — a
second SSRF guard, bounded reader and redirect walker — in `packages/local-assistant`, before
noticing `apps/aion/research-fetch.mjs` already had all of it. That package's own architecture test
forbids network code in it, and the existing guard was better: it refuses `::ffff:7f00:1`, which the
replacement got wrong until a live probe caught it. The parallel stack was deleted and what remains
is a thin adapter. **Inspect `apps/aion/` directly before building anything that reaches the
network** — a grep for `https.request` misses everything that correctly goes through `outwardFetch`.

**Independent review.** The staged change went through **twenty-two adversarial review rounds** with
an external reviewer, which returned FAIL sixty-eight times before PASS. Most of those findings were
one substitution wearing a new coat: a label standing in for evidence, a reference standing in for
the right *kind* of reference, a test asserting the hole was the rule. Several were defects in the
tests rather than the code — assertions that could not fail, and two cases where a test of mine
pinned a hole open. Every fix from the last several rounds was mutation-tested in isolation: the fix
was reverted on its own and the corresponding test had to fail.

**The next decision is the Owner's**, and it is a real fork: answer the two questions that need no
web at all (is the business accepting new clients and is there companion capacity today; is there
general liability insurance), or authorize a read-only public research capability. Nothing else moves
first.

The Director creates and runs revenue discovery on its own once a business reads
`READY_FOR_REVENUE_DISCOVERY`, without a fresh Owner prompt between steps. One correction worth
recording: branch parking is keyed on the **objective**, not the business, because a missing fact
should block the work that needs it and nothing else. Compassionate Choice's revenue objective was
being parked by an unrelated discovery question.

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
