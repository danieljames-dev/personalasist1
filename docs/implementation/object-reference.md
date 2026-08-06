# Minimum Universal Object Reference Implementation

The implementation is the `@aion/object` workspace. `contracts.ts` defines the closed reference
envelope and ports; `canonical.ts` implements the ACJ-1 value boundary, raw JSON parser, canonical
serializer, AION Frame v1, and SHA-256 adapter; `object.ts` constructs, seals, and validates Objects;
and `repository.ts` supplies shared commit validation and the in-memory adapter. `families.ts`
registers the seven Phase 5 families and closed RelationshipObject rules; `operations.ts` supplies
only explicit create, append, and load operations; `file-repository.ts` supplies the replaceable
bounded local reference adapter.

The production dependency direction is `@aion/object -> @aion/identity` contracts and
`@aion/privacy-boundary` path authorization only. Kernel does not own Object persistence and the
Object package does not read Identity state. It contains no Event Bus, Planner, Memory, Capability
Registry, operational tooling, network, telemetry, database, vector store, authentication, or
authorization behavior.

The six career entity families intentionally accept only `{}`. Detailed career schemas and Phase 6
input fields remain deferred. RelationshipObject is the sole persisted edge truth for the seven
approved relationship combinations; no entity carries a relationship array. The public operation
surface has no unrestricted patch callback, delete, query, search, permission, event, planner, or
synchronization operation.

The filesystem adapter requires an explicit absolute `private/object-store` root and composes the
Phase 3 boundary before and immediately before access. It stores exact ACJ-1 full-envelope revisions
under a domain-separated safe key and installs each revision atomically without overwrite. See the
[filesystem implementation record](object-filesystem-reference.md). No real Object state is
initialized.

Test values are deterministic, synthetic unit values in temporary roots. They are not fixtures,
candidate vectors, cross-runtime evidence, or conformance certification. No `fixtures/` directory
exists. The Object Contract remains Pre-stable; DG-3 and DG-4b remain Open. The local adapter is not
a permanent production storage decision.
