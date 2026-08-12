# AION V2 Master Plan

Status: Proposed for founder approval  
Date: 2026-08-05  
Planning horizon: Multi-year, milestone-driven

## Purpose

Transform the tested Kernel asset into a durable, local-first Personal Intelligence
Operating System that increases its owner's effectiveness while preserving control,
explainability, portability, and the ability to replace every implementation.

This plan is capability- and evidence-driven. Dates are intentionally omitted until
team capacity and milestone exit evidence exist.

## Product invariants

1. Owner data remains owner-controlled, exportable, and deletable.
2. No model, database, cloud, telemetry, or integration vendor appears in a domain
   contract.
3. Planning, authorization, execution, validation, and learning remain distinguishable.
4. Knowledge learning may be continuous; system modification always requires review.
5. Capabilities are durable contracts; workers are temporary compositions.
6. Consequential external actions require explicit policy and auditable approval.
7. Every public interface and persisted schema is versioned.
8. Every implementation is replaceable through contract and conformance tests.
9. Provenance accompanies every stored fact and derived conclusion.
10. The Kernel remains a lifecycle coordinator, not a platform service locator.

## Architectural model

The directive's sequence defines dependency-aware delivery order:

```text
Kernel
  -> Identity
  -> Object Model
  -> Memory
  -> Knowledge Graph
  -> Event Bus
  -> Planner
  -> Capability Registry
  -> Workflow Engine
  -> Workers
  -> Dashboard
  -> External Integrations
```

Runtime collaboration will not be a single linear call chain. Each subsystem owns
its state and exposes versioned ports. A composition root selects adapters and
registers lifecycle participants. Cross-subsystem facts use stable object IDs and
versioned events rather than shared database tables.

### Universal Object Model

Every persistent domain resource conforms to an `AionObject` contract containing:

- globally unique ID and object type;
- schema and object version;
- owner and access-policy references;
- metadata with controlled extension namespaces;
- typed relationship references;
- provenance and source references;
- creation and update timestamps;
- history/event references; and
- integrity metadata.

Objects use composition rather than deep inheritance. Runtime services, errors,
credentials, and transport messages are not silently persisted as domain objects;
an ADR must define the exact semantic boundary before implementation.

**Amendment (2026-08-06):** ADR-007 and the `docs/contracts/object-*` family are
authoritative for envelope composition and supersede the field list above. The Object
envelope carries no typed relationship references and no history or event references.
Relationships, versions, and events are independently queryable first-class Objects
keyed to the subject; the base snapshot stays bounded and does not grow with activity.

### Control plane and work plane

- **Control plane:** Identity, policy, approvals, capability definitions, workflow
  definitions, configuration, and audit.
- **Work plane:** temporary workers invoke policy-approved capabilities against
  explicit goals and tasks.
- **Knowledge plane:** Objects, Memory, Knowledge Graph, provenance, and learning.
- **Experience plane:** Dashboard and integrations expose controlled human/system
  interaction without owning domain state.

## Preserved assets

| Asset | Disposition |
|---|---|
| Kernel v1 source and API | Preserve behavior and versioned path |
| Kernel lifecycle tests | Retain as regression and conformance baseline |
| ADR-001 and ADR-002 | Preserve; supersede only through new ADRs |
| Sprint 1 architecture/API docs | Move intact into the future Kernel package docs |
| Strict TypeScript configuration | Generalize into shared tooling after an ADR |
| Dependency-free runtime | Preserve unless measured requirements justify additions |
| Founder charter | Treat as product-governance authority |

## Milestone 0: Governance and engineering system

### Outcome

A reproducible repository where architectural boundaries and public compatibility
can be reviewed and enforced.

### Deliverables

- Source-control and review policy.
- ADR, specification, acceptance, threat-model, and interface templates.
- Workspace/package boundaries with Kernel moved without behavior change.
- CI for type checking, tests, package exports, docs links, dependency boundaries,
  and vulnerability review.
- Versioning, deprecation, release, and support policies.
- Architecture glossary, system context, quality attributes, and ownership map.

### Exit evidence

Kernel package consumers observe no API or behavioral regression; a clean checkout
can reproduce all checks; forbidden dependencies fail CI.

## Milestone 1: Identity and Object Model foundation

### Outcome

The owner and all persistent domain resources have portable, versioned identities
and explicit ownership.

### Deliverables

- ADRs for identifiers, object semantics, metadata extensions, ownership, history,
  permissions, and schema evolution.
- Identity, principal, owner, and actor contracts.
- Minimal `AionObject` schema plus representative Resume, Project, Task, Document,
  Meeting, Company, Product, and Research Note fixtures.
- Clock, ID generator, validator, serializer, and migration ports.
- Policy decision/enforcement boundary and audit vocabulary.

### Exit evidence

Representative objects round-trip losslessly; migrations are deterministic;
ownership cannot be omitted; unknown extension fields survive round-trips; contract
tests work without a database or network.

## Milestone 2: Owner-controlled Memory

### Outcome

AION can store, retrieve, export, and delete owner knowledge with provenance.

### Deliverables

- Memory record contracts for semantic, procedural, episodic, and strategic memory.
- Required source, timestamp, confidence, relationships, owner, and version fields.
- Repository, transaction, query, retention, export, deletion, and backup ports.
- Local reference adapter selected through evidence and benchmark ADR.
- Encryption and key-custody design; redaction and consent rules.

### Exit evidence

Full owner export and verified deletion pass acceptance tests; backup restoration is
proven; provenance survives derivation and migration; adapters pass the same
conformance suite.

## Milestone 3: Knowledge Graph and Event Bus

### Outcome

AION relates knowledge and communicates changes without sharing internal storage.

### Deliverables

- Typed relationship/provenance model and graph query port.
- Event envelope with event ID, schema version, object reference, actor, owner,
  timestamp, correlation, causation, provenance, and trace context.
- Delivery, ordering, retry, dead-letter, replay, and idempotency semantics.
- In-process local adapters first; durable adapters only when requirements justify.
- Schema registry and compatibility tests.

### Exit evidence

Graph implementation can be replaced by an in-memory test adapter; event replay is
deterministic; duplicate delivery does not duplicate state; incompatible schemas
are rejected before release.

## Milestone 4: Planner

### Outcome

AION proposes evidence-backed next actions without gaining implicit execution power.

### Deliverables

- Goal, constraint, opportunity, plan, decision, assumption, evidence, and approval
  contracts.
- Policy-neutral model-provider port and deterministic test provider.
- Planner evaluation loop: changed, valuable, blocked, next, automatable, approval,
  learned.
- Explainability record connecting recommendations to evidence and confidence.
- Budget, cancellation, timeout, and human-approval boundaries.

### Exit evidence

The same planning scenarios pass with multiple test/provider adapters; every
recommendation cites evidence; Planner cannot invoke an external action directly.

## Milestone 5: Capability Registry

### Outcome

Reusable, policy-scoped capabilities replace fixed agents as the unit of action.

### Deliverables

- Versioned descriptor, input/output schemas, permissions, cost/resource hints,
  health, compatibility, and provenance.
- Registration, discovery, selection, invocation, cancellation, and result ports.
- Capability conformance SDK and reference capabilities limited to safe local cases.
- Permission grants and complete invocation audit.

### Exit evidence

Two interchangeable implementations satisfy one capability contract; unauthorized
invocations fail closed; capability selection contains no hardcoded vendor/model.

## Milestone 6: Workflow Engine

### Outcome

Goals become durable, resumable, observable workflows with validation and approval.

### Deliverables

- Goal -> Plan -> Task -> Capability -> Execution -> Validation -> Memory -> Learning
  state models.
- Durable state, retries, idempotency, compensation, pause/resume, cancellation,
  approval gates, and recovery semantics.
- Workflow versioning and deterministic migration.
- Simulation and dry-run modes.

### Exit evidence

Interrupted workflows resume without duplicate side effects; consequential steps
cannot bypass approval; histories are complete and owner-readable.

## Milestone 7: Temporary Workers

### Outcome

Short-lived workers dynamically compose capabilities for bounded tasks.

### Deliverables

- Worker lease, identity, scope, budget, sandbox, heartbeat, result, and termination
  contracts.
- Worker coordinator that does not embed permanent personas or fixed agent classes.
- Isolation and resource policies.
- Failure/reassignment behavior and audit trails.

### Exit evidence

Workers expire and release authority; loss is recoverable through workflow state;
capabilities remain usable without a worker implementation.

## Milestone 8: Owner Dashboard

### Outcome

The owner can understand, approve, correct, export, and stop AION activity.

### Deliverables

- Local-first control and observability API.
- Inbox, goals, plans, approvals, workflows, memory provenance, capability grants,
  audit, health, budgets, and emergency stop views.
- Accessibility, session security, and responsive interaction requirements.

### Exit evidence

The Dashboard owns no canonical domain state; every consequential action shows its
evidence and permission; owner export/deletion and emergency stop are usable.

## Milestone 9: External integrations

### Outcome

AION interacts with external systems through isolated, revocable adapters.

### Deliverables

- Integration SDK based on capability and object contracts.
- Secret references, least-privilege scopes, rate limits, retries, consent, audit,
  and revocation.
- Initial integrations chosen by measured owner value, not platform prestige.

### Exit evidence

Removing an integration loses no canonical owner data; credentials are not stored in
objects/events/logs; external writes require configured approval policy.

## Milestone 10: Product and Career systems

These are domain packs built on platform contracts, not new architectural centers.

- Product workflows cover opportunity discovery through monitored iteration.
- Career workflows cover resume knowledge through tracking and follow-up.
- Final job submission remains behind explicit owner approval unless the owner
  deliberately changes policy.

Exit requires proof that domain packs can be installed, upgraded, exported, and
removed without modifying Kernel or corrupting shared data.

## Milestone V1.2: Relationship Core, Product Studio, and Business Agents

Planned, not authorized. No CURRENT directive exists for this milestone, and none may be created
until the V1.1 private-bind owner phone retest passes.

Scope recorded by the Founder: promote the reusable relationship concepts proved in Sales into a
general relationship domain serving automotive prospects, professional contacts, business leads,
brand customers, B2B prospects, support customers, partners, and vendors, preserving explicit
workspace ownership and keeping sensitive financial and identity material out; a Product Studio
turning ideas into managed opportunities that distinguishes evidence from assumptions; a governed
research-agent foundation with scoped questions, provenance, confidence, and cost limits, tested
against synthetic adapters and never silently crawling; independent business and brand workspaces
that cannot leak into one another; development-project orchestration extending the existing
developer-agent bridge from idea through specification, plan, tasks, verification, review, and
approval without exposing a shell to the conversational model; a website and product build pipeline
whose real deployment requires a separately authorized capability; a bounded natural-language
command router mapping ordinary requests onto typed proposals, asking rather than guessing when
ambiguous; a Memory and learning loop keeping FACT, OBSERVATION, INFERENCE, HYPOTHESIS,
OWNER-CONFIRMED MEMORY, and LEARNED STRATEGY distinct so an inference never silently becomes fact;
autonomy governance classifying actions from level 0 read-only through level 5 irreversible, where
no agent raises its own authority and no model approves its own proposal; and mobile continuity for
every new area through the existing Command Center rather than a second interface.

The model-independence requirement recorded under Cross-cutting programs is part of this milestone.


## Vertical: Personal Sales Presence

**Mission.** AION develops and operates the Owner's professional automotive-sales online presence
using grounded current inventory, Owner brand, aggregate customer demand, and real dealership
activity — not generic marketing templates.

The distinction that defines this vertical: a content system for a salesperson is only worth having
if it is *grounded*. A calendar that demands five posts a week produces filler, and filler teaches an
audience to scroll past. Every opportunity here derives from something that actually happened — a car
arrived, a price moved, several people asked the same question — and "post nothing today" is a
supported answer.

### Status legend

`IMPLEMENTED` runnable in production today · `FOUNDATION` domain contracts and logic exist with
tests, not yet wired to the runtime · `PLANNED` designed, not built · `REQUIRES_EXTERNAL_CONNECTION`
blocked on an external provider, account, or Owner consent that does not exist yet.

### Capability status

| Capability | Status | Note |
|---|---|---|
| Grounded vehicle inventory with price history | `IMPLEMENTED` | Advertised / MSRP / dealer price already separate per observation |
| Customer needs, commitments, aggregate demand | `IMPLEMENTED` | Consumed here only in privacy-safe aggregate |
| Sales brand profile | `FOUNDATION` | `SalesBrandProfileV1`; derives from the existing `BrandDnaV1` |
| Content pillars | `FOUNDATION` | Configurable; consent-gated pillars closed by default |
| Content opportunity engine | `FOUNDATION` | Ranked from grounded signals; refuses ungrounded ones |
| Social content plan (daily / weekly / monthly) | `FOUNDATION` | No posting quota; may recommend nothing |
| Content drafts — Facebook, Instagram, short video, Reel, TikTok, YouTube Short, website feature, article, FAQ, customer share | `FOUNDATION` | One grounded facts object, many renderings |
| Price-truth enforcement | `FOUNDATION` | Advertised is not MSRP is not observed; unknown prices produce no figure |
| Temporal invalidation of vehicle content | `FOUNDATION` | Freshness re-derived from the live record, never stored and trusted |
| Website information architecture | `FOUNDATION` | Mobile-first; a view over inventory facts, never a second database |
| Vehicle page projection | `FOUNDATION` | Carries price source and last-verified date; VIN display policy |
| Lead capture contract | `FOUNDATION` | Minimal fields; credit-application fields refused at contract level |
| Social publish proposal | `FOUNDATION` | `PREPARE_ONLY`; no executor exists |
| Website change proposal | `FOUNDATION` | `PREPARE_ONLY`; no deployment path exists |
| Analytics feedback model | `FOUNDATION` | Contracts and fixtures only; refuses to read a sample too small |
| Owner command vocabulary | `FOUNDATION` | Routing defined and tested; deliberately not spliced into `service.ts` |
| Runtime wiring into Chat | `PLANNED` | Deferred to integration to avoid collision with parallel executors |
| Real personal sales website | `PLANNED` | No hosting, domain, or deployment decision has been made |
| Social scheduling and publishing | `REQUIRES_EXTERNAL_CONNECTION` | Metricool or equivalent; no OAuth, no connection, no post |
| Real analytics ingestion | `REQUIRES_EXTERNAL_CONNECTION` | Fixtures only until a provider is connected |

### What does not exist

No website is deployed. No domain is registered. No social account is connected. Nothing in this
vertical can publish, post, schedule, email, or text, and no code path in the repository attempts to.
Every proposal type is `PREPARE_ONLY` and has no executor.

### Invariants

1. Customer intelligence informs content only in aggregate. A single customer's stated want never
   becomes public content, and the aggregation floor is enforced where opportunities are constructed
   rather than where text is written.
2. A website-advertised price, a window-sticker MSRP, and an in-store observation are three separate
   facts with separate sources. Only a current advertised price may be quoted as the price.
3. Vehicle content carries an expiry and is re-verified against the live record rather than trusted.
4. Nothing asserts financing, payments, incentives, rebates, trade values, or availability.
5. Claims about the Owner require evidence. Unknown stays unknown.


## Cross-cutting programs

### Security and privacy

Threat modeling, least privilege, audit, secure defaults, data classification,
encryption, key custody, supply-chain controls, incident response, and deletion
verification evolve with every milestone—not as a final hardening phase.

### Observability

Use vendor-neutral structured signals with correlation and owner-data redaction.
Operational telemetry and owner audit history remain separate data classes.

### Compatibility

Every persisted schema and public port has conformance fixtures. Breaking changes
receive a new major contract version plus migration, coexistence, and rollback plans.

### Model independence

Model requirements describe capabilities—context, modalities, structured output,
tool use, privacy, latency, and cost—not model names. Provider adapters supply
runtime catalogs and policy performs selection.

**Amendment (2026-08-07), Founder requirement.** Model independence is raised from a design
preference to a foundational architecture requirement, planned into the V1.2 milestone. AION's
primary conversational and reasoning capability must not depend on any mandatory
company-controlled inference API.

*Core principle.* AION owns Memory, Tasks, Routines, Planner state, relationship and customer
state, Personal and Work workspaces, Brand state, Product Studio state, research evidence,
learning history, capability permissions, approvals, Activity, and agent state. No language-model
vendor owns or defines those domains. A model is a replaceable reasoning provider, and removing or
changing one must not destroy or alter AION's durable state.

*Local-first primary brain.* A first-class self-hosted model-provider architecture, capable of
using a locally or owner-controlled remotely hosted open-weight model as the primary provider.
Core operation must not require the OpenAI, Anthropic, Google, xAI, DeepSeek-hosted,
Alibaba-hosted, Mistral-hosted, or any other third-party inference service. Remote proprietary
providers remain optional adapters.

*Open-weight support.* A model-runtime abstraction able to support self-hosted candidates such as
DeepSeek, Qwen, Mistral, and gpt-oss open-weight families, and future compatible models, without
being hard-coded around any one. Which models are actually supported is decided per adapter, on
licensing, hardware requirements, inference quality, context length, tool and function capability,
structured-output reliability, privacy, and operating cost at the time the adapter is written.

*Owner-controlled inference.* Execution through owner-controlled runtimes where practical —
llama.cpp-compatible, Ollama-compatible, vLLM-compatible, or other accepted self-hosted inference
servers — behind a runtime port independent of any one implementation. Cloud inference is never
required.

*Three tiers.* Tier 1, a smaller local model sufficient for ordinary Chat, task classification,
simple planning, Memory retrieval assistance, and command routing, continuing to work without
internet access after installation. Tier 2, a larger open-weight model on a dedicated machine or
owner-rented GPU infrastructure under the owner's control, preferred for high-capability reasoning
where practical. Tier 3, optional specialist remote providers; AION must keep functioning when they
are unavailable, rate-limited, changed, discontinued, or unaffordable.

*Model router.* An AION-owned router supporting LOCAL ONLY, LOCAL PREFERRED, MANUAL, and SPECIALIST
policies. AION must never silently switch from local inference to a remote provider.

*Privacy disclosure.* Before private context reaches a remote provider, AION states which provider
receives it, which workspace it came from, what context is proposed, whether Memory is included,
and whether customer or work information is included. Sensitive Work and customer information must
not automatically enter remote model context.

*Offline mode.* A true offline mode in which no inference leaves the owner-controlled machine or
network, no remote fallback occurs, no telemetry is permitted, local state remains fully available,
and compatible local inference keeps working.

*Capability registry and evaluation.* Each configured model's capabilities are tracked separately —
conversation, reasoning, code, structured JSON, tool proposal, long context, vision, embeddings,
local or remote, cost class — rather than assumed uniform. A deterministic synthetic evaluation
harness compares configured models on instruction following, structured output, planning,
Memory-context use, tool proposal, hallucination resistance, coding, latency, and resource use, so
selection is evidence-driven rather than vendor-driven. Benchmark fixtures contain no real personal
or customer data.

*Brain boundary.* A model's hidden conversational context is never treated as AION's durable
Memory. Durable information belongs to AION's explicit Memory and provenance system; the model
receives selected context and owns no history.

*Learning independence.* Evidence, observations, owner corrections, confirmed memories, strategies,
experiment outcomes, research, and task results persist outside the model. A model may propose
lessons or hypotheses, which remain explicitly typed and provenance-backed. Replacing the model
must not erase learned state.

*Adaptation boundary.* An optional future boundary for adapters, LoRA, task-specific fine-tuning,
retrieval augmentation, and prompt or policy adaptation. Fine-tuning is never required for AION to
learn; the first learning mechanism is explicit Memory, evidence, retrieval, evaluation, and
strategy improvement. No automatic training on private owner data; any future training requires
explicit authorization and an auditable dataset manifest.

*Failure independence.* AION remains operational when any third-party provider is unavailable or a
key or quota is exhausted. Local data, Tasks, Memory, relationships, Planner state, workspaces,
Activity, and supported local inference keep working.

*Settings surface.* Primary brain, model, runtime, and mode, with optional remote providers listed
separately and a clear visual distinction between local or owner-controlled and remote or
third-party.

*Acceptance criterion.* AION fails this requirement if removing all third-party inference
credentials prevents the owner from using AION with a supported self-hosted model. The intended end
state is that with every external provider unavailable, AION still starts, Memory works, Tasks and
Routines work, Planner works, relationships and brands work, a local model still provides chat and
reasoning, and AION remains useful.

*Target shape.* The independence stack the Founder specified:

```text
PHONE
  |
Secure private AION connection
  |
AION CORE - owner controlled
  |
MODEL ROUTER
  |
  +-- LOCAL SMALL MODEL          Ollama / llama.cpp; private, offline, default
  |
  +-- SELF-HOSTED LARGE MODEL    owner GPU or owner-rented hosting; open-weight
  |
  `-- OPTIONAL SPECIALIST APIs   Claude / OpenAI / Grok / Gemini
```

The self-hosted large tier explicitly includes owner-rented GPU hosting as well as owned hardware,
with a nominated fallback host, because renting capacity the owner controls is still owner control:
what matters is that no single vendor can end AION's reasoning capability.

*Settings surface, as specified.* Mode is one of **Local Preferred**, **Local Only**, **Manual**, or
**Maximum Capability**. Alongside it: the local model, the high-capability brain and its runtime,
a fallback GPU host, a specialist coding bridge, an explicit remote-proprietary-fallback switch
that defaults to off, and the phone-access state. Local or owner-controlled entries must be
visually distinct from remote third-party ones, and Maximum Capability must still disclose what
leaves the machine before it does so — a capability preference never becomes an implicit consent
to transmit private context.

*Honest limits.* Self-hosting does not make a model unbiased, uncensored, or correct — weights carry
the biases and refusal behaviour of their training. What it provides is control: where inference
runs, whether data leaves the machine, when the model is replaced, how it is configured, and
whether a provider can cut AION off. The goal is not that a particular model is AION's brain; it is
that AION is the brain and models are reasoning resources it can choose among.


### Evidence program

Every technology selection records workloads, alternatives, benchmarks, failure
modes, operational cost, exit strategy, and decision expiry/review triggers.

## Success measures

- Owner effectiveness: accepted recommendations, saved time, completed goals, and
  reduced blocked time, with owner-controlled measurement.
- Trust: provenance coverage, explainability coverage, approval-policy compliance,
  successful export/deletion, and correction rate.
- Architecture: contract conformance, forbidden-dependency count, replacement tests,
  migration success, and change failure rate.
- Reliability: recovery time, workflow duplication rate, data-loss incidents, and
  backup restore success.
- Security: least-privilege coverage, unresolved critical findings, secret exposure,
  and incident response time.

## Governance gates

Current ratified state (2026-08-06): ADR-007 through ADR-010 are Accepted, with ADR-010
Accepted for DG-4a only. DG-1 is historically split into DG-1a (local single-owner reference
bootstrap) and DG-1b (secure external access and authentication); DG-1a is Closed by
CTO-DECISION-009 and DG-1b remains Open. DG-2 is Closed, DG-3 is Open, DG-4a is Closed, and DG-4b
is Open. The Universal Object Contract remains Pre-stable. CTO-DECISION-008 prospectively lifts
the implementation freeze only for the Minimum Personal Career Vertical Slice described by the
[permanent Sprint 3.0 directive](docs/directives/sprint-3.0-career-vertical-slice.md). Phase 2
records the prospective authorization. Sprint 3.0 Phase 3 provides the reviewed local privacy and
filesystem-containment prerequisite. Sprint 3.0 Phase 4 implements only the opaque local Identity
reference bootstrap beneath that boundary, with explicit idempotent initialization, locking,
atomic no-overwrite persistence, redacted status, and local export. It contains no profile data,
authentication, authorization, Universal Objects, career ingestion, remote access, or later phase.
Sprint 3.0 Phase 5 adds the bounded `@aion/object` reference: closed mutable profile envelopes,
typed Owner/Actor references, ACJ-1 validation/framing/integrity, exact DG-4a limits, the seven
required family/profile boundaries, RelationshipObject as sole edge truth, explicit revision
operations, and replaceable in-memory plus privacy-validated local filesystem reference adapters.
The base registry keeps all six career entity payloads closed and empty; separately authorized
composed registries add only their accepted domain payloads. No real Object or career state exists.
The filesystem adapter is not a permanent production storage decision or DG-4b workload evidence.
Sprint 3.0 Phase 6 adds independently versioned career input contracts, neutral blank owner
templates, and an explicit non-ingesting preflight composed with the Phase 3 boundary and accepted
ACJ-1/DG-4a controls. Phase 7 adds the bounded `@aion/career-evidence` reference: explicit dry-run,
catalogue import, deterministic structured CareerFacts, exact provenance relationships, explicit
conflict/supersession history, evidence-backed CareerProfiles, and deterministic retry over the
accepted Object repository. It uses only neutral synthetic temporary data; no real career input is
read and no permanent career Object is created. Phase 8 adds the bounded `@aion/job-posting`
reference: explicit structured JSON/Markdown/text dry run and import, exact source provenance,
description-only unstructured mapping, conservative listing-currentness evidence, and atomic
create/expected-revision persistence. Phase 8 proof is neutral, synthetic, and temporary; no real
Job Posting, career data, Identity value, or AI-assistant archive is accessed. Phase 6 templates and
Phase 7/Phase 8 tests are not normative fixtures. Phases 9–11 add a bounded Reference Candidate for
transparent deterministic evidence-backed matching, cited owner-review application preparation,
an explicit-root local CLI, and a complete neutral synthetic temporary demo with export/reload and
idempotent rerun. This does not add job discovery, external communication, submission, signing,
attestation, models, embeddings, vector storage, networking, or telemetry. No real owner career data
was ingested. The Object Contract remains Pre-stable; DG-3 and DG-4b remain Open; normative fixtures
remain unauthorized.

The AION V1 local assistant milestone adds the first owner-facing product surface over that
foundation: a loopback-only Command Center (`npm run aion`) with Chat, Tasks, Routines, Memory,
Planner, Approvals, Activity, Career, Imports, and Settings. It contributes a replaceable model
provider port with a deterministic offline provider and two truthfully-unavailable boundary
adapters; local conversation history with streamed responses; Memory with provenance, corrections,
disablement, deletion, export, and preserved conflicts; persisted Tasks and Routines with an
in-process scheduler that installs no OS service; a reviewable Planner; a capability registry and
bounded Agent Controller whose executions require an approval bound to one exact input digest,
once; privacy-safe Activity; a Career screen over the accepted Career engine; an Import Center with
ChatGPT, Claude, and Grok parser boundaries, mandatory dry run, exact digests, and duplicate
detection; an AES-256-GCM private backup with post-write restore verification; and an
approval-gated, repository-scoped developer-agent bridge. `npm run aion:demo` proves all of it on
neutral synthetic data, including restart reload and a byte-identical rerun.

This milestone adds no job discovery, submission, email, browsing, telemetry, analytics, live model
call, OS service, or production claim. It does not close DG-3 or DG-4b, stabilize the Universal
Object Contract, or create normative fixtures. Real owner-data ingestion remains owner-initiated
through the interface and did not occur. See
[the V1 architecture](docs/architecture/aion-v1-local-assistant.md) and
[its review](docs/reviews/aion-v1-local-assistant-review.md).

The V1 real-use activation milestone prepares that surface for actual owner use without rebuilding
it. It adds a second developer-agent bridge — Claude Code CLI alongside the preserved Codex CLI —
behind one replaceable port and an owner-selected registry; an explicit read-only or
workspace-write task boundary carried in the approval digest, defaulting to read-only; instruction
delivery on standard input so task text can never become an argument or shell syntax; a disclosed
argument vector with the local repository path redacted; developer-agent account health reported
separately from executable availability and probed only on request, without reading any account
value or determining paid quota; and a Chat hand-off that turns a repository question into an
approval-gated read-only developer task. It adds no new dependency, no network behaviour, no OS
service, no production claim, and no real owner-data ingestion; DG-3 and DG-4b remain Open, the
Universal Object Contract remains Pre-stable, and normative fixtures remain unauthorized.

The AION V1.1 Mobile Sales Work Mode milestone makes that surface usable from a phone and
separates work from personal life. It adds explicit PERSONAL and WORK workspaces carried on every
content record, with memory context, search, conflict detection and the UI all scoped to one
workspace, and a deterministic, idempotent, fail-closed migration that assigns pre-workspace
records the documented default without moving anything across the boundary. It adds durable
work-scoped relationship records with an append-only timeline, a closed query shape for the daily
questions, refusal of identity, credit, banking and financing material by field and by value, and
a data-origin classification so customer information is never implied to be personal property. It
adds deterministic template-driven sales coaching that states no commercial fact it was not given,
routine templates that activate nothing on their own, owner-entered metrics labelled as the
owner's own counts, and a phone-first Sales dashboard. It adds an AION-owned bounded verification
capability with a fixed allowlist and no command field anywhere in its input, whose evidence feeds
a read-only developer-agent analysis, so a failing suite can be explained without granting shell or
write access. It adds device pairing with single-use short-lived codes, digest-only storage,
header-only bearer material, expiring and individually revocable sessions, per-peer rate limiting,
and a service worker that caches the application shell and never an API response. Private phone
access is off by default, the bind address is restricted to loopback or a private range, and AION
creates no tunnel, port forwarding, or router configuration.

This milestone adds no CRM connection, no employer-system access, no customer communication, no job
discovery, no submission, no telemetry, no live model call, no OS service, and no production claim.
It does not close DG-3 or DG-4b, stabilize the Universal Object Contract, or create normative
fixtures. Real owner-data ingestion remains owner-initiated and did not occur, and the owner's live
private state was neither read nor migrated during development.

The next action requires a separate Founder/CTO decision after review.

No milestone enters production implementation until it has an approved specification,
ADRs for architectural change, threat model, public contract, test plan, documentation
plan, acceptance criteria, migration/rollback path, and named owner.

Approval of this plan authorizes detailed specifications and ADR proposals. It does
not authorize implementation of the next subsystem.
