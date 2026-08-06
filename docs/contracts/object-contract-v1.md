# Universal Object Contract v1

Status: **Pre-stable** normative contract — accepted architecture, unfrozen shape  
Stability: **Not designated stable v1.** The `v1` in the title names the contract family,
not a frozen shape. See [Contract stability gate](#contract-stability-gate).  
Authority: [ADR-007](../decisions/ADR-007-universal-object-model.md) (Accepted 2026-08-06)  
Implementation: Not authorized; freeze in effect  
Implementation language: Unspecified  
Storage: Unspecified

## Contract scope

This contract defines the information and behavior every persistent AION entity must
support. It is a semantic contract. Programming-language types, database schemas, and
wire encodings must conform to it but are not selected here.

## Conformance rule

An entity conforms when:

1. it declares one Object profile and supported Object contract version;
2. all mandatory fields satisfy the universal invariants;
3. its type-specific data satisfies a registered, versioned schema;
4. changes occur only through its owning domain or privileged migration/import paths;
5. history, events, relationships, provenance, export, and owner-control behaviors
   satisfy their contracts; and
6. it passes shared language-neutral fixtures and behavioral conformance tests once
   implementation is authorized.

## Object profiles

| Profile | Mutable | Revision history | Emits events | Intended use |
|---|---|---|---|---|
| Entity | Yes, through domain commands | Yes | Yes | Domain records and current canonical state |
| Relationship | Yes, through relationship commands | Yes | Yes | Canonical typed edges |
| Version | No | No recursive version | No meta-events | Immutable committed revision evidence |
| Event | No | No recursive version | No meta-events | Immutable committed-fact notification |

Profile is immutable after creation. Converting between profiles requires a new Object.

## Canonical Entity and Relationship envelope

| Field | Required | Mutability | Constraint |
|---|---:|---|---|
| `objectId` | Yes | Immutable | Canonical lowercase RFC 9562 UUID; globally unique and never reused |
| `objectType` | Yes | Immutable | Owned namespaced type identifier |
| `objectProfile` | Yes | Immutable | Declared profile; `entity` or `relationship` in this table |
| `objectContractVersion` | Yes | Immutable per revision | Exact supported Object contract version |
| `schemaId` | Yes | Immutable per revision | Stable content-addressed or equivalently immutable schema identity |
| `schemaVersion` | Yes | Advances by migration | Positive monotonic type-schema version |
| `revision` | Yes | Advances | Starts at 1; increments exactly once per committed mutation |
| `ownership` | Yes | Explicit transition only | Contains one canonical `ownerId` in version 1 |
| `createdBy` | Yes | Immutable | Canonical Actor identity reference |
| `createdAt` | Yes | Immutable | Normalized UTC timestamp from an injected trusted clock |
| `modifiedBy` | Yes | Advances | Actor responsible for current revision |
| `modifiedAt` | Yes | Advances | Never earlier than creation or prior modification |
| `lifecycleState` | Yes | Defined transitions only | Current universal record state |
| `metadata` | Yes | Domain command | Bounded labels and registered extension namespaces |
| `provenanceSummary` | Yes | Append/replace by rule | Bounded origin evidence for current state |
| `permissionSetRef` | No | Explicit command | Scalar Object reference; conveys no authority by itself |
| `auditStreamRef` | No | Controlled | Stable reference to protected audit history, not embedded entries |
| `integrity` | Yes | Recomputed | Versioned algorithm and digest over canonical committed content |
| `data` | Yes | Domain command | Immutable value tree conforming to `schemaId` and `schemaVersion` |

`objectProfile` is universal and mandatory for all four profiles. This table states the
envelope for the two mutable profiles; the Version and Event sections below state the
same fields under their own profile rules. No profile omits a mandatory universal field.

The envelope contains no authoritative arrays of relationships, versions, events,
knowledge, memories, plans, capabilities, workflows, or audit entries. Those concerns
are supported through typed Relationship Objects and query contracts.

## Immutable Version profile

A Version Object uses the universal identity, type, profile, contract/schema version,
owner, creator, creation time, metadata, provenance, permission reference, audit
reference, integrity, and data concerns with these profile rules:

- `objectProfile` is `version`;
- revision is always 1 and never changes;
- creator and modifier are identical;
- creation and modification timestamps are identical;
- lifecycle is immutable active evidence until an approved retention process destroys
  protected content;
- data identifies subject Object, subject revision, previous Version Object when one
  exists, canonical revision representation or secure artifact reference, change
  summary, correlation, and migration information;
- it has no recursive Version Object and emits no Object event about its own creation.

## Immutable Event profile

An Event Object follows the same immutable profile shape, with:

- `objectProfile` equal to `event`;
- revision fixed at 1;
- data defined by the Object Event contract;
- no recursive Version Object; and
- no Object event emitted about the Event Object itself.

Event and Version profiles remain Objects because they are persistent, addressable,
owned, provenance-bearing, permissionable, auditable, exportable entities. Their
non-recursion is a universal invariant.

## Metadata

Metadata contains:

- a bounded, deduplicated set of normalized labels used for organization, not policy;
- namespaced extension objects whose namespace ownership is registered; and
- no field capable of overriding the envelope or type-specific data.

Metadata values are deterministic, finite, JSON-compatible values. Forbidden property
names, maximum depth, maximum encoded size, label limits, and namespace governance must
be fixed before implementation. Executable code, credentials, and secrets are invalid.

Unknown valid extensions must survive read/export/import round trips unchanged. An
unknown extension is not executed or interpreted implicitly.

## Provenance

Every Object supports provenance. The bounded summary records:

- origin category: owner-authored, imported, derived, observed, or system-produced;
- responsible Actor;
- observation and recording time;
- source Object or external source reference when permitted;
- derivation method identifier when derived;
- confidence when meaningful; and
- correlation to the operation that created the current state.

Detailed assertion-level provenance belongs in type data or related Provenance Objects
when required, particularly for Memory and Knowledge. Provenance is append-only evidence;
correction supersedes a claim and preserves history rather than editing evidence.

## Identity and ownership

Object consumes exactly two approved Identity identifier namespaces: `OwnerIdV1` for
canonical ownership and `ActorIdV1` for attribution. `PrincipalIdV1` and
`SystemInstanceIdV1` are Identity concerns and never appear in the Object envelope;
a system-originated change is attributed to an Actor whose Identity record resolves to
the system instance. The namespaces reserved by ADR-006 — `OrganizationId`,
`WorkspaceId`, `ServiceAccountId`, `PluginId`, and `RobotId` — must not be introduced
by an Object type, extension namespace, or relationship descriptor.

All identifiers are opaque. An Object ID, Owner ID, or Actor ID must not encode or
allow inference of owner, type, profile, tenant, storage location, shard, vendor,
sequence, or creation time. Sorting, routing, or access decisions must never be derived
from identifier structure.

- Object IDs, Owner IDs, and Actor IDs are different namespaces.
- An Object ID is not a credential and grants no access.
- Every Object has exactly one canonical owner in version 1.
- Ownership does not mean custody, authorship, subject identity, or authorization.
- Transfer requires a domain-approved command, expected revision, current and new
  owner references, Actor, provenance, permission evidence, Version Object, and event.
- Related Objects do not transfer automatically.
- Future multi-owner behavior requires a new ownership contract version; type data
  must not assume the owner is a person.

## Permission and audit references

`permissionSetRef` points to a future policy-owned Object describing applicable grants
or policy material. Object Model validates reference shape only. It never evaluates
the reference, infers roles, or treats absence/presence as authorization.

`auditStreamRef` identifies a protected audit domain stream or root Object. Operational
logs are not audit history. Audit records are independently permissioned, minimized,
and exportable under owner/security policy.

Before Policy exists, Object implementations must remain isolated and fail closed for
external or consequential mutations except an explicitly approved bootstrap ceremony.

## Cross-subsystem reference support

Every Object can participate in typed Relationships representing:

- `KnowledgeRef`: association with claims, concepts, evidence, or knowledge records;
- `PlannerRef`: association with goals, plans, decisions, assumptions, or outcomes;
- `MemoryRef`: association with semantic, procedural, episodic, or strategic memory;
- `CapabilityRef`: association with a capability definition, invocation, or result;
- `WorkflowRef`: association with a workflow definition, run, task, or approval; and
- domain-defined references registered under owned namespaces.

Support means Objects can be valid relationship endpoints and can be queried by
subject. These references are not embedded growing arrays and do not cause Object
Model to import or invoke the referenced subsystem.

## Universal operations

The contract permits these infrastructure-level operations:

| Operation | Authority |
|---|---|
| Validate envelope | Object invariant validator |
| Validate type data | Owning domain schema/validator through registry contract |
| Read current snapshot | Repository port after external access decision |
| Read versions/events/relationships | Dedicated query ports after external access decision |
| Commit prepared domain change | Aggregate repository port with expected revision |
| Export owner data | Export port with external approval/policy evidence |
| Import trusted package | Separate privileged import protocol |
| Migrate schema | Separate approved migration protocol |

There is no generic public create/update/delete method. Each owning domain defines
meaningful commands and produces a prepared change that satisfies this contract.

## Commit contract

A conforming aggregate commit receives:

- current subject identity and expected revision, or a domain-approved creation intent;
- complete validated next snapshot;
- exactly one complete immutable Version Object;
- zero or more complete immutable Event Objects;
- idempotency and correlation identity; and
- durable publication intent when event publication is asynchronous.

The commit is all-or-nothing. On conflict, no partial snapshot, version, or event is
visible. After a successful commit, event publication may retry without changing event
identity or domain truth. Cancellation after commit cannot undo or disguise success.

## Stable failure categories

| Failure | Meaning |
|---|---|
| Invalid Object | Universal envelope invariant failed |
| Unknown Object type | Type namespace is not registered |
| Unsupported contract | Object contract version is not readable/writable |
| Unsupported schema | Type schema/version is not supported |
| Invalid domain data | Owning domain validation failed |
| Not found | No visible Object resolves under the caller's access context |
| Revision conflict | Expected and committed revisions differ |
| Invalid lifecycle transition | Requested transition is not permitted |
| Invalid reference | Identity, relationship, permission, audit, or source reference is invalid |
| Owner mismatch | Operation context conflicts with canonical ownership |
| Authorization evidence required | External policy/approval evidence is absent |
| Commit failed | Atomic commit did not become authoritative |
| Publication pending/failed | Commit exists; immutable events require safe retry |
| Cancelled or deadline exceeded | Operation stopped before its authoritative boundary |

The category meanings above are normative. Stable machine-readable failure codes are
assigned when this contract is designated version 1, together with their fixtures; a
category name is not itself a wire code. Once assigned, a code's meaning is immutable
and a removed code is never reused.

Failures expose correlation and safe retry classification but not private content,
Object existence across an access boundary, credentials, or adapter internals. `Not
found` and `Authorization evidence required` must not be distinguishable in a way that
confirms the existence of an Object the caller cannot access.

## Export guarantee

Every owner can request a documented export containing authorized current Objects,
schemas, Relationships, Versions, Events, provenance, integrity information, and a
manifest. The format is open, versioned, deterministic, independently verifiable, and
does not require the original storage vendor to read.

Export never silently omits unknown extension data, rewrites identity, or claims that
derived indexes are canonical. Large artifacts may be separate manifest entries with
content hashes.

## Contract stability gate

This contract is **pre-stable**. Its architecture is accepted; its field shape is not
frozen and may still change without a major-version step. Before designation as stable
version 1, language-neutral fixtures must model at least Owner record, Document, Project,
Task, Memory, Capability, Workflow, Relationship, Version, and Event Objects and
demonstrate bounded size, round-trip export, migration, and domain-boundary conformance.

That gate is recorded as DG-3, and the canonical serialization it depends on as DG-2, in
the [Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
§Deferred implementation gates. Until both are satisfied, no document, schema, package,
or announcement may describe this contract as stable v1.

