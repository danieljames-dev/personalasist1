# Object Event Contract

Status: **Pre-stable** normative contract  
Authority: [ADR-007](../decisions/ADR-007-universal-object-model.md) (Accepted 2026-08-06)  
Implementation: Not authorized; freeze in effect  
Event Bus: Explicitly out of scope

## Responsibility

Object events communicate immutable facts about committed Object changes. They do not
request work, grant authority, route themselves, discover consumers, or define an
Event Bus.

## Event Object profile

Every event is an immutable Event Object conforming to the Universal Object contract.
It has its own UUID, owner, provenance, permission/audit references, integrity, and
export behavior. Its revision is fixed at 1. It never creates a Version Object and
never emits an event about itself.

## Required event data

| Field | Meaning |
|---|---|
| Event type | Immutable namespaced fact name |
| Event contract version | Version of the common event envelope |
| Event payload schema | Immutable schema identity and version |
| Subject Object ID | Object whose committed truth changed |
| Subject Object type/profile | Type and profile at the committed revision |
| Subject revision | Exact post-commit revision represented |
| Previous revision | Prior subject revision when applicable |
| Owner ID | Canonical owner at event time |
| Actor ID | Actor responsible for the committed operation |
| Occurred time | Commit-domain timestamp, not global ordering proof |
| Correlation ID | Groups one logical operation |
| Causation event ID | Immediate triggering event when applicable |
| Idempotency ID | Stable operation identity preventing duplicate truth |
| Provenance | Minimized origin/derivation evidence |
| Change summary | Changed concern names and before/after integrity descriptors |
| Reason | Bounded human/machine-readable reason category where applicable |

Payloads contain minimized facts, not unrestricted full before/after Object content.
Consumers retrieve current or historical subject data through authorized Object APIs.

## Standard event types

| Event | Required fact |
|---|---|
| `ObjectCreated` | A new subject Object revision 1 committed |
| `ObjectValidated` | Declared validation completed for a specific revision |
| `ObjectActivated` | Subject entered Active state |
| `ObjectUpdated` | A domain command committed a new revision |
| `ObjectArchived` | Subject entered Archived state |
| `ObjectRestored` | Archived subject revalidated and returned Active |
| `ObjectDeprecated` | Subject entered Deprecated state |
| `ObjectDeleted` | Subject entered terminal logical deletion |
| `ObjectDestroyed` | Approved destruction verification completed; contains no destroyed content |
| `ObjectImported` | Trusted import protocol committed subject data |
| `ObjectExported` | Owner-controlled export record committed |
| `ObjectMerged` | Domain merge produced/updated a target from named sources |
| `ObjectSplit` | Domain split produced named successors from a source |
| `ObjectRelationshipAdded` | Canonical Relationship Object became active |
| `ObjectRelationshipRemoved` | Relationship archived or deleted with stated disposition |
| `ObjectVersionCreated` | Subject Version Object committed; this is part of subject commit and does not cause recursion |
| `ObjectOwnershipTransferred` | Canonical owner changed through approved transition |
| `ObjectSchemaMigrated` | Subject data committed under a new schema version |
| `ObjectPermissionReferenceChanged` | Permission-set reference changed; no policy result is implied |

Domain events use owned namespaces and may add schema-validated facts without
redefining universal lifecycle events.

## Commit and publication

Subject snapshot, Version Object, Event Objects, and pending-publication evidence are
one aggregate commit. Publication occurs through a replaceable publisher port after
commit. Object Model never invokes a subscriber or downstream service.

Where repository and transport cannot share a transaction, an atomic outbox or
equivalently proven mechanism is required. The baseline delivery expectation is
at-least-once. Consumers deduplicate by Event Object ID and independently verify
authorization before acting.

## Ordering and causality

- Subject revision totally orders events that change one subject.
- No global event order is promised.
- Correlation groups one logical operation across Objects.
- Causation identifies the immediate source event, not ultimate business justification.
- Timestamps are evidence and cannot resolve all distributed ordering conflicts.
- Consumers encountering a subject revision gap pause/park that subject and recover
  missing history rather than guessing.

## Replay

Replay republishes the same immutable Event Objects with the same identity and payload.
Transport metadata may mark replay but cannot mutate canonical event data. Replay does
not create new domain truth and grants no new authority.

## Compatibility

Common event envelope version, individual event payload schema version, subject Object
contract version, and subject type schema version are separate. Consumers declare
supported versions. Unknown or incompatible events are quarantined safely; consumers
never infer unknown semantics.

Breaking payload changes create a new major event type/schema version. Golden fixtures
must prove forward/backward behavior before release.

## Security and privacy

- Event identity, owner, permission reference, or source event never grants authority.
- Consumers re-resolve current Identity, Object lifecycle, and policy before side effects.
- Events exclude credentials, secrets, private content, raw embeddings, and removed
  Deleted/Destroyed data.
- Cross-owner publication fails closed until policy explicitly authorizes it.
- Integrity is verified before consumption; invalid events cannot mutate truth.
- Operational logs do not copy payloads or owner/Object IDs by default.

## Failure categories

- invalid envelope or payload;
- unsupported contract or schema;
- integrity failure;
- duplicate already processed;
- subject revision gap;
- owner/policy mismatch;
- publication unavailable;
- poison event quarantined; and
- retention/replay request outside approved scope.

Event failures are observable and isolated so one subject cannot block unrelated
subjects indefinitely. No fallback path directly calls a downstream service.

