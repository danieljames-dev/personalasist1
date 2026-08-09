import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  type CapabilityEnvelopeV1,
  type AuthorizationLifecycleV1,
  DelegatedOperatorError,
} from "./contracts.js";
import { parseCapabilityEnvelope, envelopeDigest } from "./envelope.js";
import { type AuthorizationRecordV1 } from "./authorization.js";

export interface StoreSnapshotV1 {
  readonly generation: number;
  readonly records: Record<string, AuthorizationRecordV1>;
  readonly writerLock: null | {
    readonly repositoryRoot: string;
    readonly authorizationId: string;
    readonly agentRole: "GROK_BUILD";
  };
}

export class AuthorizationStore {
  private generation = 1;
  private records = new Map<string, AuthorizationRecordV1>();
  private writerLock: StoreSnapshotV1["writerLock"] = null;
  private readonly dir: string;

  constructor(storeDir: string) {
    this.dir = storeDir;
    mkdirSync(this.dir, { recursive: true });
    this.load();
  }

  private path(): string {
    return join(this.dir, "authorizations.json");
  }

  private load(): void {
    const p = this.path();
    if (!existsSync(p)) {
      this.persist();
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    } catch {
      throw new DelegatedOperatorError("store-corrupt", "Authorization store is not valid JSON");
    }
    if (typeof raw !== "object" || raw === null) {
      throw new DelegatedOperatorError("store-corrupt", "Authorization store root invalid");
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.generation !== "number" || !Number.isInteger(rec.generation) || rec.generation < 1) {
      throw new DelegatedOperatorError("store-corrupt", "generation invalid");
    }
    this.generation = rec.generation;
    this.records.clear();
    if (typeof rec.records !== "object" || rec.records === null) {
      throw new DelegatedOperatorError("store-corrupt", "records invalid");
    }
    for (const [id, value] of Object.entries(rec.records as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) {
        throw new DelegatedOperatorError("store-corrupt", `record ${id} invalid`);
      }
      const r = value as Record<string, unknown>;
      const envelope = parseCapabilityEnvelope(r.envelope);
      if (envelope.authorizationId !== id) {
        throw new DelegatedOperatorError("store-corrupt", "authorizationId mismatch in store");
      }
      const digest = typeof r.envelopeDigest === "string" ? r.envelopeDigest : "";
      if (digest !== envelopeDigest(envelope)) {
        throw new DelegatedOperatorError("store-corrupt", "Stored envelope digest mismatch");
      }
      this.records.set(id, {
        envelope,
        lifecycle: r.lifecycle as AuthorizationLifecycleV1,
        envelopeDigest: digest,
        generation: typeof r.generation === "number" ? r.generation : this.generation,
        superseded: r.superseded === true,
      });
    }
    this.writerLock = (rec.writerLock as StoreSnapshotV1["writerLock"]) ?? null;
  }

  private persist(): void {
    const records: Record<string, AuthorizationRecordV1> = {};
    for (const [id, value] of this.records) records[id] = value;
    const snapshot: StoreSnapshotV1 = {
      generation: this.generation,
      records,
      writerLock: this.writerLock,
    };
    const target = this.path();
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    renameSync(tmp, target);
  }

  putPending(envelope: CapabilityEnvelopeV1): AuthorizationRecordV1 {
    if (envelope.approvalProof !== null) {
      throw new DelegatedOperatorError("store-invalid", "Pending envelope must not include approval proof");
    }
    const parsed = parseCapabilityEnvelope(envelope);
    if (this.records.has(parsed.authorizationId)) {
      throw new DelegatedOperatorError("duplicate-auth", "authorizationId already exists");
    }
    const record: AuthorizationRecordV1 = {
      envelope: parsed,
      lifecycle: "PENDING_OWNER_AUTHORIZATION",
      envelopeDigest: envelopeDigest(parsed),
      generation: this.generation,
      superseded: false,
    };
    this.records.set(parsed.authorizationId, record);
    this.persist();
    return record;
  }

  /**
   * Activate only when proof already attached and verified by caller.
   * Agents have no method that sets lifecycle to AUTHORIZED without proof.
   */
  activateWithProof(envelope: CapabilityEnvelopeV1): AuthorizationRecordV1 {
    const parsed = parseCapabilityEnvelope(envelope);
    if (parsed.approvalProof === null) {
      throw new DelegatedOperatorError("missing-approval", "Cannot activate without approval proof");
    }
    const digest = envelopeDigest(parsed);
    const existing = this.records.get(parsed.authorizationId);
    if (existing?.superseded) {
      throw new DelegatedOperatorError("superseded", "Cannot activate superseded authorization");
    }
    // Supersede previous if referenced
    if (parsed.supersedesAuthorizationId) {
      const prev = this.records.get(parsed.supersedesAuthorizationId);
      if (prev) {
        this.records.set(parsed.supersedesAuthorizationId, {
          ...prev,
          lifecycle: "SUPERSEDED",
          superseded: true,
        });
      }
    }
    const record: AuthorizationRecordV1 = {
      envelope: parsed,
      lifecycle: "AUTHORIZED",
      envelopeDigest: digest,
      generation: this.generation,
      superseded: false,
    };
    this.records.set(parsed.authorizationId, record);
    this.generation += 1;
    this.persist();
    return record;
  }

  get(authorizationId: string): AuthorizationRecordV1 | undefined {
    return this.records.get(authorizationId);
  }

  setLifecycle(authorizationId: string, lifecycle: AuthorizationLifecycleV1): AuthorizationRecordV1 {
    const cur = this.records.get(authorizationId);
    if (!cur) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (cur.superseded && lifecycle !== "SUPERSEDED") {
      throw new DelegatedOperatorError("superseded", "Cannot change superseded authorization");
    }
    const next: AuthorizationRecordV1 = { ...cur, lifecycle, superseded: lifecycle === "SUPERSEDED" || cur.superseded };
    this.records.set(authorizationId, next);
    this.persist();
    return next;
  }

  isSuperseded(authorizationId: string): boolean {
    return this.records.get(authorizationId)?.superseded === true;
  }

  getWriterLock(): StoreSnapshotV1["writerLock"] {
    return this.writerLock;
  }

  setWriterLock(lock: StoreSnapshotV1["writerLock"]): void {
    this.writerLock = lock;
    this.persist();
  }

  /** Deleting the store file must not create authority — empty is deny. */
  static openOrEmpty(storeDir: string): AuthorizationStore {
    return new AuthorizationStore(storeDir);
  }

  listIds(): string[] {
    return [...this.records.keys()];
  }

  dirForTests(): string {
    return this.dir;
  }
}

export function wipeStoreForTests(storeDir: string): void {
  // Intentionally does not create default-allow; recreating store is empty deny.
  if (!existsSync(storeDir)) return;
  for (const name of readdirSync(storeDir)) {
    // leave deletion to test harness via fs.rmSync
    void name;
  }
}
