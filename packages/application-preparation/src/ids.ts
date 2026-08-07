import { asObjectIdV1, type ObjectIdV1 } from "@aion/object";
import { createHash } from "node:crypto";

export interface ApplicationPreparationIdDeriverV1 { derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1; }
export class Sha256ApplicationPreparationIdDeriverV1 implements ApplicationPreparationIdDeriverV1 {
  derive(operationId: string, purpose: string, logicalKey: string): ObjectIdV1 {
    const bytes = createHash("sha256").update("aion.application-preparation.object-id.v1\0").update(operationId).update("\0").update(purpose).update("\0").update(logicalKey).digest();
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString("hex");
    return asObjectIdV1(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
}
export function privateDraftReferenceV1(id: ObjectIdV1) {
  return Object.freeze({ version: "1" as const, fingerprint: createHash("sha256").update("aion.application-draft.reference.v1\0").update(id).digest("hex").slice(0, 16) });
}
