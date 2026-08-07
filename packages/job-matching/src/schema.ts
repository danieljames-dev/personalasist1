import { JobPostingSchemaRegistryV1 } from "@aion/job-posting";
import {
  JOB_MATCH_REPORT_OBJECT_V1,
  type CanonicalValueV1,
  type ObjectSchemaRegistryV1,
  type ObjectTypeRegistrationV1,
} from "@aion/object";
import { validateJobMatchReportPayloadV1 } from "./contracts.js";

function same(left: ObjectTypeRegistrationV1, right: ObjectTypeRegistrationV1): boolean {
  return left.objectType === right.objectType && left.objectProfile === right.objectProfile
    && left.schemaId === right.schemaId && left.schemaVersion === right.schemaVersion;
}

export class JobMatchingSchemaRegistryV1 implements ObjectSchemaRegistryV1 {
  readonly #base = new JobPostingSchemaRegistryV1();
  isRegistered(registration: ObjectTypeRegistrationV1): boolean { return this.#base.isRegistered(registration); }
  isExtensionNamespaceRegistered(namespace: string): boolean { return this.#base.isExtensionNamespaceRegistered(namespace); }
  validateData(registration: ObjectTypeRegistrationV1, data: CanonicalValueV1): boolean {
    try {
      if (same(registration, JOB_MATCH_REPORT_OBJECT_V1)) { validateJobMatchReportPayloadV1(data); return true; }
      return this.#base.validateData(registration, data);
    } catch { return false; }
  }
}
