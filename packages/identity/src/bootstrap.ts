import {
  asActorIdV1,
  asOwnerIdV1,
  asPrincipalIdV1,
  asSystemInstanceIdV1,
  IdentityErrorV1,
  validateLocalIdentityStateV1,
  type IdentityClock,
  type IdentityIdGenerator,
  type IdentityKindV1,
  type IdentityRecordV1,
  type IdentityStateRepository,
  type LocalIdentityStateV1,
} from "./contracts.js";

export type InitializeIdentityResultV1 =
  | { readonly version: "1"; readonly outcome: "initialized"; readonly state: LocalIdentityStateV1 }
  | { readonly version: "1"; readonly outcome: "already-initialized"; readonly state: LocalIdentityStateV1 };

function validatedTimestamp(clock: IdentityClock): string {
  const value = clock.now();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    throw new IdentityErrorV1("identity-state-invalid", "Identity clock returned a non-canonical timestamp.");
  }
  return value;
}

function record(kind: IdentityKindV1, id: IdentityRecordV1["id"], timestamp: string): IdentityRecordV1 {
  return { version: "1", kind, id, lifecycleStatus: "active", createdAt: timestamp, updatedAt: timestamp, revision: 1 };
}

export async function initializeLocalIdentityV1(
  repository: IdentityStateRepository,
  generator: IdentityIdGenerator,
  clock: IdentityClock,
): Promise<InitializeIdentityResultV1> {
  return repository.withExclusiveInitialization(async () => {
    const existing = await repository.load();
    if (existing !== null) {
      return { version: "1", outcome: "already-initialized", state: validateLocalIdentityStateV1(existing) };
    }

    const timestamp = validatedTimestamp(clock);
    const ownerId = asOwnerIdV1(generator.generate("owner"));
    const principalId = asPrincipalIdV1(generator.generate("principal"));
    const actorId = asActorIdV1(generator.generate("actor"));
    const systemInstanceId = asSystemInstanceIdV1(generator.generate("system-instance"));
    if (new Set([ownerId, principalId, actorId, systemInstanceId]).size !== 4) {
      throw new IdentityErrorV1("identity-state-conflict", "Identity generator returned a duplicate identifier.");
    }

    const state: LocalIdentityStateV1 = {
      schemaVersion: "aion.local-identity-state.v1",
      contractVersion: "identity-contract-v1",
      lifecycleStatus: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: {
        version: "1",
        source: "explicit-local-bootstrap",
        recordedAt: timestamp,
        generatorProfileVersion: "uuid-v4-rfc9562",
      },
      records: [
        record("owner", ownerId, timestamp),
        record("principal", principalId, timestamp),
        record("actor", actorId, timestamp),
        record("system-instance", systemInstanceId, timestamp),
      ],
      relationships: [
        { version: "1", kind: "actor-to-principal", actorId, principalId },
        { version: "1", kind: "principal-to-owner", principalId, ownerId },
        { version: "1", kind: "system-instance-to-owner", systemInstanceId, ownerId },
      ],
    };
    validateLocalIdentityStateV1(state);
    await repository.installNew(state);
    return { version: "1", outcome: "initialized", state };
  });
}
