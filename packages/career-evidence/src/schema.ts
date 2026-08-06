import {
  CAREER_FACT_OBJECT_V1,
  CAREER_PROFILE_OBJECT_V1,
  CAREER_SOURCE_OBJECT_V1,
  CareerObjectSchemaRegistryV1,
  type CanonicalValueV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
} from "@aion/object";

import {
  validateCareerFactPayloadV1,
  validateCareerProfilePayloadV1,
  validateCareerSourcePayloadV1,
} from "./contracts.js";

function same(left: ObjectTypeRegistrationV1, right: ObjectTypeRegistrationV1): boolean {
  return left.objectType === right.objectType
    && left.objectProfile === right.objectProfile
    && left.schemaId === right.schemaId
    && left.schemaVersion === right.schemaVersion;
}

export class CareerEvidenceSchemaRegistryV1 implements ObjectSchemaRegistryV1 {
  readonly #base = new CareerObjectSchemaRegistryV1();

  isRegistered(registration: ObjectTypeRegistrationV1): boolean {
    return this.#base.isRegistered(registration);
  }

  isExtensionNamespaceRegistered(_namespace: string): boolean {
    return false;
  }

  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    try {
      if (same(registration, CAREER_SOURCE_OBJECT_V1)) {
        validateCareerSourcePayloadV1(data);
        return true;
      }
      if (same(registration, CAREER_FACT_OBJECT_V1)) {
        validateCareerFactPayloadV1(data);
        return true;
      }
      if (same(registration, CAREER_PROFILE_OBJECT_V1)) {
        validateCareerProfilePayloadV1(data);
        return true;
      }
      return this.#base.validateData(registration, data);
    } catch {
      return false;
    }
  }
}
