# @aion/object

Minimum local, domain-neutral reference implementation of the Pre-stable Universal Object
Contract. It provides opaque Object IDs; closed Entity and Relationship envelopes; typed
`OwnerIdV1` and `ActorIdV1` references from `@aion/identity`; deterministic construction;
ACJ-1 validation, serialization, framing, and SHA-256 integrity; DG-4a limit enforcement; and a
replaceable revision-preserving repository port with an in-memory reference adapter.

Object identity and ownership are references, not credentials or access grants. The package does
not authenticate or authorize callers and does not read Identity persistence. It contains no
filesystem adapter, real Object state, career type, Event Bus, Planner, Memory, Capability Registry,
network, telemetry, database, vector store, fixture corpus, or import/export behavior.

The implementation is reference evidence only. The Universal Object Contract remains Pre-stable;
DG-3 and DG-4b remain Open; normative fixtures and Phase 6 remain unauthorized.
