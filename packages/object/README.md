# @aion/object

Minimum local, domain-neutral reference implementation of the Pre-stable Universal Object
Contract. It provides opaque Object IDs; closed Entity and Relationship envelopes; typed
`OwnerIdV1` and `ActorIdV1` references from `@aion/identity`; deterministic construction;
ACJ-1 validation, serialization, framing, and SHA-256 integrity; DG-4a limit enforcement; and a
replaceable revision-preserving repository port with in-memory and bounded local filesystem
reference adapters. It also registers the six required career entity family boundaries and the
RelationshipObject family with exactly seven allowed endpoint combinations.

The six career entity payloads are closed and empty; detailed career fields remain deferred.
RelationshipObject is the sole persisted edge truth. Explicit operations create initial Objects,
append expected revisions, create/append relationships, and load snapshots; no unrestricted mutation
or query API exists. The filesystem adapter requires an explicit `private/object-store` root, reuses
the Phase 3 privacy boundary, installs exact immutable ACJ-1 revisions without overwrite, and creates
nothing on import or construction.

Object identity and ownership are references, not credentials or access grants. The package does
not authenticate or authorize callers and does not read Identity persistence. It contains no real
Object state, career payload schema, Event Bus, Planner, Memory, Capability Registry, network,
telemetry, database, vector store, fixture corpus, or import/export behavior.

The implementation is reference evidence only. The Universal Object Contract remains Pre-stable;
DG-3 and DG-4b remain Open; normative fixtures remain unauthorized. Phase 6 career-input contracts
are separately implemented by `@aion/career-input` and do not expand this package or create Objects.
