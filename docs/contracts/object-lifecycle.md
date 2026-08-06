# Object Lifecycle Contract

Status: **Pre-stable** normative contract  
Authority: [ADR-007](../decisions/ADR-007-universal-object-model.md) (Accepted 2026-08-06)  
Implementation: Not authorized; freeze in effect

## State and operation distinction

The directive's lifecycle vocabulary includes both durable states and recorded
operations. Mixing them would make an Object simultaneously “active” and “exported” or
force import/export to change business availability. Version 1 therefore defines:

### Durable universal states

- **Created** — revision 1 exists but has not completed required validation.
- **Validated** — universal and domain validation succeeded; activation has not yet
  occurred or requires a separate approval.
- **Active** — available for normal domain operations.
- **Archived** — intentionally inactive but retained and restorable.
- **Deprecated** — still readable and possibly usable under policy, but replacement or
  retirement is recommended.
- **Deleted** — logically deleted; normal use is prohibited, identity remains reserved,
  and content is minimized according to approved retention rules.
- **Destroyed** — terminal proof that protected content has been irreversibly erased
  from authoritative storage and eligible backups; only a minimal non-content
  destruction certificate may remain where required.

### Recorded operations

- **Imported** — an Object or new revision entered through the trusted import protocol.
- **Exported** — an owner-controlled export package was produced.
- **Merged** — two or more source Objects produced or were consolidated into a target.
- **Split** — one source Object produced two or more successor Objects.
- **Restored** — an Archived Object returned to Active.

Every operation creates immutable Version/Event evidence as specified. Imported,
Exported, Merged, and Split do not automatically define the resulting durable state;
their command specifies and validates it.

## State model

```text
Created -> Validated -> Active -> Archived -> Deleted -> Destroyed
   |           |          ^  |       |  ^        ^
   |           |          |  |       |  |        |
   |           |          |  |       +--+        |
   |           |          |  |     (Restore)     |
   |           |          |  +-> Deprecated -----+
   |           |          |          |  |  (Delete)
   |           |          +----------+  +-> Archived
   |           |          (Reactivate)
   |           +-> Deleted
   +-> Deleted

Active -> Deleted and Deprecated -> Deleted are permitted directly.
```

The diagram is illustrative. The transition table at the end of this document is the
normative statement of permitted transitions; where the two differ, the table governs.

Domains may require direct activation after atomic create-and-validate. In that case,
Created and Validated remain recorded transition facts within revision 1 or the
creation transaction; externally visible intermediate states are not required. A
domain may expose them only when a real approval or validation workflow requires it.

Domain states such as Task Completed, Identity Disabled, Workflow Paused, Invoice
Paid, or Memory Superseded remain type-specific data and do not replace universal
record lifecycle.

## Transition requirements

Every state-changing operation requires:

- Object identity and expected revision;
- canonical Actor and Owner context;
- operation correlation and idempotency identity;
- reason and provenance;
- domain validation;
- external authorization/approval evidence where required;
- one atomic snapshot and Version Object commit; and
- immutable committed-fact Event Objects.

No lifecycle operation directly invokes a downstream service.

## Created

Creation reserves a new non-reusable UUID, fixes Object type/profile/creator/creation
time, validates basic envelope shape, and prepares revision 1. It may be committed as
Created only when a real later validation step is part of the domain contract.

Failure before commit leaves no authoritative Object. Ambiguous commit is resolved by
idempotency identity; callers do not create a replacement ID blindly.

## Validated

Validation confirms universal invariants, supported schema, domain data, identity
references, provenance, metadata limits, and required external approval evidence. It
does not mean the Object is truthful, safe, or authorized for every future action.

Validation results are tied to Object revision and validator/schema versions. Changing
validated content invalidates the prior result and creates a new revision.

## Active

Active Objects participate in domain-permitted commands and Relationships. Activation
requires successful validation. External policy still controls who may read or act;
Active is not an access grant.

## Archived

Archive removes an Object from normal active work while preserving identity, content,
history, events, provenance, and relationships according to policy. Archive requires
reason and expected revision. Relationships are not deleted automatically; their type
rules determine visibility or independent transitions.

## Restored

Restore transitions Archived to Active. It revalidates current schema, identity and
relationship integrity, domain invariants, and external permission evidence. It never
rewinds revision or erases the archive event.

Deleted and Destroyed Objects cannot be restored under the same identity.

## Deprecated

Deprecation marks an Object as retained but discouraged or scheduled for replacement.
It identifies a reason, effective time, and optional `Supersedes`/successor relationship.
Domains define whether deprecated Objects remain usable. Deprecation may transition
to Active if withdrawn, Archived, or Deleted, with full history.

## Deleted

Deletion is terminal logical removal from normal use. It:

- permanently reserves the Object ID;
- increments revision and emits `ObjectDeleted`;
- removes/minimizes protected content according to data classification and retention;
- preserves only permitted tombstone, referential, audit, and destruction-planning
  evidence;
- evaluates related Objects through explicit rules rather than implicit cascade; and
- schedules eligible backup/vector/projection erasure and verification.

Deletion cannot claim physical erasure. It remains distinguishable from Destroyed.

## Destroyed

Destruction is a terminal verified operation after authoritative content and all
eligible replicas, indexes, exports under AION control, and expired backups have been
erased or cryptographically rendered inaccessible. It requires a destruction plan,
retention eligibility, verification evidence, and external approval.

The original content, metadata, detailed provenance, and relationships are unavailable.
A minimal protected Destruction Certificate Object may retain a salted/non-reversible
identity reference, completion time, scope, method, Actor, approval, and evidence hash
without enabling content recovery or ID reuse.

Exact destruction behavior is data-class and jurisdiction dependent. It requires a
subordinate ADR before persistent implementation.

## Imported

Import uses a separate privileged protocol. It validates manifest, schema, integrity,
ownership, provenance, identity collision, version compatibility, and trust. It never
silently overwrites an existing Object.

Possible collision outcomes are reject, recognize exact duplicate, or create a new
Object with explicit `DerivedFrom`/`Supersedes` relationship. Identity rewriting is
recorded and never hidden. Successful import emits `ObjectImported` plus creation or
update facts as applicable.

## Exported

Export does not mutate the Object's durable lifecycle state. It creates an immutable
Export Record Object and `ObjectExported` event containing manifest identity, scope,
time, Actor, contract versions, and integrity summary without secrets or unrestricted
content. The owner receives an open, independently verifiable package.

## Merged

Merge is domain-owned, never generic field concatenation. It accepts two or more
source Objects, validates compatible types/ownership/policy, defines conflict
resolution, and produces either:

- a new target Object related by `DerivedFrom`; or
- a new revision of a designated target when the domain explicitly permits.

Sources remain historically intact and normally become Deprecated or Archived, not
silently deleted. `ObjectMerged` identifies sources, target, ruleset, Actor, and
provenance.

## Split

Split is domain-owned and produces two or more new successor Objects or explicitly
approved revisions. Successors record `DerivedFrom` relationships to the source. The
source remains intact historically and transitions to Active, Deprecated, or Archived
as the domain specifies. No ownership or permission is copied without validation.

## Transition table

| From | Operation | To | Reversible |
|---|---|---|---|
| None | Create | Created, Validated, or Active | No ID reuse; Object may later delete |
| Created | Validate | Validated | Validation can be superseded by later revision |
| Validated | Activate | Active | Yes, through Archive |
| Created/Validated | Delete | Deleted | No |
| Active | Archive | Archived | Yes, through Restore |
| Archived | Restore | Active | Yes, through Archive |
| Active | Deprecate | Deprecated | Yes, through Reactivate if domain permits |
| Deprecated | Reactivate | Active | Domain/policy controlled |
| Deprecated | Archive | Archived | Yes, through Restore and revalidation |
| Active/Archived/Deprecated | Delete | Deleted | No |
| Deleted | Destroy | Destroyed | No |
| Any non-destroyed | Export | Unchanged | Not applicable |
| Import package | Import | Domain-approved state | Rollback by compensating deletion, never hidden overwrite |
| Domain-approved sources | Merge | Sources retained; target domain-approved | Domain-specific compensation only |
| Domain-approved source | Split | Source retained; successors created | Domain-specific compensation only |

## Failure and recovery

- Failure before atomic commit changes no authoritative state.
- Failure after commit but before publication leaves immutable events pending retry.
- Stale expected revision fails without partial writes.
- Restoration of a system backup never resurrects Objects deleted before the selected
  recovery point without reconciliation and deletion replay.
- Projection and vector recovery must honor the latest authoritative lifecycle state.

