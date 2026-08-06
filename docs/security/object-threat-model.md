# Universal Object Model Threat Model

Status: **Accepted** alongside [ADR-007](../decisions/ADR-007-universal-object-model.md),
2026-08-06  
Scope: Object contracts and architecture only  
Implementation: Bounded Phase 5 reference controls are implemented; durable, external, destructive,
multi-owner, and full-profile behavior remains unimplemented and frozen

## Security objectives

1. Preserve canonical identity, ownership, provenance, version, lifecycle, and
   relationship truth.
2. Prevent unauthorized reading, mutation, linking, export, import, merge, split,
   deletion, destruction, and ownership transfer.
3. Prevent Object references and events from being mistaken for authority.
4. Preserve owner control, exportability, deletion evidence, and recovery.
5. Prevent adapters, plugins, schemas, migrations, and projections from weakening
   universal invariants.

## Assets

- Object content and bounded metadata.
- Owner, Actor, and identity references.
- Provenance, audit, Version, Event, and Relationship Objects.
- Permission, Knowledge, Planner, Memory, Capability, and Workflow references.
- Type schemas, migration descriptors, relationship descriptors, and export manifests.
- Lifecycle and destruction evidence.
- Integrity and compatibility records.

## Trust boundaries

| Boundary | Trust rule |
|---|---|
| Caller to domain command | Caller identity/context is untrusted until independently authenticated and authorized |
| Domain to Object commit | Prepared change is revalidated against universal invariants and expected revision |
| Object Model to repository | Adapter is replaceable infrastructure and cannot define domain truth |
| Object Model to event publisher | Publisher transports committed facts and gains no business authority |
| Schema/plugin to validator | Schema and validation logic are untrusted supply-chain inputs until approved/sandboxed |
| Import/export boundary | Packages are untrusted until manifest, integrity, schema, ownership, and provenance checks pass |
| Cross-owner relationship | Existence and endpoint information are confidential by default |
| Backup/restore boundary | Restored data is untrusted until integrity, lifecycle, deletion, and version reconciliation completes |

## Threat analysis

| Threat | Attack or failure | Required architectural control |
|---|---|---|
| Object ID spoofing/collision | Substitute or overwrite another Object | Canonical UUID validation, collision-resistant injected generation, uniqueness, non-reuse |
| Kind/type confusion | Use one ID/type/profile as another | Namespaced identities, immutable profile/type, runtime schema validation |
| Mass assignment | Caller sets owner, creator, revision, lifecycle, or integrity | Domain commands separate from stored envelope; trusted commit builder owns reserved fields |
| Ownership takeover | Forge owner transfer or import | Expected revision, Identity resolution, external policy/approval, event/version evidence |
| Actor spoofing | Claim another Actor in provenance/history | Authentication supplies claims; Object Model treats context as evidence requiring validation |
| Permission-reference confusion | Treat reference as granted access | Permission reference explicitly non-authoritative; external policy decision required |
| Generic mutation bypass | Write type data without business validation | No public generic update; domain-owned commands and registry validation |
| Stale/concurrent write | Lose or overwrite another change | Mandatory expected revision and atomic compare-and-commit |
| Partial aggregate commit | Snapshot exists without version/event or vice versa | Portable atomic aggregate contract and crash-point conformance |
| Event replay/duplication | Duplicate downstream effects | Immutable event UUID, subject revision, idempotent consumers, no authority in event |
| Event forgery/tampering | Create false committed facts | Integrity verification, repository provenance, protected publisher, quarantine |
| Event recursion | Infinite meta-events/meta-versions | Immutable Event/Version profiles explicitly emit/create neither for themselves |
| Relationship injection | Link inaccessible or incompatible Objects | Endpoint/type/owner/policy validation; cross-owner fail closed |
| Relationship inference | Reveal hidden Object existence | Independent access checks for edge and endpoints; non-enumerating failures |
| Relationship cycle/cardinality abuse | Corrupt graph or deny service | Descriptor constraints, atomic uniqueness, bounded cycle checks, quotas |
| Dual relationship truth | Endpoint arrays conflict with Relationship Objects | Relationship Object is sole canonical edge; endpoint snapshots contain no authoritative arrays |
| Metadata/property injection | Override reserved fields or exploit parser | JSON-compatible values, forbidden keys, namespaces, depth/size limits, no executable content |
| Schema downgrade/confusion | Bypass newer validation | Immutable schema identity, declared compatibility, no silent downgrade |
| Malicious schema/validator | Execute plugin/vendor code with broad access | Declarative schemas where possible; signing/review/sandbox/resource limits for code |
| Migration corruption | Bulk overwrite, loss, or ownership rewrite | Dry run, backup, checkpoints, idempotency, fixtures, approval, reconciliation |
| Import overwrite | Replace canonical data with crafted package | Collision protocol, integrity/manifest validation, no silent overwrite |
| Export exfiltration | Include unauthorized linked/private content | Explicit scope, external policy, relationship traversal limits, manifest review |
| Provenance forgery | Launder inference as owner-provided fact | Source categories, Actor attribution, immutable versions, derivation lineage |
| Audit tampering | Erase evidence of mutation/access | Protected separate audit domain, append-only evidence, integrity/reconciliation |
| Deleted Object resurrection | Restore/import/backup revives deleted data | Terminal deletion rules, non-reuse, deletion replay and restore reconciliation |
| Incomplete destruction | Copies remain in backups/vectors/exports | Destruction plan, inventory, retention expiry, cryptographic erase, verification certificate |
| Hash ambiguity | Different encodings produce misleading digests | One versioned canonicalization contract and algorithm agility |
| Hash mistaken for authenticity | Attacker recomputes digest | Separate signature/trust design; digest alone never proves Actor |
| Resource exhaustion | Huge metadata, deep JSON, high-degree links, event storms | Hard limits, pagination, quotas, deadlines, cancellation, rate controls |
| Plugin namespace collision | Impersonate another type/relationship | Registered namespace ownership and immutable schema identity |
| Plugin removal/orphaning | Owner cannot read/export plugin Objects | Preserve raw valid data/schema; fallback export without plugin execution |
| Vector/index shadow data | Deleted content remains in projections | Derived-data inventory, lifecycle propagation, rebuild and deletion verification |
| Secret leakage | Credentials enter Object/event/export/log | Secrets forbidden; secret references only; scanning/redaction and incident rotation |

## Identity bootstrap risk

Object requires Owner and Actor references, while persisted Identity records must be
Objects. A subordinate bootstrap design must create the first canonical Owner and Actor
without raw temporary strings, circular repository calls, or implicit authorization.

Until approved, no persistent or externally accessible Object implementation may
invent bootstrap behavior. Candidate designs must include recovery, rotation,
provenance, and prevention of second-owner injection.

## Authorization boundary

Object Model never decides whether an operation is allowed. It receives external,
verifiable authorization/approval evidence bound to Actor, Owner, action, subject,
revision, scope, and expiry. It validates evidence shape and correlation, not policy
meaning.

Before Policy is implemented, any future approved Object work must be limited to pure
contract/invariant validation and isolated in-memory conformance unless a separate
bootstrap authorization ADR is approved.

## Data minimization

- Base envelope contains no unbounded relationship/history/event collections.
- Event payloads contain summaries, not full content.
- Ordinary telemetry excludes owner/Object IDs and content by default.
- Large media and derived embeddings use controlled artifacts/projections.
- Export traversal is explicit and bounded.
- Deleted/Destroyed events contain no erased content.

## Secure lifecycle rules

- Created is not automatically trusted; validation is revision-specific.
- Active is not an authorization grant.
- Archive does not weaken access control.
- Restore revalidates current schema, identity, relationships, and policy.
- Delete is irreversible under the same Object ID.
- Destroy requires verified erasure scope and cannot be claimed while recoverable
  controlled copies remain.
- Merge and Split never copy ownership/permissions implicitly.
- Import and migration never bypass provenance/history.

## Verification requirements before release

Future verification must demonstrate:

- Object/profile/type/UUID separation and reserved-field protection;
- one winner under concurrent expected revision;
- atomic crash recovery at every aggregate commit boundary;
- non-recursive Event and Version profile behavior;
- relationship cardinality, cycle, inference, and cross-owner controls;
- malformed/deep/oversized metadata and schema rejection;
- import/export mutation, collision, and round-trip integrity;
- migration interruption, resume, information-loss reporting, and rollback claims;
- event tamper, duplicate, gap, replay, and unsupported-version behavior;
- delete/restore/rebuild non-resurrection; and
- architecture boundaries excluding policy, Event Bus, database, framework, and vendor
  dependencies.

No test implementation is authorized by this threat model.

## Residual decisions blocking implementation

1. Identity and authorization bootstrap.
2. Canonical serialization and algorithm agility.
3. UUID generation requirements.
4. Metadata/schema limits and namespace governance.
5. Destruction semantics across backups, exports, and derived stores.
6. Portable atomic commit/outbox guarantees.
7. Plugin validator/migration isolation.
8. Signing/authenticity requirements for schemas, events, exports, and releases.

## Residual risk acceptance

ADR-007 must not move to implementation approval until blocking decisions are resolved
or explicitly accepted with bounded scope, owner, verification, and review date.

ADR-007 was accepted on 2026-08-06 as an architecture-boundary decision only. That
acceptance closed none of the residual decisions above. Items 1, 2, and 4 of this
section are recorded as enforceable deferred gates DG-1, DG-2, and DG-4 in the
[Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md)
§Deferred implementation gates; the remainder stay open under this threat model.
