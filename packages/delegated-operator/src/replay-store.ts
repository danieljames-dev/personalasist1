/**
 * Durable anti-replay store (M-5).
 * Survives broker process restart when backed by the same state directory.
 * Fail closed if state corrupt/unavailable.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DelegatedOperatorError } from "./contracts.js";
import { digestCanonical } from "./canonical.js";

export interface ReplayIdentityV1 {
  readonly authorizationId: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly envelopeDigest: string;
  readonly sessionOrBrokerId: string;
}

export class DurableReplayStore {
  private readonly path: string;
  private consumed: Set<string>;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, "replay-consumed.v1.json");
    this.consumed = this.load();
  }

  private load(): Set<string> {
    if (!existsSync(this.path)) {
      this.persist(new Set());
      return new Set();
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { ids?: unknown }).ids)) {
        throw new Error("shape");
      }
      const ids = (raw as { ids: unknown[] }).ids;
      const set = new Set<string>();
      for (const id of ids) {
        if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new Error("bad id");
        set.add(id);
      }
      return set;
    } catch {
      throw new DelegatedOperatorError("replay-state-corrupt", "Replay state corrupt or unreadable; fail closed");
    }
  }

  private persist(set: Set<string>): void {
    const body = JSON.stringify({ version: 1, ids: [...set].sort() }, null, 0);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, this.path);
  }

  static identityKey(id: ReplayIdentityV1): string {
    return digestCanonical({
      authorizationId: id.authorizationId,
      requestId: id.requestId,
      requestDigest: id.requestDigest,
      envelopeDigest: id.envelopeDigest,
      sessionOrBrokerId: id.sessionOrBrokerId,
    });
  }

  /**
   * Mark consumed BEFORE privileged execution (write-ahead).
   * Returns false if already consumed.
   */
  tryConsume(id: ReplayIdentityV1): boolean {
    const key = DurableReplayStore.identityKey(id);
    // reload to survive multi-instance races best-effort
    this.consumed = this.load();
    if (this.consumed.has(key)) return false;
    this.consumed.add(key);
    this.persist(this.consumed);
    return true;
  }

  has(id: ReplayIdentityV1): boolean {
    this.consumed = this.load();
    return this.consumed.has(DurableReplayStore.identityKey(id));
  }
}

export function requestBodyDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
