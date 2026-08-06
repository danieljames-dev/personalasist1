import {
  ObjectErrorV1,
  type ObjectCommitRequestV1,
  type ObjectConstructionPortsV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectLifecycleStatusV1,
  type ObjectRepository,
} from "./contracts.js";
import { validateObjectEnvelopeV1 } from "./object.js";

type ValidationPorts = Pick<ObjectConstructionPortsV1, "canonicalizer" | "digest" | "schemaRegistry">;

const NON_DESTRUCTIVE_TRANSITIONS: Readonly<Record<ObjectLifecycleStatusV1, readonly ObjectLifecycleStatusV1[]>> = {
  created: ["created", "validated", "active"],
  validated: ["validated", "active"],
  active: ["active", "archived", "deprecated"],
  archived: ["archived", "active"],
  deprecated: ["deprecated", "active", "archived"],
  deleted: ["deleted"],
  destroyed: ["destroyed"],
};

function fail(code: "revision-conflict" | "invalid-object" | "invalid-lifecycle-transition", location: string, message: string): never {
  throw new ObjectErrorV1(code, location, message);
}
function sameIdentityAndImmutableFields(current: ObjectEnvelopeV1, next: ObjectEnvelopeV1): boolean {
  return current.objectId === next.objectId
    && current.objectType === next.objectType
    && current.objectProfile === next.objectProfile
    && current.objectContractVersion === next.objectContractVersion
    && current.schemaId === next.schemaId
    && current.schemaVersion === next.schemaVersion
    && current.ownership.ownerId === next.ownership.ownerId
    && current.createdBy === next.createdBy
    && current.createdAt === next.createdAt;
}

export class InMemoryObjectRepositoryV1 implements ObjectRepository {
  readonly #current = new Map<string, ObjectEnvelopeV1>();
  readonly #history = new Map<string, Map<number, ObjectEnvelopeV1>>();

  constructor(
    private readonly ports: ValidationPorts,
    initialState: readonly unknown[] = [],
  ) {
    for (const candidate of initialState) {
      const snapshot = validateObjectEnvelopeV1(candidate, ports);
      if (this.#current.has(snapshot.objectId) || snapshot.revision !== 1) {
        fail("invalid-object", "$", "Initial repository state is conflicting or unsupported.");
      }
      this.#current.set(snapshot.objectId, snapshot);
      this.#history.set(snapshot.objectId, new Map([[snapshot.revision, snapshot]]));
    }
  }

  async loadCurrent(objectId: ObjectIdV1): Promise<ObjectEnvelopeV1 | null> {
    const value = this.#current.get(objectId);
    return value === undefined ? null : validateObjectEnvelopeV1(value, this.ports);
  }

  async loadRevision(objectId: ObjectIdV1, revision: number): Promise<ObjectEnvelopeV1 | null> {
    const value = this.#history.get(objectId)?.get(revision);
    return value === undefined ? null : validateObjectEnvelopeV1(value, this.ports);
  }

  async commit(request: ObjectCommitRequestV1): Promise<void> {
    const snapshot = validateObjectEnvelopeV1(request.snapshot, this.ports);
    const current = this.#current.get(snapshot.objectId);

    if (request.expectedRevision === null) {
      if (current !== undefined || snapshot.revision !== 1) {
        fail("revision-conflict", "$.revision", "Object creation conflicts with existing state.");
      }
      this.#current.set(snapshot.objectId, snapshot);
      this.#history.set(snapshot.objectId, new Map([[1, snapshot]]));
      return;
    }

    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
      fail("revision-conflict", "$.expectedRevision", "Expected revision is invalid.");
    }
    if (current === undefined || current.revision !== request.expectedRevision) {
      fail("revision-conflict", "$.expectedRevision", "Expected revision does not match current state.");
    }
    if (snapshot.revision !== current.revision + 1) {
      fail("revision-conflict", "$.revision", "Next revision must advance exactly once.");
    }
    if (!sameIdentityAndImmutableFields(current, snapshot)) {
      fail("invalid-object", "$", "Immutable Object fields changed.");
    }
    if (Date.parse(snapshot.modifiedAt) < Date.parse(current.modifiedAt)) {
      fail("invalid-object", "$.modifiedAt", "Modified time moved backward.");
    }
    if (!NON_DESTRUCTIVE_TRANSITIONS[current.lifecycleState].includes(snapshot.lifecycleState)) {
      fail("invalid-lifecycle-transition", "$.lifecycleState", "Lifecycle transition is not authorized.");
    }
    if (snapshot.lifecycleState === "deleted" || snapshot.lifecycleState === "destroyed") {
      fail("invalid-lifecycle-transition", "$.lifecycleState", "Delete and destroy are outside Phase 5.");
    }

    const nextHistory = new Map(this.#history.get(snapshot.objectId));
    if (nextHistory.has(snapshot.revision)) {
      fail("revision-conflict", "$.revision", "Revision identity is already reserved.");
    }
    nextHistory.set(snapshot.revision, snapshot);
    this.#history.set(snapshot.objectId, nextHistory);
    this.#current.set(snapshot.objectId, snapshot);
  }
}
