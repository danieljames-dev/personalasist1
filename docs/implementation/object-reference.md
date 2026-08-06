# Minimum Universal Object Reference Implementation

The implementation is the `@aion/object` workspace. `contracts.ts` defines the closed reference
envelope and ports; `canonical.ts` implements the ACJ-1 value boundary, raw JSON parser, canonical
serializer, AION Frame v1, and SHA-256 adapter; `object.ts` constructs, seals, and validates Objects;
and `repository.ts` supplies the replaceable repository contract and in-memory reference adapter.

The production dependency direction is `@aion/object -> @aion/identity` contracts only. Kernel does
not own Object persistence. The package has no dependency on Identity persistence, the privacy
filesystem adapter, career code, Event Bus, Planner, Memory, Capability Registry, operational
tooling, network, telemetry, database, or vector store.

The accepted Phase 3 path boundary is not imported because Phase 5 creates no filesystem adapter or
real Object state. Any separately authorized future filesystem adapter must compose that boundary at
the adapter layer and may not infer or scan paths.

Test values are deterministic, synthetic unit values. They are not fixtures, candidate vectors,
cross-runtime evidence, or conformance certification. No `fixtures/` directory exists. The Object
Contract remains Pre-stable; DG-3 and DG-4b remain Open.
