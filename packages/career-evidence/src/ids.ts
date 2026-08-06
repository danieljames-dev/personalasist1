import { asObjectIdV1, type ObjectIdV1 } from "@aion/object";
import { createHash } from "node:crypto";

export interface CareerEvidenceIdDeriverV1 {
  derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1;
}

export class Sha256CareerEvidenceIdDeriverV1 implements CareerEvidenceIdDeriverV1 {
  derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1 {
    const bytes = createHash("sha256")
      .update("aion.career-evidence.object-id.v1\0", "utf8")
      .update(operationId, "utf8")
      .update("\0", "utf8")
      .update(purpose, "utf8")
      .update("\0", "utf8")
      .update(logicalKey, "utf8")
      .digest();
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString("hex");
    return asObjectIdV1(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`);
  }
}

export function privateObjectReferenceSummaryV1(objectId: ObjectIdV1) {
  const fingerprint = createHash("sha256")
    .update("aion.private-object-reference.v1\0", "utf8")
    .update(objectId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return Object.freeze({ version: "1" as const, fingerprint });
}

export function stableConflictGroupIdV1(factIds: readonly ObjectIdV1[], fieldLocations: readonly string[]): string {
  return `aion.conflict.${createHash("sha256")
    .update("aion.career-fact.conflict.v1\0", "utf8")
    .update([...factIds].sort().join("\0"), "utf8")
    .update("\0", "utf8")
    .update([...fieldLocations].sort().join("\0"), "utf8")
    .digest("hex")}`;
}
