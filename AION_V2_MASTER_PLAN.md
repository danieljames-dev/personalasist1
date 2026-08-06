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

No milestone enters production implementation until it has an approved specification,
ADRs for architectural change, threat model, public contract, test plan, documentation
plan, acceptance criteria, migration/rollback path, and named owner.

Approval of this plan authorizes detailed specifications and ADR proposals. It does
not authorize implementation of the next subsystem.

