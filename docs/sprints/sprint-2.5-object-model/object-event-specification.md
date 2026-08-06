# Object Event Specification v1

Status: Proposed normative event contract

## Purpose

Publish immutable facts about committed Object changes without coupling the Object
Model to subscribers, downstream services, or a transport implementation.

## Event inheritance

Every event is itself an `AionObjectV1<ObjectEventDataV1>` with object type
`org.aion.object-event`. Its inherited owner, provenance, permissions, lifecycle,
history, and integrity follow the same Object rules. Event Objects are immutable and
remain active until retention policy tombstones them; their own `eventRefs` are empty
unless a later event changes their lifecycle.

```ts
interface ObjectEventDataV1 extends JsonObjectV1 {
  readonly eventType: ObjectEventTypeV1;
  readonly eventContractVersion: "1.0";
  readonly subjectObjectId: ObjectIdV1;
  readonly subjectObjectType: ObjectTypeV1;
  readonly subjectRevision: number;
  readonly occurredAt: TimestampV1;
  readonly actorId: ActorIdV1;
  readonly ownerId: OwnerIdV1;
  readonly correlationId: CorrelationIdV1;
  readonly causationEventId?: ObjectEventIdV1;
  readonly change: ObjectChangeSummaryV1;
}

interface ObjectChangeSummaryV1 {
  readonly changedFields: readonly string[];
  readonly previousIntegrityHash?: string;
  readonly currentIntegrityHash: string;
  readonly reason?: string;
}
```

Events contain change summaries, not unrestricted before/after Object content.
Consumers retrieve the subject through authorized APIs. Domain-specific events may
add versioned data that passes classification and minimization review.

## Standard event types

| Event | Fact represented |
|---|---|
| `ObjectCreatedV1` | Revision 1 committed as active |
| `ObjectUpdatedV1` | Type data or metadata committed |
| `ObjectArchivedV1` | Active Object became archived |
| `ObjectRestoredV1` | Archived Object returned active |
| `ObjectTombstonedV1` | Object entered terminal tombstone state |
| `ObjectOwnershipTransferredV1` | Canonical owner changed |
| `ObjectSchemaMigratedV1` | Type data moved to a new schema version |
| `ObjectPermissionReferencesChangedV1` | Permission references changed, not policy result |
| `ObjectRelationshipCreatedV1` | Relationship Object committed |
| `ObjectRelationshipArchivedV1` | Relationship became inactive |
| `ObjectRelationshipTombstonedV1` | Relationship permanently closed |

Domains publish additional namespaced event types without redefining base lifecycle
facts. Event names are immutable once released.

## Commit and publication

The canonical transaction commits subject snapshot, revision Object, Event Object,
subject `eventRefs`, and durable pending-publication state atomically. A publisher
port forwards committed Event Objects. The Object Model never discovers subscribers,
routes work, waits for their business outcomes, or calls them directly.

If the repository and transport cannot share a transaction, an outbox or equivalently
proven pattern is required. Publication is at-least-once unless a future adapter proves
stronger semantics. Consumers must deduplicate by Event Object ID.

## Ordering and causality

- Subject revision provides total order for one Object.
- No global event order is promised.
- Correlation groups one logical operation; causation identifies the immediate source
  event when work was event-triggered.
- A consumer rejects or parks a future subject revision when earlier required
  revisions are absent; replay resolves gaps.
- Timestamps are evidence, not a distributed ordering guarantee.

## Compatibility

Event contract and event-type payload versions are independent. Additive optional
fields require conformance fixtures. Breaking changes create a new event major version.
Consumers declare supported versions and must not guess unknown semantics.

## Privacy and security

- Events inherit owner and permission references but never constitute authorization.
- Payloads exclude credentials, secrets, raw private content, and removed tombstone data.
- Operational telemetry must not copy event payloads or owner/Object IDs by default.
- Cross-owner delivery fails closed and requires future explicit policy.
- Event integrity is verified before consumption; forged events cannot mutate truth.

## Replay and retention

Replay republishes immutable Event Objects with the same IDs and payloads and marks
transport metadata as replay outside the canonical event. Replay cannot create new
domain truth by itself. Retention must preserve enough event/revision evidence to meet
recovery and audit requirements while honoring owner deletion policy.

## Failure behavior

Malformed, unsupported, unauthorized, duplicate, or integrity-invalid events are
rejected/quarantined with stable reason codes. Poison events cannot block unrelated
subjects indefinitely. Event failure never causes the publisher to invoke a fallback
downstream service.

