import type {
  IdentityClock,
  IdentityIdGenerator,
  IdentityKindV1,
  IdentityStateRepository,
  LocalIdentityStateV1,
} from "../src/index.js";

export const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
] as const;
export const TIME = "2026-01-02T03:04:05.000Z";

export class DeterministicClock implements IdentityClock {
  calls = 0;
  constructor(private readonly value = TIME) {}
  now(): string { this.calls += 1; return this.value; }
}

export class DeterministicGenerator implements IdentityIdGenerator {
  calls: IdentityKindV1[] = [];
  constructor(private readonly values: readonly string[] = IDS) {}
  generate(kind: IdentityKindV1): string {
    const value = this.values[this.calls.length];
    this.calls.push(kind);
    if (!value) throw new Error("deterministic generator exhausted");
    return value;
  }
}

export class MemoryRepository implements IdentityStateRepository {
  value: unknown | null = null;
  installs = 0;
  lockCalls = 0;
  failInstall = false;
  async withExclusiveInitialization<T>(operation: () => Promise<T>): Promise<T> {
    this.lockCalls += 1;
    return operation();
  }
  async load(): Promise<unknown | null> { return structuredClone(this.value); }
  async installNew(state: LocalIdentityStateV1): Promise<void> {
    if (this.failInstall) throw new Error("synthetic persistence failure");
    if (this.value !== null) throw new Error("synthetic conflict");
    this.value = structuredClone(state);
    this.installs += 1;
  }
}

export function cloneState(state: LocalIdentityStateV1): Record<string, unknown> {
  return structuredClone(state) as unknown as Record<string, unknown>;
}
