import { JobMatchingSchemaRegistryV1 } from "@aion/job-matching";
import { APPLICATION_DRAFT_OBJECT_V1, type CanonicalValueV1, type ObjectSchemaRegistryV1, type ObjectTypeRegistrationV1 } from "@aion/object";
import { validateApplicationDraftPayloadV1 } from "./contracts.js";

function same(left: ObjectTypeRegistrationV1, right: ObjectTypeRegistrationV1): boolean {
  return left.objectType === right.objectType && left.objectProfile === right.objectProfile
    && left.schemaId === right.schemaId && left.schemaVersion === right.schemaVersion;
}
export class ApplicationPreparationSchemaRegistryV1 implements ObjectSchemaRegistryV1 {
  readonly #base = new JobMatchingSchemaRegistryV1();
  isRegistered(registration: ObjectTypeRegistrationV1): boolean { return this.#base.isRegistered(registration); }
  isExtensionNamespaceRegistered(namespace: string): boolean { return this.#base.isExtensionNamespaceRegistered(namespace); }
  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    try {
      if (same(registration, APPLICATION_DRAFT_OBJECT_V1)) { validateApplicationDraftPayloadV1(data); return true; }
      return this.#base.validateData(registration, data);
    } catch { return false; }
  }
}
