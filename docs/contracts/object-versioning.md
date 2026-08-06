# Object Versioning Contract

Status: **Pre-stable** normative contract  
Authority: [ADR-007](../decisions/ADR-007-universal-object-model.md) (Accepted 2026-08-06)  
Implementation: Not authorized; freeze in effect

## Version dimensions

Version concepts are independent and never substituted for one another:

| Dimension | Purpose | Example behavior |
|---|---|---|
| Object contract version | Universal envelope/profile semantics | Breaking envelope change creates a new major contract |
| Type schema identity | Immutable identity/digest of a domain schema | Prevents two different schemas sharing a label |
| Type schema version | Ordered evolution of one Object type's data | Migration moves data between declared versions |
| Object revision | Monotonic committed changes to one Object identity | Starts at 1 and increments per mutation |
| Event contract version | Common event envelope semantics | Evolves independently of subject Object |
| Event payload schema version | One event type's facts | Consumers declare supported payloads |
| Relationship descriptor version | Cardinality/type/integrity semantics | Existing edges remain interpretable under recorded descriptor |
| Package/release version | Software distribution | Does not determine persisted data compatibility |

## Object revision rules

- Revision starts at 1.
- Entity and Relationship revisions increment exactly once per committed mutation.
- Failed, cancelled-before-commit, or conflicted operations consume no revision.
- Version and Event profile revision is fixed at 1 because those Objects are immutable.
- Every Entity/Relationship revision has exactly one immutable Version Object.
- Revision ordering is per Object only; it is not a global transaction order.
- Expected revision is mandatory for mutation. Last-write-wins is prohibited.
- Merges require domain-defined semantics and never happen implicitly at repository level.

## Version Object contents

A Version Object records:

- subject Object ID, type, profile, and committed revision;
- previous Version Object ID when present;
- Object contract, type schema, and relationship-descriptor versions used;
- canonical revision representation or secure content-addressed artifact reference;
- integrity descriptor;
- Actor, Owner, time, provenance, correlation, and command category;
- change summary and migration descriptor when applicable; and
- redaction/destruction status governed by retention policy.

A Version Object is immutable and non-recursive. It has no Version Object of its own
and emits no event about itself. `ObjectVersionCreated` belongs to the subject commit.

## Schema identity and compatibility

Every schema has:

- immutable namespaced type ownership;
- immutable schema identity or digest;
- positive ordered version;
- declared readable predecessor/successor versions;
- migration edges with reversibility and information-loss declarations;
- golden valid/invalid fixtures; and
- lifecycle/support status.

Compatibility is declared and proven by fixtures, never inferred from a version number.
Unknown major Object contracts fail closed. Unknown valid extension namespaces are
preserved without execution. Writers never silently downgrade.

## Migration protocol

Schema migration is a privileged domain-owned operation that:

1. verifies source Object contract/schema/revision and integrity;
2. resolves one approved migration path;
3. preserves a backup/export and original Version Object;
4. transforms data deterministically where claimed;
5. validates the target schema and domain invariants;
6. commits one new revision, Version Object, and `ObjectSchemaMigrated` event;
7. checkpoints bulk work by immutable migration run identity;
8. remains idempotent and resumable; and
9. reports loss, skipped Objects, conflicts, and rollback capability explicitly.

Mixed schema versions must remain readable during an approved migration window.
Destructive or lossy migrations require owner approval and cannot claim reversibility.

## Canonical serialization and integrity

Integrity calculation requires one versioned, deterministic, language-neutral
canonical representation. The integrity descriptor records canonicalization version,
digest algorithm identifier, and digest. Algorithms are replaceable through a registry;
no algorithm is permanent in the universal contract.

A digest detects accidental/unauthorized content change but does not prove Actor
identity or authenticity without an approved signature/trust design.

Canonicalization is a subordinate decision required before implementation.

## Coexistence and support

Breaking Object contract changes create a new major version that coexists with prior
supported versions. A release must publish:

- supported read/write versions;
- conversion/migration path;
- compatibility fixtures;
- deprecation timeline and owner impact;
- rollback or restore procedure; and
- export guarantees for all supported versions.

Old data is never made unreadable merely because application code upgrades. Removal
of a reader requires proof that no retained Object/export/backup depends on it or an
approved archival reader remains available.

## Merge and split version history

Merge and Split preserve independent source histories. A new/updated target records
source Object and exact source revision through `DerivedFrom` Relationships. Histories
are not spliced into one revision sequence. This preserves provenance and avoids
revision-number collision.

## Version scalability

Current snapshots do not embed all Version IDs. Version queries use subject identity,
stable revision ordering, cursor pagination, and bounded pages. Retention may move old
Version content to archival storage while preserving owner export and integrity
requirements. Storage selection remains outside this contract.

