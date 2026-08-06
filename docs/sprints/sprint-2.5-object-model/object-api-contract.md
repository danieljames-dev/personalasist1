# Universal Object API contract v1

Status: Proposed normative contract

## Version and compatibility

The future import path is `@aion/object-model/object/v1`. Language-neutral schemas
will live under an equivalent `object/v1` contract namespace. Breaking changes require
`object/v2`; existing v1 Objects remain readable during migration.

The TypeScript notation below specifies semantics, not implementation language.

## Values

```ts
type ObjectIdV1 = string & { readonly __brand: "ObjectIdV1" }; // canonical UUID
type ObjectTypeV1 = string & { readonly __brand: "ObjectTypeV1" };
type ObjectRevisionIdV1 = ObjectIdV1;
type ObjectEventIdV1 = ObjectIdV1;
type ObjectRelationshipIdV1 = ObjectIdV1;
type CorrelationIdV1 = string & { readonly __brand: "CorrelationIdV1" };
type TimestampV1 = string & { readonly __brand: "RFC3339TimestampV1" };

type JsonPrimitiveV1 = null | boolean | number | string;
type JsonValueV1 = JsonPrimitiveV1 | JsonValueV1[] | {
  readonly [key: string]: JsonValueV1;
};
type JsonObjectV1 = { readonly [key: string]: JsonValueV1 };
```

Numbers must be finite and interoperable with the normative JSON schema. Timestamps
are normalized UTC RFC 3339 strings with approved precision.

## Envelope

```ts
interface AionObjectV1<TData extends JsonObjectV1> {
  readonly id: ObjectIdV1;
  readonly objectType: ObjectTypeV1;
  readonly objectContractVersion: "1.0";
  readonly schemaVersion: number;
  readonly revision: number;
  readonly ownership: ObjectOwnershipV1;
  readonly createdBy: ActorIdV1;
  readonly updatedBy: ActorIdV1;
  readonly createdAt: TimestampV1;
  readonly updatedAt: TimestampV1;
  readonly lifecycle: ObjectLifecycleStateV1;
  readonly metadata: ObjectMetadataV1;
  readonly provenance: readonly ProvenanceRecordV1[];
  readonly relationshipRefs: readonly ObjectRelationshipIdV1[];
  readonly permissionRefs: readonly PermissionReferenceV1[];
  readonly historyRefs: readonly ObjectRevisionIdV1[];
  readonly eventRefs: readonly ObjectEventIdV1[];
  readonly integrity: ObjectIntegrityV1;
  readonly data: TData;
}

interface ObjectOwnershipV1 {
  readonly ownerId: OwnerIdV1;
}

type ObjectLifecycleStateV1 = "active" | "archived" | "tombstoned";

interface ObjectMetadataV1 {
  readonly labels: readonly string[];
  readonly extensions: Readonly<Record<string, JsonObjectV1>>;
}

interface PermissionReferenceV1 {
  readonly permissionObjectId: ObjectIdV1;
  readonly permissionRevision: number;
}

interface ProvenanceRecordV1 {
  readonly sourceKind: "owner" | "import" | "derived" | "system";
  readonly sourceObjectId?: ObjectIdV1;
  readonly sourceUri?: string;
  readonly observedAt: TimestampV1;
  readonly recordedBy: ActorIdV1;
  readonly confidence?: number; // 0..1; absence means not assessed
  readonly method?: string;
}

interface ObjectIntegrityV1 {
  readonly contentHash: string;
  readonly algorithm: "sha-256";
}
```

Arrays and nested values are deeply immutable at the contract boundary. Ordering is
normative where present. Duplicate references are invalid.

## Command context

```ts
interface ObjectCommandContextV1 {
  readonly actorId: ActorIdV1;
  readonly ownerId: OwnerIdV1;
  readonly correlationId: CorrelationIdV1;
  readonly causationEventId?: ObjectEventIdV1;
  readonly provenance: readonly ProvenanceRecordV1[];
  readonly signal: AbortSignal;
}
```

Context identifies and correlates a request but conveys no authorization decision.

## Ports

```ts
interface ObjectServiceV1 {
  create<T extends JsonObjectV1>(
    command: CreateObjectCommandV1<T>,
    context: ObjectCommandContextV1,
  ): Promise<AionObjectV1<T>>;

  get<T extends JsonObjectV1>(
    id: ObjectIdV1,
    context: ObjectReadContextV1,
  ): Promise<AionObjectV1<T>>;

  update<T extends JsonObjectV1>(
    command: UpdateObjectCommandV1<T>,
    context: ObjectCommandContextV1,
  ): Promise<AionObjectV1<T>>;

  archive(command: ObjectTransitionCommandV1, context: ObjectCommandContextV1):
    Promise<AionObjectV1<JsonObjectV1>>;

  restore(command: ObjectTransitionCommandV1, context: ObjectCommandContextV1):
    Promise<AionObjectV1<JsonObjectV1>>;

  tombstone(command: ObjectTransitionCommandV1, context: ObjectCommandContextV1):
    Promise<AionObjectV1<JsonObjectV1>>;

  transferOwnership(command: TransferOwnershipCommandV1,
    context: ObjectCommandContextV1): Promise<AionObjectV1<JsonObjectV1>>;
}

interface ObjectRepositoryV1 {
  get(id: ObjectIdV1, options: ObjectReadOptionsV1):
    Promise<AionObjectV1<JsonObjectV1> | undefined>;
  commit(changeSet: ObjectChangeSetV1): Promise<ObjectCommitResultV1>;
}

interface ObjectTypeRegistryV1 {
  get(type: ObjectTypeV1, schemaVersion: number):
    Promise<ObjectTypeDescriptorV1 | undefined>;
  validate(type: ObjectTypeV1, schemaVersion: number, data: JsonObjectV1):
    Promise<ObjectValidationResultV1>;
}

interface ObjectEventPublisherV1 {
  publish(events: readonly ObjectEventV1[]): Promise<void>;
}
```

The repository atomically commits snapshot, revision, relationship changes, and
pending event records. The publisher communicates facts only and has no downstream
service API. A durable adapter uses an outbox or equivalently proven mechanism.

## Commands

```ts
interface CreateObjectCommandV1<T extends JsonObjectV1> {
  readonly id?: ObjectIdV1;
  readonly objectType: ObjectTypeV1;
  readonly schemaVersion: number;
  readonly ownerId: OwnerIdV1;
  readonly metadata?: ObjectMetadataV1;
  readonly permissionRefs?: readonly PermissionReferenceV1[];
  readonly data: T;
}

interface UpdateObjectCommandV1<T extends JsonObjectV1> {
  readonly id: ObjectIdV1;
  readonly expectedRevision: number;
  readonly schemaVersion: number;
  readonly metadata?: ObjectMetadataV1;
  readonly permissionRefs?: readonly PermissionReferenceV1[];
  readonly data: T;
}

interface ObjectTransitionCommandV1 {
  readonly id: ObjectIdV1;
  readonly expectedRevision: number;
  readonly reason: string;
}

interface TransferOwnershipCommandV1 extends ObjectTransitionCommandV1 {
  readonly newOwnerId: OwnerIdV1;
  readonly approvalObjectId: ObjectIdV1;
}
```

Updates replace the complete validated type data in v1. Generic JSON Patch is not a
public contract because path-level mutations can bypass schema and domain invariants.

## Stable failure codes

| Code | Meaning |
|---|---|
| `OBJECT_INVALID` | Envelope or data violates a declared invariant |
| `OBJECT_TYPE_UNKNOWN` | Type or schema version is not registered |
| `OBJECT_NOT_FOUND` | No visible Object exists for the ID |
| `OBJECT_CONFLICT` | Expected revision does not match committed revision |
| `OBJECT_STATE_INVALID` | Operation is illegal in current lifecycle state |
| `OBJECT_REFERENCE_INVALID` | Relationship/history/event/permission reference is invalid |
| `OBJECT_OWNER_MISMATCH` | Command owner context conflicts with canonical ownership |
| `OBJECT_POLICY_REQUIRED` | Required policy/approval evidence is absent |
| `OBJECT_COMMIT_FAILED` | Atomic persistence did not commit |
| `OBJECT_EVENT_PUBLICATION_FAILED` | Commit exists but publication requires safe retry |
| `OBJECT_CANCELLED` | Cancellation occurred before a commit boundary |

Errors may include correlation ID, object type, expected/actual revision, and retry
classification. They must not expose Object content, owner identity, storage details,
credentials, or policy internals.

## Compatibility rules

- Unknown additive metadata extension namespaces round-trip unchanged.
- Readers reject unsupported Object contract major versions.
- Readers may accept a newer type schema only when its descriptor declares backward
  read compatibility and conformance fixtures prove it.
- Writers never downgrade an Object silently.
- Serialization is deterministic for integrity calculation; the canonicalization
  algorithm must be separately specified before implementation.

