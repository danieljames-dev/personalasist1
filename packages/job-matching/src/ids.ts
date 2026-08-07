import { asObjectIdV1, type ObjectIdV1 } from "@aion/object";
import { createHash } from "node:crypto";

export interface JobMatchingIdDeriverV1 {
  derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1;
}

export class Sha256JobMatchingIdDeriverV1 implements JobMatchingIdDeriverV1 {
  derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1 {
    const bytes = createHash("sha256")
      .update("aion.job-matching.object-id.v1\0", "utf8")
      .update(operationId, "utf8").update("\0", "utf8")
      .update(purpose, "utf8").update("\0", "utf8")
      .update(logicalKey, "utf8").digest();
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString("hex");
    return asObjectIdV1(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
}

export function privateMatchReferenceV1(objectId: ObjectIdV1) {
  return Object.freeze({
    version: "1" as const,
    fingerprint: createHash("sha256")
      .update("aion.job-match.reference.v1\0", "utf8")
      .update(objectId, "utf8").digest("hex").slice(0, 16),
  });
}
