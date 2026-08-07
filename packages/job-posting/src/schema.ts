import { CareerEvidenceSchemaRegistryV1 } from "@aion/career-evidence";
import {
  JOB_POSTING_OBJECT_V1,
  type CanonicalValueV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
} from "@aion/object";
import { validateJobPostingPayloadV1 } from "./contracts.js";

function same(left: ObjectTypeRegistrationV1, right: ObjectTypeRegistrationV1): boolean {
  return left.objectType === right.objectType
    && left.objectProfile === right.objectProfile
    && left.schemaId === right.schemaId
    && left.schemaVersion === right.schemaVersion;
}

export class JobPostingSchemaRegistryV1 implements ObjectSchemaRegistryV1 {
  readonly #base = new CareerEvidenceSchemaRegistryV1();

  isRegistered(registration: ObjectTypeRegistrationV1): boolean {
    return this.#base.isRegistered(registration);
  }

  isExtensionNamespaceRegistered(namespace: string): boolean {
    return this.#base.isExtensionNamespaceRegistered(namespace);
  }

  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    try {
      if (same(registration, JOB_POSTING_OBJECT_V1)) {
        validateJobPostingPayloadV1(data);
        return true;
      }
      return this.#base.validateData(registration, data);
    } catch {
      return false;
    }
  }
}
