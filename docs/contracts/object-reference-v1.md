# Minimum Object Reference Contract v1

Status: Sprint 3 Phase 5 reference implementation contract
Authority: [CTO-DECISION-009](../decisions/CTO-DECISION-009-phase-4-approval-and-object-reference.md)
Upstream contract: [Universal Object Contract v1](object-contract-v1.md), still Pre-stable

## Scope

`@aion/object` implements a bounded reference for mutable `entity` and `relationship` profiles. It
does not designate the Universal Object Contract Stable and does not implement immutable Version or
Event Object materialization, an aggregate outbox, export/import, migration, deletion, destruction,
ownership transfer, authentication, authorization, or a durable adapter.

The closed envelope has the upstream mandatory fields: `objectId`, `objectType`, `objectProfile`,
`objectContractVersion`, `schemaId`, `schemaVersion`, `revision`, `ownership`, `createdBy`,
`createdAt`, `modifiedBy`, `modifiedAt`, `lifecycleState`, `metadata`, `provenanceSummary`,
`integrity`, and `data`. The upstream optional scalar `permissionSetRef` and `auditStreamRef` fields
are supported. No relationship, version, event, audit-entry, plan, memory, capability, workflow, or
career collection is embedded.

`ObjectIdV1` is an opaque canonical lowercase RFC 9562 UUID v4. `objectType` and `schemaId` are
bounded NFC ASCII namespaced identifiers, and their exact tuple with profile and positive schema
version must be accepted by an injected `ObjectSchemaRegistryV1`. Object IDs, Owner IDs, and Actor
IDs are distinct types and are not credentials.

## Identity, metadata, and provenance

`ownership.ownerId` uses `OwnerIdV1`; `createdBy`, `modifiedBy`, and provenance attribution use
`ActorIdV1` from `@aion/identity`. Object code imports Identity contracts only and never reads or
writes Identity state. Ownership and attribution grant no authority.

Metadata contains sorted, unique, non-empty NFC labels and a canonical extension Object. Every
extension namespace must be accepted by the injected schema registry and unknown valid registered
extension values survive sealing and reload. The reference enforces ACJ-1/DG-4a bounds but invents
no DG-4b label, metadata, provenance, or workload limit. Provenance records version, accepted origin
category, responsible Actor, observation and
recording time, and correlation; source and derivation references are optional where applicable.
No universal confidence scale is implemented because none is accepted.

## Canonical integrity

The integrity descriptor uses AION Frame v1, purpose `aion.object.integrity`, profile `acj-1`,
contract family `aion.object`, contract version `1`, context `<schemaId>:<schemaVersion>`, and the
registered initial algorithm `sha-256`. The canonical payload is the complete committed envelope
content excluding the integrity descriptor itself; this is the non-recursive content whose digest
the descriptor records. The descriptor also records schema identity/version as required by ACJ-1.

Validation recomputes and constant-time compares the digest. A digest proves content equality only;
it provides no authenticity, confidentiality, trust, freshness, authentication, or authorization.

The canonical boundary accepts only null, Boolean, NF-1 safe integers, NFC strings, arrays, and
plain Objects. It preserves array order, sorts Object members by UTF-16 code units, emits UTF-8
without BOM/whitespace/trailing newline, rejects repair/coercion, and includes a raw UTF-8 JSON
entry that rejects duplicate members before host parsing can erase them.

## DG-4a limits

`aion-resource-limits-1` is enforced with inclusive maxima: raw input 4 MiB (L-01), canonical output
4 MiB (L-02), depth 64 (L-04), 4,096 members per Object (L-05), 65,536 array elements (L-06),
262,144 total value nodes (L-07), strings 1 MiB UTF-8 (L-08), member names 1,024 bytes (L-10),
identifiers 256 bytes (L-11), frame text fields 1,024 bytes (L-12/L-13), and NF-1 integers in the
inclusive range `-(2^53-1)` through `2^53-1`. Every rejection occurs before an oversized canonical
output, frame, digest, or repository write is returned.

DG-4b remains Open. No Object/domain workload, storage, query, batch, concurrency, cancellation, or
service limit is claimed.

## Construction and repository

`ObjectClock`, `ObjectIdGenerator`, `ObjectCanonicalSerializerV1`, `ObjectDigestV1`, and
`ObjectSchemaRegistryV1` are injected. Construction reserves exactly one Object ID, reads one
timestamp, validates domain data through the registry, seals integrity, deep-copies, and freezes the
result without mutating caller input.

`ObjectRepository` exposes current/revision load and compare-and-commit. The in-memory reference
adapter validates integrity before commit, preserves every accepted snapshot revision, requires
revision 1 for create, advances exactly once, rejects stale expected revisions, and permits only
accepted non-destructive lifecycle transitions. Ownership transfer, schema migration, delete, and
destroy fail closed in this phase. There is no filesystem or real Object store; all test state is
synthetic and process-local.

Full immutable Version/Event Object aggregate materialization and durable publication intent remain
deliberately unimplemented until their separately unresolved portable aggregate/outbox semantics
are authorized. The repository therefore supplies Phase 5 revision/reference evidence, not a claim
of full ADR-007 persistence conformance.
