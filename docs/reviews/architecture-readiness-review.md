# Sprint 2.5 Architecture Readiness Review

Review subject: Proposed Universal Object Model and ADR-007  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-05  
Decision scope: Architecture readiness only; no implementation authorization

## Executive summary

The proposed Universal Object Model has a strong architectural center: structural
conformance instead of language-specific class inheritance, explicit ownership and
provenance, three separate version concepts, optimistic concurrency, replaceable
ports, committed-fact events, and clear separation from authorization, storage, and
the future Knowledge Graph.

It is not ready for implementation unchanged. Four design contradictions create
material construction risk:

1. Event Objects, Revision Objects, and Relationship Objects inherit the same history
   and event obligations as ordinary Objects, causing recursive meta-history and
   meta-event creation unless special profiles are defined.
2. Canonical Relationship Objects coexist with embedded `relationshipRefs` on endpoint
   Objects. This creates multiple sources of truth and requires multi-aggregate atomic
   writes.
3. `ObjectServiceV1.update()` is a generic public mutation path that can bypass the
   business invariants of the domain owning a concrete Object type.
4. Arrays for relationships, permissions, history, events, and provenance grow with
   Object activity. Keeping them in every snapshot creates unbounded objects, write
   amplification, and storage coupling.

The design should remain structurally universal, but the envelope must become smaller,
aggregate-safe, and explicit about infrastructure Object profiles before construction.

## Evidence reviewed

- ADR-007: Universal Object Model.
- Sprint 2.5 Object Specification.
- Object API Contract v1.
- Object Relationship Model v1.
- Object Lifecycle v1.
- Object Event Specification v1.
- Universal Object Model Threat Model.
- Sprint 2.5 acceptance criteria.
- Accepted ADR-006 and the amended Identity specification.
- AION v2 dependency rules, master plan, migration plan, and architecture audit.

## 1. Separation of Concerns

### Current design assessment

The design correctly limits Object Model responsibility to the universal structural
envelope and its invariants. Authentication, authorization, domain behavior, event
transport, storage, graph queries, and UI are explicitly excluded. Structural
inheritance avoids requiring one language-specific base class.

The proposed `ObjectServiceV1`, however, combines envelope construction, validation,
lifecycle transitions, ownership transfer, repository coordination, revision creation,
and event publication. Generic `update()` also overlaps with every domain's command
handling responsibility.

### Risks

- Object Model becomes a central application service rather than a foundational
  contract library.
- Generic updates bypass Project, Task, Memory, Workflow, or Identity invariants.
- Ownership transfer introduces policy-sensitive orchestration before policy exists.
- Future convenience methods accumulate in the universal service.

### Alternatives considered

- Keep the current universal CRUD service.
- Give every domain direct repository access.
- Split pure envelope/invariant functions, persistence ports, and domain-owned command
  services.

### Recommendation

Split the design. Object Model should own pure envelope validation, lifecycle-state
rules, common value types, type registration contracts, and persistence interfaces.
Domain services should own creation and mutation of their concrete Object types.
Restrict generic mutation to controlled migration/import infrastructure; do not make
`ObjectServiceV1.update()` the normal public write API.

## 2. Domain Boundaries

### Current design assessment

The proposal states that type-specific business rules remain in owning domains and
that Object never imports domain packages. This is correct. Namespaced object types
and schemas provide a viable extension boundary.

The boundary between universal lifecycle rules and domain lifecycle rules remains
unclear. For example, a Task may be completed while its Object envelope stays active;
a Workflow may be paused; an Identity may be disabled. The base states do not replace
those domain states, but this distinction is only implied.

### Risks

- Teams treat `archived` as a substitute for domain completion, disablement, or
  cancellation.
- The type registry becomes a location for domain business behavior.
- Schema migration ownership shifts ambiguously between Object Model and domains.

### Alternatives considered

- Put all lifecycle states in the universal envelope.
- Let every domain redefine Object lifecycle.
- Retain a minimal storage/availability lifecycle and explicitly separate domain state.

### Recommendation

Define base lifecycle as record availability only. Require every domain specification
to define its own business state separately. The type registry may locate validators
and migration descriptors but must not execute domain workflows or own business rules.
Domain packages own schema semantics and migration code; Object Model enforces the
common migration protocol.

## 3. Coupling

### Current design assessment

Ports, structural conformance, adapter isolation, and language-neutral schemas reduce
implementation coupling. Depending only on Identity identifier contracts avoids an
Identity implementation cycle.

The envelope currently couples every Object write to relationship, permission,
revision, event, provenance, integrity, schema-registry, and actor concerns. Embedded
reference arrays also couple endpoint mutations to independently canonical Objects.

### Risks

- A change in any cross-cutting subsystem forces every Object writer to change.
- Relationship creation requires rewriting source and possibly target snapshots.
- Event/history retention choices alter the base Object representation.
- Plugin and domain teams become dependent on central release cadence.

### Alternatives considered

- Keep all inherited collections embedded for convenient reads.
- Store only IDs for all concerns in the envelope.
- Keep stable scalar references in the envelope and move growing collections to
  canonical related Objects or queryable indexes.

### Recommendation

Minimize the base envelope. Retain stable scalar identity, type, versions, ownership,
actor/timestamps, lifecycle, bounded metadata, latest integrity, and type data.
Represent relationships, revisions, events, and potentially permission assignments as
separate canonical Objects queried by subject ID. If summary fields are retained, mark
them explicitly non-authoritative and bounded.

## 4. Cohesion

### Current design assessment

Identity, ownership, revision, lifecycle, and provenance form a cohesive universal
record concept. Relationship, event, and history details are individually well
specified but make the base envelope less cohesive when embedded as mutable lists.

### Risks

- The Object envelope becomes a container for every platform concern.
- Universal fields are added because they are broadly useful rather than universally
  invariant.
- Different Object profiles populate most fields with empty arrays, signaling weak
  cohesion.

### Alternatives considered

- One maximal envelope for uniformity.
- Small core envelope plus composable standard facets.
- Independent domain envelopes with no universal structure.

### Recommendation

Adopt a small mandatory core plus versioned standard facets. Ownership, provenance,
and integrity may be mandatory facets if evidence confirms universal use. Growing
associations should not be embedded. Each mandatory field must have a universal
invariant and meaningful value for Event, Revision, Relationship, Identity, and normal
domain Objects.

## 5. Event Flow

### Current design assessment

The design correctly treats events as immutable committed facts, separates publisher
from transport and subscribers, requires idempotency, correlation, causation, and
subject ordering, and recommends an atomic outbox. It explicitly prohibits downstream
invocation.

Making every event a full Object creates recursion: creating an Event Object normally
requires its own Revision Object and `ObjectCreatedV1` event. The proposed exception
that event `eventRefs` are empty is not generalized or reconciled with the universal
invariants.

### Risks

- Infinite meta-event and meta-revision generation.
- Special cases implemented inconsistently across adapters.
- High write amplification for every domain mutation.
- Event retention and Object deletion semantics conflict.

### Alternatives considered

- Events are full ordinary Objects with recursive history.
- Events are transport envelopes outside the Object Model.
- Events structurally inherit Object identity/ownership/provenance through a defined
  immutable system-Object profile that does not emit lifecycle events about itself.

### Recommendation

Define explicit Object profiles before approval: aggregate Object, Relationship Object,
Revision Object, and Event Object. Event and Revision profiles must be immutable
terminal records that do not recursively generate their own revisions or creation
events. Specify whether their omission of meta-history is a contract invariant rather
than an implementation exception. Preserve outbox, at-least-once, and no-downstream-call
rules.

## 6. Identity Integration

### Current design assessment

The design correctly depends on approved opaque Identity identifier contracts rather
than credentials or policy. Persisted Identity records conform through an implementation
layer, avoiding an identifier-contract/Object package cycle. Actor and owner attribution
are mandatory.

Creation still assumes that valid `OwnerIdV1` and `ActorIdV1` values can be resolved,
while Identity is not implemented. Bootstrap ownership and system actor creation are
unresolved threat-model items.

### Risks

- Circular bootstrap: Identity records need Object, while Objects need an existing
  owner and actor.
- Callers may treat possession of an ID as authentication.
- Tombstoning Identity Objects may break historical attribution.

### Alternatives considered

- Implement Object before Identity and use raw strings temporarily.
- Exempt Identity records from Object.
- Define a deterministic, audited bootstrap ceremony using approved Identity
  primitives, then materialize Identity records as Objects.

### Recommendation

Do not use temporary raw IDs or exempt Identity. Specify the bootstrap ceremony,
bootstrap actor limitations, and historical Identity-reference behavior before
implementation. Identity validation must be a port; Object Model must never interpret
credentials or policy.

## 7. Memory Integration

### Current design assessment

The envelope supports Memory's required owner, provenance, timestamp, confidence,
relationships, and version concerns. Semantic, procedural, episodic, and strategic
memory can become distinct namespaced Object types.

The design does not distinguish a Memory Object's canonical metadata from potentially
large content, embeddings, indexes, derived representations, or source artifacts.

### Risks

- Large content and embeddings are copied into every revision/event path.
- Provider-specific vector representations leak into canonical Objects.
- Confidence in universal provenance conflicts with domain-specific claims having
  different confidence per assertion.
- Tombstone and source deletion fail to propagate to derived memories.

### Alternatives considered

- Store all memory content and embeddings directly in Object data.
- Keep only metadata Objects with all content in opaque storage.
- Use Objects for canonical memory records and content-addressed attachment/artifact
  Objects for large or derived data; keep indexes as rebuildable adapters.

### Recommendation

Specify canonical content versus derived projection boundaries before Memory. Embeddings
and indexes must remain replaceable projections, not universal Object fields. Provenance
must support assertion-level detail in Memory data without bloating the base envelope.
Define deletion propagation and derivation lineage as Memory requirements.

## 8. Planner Integration

### Current design assessment

Goals, plans, decisions, assumptions, evidence, and approval requests can conform to
Object without Planner coupling. The event model supports Planner observing committed
changes asynchronously.

The “everything is Object” rule could encourage persisting every transient candidate,
token-level inference, or intermediate reasoning state. That would create noise,
privacy risk, and storage cost.

### Risks

- Planner uses generic Object mutation instead of domain commands.
- Unbounded planning artifacts pollute Memory and audit history.
- Events are mistaken for authority to execute.
- Sensitive model reasoning is stored without necessity.

### Alternatives considered

- Persist every Planner intermediate as an Object.
- Persist only final plans and decisions.
- Define explicit materialization rules for durable evidence, decisions, plans, and
  approved learning while keeping transient computation ephemeral.

### Recommendation

Before Planner design, define which artifacts cross the materialization boundary.
Persist owner-relevant inputs, evidence, decisions, plans, approvals, and outcomes—not
unbounded internal reasoning. Planner must consume events as signals, re-resolve current
state, and obtain separate approval/capability authority before execution.

## 9. Capability Registry Compatibility

### Current design assessment

Capability descriptors, versions, schemas, grants, and invocation records can be
Objects. Namespaced types and versioned data are compatible with replaceable
capabilities. The Object type registry is correctly distinguished from the future
Capability Registry.

### Risks

- The two registries acquire overlapping discovery and validation responsibilities.
- Capability input/output schemas are confused with Object schemas.
- Permission references in Objects are treated as capability grants.

### Alternatives considered

- Merge Object Type and Capability registries.
- Keep them entirely unrelated.
- Keep separate responsibilities with shared versioned-schema primitives.

### Recommendation

Keep registries separate. Object Type Registry answers “is this durable entity valid?”
Capability Registry answers “what action can be invoked under what contract?” Share
schema/version primitives only. Capability grants must be policy Objects and confer no
authority until evaluated by policy.

## 10. Future Multi-owner Support

### Current design assessment

Single canonical owner in v1 is simple and secure by default. Cross-owner relationships
fail closed, and Organization/Workspace identifiers are reserved rather than prematurely
implemented.

Ownership is embedded as exactly one `ownerId` in every Object and duplicated in event
data. Moving later to shared, delegated, organizational, or workspace custody could
touch every schema, query, index, event, and adapter.

### Risks

- A v2 multi-owner migration becomes platform-wide and expensive.
- “Owner,” “custodian,” “controller,” and “subject” become conflated.
- Ownership transfer cannot model shared or delegated control.

### Alternatives considered

- Implement multi-owner support now.
- Keep a single scalar forever.
- Preserve single-owner v1 while defining an ownership-subject abstraction and explicit
  forward migration seam.

### Recommendation

Do not implement multi-owner behavior now. Rename semantics precisely: canonical data
owner versus custodian/subject. Define how `ObjectOwnershipV1` can migrate to a later
ownership Object/reference without rewriting type data. Avoid assumptions that owner
ID is a person or an authorization grant.

## 11. Plugin Compatibility

### Current design assessment

Namespaced object types and metadata extensions allow plugins to define data without
changing the base envelope. Language-neutral schemas and unknown-extension round trips
support portability.

Namespace ownership, schema signing, plugin removal, orphaned Objects, migrations, and
resource limits remain unspecified. Reserved `PluginId` is intentionally unimplemented.

### Risks

- Namespace squatting or collision.
- Malicious schemas/validators execute with excessive authority.
- Removing a plugin makes owner data unreadable or unmigratable.
- Extensions become a bypass around domain schema review.

### Alternatives considered

- Allow arbitrary plugin namespaces and executable validators.
- Require every plugin type in the central AION schema set.
- Use signed/owned namespaces, declarative schemas, sandboxed migrations, and durable
  fallback export/read behavior.

### Recommendation

Define namespace ownership and orphan-data behavior before plugin implementation, not
before the Object core. Object readers must preserve and export unknown plugin Objects
without executing plugin code. Validators and migrations require isolation, resource
limits, provenance, and explicit owner approval.

## 12. Versioning Strategy

### Current design assessment

Separating Object contract version, type schema version, instance revision, event
contract version, and package release version is excellent. Coexistence and prohibition
of silent downgrade are appropriate.

Compatibility rules for schema descriptors, canonical serialization, migration chains,
and unknown versions are not fully normative. Numeric `schemaVersion` does not specify
major/minor compatibility semantics.

### Risks

- Different adapters interpret compatibility differently.
- Long migration chains become untestable.
- Hashes change across serialization implementations.
- An additive schema change increments versions inconsistently.

### Alternatives considered

- Semantic-version strings for every layer.
- Monotonic integer schema versions with descriptor-declared compatibility.
- Content-addressed schemas plus human release versions.

### Recommendation

Retain the three core version dimensions. Before implementation, specify immutable
schema IDs/digests, monotonic migration edges, compatibility declarations, canonical
serialization, supported-version windows, and golden fixtures. Do not infer
compatibility from version numbers alone.

## 13. Migration Complexity

### Current design assessment

The proposal requires explicit, attributed, checkpointed, idempotent schema migrations
with history and rollback evidence. This is appropriately cautious.

Every migration currently creates a new Object snapshot, Revision Object, Event Object,
updated reference arrays, integrity hash, and potentially relationship validation. The
write multiplier and recursive system-Object issue make bulk migration costly.

### Risks

- Large migrations exceed local-device time or storage budgets.
- Partial migrations create mixed schema populations not handled by readers.
- Plugin migration code becomes a supply-chain execution path.
- Rollback claims are impossible for lossy transformations.

### Alternatives considered

- Eagerly migrate all Objects before application startup.
- Read-old/write-new lazy migration.
- Background checkpointed migration with dual-version readers.

### Recommendation

Require dual-version read support and checkpointed background migration for persisted
releases. Migration descriptors must state reversibility and information loss. Remove
growing reference arrays from snapshot rewrites. Establish workload benchmarks and
failure-injection tests before selecting a default migration mode.

## 14. Testability

### Current design assessment

Injected clocks, UUID generators, repositories, publishers, registries, cancellation,
expected revisions, stable errors, and language-neutral fixtures make the design
highly testable. The proposed security/property/conformance tests are strong.

The contract uses `AbortSignal` in allegedly language-neutral semantics, and atomic
commit requirements are not expressed as a portable conformance protocol.

### Risks

- In-memory adapters pass while durable adapters violate atomicity or crash recovery.
- TypeScript-specific cancellation leaks into normative cross-language contracts.
- Timing and concurrency tests become nondeterministic.

### Alternatives considered

- Test only domain validation.
- Require one shared adapter implementation.
- Publish behavioral conformance suites and fault-injection scenarios per port.

### Recommendation

Define language-neutral cancellation/deadline semantics, then map them to `AbortSignal`
in TypeScript. Conformance must include crash points around snapshot/revision/event
commit and publication, not just happy-path repository calls. Use deterministic clocks,
IDs, and schedulers in tests.

## 15. Security Boundaries

### Current design assessment

The threat model correctly treats IDs as non-credentials, permission references as
non-authoritative, adapters as untrusted infrastructure, cross-owner access as fail
closed, and events as minimal facts. Mass assignment, schema confusion, relationship
inference, replay, tombstone resurrection, and migration threats are recognized.

The policy subsystem does not yet exist, but API operations include transfer,
relationships, reads, and tombstoning whose safety depends on policy. Bootstrap-owner
behavior and protected audit access are unresolved.

### Risks

- A reference implementation accidentally treats owner equality as complete
  authorization.
- Generic read errors leak Object existence.
- Extension schemas or migrations execute unsafe code.
- Integrity hashes are mistaken for authenticity without keyed signatures/trust roots.

### Alternatives considered

- Delay all Object work until full policy implementation.
- Implement implicit owner-only checks in Object Model.
- Implement pure Object contracts/invariants first with a fail-closed authorization
  port and no external/durable exposure.

### Recommendation

Object Model must accept authorization evidence from a separate port/context and must
never decide policy. Until policy exists, implementation scope—when approved—should be
pure contracts, validation, and isolated in-memory conformance only. Define bootstrap,
non-enumerating read behavior, canonical hashing versus authenticity, and migration
sandboxing before persistence or external APIs.

## 16. Performance Risks

### Current design assessment

The design acknowledges size limits and pagination, but the envelope contains multiple
arrays that grow with activity. Each mutation creates at least a snapshot, revision,
event, pending publication record, hashes, and array copies. Relationship operations
may rewrite multiple Objects.

### Risks

- Quadratic storage/write cost as history and event reference arrays grow.
- Large snapshots increase memory, serialization, hashing, and sync cost.
- High-frequency Objects produce excessive immutable system Objects.
- Generic JSON data and validation become CPU bottlenecks on local devices.

### Alternatives considered

- Accept write amplification for complete self-contained snapshots.
- Store delta/event history only.
- Keep current snapshot compact and maintain append-only history/events/relationships
  in separately indexed stores using the same Object identity model.

### Recommendation

Remove unbounded reference arrays from canonical snapshots or cap them as explicitly
non-authoritative summaries. Benchmark representative high-churn Task, Workflow,
Memory, and event workloads. Define maximum envelope/data/metadata/reference sizes and
streaming import/export before freezing v1.

## 17. Storage Independence

### Current design assessment

Repository ports, JSON-compatible data, replaceable type registries, no selected
database, and a rebuildable Knowledge Graph support storage independence.

The atomic change set spans snapshot, revision, events, outbox, and relationship
changes. This assumes transactional capabilities that not all local stores provide.
Canonical queries and pagination semantics are also underspecified.

### Risks

- The contract secretly requires a relational transactional store.
- Adapters simulate atomicity differently and become behaviorally incompatible.
- Integrity and ordering depend on storage-specific serialization.

### Alternatives considered

- Require ACID transactions as an adapter capability.
- Use event sourcing as the only store.
- Define a minimal atomic aggregate boundary and capability-declared adapters.

### Recommendation

Reduce the atomic boundary to one aggregate snapshot plus its immutable revision/event
records and outbox entry. Relationship Objects should be independent aggregates with
eventual projections, not atomic endpoint-array updates. Specify repository consistency,
transaction, pagination, and crash-recovery capabilities in conformance tests. Reject
adapters that cannot meet the chosen minimum rather than weakening semantics.

## 18. API Stability

### Current design assessment

The versioned import path, stable error codes, immutable records, full-replacement
updates, and expected revisions are good foundations. The proposal correctly avoids
generic JSON Patch.

The API is labeled a normative contract while major unresolved decisions affect its
field set and service boundaries. Optional IDs on create, raw URI provenance, generic
read typing, error privacy, integrity algorithm, and transfer semantics need refinement.

### Risks

- Premature v1 commitment creates immediate v2 pressure.
- Optional caller-supplied IDs permit collision/import ambiguity.
- Stable errors become information side channels.
- A fixed `sha-256` field conflates hash agility with contract major version.

### Alternatives considered

- Freeze the current API before implementation.
- Keep all contracts internal until production use.
- Mark an experimental `v0` design contract, validate with representative types, then
  approve v1 before persistence.

### Recommendation

Do not call the current shape stable v1. Treat it as a proposed contract and validate
with Identity Record, Project, Task, Memory, Relationship, Revision, and Event fixtures.
Resolve required changes, publish golden schemas, then designate v1. Separate normal
creation from trusted import with caller-supplied IDs. Make integrity algorithms
versioned/agile.

## 19. Long-term Maintainability

### Current design assessment

The architecture is documentation-first, versioned, model/vendor neutral, local-first,
and designed for conformance. These choices support a decades-long platform. Structural
inheritance and replaceable adapters are maintainable.

The maximal envelope and central service are likely to attract every future concern.
The phrase “everything inherits Object” may be interpreted as permission to persist
everything or centralize all behavior.

### Risks

- God Object and God Service emerge gradually.
- Universal schema governance becomes a bottleneck.
- Empty/irrelevant inherited fields proliferate.
- Exceptions for system Objects undermine trust in universal invariants.

### Alternatives considered

- Abandon the Universal Object Model.
- Keep one maximal mandatory structure.
- Retain a minimal universal Object identity/envelope with governed facets and profiles.

### Recommendation

Retain the Universal Object Model, but explicitly state two rules: every domain entity
has Object identity/envelope; not every runtime value must be materialized as a durable
Object. Establish a base-field admission test requiring universality, stable semantics,
bounded size, and implementation independence. Add Object-profile conformance and a
schema governance process.

## 20. Risks and Unknowns

### Current design assessment

The documents identify several residual decisions, but the combined readiness impact
is larger than the threat model alone indicates.

### Risks

The highest unresolved risks are:

1. recursive Event/Revision Object behavior;
2. multiple relationship sources of truth;
3. unbounded envelope collections and write amplification;
4. generic mutation bypassing domain invariants;
5. Identity/Object bootstrap;
6. policy absence and bootstrap authorization;
7. canonical serialization and hash agility;
8. schema namespace ownership and plugin orphaning;
9. deletion versus audit/history/event retention;
10. atomicity assumptions and durable event publication;
11. single-owner migration seam;
12. materialization boundaries for Planner and other transient computation.

### Alternatives considered

- Accept all unknowns and discover them during implementation.
- Reject the Universal Object concept entirely.
- Resolve construction-blocking contradictions now and defer bounded future-domain
  details behind explicit extension seams.

### Recommendation

Resolve the first seven risks before any production implementation. Document explicit
extension seams and review triggers for the remaining future-domain risks. Use concrete
fixtures and sequence diagrams to validate the revised design without writing
production code.

## Required architecture changes before implementation

1. **Define Object profiles.** Specify ordinary aggregate, Relationship, Revision,
   and Event profiles, including which universal fields apply and how immutable system
   Objects avoid recursive history/events.
2. **Eliminate relationship dual truth.** Remove authoritative `relationshipRefs` from
   endpoint snapshots or define them as bounded, rebuildable projections. Relationship
   Objects remain canonical.
3. **Remove unbounded inherited arrays.** History, events, relationships, and other
   growing collections must be separately queryable; snapshots may contain only
   bounded non-authoritative summaries.
4. **Narrow the universal API.** Remove generic public domain mutation. Domain services
   own concrete Object creation/update; Object Model supplies invariant and persistence
   protocols. Separate trusted import from normal creation.
5. **Specify Identity bootstrap.** Define first Owner/Actor creation and historical
   identity-reference behavior without raw temporary identifiers or policy assumptions.
6. **Define the authorization seam.** Object Model consumes external authorization
   evidence and fails closed; it never equates ownership or permission references with
   authority.
7. **Complete version/integrity rules.** Specify canonical serialization, schema IDs,
   migration graphs, compatibility fixtures, and hash algorithm agility.
8. **Constrain atomicity.** Define one aggregate commit boundary and portable crash
   recovery/outbox conformance. Avoid atomic endpoint rewrites for relationships.
9. **Validate representative fixtures.** Model Identity Record, Project, Task, Memory,
   Relationship, Revision, and Event examples before declaring the API stable v1.
10. **Set measurable limits.** Define maximum data, metadata, provenance, extension,
    and event sizes and benchmark high-churn local-first workloads.

## Conditions that may remain deferred

The following do not block a pure Object core once explicit extension seams exist:

- multi-owner runtime behavior;
- Organization, Workspace, Service Account, Plugin, and Robot identifiers;
- durable database selection;
- Event Bus implementation;
- Knowledge Graph implementation;
- Planner, Capability Registry, Workflow, Worker, or plugin implementation;
- remote synchronization and distributed transactions.

Deferral must not result in hardcoded assumptions that make these changes impossible.

## Final CTO recommendation

# APPROVE WITH CHANGES

ADR-007 and Sprint 2.5 should not be implemented in their current form. The Universal
Object Model direction is sound and should be preserved, but the required architecture
changes above must be incorporated into revised design documents and re-reviewed.

This decision authorizes documentation revision only. It does not authorize production
code, Object Model implementation, Identity implementation, Planner implementation, or
selection of a storage/event vendor.
