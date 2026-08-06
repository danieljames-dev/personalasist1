import { createHash, randomUUID } from "node:crypto";

import { validateLocalIdentityStateV1, type IdentityClock, type IdentityIdGenerator, type IdentityKindV1, type LocalIdentityStateV1 } from "./contracts.js";

export class SystemIdentityClock implements IdentityClock {
  now(): string { return new Date().toISOString(); }
}

export class RandomUuidIdentityIdGenerator implements IdentityIdGenerator {
  generate(_kind: IdentityKindV1): string { return randomUUID(); }
}

export interface IdentityStatusV1 {
  readonly version: "1";
  readonly initialized: boolean;
  readonly schemaVersion?: "aion.local-identity-state.v1";
  readonly lifecycleStatus?: "active" | "disabled";
  readonly recordCount: number;
  readonly relationshipCount: number;
  readonly fingerprints: readonly { readonly kind: IdentityKindV1; readonly sha256Prefix: string }[];
}

export function identityStatusV1(value: unknown | null): IdentityStatusV1 {
  if (value === null) return { version: "1", initialized: false, recordCount: 0, relationshipCount: 0, fingerprints: [] };
  const state: LocalIdentityStateV1 = validateLocalIdentityStateV1(value);
  return {
    version: "1",
    initialized: true,
    schemaVersion: state.schemaVersion,
    lifecycleStatus: state.lifecycleStatus,
    recordCount: state.records.length,
    relationshipCount: state.relationships.length,
    fingerprints: state.records.map(({ kind, id }) => ({
      kind,
      sha256Prefix: createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12),
    })),
  };
}
