# Sprint 2.5: Universal Object Model specification

Status: Proposed—implementation prohibited until approval  
Owner: CTO  
Component: Universal Object Model

## Purpose

Provide one durable, language-neutral foundation for every AION domain entity so
identity, ownership, provenance, relationships, permissions, history, events, and
versioning remain consistent across decades of subsystem evolution.

## Responsibility

The Object Model has one responsibility: define and enforce the canonical structural
envelope and lifecycle invariants shared by every AION domain entity.

It does not own type-specific business behavior, authentication, authorization,
workflow decisions, event delivery, storage technology, search, graph queries, or UI.

## Scope

Every persisted, addressable, shareable, relatable, permissioned, historical, or
event-producing AION entity is an Object. Examples include Identity records, Projects,
Tasks, Documents, Meetings, Memories, Relationships, Object revisions, domain events,
plans, workflows, capability descriptors, workers, integrations, and configuration
entities.

Language/runtime primitives and private local variables are values, not standalone
domain entities. If such a value crosses a public domain boundary or gains its own
identity/lifecycle, it becomes Object data or an Object.

## Structural inheritance

Every concrete type conforms to `AionObjectV1<TData>` and declares:

- a globally unique UUID `id`;
- stable `objectType` namespace;
- Object contract version and domain schema version;
- monotonically increasing `revision`;
- ownership and actor attribution;
- creation/update timestamps;
- lifecycle state;
- bounded metadata and provenance;
- relationship, permission, history, and event references;
- integrity token; and
- type-specific `data` validated by its registered schema.

Structural conformance is normative. A language may implement it with composition,
interfaces, traits, generated records, or inheritance without changing the contract.

## Required inherited concerns

### UUID

`ObjectIdV1` is a canonical lowercase RFC 9562 UUID string. The generation strategy
is injected and replaceable. IDs are immutable, never reused, contain no vendor or
business meaning, and do not establish authorization.

### Metadata

Metadata separates reserved system fields from namespaced extensions. Extension keys
must be registered URI-like namespaces, size-limited, JSON-compatible, and incapable
of overriding system fields or type data.

### Relationships

Objects reference first-class `ObjectRelationshipV1` Objects by ID. Relationships
are typed, directed, versioned, provenance-bearing, and independently lifecycle-managed.
See [relationship model](object-relationship-model.md).

### Permissions

Objects hold immutable `PermissionReferenceV1` values pointing to future policy/grant
Objects. They never contain evaluated roles, ambient ACL logic, credentials, or an
authorization result. Until policy exists, protected operations fail closed except
for explicitly defined bootstrap-owner behavior.

### History

`historyRefs` identify immutable Object Revision Objects. History is append-only;
correction creates a new revision rather than overwriting evidence.

### Events

`eventRefs` identify immutable committed-fact Object Event Objects. Events publish
through a port and never cause the Object Model to call consumers. See
[event specification](object-event-specification.md).

### Version

Three versions are distinct:

- `objectContractVersion`: shape/semantics of the universal envelope.
- `schemaVersion`: shape/semantics of `data` for its `objectType`.
- `revision`: optimistic concurrency sequence for this Object instance.

Package versions are release metadata and never substitute for these fields.

### Ownership

Every Object has exactly one canonical `ownerId` in v1 and records creating/updating
actors. Ownership transfer is an explicit lifecycle operation requiring expected
revision, provenance, audit event, and future policy approval. Ownership does not
imply that every custodian or storage provider may read content.

## Core invariants

1. All domain entities conform to exactly one supported Object contract version.
2. ID, object type, creator, and creation time are immutable.
3. Revision begins at 1 and increments exactly once per committed mutation.
4. Updated time never precedes created time and advances with each revision.
5. Owner is mandatory; transfer is explicit and historical.
6. Type data validates against the declared object type and schema version.
7. References are kind-valid and cannot be used as embedded authority.
8. Metadata cannot override reserved fields or type-specific data.
9. History and events are append-only references to immutable Objects.
10. Tombstoned Objects cannot be mutated or resurrected under the same ID.
11. Every mutation records actor, provenance, correlation, and expected revision.
12. Storage adapters cannot weaken these invariants.

## Object type registry

The Object Model requires a replaceable `ObjectTypeRegistryV1` contract containing
type name, current/supported schema versions, validators, migration descriptors, and
extension constraints. This is schema registration—not the future Capability
Registry—and it invokes no domain behavior.

Type names use reverse-domain-style namespaces controlled by AION or installed
extensions, for example `org.aion.project`. Names are immutable once persisted.

## Persistence boundary

Repositories operate on complete immutable Object snapshots and expected revisions.
No domain package shares database tables or imports a concrete repository. Transactions
must atomically persist the new Object revision, revision record, and pending domain
events or prove equivalent delivery guarantees.

No storage engine is selected in Sprint 2.5.

## Data portability

Canonical export includes Objects, referenced revisions, relationships, event records,
schemas/versions, provenance, and integrity data in an owner-readable, documented
format. Unknown valid extension data survives round-trips. Import never rewrites IDs,
owners, timestamps, or history silently.

## Observability

Operations expose stable outcome codes, duration, object type, contract/schema version,
and correlation ID. Ordinary operational telemetry excludes Object IDs, owner IDs,
content, metadata, and relationship targets by default. Owner audit is a protected
Object domain, not an unrestricted log stream.

## Non-goals for v1

- Multi-owner Objects or organization/workspace tenancy.
- Authorization policy implementation.
- Event Bus implementation or subscriber behavior.
- Full-text/semantic search or Knowledge Graph implementation.
- Distributed transactions, synchronization, or conflict-free replication.
- Physical purge rules before retention and audit semantics are approved.
- A universal bag of domain business methods.

## Dependencies

Object contracts depend only on approved Identity identifier contracts, JSON-compatible
value definitions, and injected clock/UUID primitives. Domain types depend on Object;
Object never imports a domain package.

## Acceptance criteria

See [acceptance criteria](acceptance-criteria.md). No implementation begins until all
design artifacts and ADR-007 are approved.

