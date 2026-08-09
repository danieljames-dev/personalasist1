/**
 * R6.5.2: Owner approval inbox under broker-private state.
 * Only elevated Owner Approval Helper (Admin) may write requests.
 * Broker service alone mints proofs with private presence key.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DelegatedOperatorError } from "./contracts.js";

export interface OwnerApprovalInboxRequestV1 {
  readonly schemaVersion: "aion.owner-approval-inbox.v1";
  readonly authorizationId: string;
  readonly envelopeDigest: string;
  readonly approvalNonce: string;
  readonly directiveId: string;
  readonly repositoryRoot: string;
  readonly requestedAtUtc: string;
  readonly helperPid: number;
  readonly elevated: true;
}

export function writeOwnerApprovalRequest(inboxDir: string, req: OwnerApprovalInboxRequestV1): string {
  mkdirSync(inboxDir, { recursive: true });
  const id = randomBytes(8).toString("hex");
  const path = join(inboxDir, `${id}.json`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(req, null, 2), "utf8");
  renameSync(tmp, path);
  return path;
}

export function parseOwnerApprovalRequest(raw: unknown): OwnerApprovalInboxRequestV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new DelegatedOperatorError("approval-inbox", "Invalid approval request");
  }
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== "aion.owner-approval-inbox.v1") {
    throw new DelegatedOperatorError("approval-inbox", "Unsupported approval request schema");
  }
  if (r.elevated !== true) {
    throw new DelegatedOperatorError("approval-inbox", "Approval request must claim elevated helper");
  }
  for (const k of [
    "authorizationId",
    "envelopeDigest",
    "approvalNonce",
    "directiveId",
    "repositoryRoot",
    "requestedAtUtc",
  ]) {
    if (typeof r[k] !== "string" || (r[k] as string).length === 0) {
      throw new DelegatedOperatorError("approval-inbox", `Missing field ${k}`);
    }
  }
  if (typeof r.helperPid !== "number") {
    throw new DelegatedOperatorError("approval-inbox", "helperPid required");
  }
  return {
    schemaVersion: "aion.owner-approval-inbox.v1",
    authorizationId: r.authorizationId as string,
    envelopeDigest: r.envelopeDigest as string,
    approvalNonce: r.approvalNonce as string,
    directiveId: r.directiveId as string,
    repositoryRoot: r.repositoryRoot as string,
    requestedAtUtc: r.requestedAtUtc as string,
    helperPid: r.helperPid as number,
    elevated: true,
  };
}

export function drainOwnerApprovalInbox(inboxDir: string): OwnerApprovalInboxRequestV1[] {
  if (!existsSync(inboxDir)) return [];
  const out: OwnerApprovalInboxRequestV1[] = [];
  for (const name of readdirSync(inboxDir)) {
    if (!name.endsWith(".json")) continue;
    const full = join(inboxDir, name);
    try {
      const req = parseOwnerApprovalRequest(JSON.parse(readFileSync(full, "utf8")));
      out.push(req);
    } catch {
      /* leave corrupt for audit; skip */
      continue;
    } finally {
      try {
        unlinkSync(full);
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}
