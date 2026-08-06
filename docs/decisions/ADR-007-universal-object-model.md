# ADR-007: Universal Object Model

- Status: Accepted
- Date: 2026-08-06
- Accepted: 2026-08-06
- Decision owner: CTO
- Decision record: [CTO-DECISION-002](CTO-DECISION-002-sprint-2.5-approval.md)
- Implementation status: **Frozen.** Acceptance of this ADR does not lift the freeze.
- Contract stability: Universal Object Contract is **pre-stable**; not designated stable v1

## Governing documents

This decision is expressed by the following contract family. No other document in this
repository states the Object contract.

- [Object Model architecture](../architecture/object-model.md)
- [Universal Object Contract v1](../contracts/object-contract-v1.md)
- [Object Lifecycle Contract](../contracts/object-lifecycle.md)
- [Object Event Contract](../contracts/object-events.md)
- [Object Relationship Contract](../contracts/object-relationships.md)
- [Object Versioning Contract](../contracts/object-versioning.md)
- [Universal Object Model Threat Model](../security/object-threat-model.md)
- [Sprint 2.5 specification](../sprints/sprint-2.5/specification.md),
  [acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md), and
  [risks](../sprints/sprint-2.5/risks.md)

## Superseded design artifacts

The pre-review design in [`docs/sprints/sprint-2.5-object-model/`](../sprints/sprint-2.5-object-model/)
is superseded in full and retained only as review evidence. It must not be cited as a
contract. Its rejected elements are enumerated in the
[Sprint 2.5 Object Model Review](../reviews/sprint-2.5-object-model-review.md).

## Context

AION will manage durable entities across identity, memory, knowledge, planning,
capabilities, workflows, plugins, products, careers, communications, and future
domains. Without one universal contract, each subsystem would redefine identity,
ownership, provenance, metadata, lifecycle, relationships, permissions, history,
events, and versioning. Those definitions would drift and prevent reliable export,
migration, audit, and cross-domain reasoning.

The Architecture Readiness Review approved the direction with changes. It rejected a
maximal envelope, generic public mutation, duplicated relationship truth, unbounded
reference arrays, and recursively self-recording Event and Version Objects.

## Decision

Every persistent AION domain entity conforms structurally to the versioned Universal
Object contract. This is the meaning of “everything is an Object.” Implementations
may use composition, records, traits, interfaces, generated schemas, or inheritance;
no programming-language inheritance mechanism is mandated.

The base Object envelope is compact, bounded, and contains only universal scalar or
bounded concerns:

- globally unique Object identity and namespaced type;
- Object contract version, type schema version, and instance revision;
- exactly one canonical owner in version 1;
- creator, last modifier, and timestamps;
- record lifecycle state;
- bounded metadata and provenance summary;
- scalar references to access-control and audit domains when present;
- latest integrity descriptor; and
- type-specific data validated by its owning domain schema.

Growing collections are not embedded in the base snapshot. Relationships, history,
events, and cross-subsystem references are independently queryable first-class
Objects keyed to the subject. They do not require endpoint snapshot rewrites.

Four Object profiles share the universal identity, ownership, provenance, versioning,
and export rules while applying profile-specific mutation rules:

1. **Entity Object** — mutable through domain-owned commands and revision control.
2. **Relationship Object** — canonical typed edge between two Object identities.
3. **Version Object** — immutable record of one committed Entity or Relationship
   revision; it does not generate recursive versions or events.
4. **Event Object** — immutable committed-fact record; it does not generate recursive
   versions or events.

Object Model supplies contracts, invariant validation, lifecycle rules, type/schema
registration protocols, and persistence transaction boundaries. The domain owning an
Object type owns its business rules and mutation commands. There is no generic public
update operation capable of bypassing domain invariants.

Identity identifier contracts remain below Object. Persisted Identity records are
Entity Objects. Object never authenticates, authorizes, evaluates policy, invokes
downstream services, selects storage, or implements an Event Bus.

Every committed mutation atomically records the new canonical snapshot, its immutable
Version Object, its immutable Event Object or Objects, and durable pending-publication
state. Relationship mutations operate as their own aggregate commits and never update
endpoint arrays atomically.

## Object materialization boundary

An AION value becomes an Object when it is persistent, independently addressable,
owned, shared across a domain boundary, related, permissioned, audited, versioned, or
event-producing. Private variables, transient calculations, tokens, and rebuildable
indexes are not independently materialized merely to satisfy the slogan. If retained
as durable domain state, they must be represented as Object data or Objects.

## Alternatives considered

### Independent domain base models

Rejected because ownership, provenance, export, and lifecycle semantics would drift
and cross-domain tooling would require bespoke adapters.

### One mutable base class

Rejected because it creates language lock-in and encourages a God Object containing
domain behavior.

### Maximal envelope with embedded relationships, history, and events

Rejected because collections grow without bound, every mutation rewrites them, and
relationship truth becomes duplicated across edges and endpoints.

### Generic CRUD Object service

Rejected because generic update can bypass type-specific business invariants. Domains
must expose meaningful commands while conforming to universal commit protocols.

### Event sourcing as the universal source of truth

Rejected because current evidence does not justify forcing all domains into event
sourcing. Events are immutable committed facts; canonical snapshots remain valid
authoritative state in version 1.

### Events and versions outside Object

Rejected because they are persistent, owned, addressable, exportable entities. Explicit
immutable profiles prevent recursive meta-events and meta-versions.

## Consequences

### Benefits

- Uniform identity, ownership, provenance, lifecycle, history, export, and migration.
- Domain behavior remains cohesive and independently replaceable.
- Memory, Planner, Knowledge Graph, Workflow, Capability, and Plugin subsystems share
  references without shared storage.
- Relationship and history scale independently of Object snapshot size.
- Storage engines and event transports remain replaceable.

### Costs

- Every domain type requires a registered schema, conformance fixtures, and explicit
  mutation commands.
- Commits produce additional Version and Event Objects.
- Readers resolve relationships and history through ports rather than embedded arrays.
- Schema governance, migration compatibility, and export formats require long-term
  stewardship.

### Constraints

- Permission references confer no authority.
- Events describe committed facts and invoke no downstream service.
- Knowledge, Memory, Planner, Capability, and Workflow references do not transfer
  business ownership to Object Model.
- No storage-specific identifier, transaction, query, or serialization concept may
  enter the public contract.

## Required subordinate decisions before implementation

1. Canonical serialization and integrity algorithm agility.
2. UUID generation profile and entropy requirements.
3. Identity bootstrap for the first Owner and Actor.
4. Bootstrap authorization before the policy subsystem exists.
5. Extension namespace registration and bounded resource limits.
6. Deletion, destruction, retention, and backup-erasure evidence by data class.
7. Portable aggregate commit and outbox conformance semantics.

None of these are closed by acceptance of this ADR. Items 1, 3, 4, and 5 are recorded as
enforceable deferred gates DG-1 through DG-4 in the
[Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md), each with
owner, rationale, risk, affected components, blocking gate, required evidence, and review
trigger.

## Review triggers

- A representative domain cannot conform without violating its responsibility.
- Envelope size or write amplification fails approved local-device benchmarks.
- Multi-owner collaboration requires ownership semantics beyond the version 1 seam.
- A bounded domain demonstrates a justified need for event sourcing.
- Cross-process operation requires a new consistency or transaction boundary.

## Approval effect

Acceptance of this ADR is an **architecture-boundary decision only**. It is not
implementation readiness and not contract stability.

### Acceptance authorizes

- subordinate architectural decisions;
- language-neutral schemas;
- representative fixtures;
- failing contract and conformance tests;
- deterministic test adapters; and
- further design validation.

### Acceptance does NOT authorize

- production Object implementation;
- Identity implementation;
- persistence adapters;
- databases;
- Event Bus implementation;
- Planner implementation;
- Memory implementation;
- Knowledge Graph implementation;
- Workflow Engine implementation;
- Capability Registry implementation;
- plugins;
- agents;
- user interfaces; or
- external integrations.

The implementation freeze remains in effect. Nothing in this ADR, and no subordinate
artifact produced under it, lifts that freeze; only a separate recorded CTO decision can.
The Universal Object Contract remains pre-stable until the deferred gates for
representative fixtures and canonical serialization are satisfied.

