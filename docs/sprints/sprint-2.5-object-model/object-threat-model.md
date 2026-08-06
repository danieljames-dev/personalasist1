# Universal Object Model threat model

Status: Proposed

## Assets

- Owner-controlled Object content and metadata.
- Canonical identity, ownership, lifecycle, version, and type truth.
- Relationship topology, provenance, permissions, history, and domain events.
- Integrity, migration, deletion, and audit evidence.

## Trust boundaries

1. Callers to Object APIs are untrusted until Identity and future policy checks pass.
2. Type-specific data and extension metadata are untrusted input.
3. Repository, event publisher, migration, import, and export adapters are replaceable
   infrastructure and cannot weaken domain invariants.
4. Event consumers are independent and receive no implicit authority.
5. Cross-owner references and exports cross a high-risk disclosure boundary.

## Threats and controls

| Threat | Impact | Required control |
|---|---|---|
| UUID spoofing, collision, or reuse | Object substitution | Canonical validation, collision-resistant injected generator, uniqueness and non-reuse constraints |
| Mass assignment of owner/system fields | Ownership takeover | Separate commands from stored envelope; server constructs reserved fields |
| Prototype/property injection in metadata | Code execution or invariant override | JSON-only parsing, forbidden keys, namespaced extensions, depth/size limits |
| Schema confusion/downgrade | Validation bypass | Type + schema registry, no silent downgrade, signed/controlled descriptors |
| Stale concurrent write | Lost updates/history | Required expected revision and atomic compare-and-swap |
| Forged actor/owner context | Unauthorized mutation | Identity resolution plus future policy; context alone is never proof |
| Relationship inference | Disclosure of hidden Objects | Independent authorization of edge/endpoints and non-enumerating errors |
| Relationship cycle/cardinality abuse | Graph corruption or denial of service | Descriptor constraints, bounded traversal, atomic validation |
| Permission reference treated as permission | Authorization bypass | Policy decision required; references confer no authority |
| History/event tampering | Loss of provenance and audit trust | Immutable Objects, integrity hashes, append-only references, reconciliation |
| Event replay/duplication | Duplicate side effects | Stable event UUID, subject revision, idempotent consumer requirement |
| Event payload exfiltration | Owner-data disclosure | Minimal summaries, classification, redaction, protected transport/storage |
| Tombstone resurrection or ID reuse | Deletion failure and identity confusion | Terminal state, non-reuse constraint, import/migration rejection |
| Incomplete cascade deletion | Residual owner data | Explicit relationship-aware deletion plan and verification report |
| Malicious migration/import | Bulk corruption or takeover | Dry-run, schema/integrity validation, checkpoints, backup, approval, reconciliation |
| Resource exhaustion | Availability loss | Payload/reference/depth limits, pagination, quotas, cancellation, deadlines |
| Hash canonicalization ambiguity | False integrity result | One versioned canonical serialization algorithm before implementation |
| Confused-deputy event reaction | Unauthorized downstream action | Events grant no authority; consumer independently resolves policy/approval |

## Secure defaults

- Fail closed for unknown types, schema versions, owners, actors, permissions,
  relationships, and lifecycle states.
- No cross-owner relationship, transfer, or export without explicit future policy.
- No ordinary logs containing IDs, content, extensions, relationships, or event payloads.
- No physical purge until retention/deletion design and restore consequences are approved.
- No remote API or external adapter in Sprint 2.5.

## Verification requirements

- Property/fuzz tests for JSON limits, forbidden keys, UUIDs, revisions, and schemas.
- Concurrency tests proving one winner per expected revision.
- Import/export mutation tests and exact round-trip fixtures.
- Relationship access-control and inference tests with multiple owners.
- Event tamper, duplicate, replay, gap, and unsupported-version tests.
- Tombstone non-resurrection and identifier non-reuse tests.
- Architecture tests proving Object has no policy, Event Bus, database, vendor, or
  downstream-service dependency.

## Residual decisions before implementation

1. Canonical JSON serialization and integrity coverage.
2. UUID generation profile and entropy source.
3. Bootstrap-owner authorization before the policy subsystem exists.
4. Tombstone minimization and deletion verification by data class.
5. Extension namespace registration and resource limits.

These require approved subordinate ADRs or explicit specification amendments; an
implementation must not invent them.

