import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type OperatorAuditEventV1, type AgentRoleV1, type OperationClassV1, DelegatedOperatorError } from "./contracts.js";
import { digestCanonical, safeEqualHex } from "./canonical.js";

const GENESIS = "0".repeat(64);

export class AuditLog {
  private seq = 0;
  private lastDigest = GENESIS;
  private readonly path: string;

  constructor(storeDir: string) {
    this.path = join(storeDir, "audit-log.jsonl");
    mkdirSync(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) {
      this.rebuildFromDisk();
    } else {
      writeFileSync(this.path, "", "utf8");
    }
  }

  private rebuildFromDisk(): void {
    const text = readFileSync(this.path, "utf8");
    if (!text.trim()) return;
    let prev = GENESIS;
    let seq = 0;
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new DelegatedOperatorError("audit-corrupt", "Audit log contains non-JSON line");
      }
      if (typeof parsed !== "object" || parsed === null) {
        throw new DelegatedOperatorError("audit-corrupt", "Audit log line not object");
      }
      const rec = parsed as OperatorAuditEventV1;
      try {
        const body = {
          seq: rec.seq,
          eventId: rec.eventId,
          utc: rec.utc,
          kind: rec.kind,
          authorizationId: rec.authorizationId ?? null,
          envelopeDigest: rec.envelopeDigest ?? null,
          agentRole: rec.agentRole ?? null,
          operation: rec.operation ?? null,
          outcome: rec.outcome,
          detail: rec.detail,
          prevDigest: rec.prevDigest,
        };
        const expected = digestCanonical(body);
        if (
          typeof rec.eventDigest !== "string" ||
          !safeEqualHex(expected, rec.eventDigest) ||
          rec.prevDigest !== prev
        ) {
          throw new DelegatedOperatorError("audit-tamper", "Audit log chain verification failed");
        }
        prev = rec.eventDigest;
        seq = rec.seq;
      } catch {
        throw new DelegatedOperatorError("audit-tamper", "Audit log chain verification failed");
      }
    }
    this.lastDigest = prev;
    this.seq = seq;
  }

  append(input: {
    kind: string;
    authorizationId: string | null;
    envelopeDigest: string | null;
    agentRole: AgentRoleV1 | null;
    operation: OperationClassV1 | null;
    outcome: string;
    detail: string;
    utc: string;
  }): OperatorAuditEventV1 {
    // Redact obvious secret-shaped content from detail.
    const detail = redact(input.detail);
    const seq = this.seq + 1;
    const eventId = randomBytes(12).toString("hex");
    const body = {
      seq,
      eventId,
      utc: input.utc,
      kind: input.kind,
      authorizationId: input.authorizationId,
      envelopeDigest: input.envelopeDigest,
      agentRole: input.agentRole,
      operation: input.operation,
      outcome: input.outcome,
      detail,
      prevDigest: this.lastDigest,
    };
    const eventDigest = digestCanonical(body);
    const event: OperatorAuditEventV1 = { ...body, eventDigest };
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, "utf8");
    this.seq = seq;
    this.lastDigest = eventDigest;
    return event;
  }

  tipDigest(): string {
    return this.lastDigest;
  }

  pathForTests(): string {
    return this.path;
  }
}

function redact(text: string): string {
  return text
    .replace(/\d{6}(-\d{6}){7}/g, "[RECOVERY_PASSWORD_REDACTED]")
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

export function hashFileSha256(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}
