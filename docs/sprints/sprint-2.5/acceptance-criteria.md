# Sprint 2.5 Acceptance Criteria

Status: Accepted by Founder/CTO on 2026-08-06  
Scope: Architecture documentation only  
Gate: Architecture-boundary approval. This gate is not implementation readiness and not
contract stability; both are governed by the deferred gates recorded below.  
Decision record: [CTO-DECISION-002](../../decisions/CTO-DECISION-002-sprint-2.5-approval.md)

## Deliverable completeness

- [x] All eleven directive documents exist at the exact required paths.
- [x] ADR-007 status changes only by explicit recorded CTO decision.
- [x] No production code, schema file, test, database, adapter, framework, or automation
  was generated.
- [x] The seven construction-blocking Architecture Readiness Review changes are
  incorporated: Object profiles (1), relationship dual truth eliminated (2), unbounded
  inherited arrays removed (3), universal API narrowed (4), authorization seam defined
  (6), atomicity constrained (8), and the version/integrity rules other than canonical
  serialization completed (7-partial).
- [x] The four remaining Architecture Readiness Review matters — identity bootstrap (5),
  canonical serialization (7-remainder), representative fixtures (9), and measurable
  limits (10) — are recorded as deferred gates below with owner, rationale, risk,
  affected components, blocking gate, required evidence, and review trigger. They are
  not waived, dismissed, or optional.

## Responsibility and boundaries

- [x] Object Model has exactly one responsibility: universal structural and
  record-lifecycle invariants.
- [x] Domain-owned commands retain all type-specific business logic.
- [x] No generic public mutation can bypass a domain.
- [x] Object Model contains no authentication, authorization, policy, Event Bus,
  database, vector store, model, framework, or vendor behavior.
- [x] Object events never invoke downstream services.

## Universal model

- [x] Every persistent AION domain entity structurally conforms to Object.
- [x] Object materialization excludes transient private values unless deliberately
  persisted/addressed as domain state.
- [x] Entity, Relationship, Version, and Event profiles are defined.
- [x] Version and Event profiles are immutable and non-recursive.
- [x] Base snapshots are bounded and contain no growing relationship/history/event arrays.
- [x] Every Object supports owner-controlled open-format export.

## Required concerns

- [x] Ownership and canonical Identity references are mandatory and distinct from
  credentials/authorization.
- [x] Metadata is bounded, namespaced, non-executable, and cannot override reserved data.
- [x] Every Object supports provenance and version history.
- [x] Permissions and audit are references, not embedded policy or logs.
- [x] Knowledge, Planner, Memory, Capability, and Workflow references use typed
  Relationships without subsystem coupling.

## Lifecycle

- [x] Created, Validated, Active, Archived, Deprecated, Deleted, and Destroyed states
  are defined with permitted transitions.
- [x] Restored, Imported, Exported, Merged, and Split operations are defined and not
  confused with persistent availability states.
- [x] Delete and Destroy are distinct, irreversible, and account for projections and
  controlled backups.
- [x] Domain state remains separate from universal record lifecycle.

## Events

- [x] Required Object event types and common event data are defined.
- [x] Events are minimized committed facts with correlation, causation, provenance,
  subject revision, compatibility, and idempotency.
- [x] Commit/publication failure, at-least-once delivery, replay, gaps, ordering, and
  quarantine behavior are specified without implementing transport.

## Relationships

- [x] All fifteen required standard relationship types are defined.
- [x] Cardinality, endpoint constraints, uniqueness, cycles, ownership, lifecycle,
  provenance, inverse semantics, and integrity are explicit.
- [x] Relationship Objects are the sole canonical edge truth.
- [x] Cross-owner relationships fail closed and confer no authority.

## Versioning and migration

- [x] Contract, schema, revision, event, relationship descriptor, and package versions
  are distinct.
- [x] Compatibility is declared and fixture-proven, not inferred from numbering.
- [x] Migration is checkpointed, resumable, idempotent, attributed, and explicit about
  information loss and rollback.
- [x] Canonical serialization and integrity agility are identified as blocking decisions.

## Security and longevity

- [x] Threat boundaries, attacks, controls, residual risks, and implementation blockers
  are documented.
- [x] Identity/authorization bootstrap remains an explicit unresolved prerequisite.
- [x] Scalability, write amplification, high-degree relations, large artifacts, and
  migration risks have recommended mitigations.
- [x] Future multi-owner and plugin evolution have defined seams without implementation.
- [x] The design is storage-, language-, model-, and vendor-neutral.

## Deferred implementation gates

These four matters were raised by the Architecture Readiness Review. They are deferred to
explicit later gates, not waived. No gate below may be recorded as met without the required
evidence. Architecture-boundary approval of ADR-007 closed none of them.

**Current gate status — 2026-08-06**

| Gate | Status |
|---|---|
| DG-1 Identity bootstrap | **Open** |
| DG-2 Canonical serialization | **Closed** by [ADR-008](../../decisions/ADR-008-canonical-serialization.md) and [CTO-DECISION-003](../../decisions/CTO-DECISION-003-canonical-serialization.md) |
| DG-3 Representative fixtures | **Open.** Specification delivered by ADR-009 (Proposed); no fixture, loader, or harness exists. Three coverage areas BLOCKED on open gates |
| DG-4 Measurable limits | **Open.** `aion-resource-limits-1` profile proposed by [ADR-010](../../decisions/ADR-010-measurable-resource-limits.md) (Proposed). Sprint 2.9 resolved B-1–B-3 fully and B-4 partially: canonicalization and framing limits evidenced across six size classes, six workload families and two runtimes; **Object business limits and the six Object workload families remain unsupplied**. Final review: APPROVE WITH CHANGES, one required change (RC-1: split the gate) |

### DG-1 — Identity bootstrap

| Field | Value |
|---|---|
| Owner | CTO |
| Rationale | The first Owner and Actor must exist before any Object, but persisted Identity records are Entity Objects. No ceremony can be invented by an implementation. |
| Risk | Circular bootstrap deadlock; second-owner injection; unattributable or forged first-owner provenance; unrecoverable owner identity. |
| Affected components | Identity, Object Model, future Policy, export, import, audit |
| Blocking gate | **Must be resolved by a subordinate ADR before implementation of Identity-backed Object creation.** |
| Required evidence | An accepted subordinate ADR defining the ceremony, bootstrap actor limitations, second-owner injection prevention, recovery, rotation, provenance, and historical identity-reference behaviour — without raw temporary identifiers or implied authorization. |
| Review trigger | Any proposal to create a persisted Object, Identity record, or externally reachable Object API; any multi-owner or federation requirement. |

### DG-2 — Canonical serialization — **CLOSED 2026-08-06**

| Field | Value |
|---|---|
| Owner | CTO |
| Rationale | Integrity digests are unreproducible across languages and runtimes until one deterministic canonical representation is fixed. Every integrity claim depends on it. |
| Risk | Divergent digests for identical content; false integrity failures; hashes silently invalidated by a canonicalization change; digest mistaken for authenticity. |
| Affected components | Object Model integrity, versioning, export/import manifests, event integrity verification, migration, future signing and trust design |
| Blocking gate | **Closed.** |
| Required evidence | **Satisfied** by [ADR-008](../../decisions/ADR-008-canonical-serialization.md) (Accepted 2026-08-06) and the [ACJ-1 contract](../../contracts/canonical-serialization.md): canonicalization profile and version, deterministic encoding rules, a named validation boundary, injective length-prefixed domain separation, and an algorithm registry with agility. Cross-runtime agreement fixtures are **required but not yet produced** — they are DG-3 work. Authenticity remains a separate design. |
| Review trigger | Any proposal to widen the value domain, change the canonicalization profile, add or retire a digest algorithm, or introduce signing. |

**Closure scope.** DG-2 closed the *specification* gap, not the *evidence* gap. Digest
computation, storage, comparison, and publication remain unauthorized because no
implementation exists and cross-runtime agreement has never been demonstrated. Six
subordinate decisions carry forward — see
[ADR-008 §Required subordinate decisions](../../decisions/ADR-008-canonical-serialization.md#required-subordinate-decisions).

### DG-3 — Representative contract fixtures — **UNBLOCKED for design 2026-08-06**

| Field | Value |
|---|---|
| Owner | CTO |
| Rationale | The contract's own stability gate requires the envelope to be validated against real Object shapes before it is frozen. Freezing an unvalidated shape forces an immediate breaking major version. |
| Risk | Premature v1 freeze; a domain that cannot conform without violating its responsibility; unbounded envelope growth discovered after commitment. |
| Affected components | Universal Object Contract, all future domain schemas, export format, migration graph |
| Blocking gate | **Still open.** Must exist and pass before the Object Contract can be designated stable v1. |
| Status | **Open.** Specification authorized and delivered by [ADR-009](../../decisions/ADR-009-contract-fixture-corpus.md) (Proposed) and the [AFX-1 corpus contract](../../contracts/contract-fixture-corpus.md), 2026-08-06. **Specification alone does not close DG-3.** No fixture, loader, or harness exists or is authorized. Three coverage areas remain BLOCKED on open gates: maximum-member rejection (DG-4), invalid decimal representation (decimal decision), and cross-runtime agreement (no second runtime selected). |
| Closure conditions | Fixture schema accepted; ADR-009 accepted; required initial corpus created; positive **and** negative cases present; timestamp precision decision reflected; canonical, framed, and digest expectations recorded; **cross-runtime conformance demonstrated**; release manifest produced; artifacts checksummed; corpus security review passed; no private data or secrets present; `npm run verify` and future corpus checks pass; Object Contract stability gate satisfied. |
| Required evidence | Language-neutral fixtures modelling at least Owner record, Document, Project, Task, Memory, Capability, Workflow, Relationship, Version, and Event Objects, demonstrating bounded size, round-trip export, migration, and domain-boundary conformance. Each carries source value, expected canonical bytes, expected framed digest input and digest, expected validation outcome, applicable versions, and rationale. Rejection fixtures are mandatory. |
| Review trigger | Any proposal to label the contract stable v1, publish golden schemas, or begin a domain schema that depends on a frozen envelope. |

### DG-4 — Measurable resource and complexity limits

| Field | Value |
|---|---|
| Owner | CTO |
| Rationale | The contract requires bounded metadata, provenance, data, and events but specifies no number. "Bounded" is unenforceable and untestable until the bounds exist. |
| Risk | Resource exhaustion through deep or oversized metadata, high-degree relationships, event storms, or large artifacts; write amplification exceeding owner hardware; adapters choosing incompatible limits. |
| Affected components | Object Model validation, metadata and extension namespaces, relationship cardinality, event payloads, storage adapters, import and ingestion paths |
| Blocking gate | **Must be specified before production adapters or untrusted ingestion are authorized.** |
| Required evidence | An approved limits specification fixing maximum encoded envelope, data, metadata, label count, nesting depth, provenance, extension, relationship page, and event sizes, plus benchmarked high-churn, high-degree, large-artifact, migration, export, and restore workloads on representative local hardware. |
| Review trigger | Any proposal for a durable adapter, an import or ingestion path, an untrusted schema or plugin source, or a performance budget claim. |

## Approval result

Sprint 2.5 passes only when the CTO accepts every criterion or records explicit
exceptions with owner, rationale, risk, and review trigger. Passing does not authorize
implementation.

**Recorded result — 2026-08-06.** The Founder/CTO narrowed the architecture-approval
gate to the seven incorporated construction-blocking changes and recorded DG-1 through
DG-4 above as deferred gates with controls. Every criterion in this document is accepted
on that basis. ADR-007 is Accepted. The Universal Object Contract remains **pre-stable**
and is not designated stable v1. The implementation freeze remains in effect. See
[CTO-DECISION-002](../../decisions/CTO-DECISION-002-sprint-2.5-approval.md).

