/**
 * The Experience and Learning Ledger now lives in `src`.
 *
 * It moved there when the autonomy kernel needed it: the original comment in this file said storage
 * "belongs to a milestone that is about memory rather than one that is about discovery", and that
 * milestone arrived. The harness and the kernel share one ledger rather than two that drift.
 *
 * This file stays as a re-export so every existing harness import keeps working and the campaign
 * artifacts already on disk keep parsing — the schema id did not change.
 */
export {
  EXPERIENCE_LEDGER_SCHEMA_V1,
  EXPERIENCE_PROVENANCE_V1,
  createExperienceLedger,
  type ExperienceEntryV1,
  type ExperienceFreshnessV1,
  type ExperienceLedgerV1,
  type ExperienceOutcomeV1,
  type ExperienceProvenanceV1,
} from "../../src/experience-ledger.js";
