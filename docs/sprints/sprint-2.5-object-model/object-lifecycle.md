# Object Lifecycle v1

Status: **Superseded — retained as historical evidence; not normative**  
Superseded by: [Object Lifecycle Contract](../../contracts/object-lifecycle.md)  
Superseded on: 2026-08-06  
Reason: The three-state `active`/`archived`/`tombstoned` model does not express the
Created, Validated, Deprecated, Deleted, and Destroyed states or the Imported,
Exported, Merged, Split, and Restored operations required by the CTO directive.

> This document must not be cited as a current contract. It is preserved unmodified
> below the header so the review trail remains auditable.

## States

```text
                 archive                 tombstone
create -> active --------> archived ----------------> tombstoned
             |                 |
             | tombstone       | restore
             v                 v
         tombstoned <------- active
```

- `active`: available for normal type-permitted operations.
- `archived`: retained and readable under policy but excluded from normal active work;
  type data cannot change except through explicit restore.
- `tombstoned`: terminal logical deletion; content is minimized/redacted according to
  retention policy and the ID can never be reused.

There is no persisted `draft` base state. Draft is domain behavior represented in
type-specific data if needed. Creation commits revision 1 directly as `active`.

## Creation

Creation validates identity references, Object type/schema, owner, metadata,
provenance, and type data. One atomic commit creates:

1. the active Object snapshot at revision 1;
2. an immutable Object Revision Object;
3. an `ObjectCreatedV1` Event Object; and
4. durable pending publication state when transport is external to the transaction.

No success is returned until the canonical commit is durable. Event delivery may be
asynchronous, but lost publication is observable and retryable.

## Update

Updates require `expectedRevision`. The service loads the current snapshot, verifies
active state, owner context, schema, domain validation, and policy evidence, then
atomically commits revision `n + 1`, revision history, and events.

Stale writes fail with `OBJECT_CONFLICT` and include the current revision but no
content. Automatic last-write-wins is prohibited. Merge behavior belongs to a
type-specific, explicitly approved domain operation.

## Archive and restore

Archive requires an active Object, expected revision, actor, reason, provenance, and
policy evidence when applicable. It increments revision and emits `ObjectArchivedV1`.

Restore requires archived state and the same controls. It revalidates current schema,
references, and domain invariants before becoming active and emits `ObjectRestoredV1`.
Restore never rewinds revision or erases archive history.

## Tombstone

Tombstone is terminal and requires expected revision, actor, reason, provenance, and
approved retention/deletion policy. The commit:

- changes lifecycle to `tombstoned`;
- increments revision;
- removes or cryptographically destroys content designated erasable;
- retains the minimum protected identity/integrity/history data required to prevent
  reuse and preserve lawful audit/referential truth;
- processes relationships by explicit descriptor rules; and
- emits `ObjectTombstonedV1` containing no removed sensitive content.

The exact erasure profile is data-class and jurisdiction dependent and must be
specified before persistent adapters. “Delete” is not exposed as an ambiguous API.

## Physical purge

Physical purge is storage maintenance, not an Object lifecycle transition. It is
prohibited in v1 until retention, backup, legal, relationship, event, and audit
requirements define verifiable eligibility. Purge never permits ID reuse.

## Ownership transfer

Transfer keeps the same Object ID and creates a new revision. It requires an approval
Object, current and new owner references, expected revision, actor, provenance, and
future policy authorization. Related Objects do not transfer implicitly. The event
records old/new owner references subject to audit visibility policy.

## Schema migration

Migration is an explicit revision attributed to a system Actor and migration
descriptor. It preserves original history, validates target schema, and emits
`ObjectSchemaMigratedV1`. Bulk migrations are checkpointed, resumable, idempotent,
auditable, and reversible where the schema claims reversibility.

## Failure boundaries

- Failure before commit leaves no new snapshot, history, or event.
- Ambiguous commit is resolved by correlation/idempotency key, never blind retry.
- Publication failure after commit does not roll back canonical truth; pending events
  retry idempotently and health becomes degraded/observable.
- Cancellation before commit aborts; cancellation after commit cannot reinterpret a
  success as a rollback.
- Adapter recovery must reconcile snapshots, history, relationships, and events.

## Lifecycle invariants

Terminal Objects cannot resurrect. Every successful transition advances revision
exactly once. Timestamps come from an injected clock. Actor and provenance are never
optional. No lifecycle transition invokes a downstream service.

