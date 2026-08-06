import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAREER_FACTS_INPUT_VERSION_V1,
  CAREER_PREFERENCES_INPUT_VERSION_V1,
  CareerInputErrorV1,
  JOB_POSTING_INPUT_VERSION_V1,
  validateCareerFactsInputV1,
  validateCareerPreferencesInputV1,
  validateEvidenceDocumentDescriptorV1,
  validateJobPostingInputV1,
} from "../src/index.js";

const unknown = { state: "unknown" } as const;
const unknownList = { state: "unknown", values: [] } as const;

function fact(overrides: Record<string, unknown> = {}) {
  return {
    version: "1",
    factId: "synthetic.fact.1",
    factKind: "role-title",
    value: { state: "supplied", value: "Synthetic role" },
    startDate: { state: "supplied", value: "2024-01" },
    endDate: { state: "supplied", value: "2024-12" },
    responsibilities: ["Synthetic responsibility"],
    accomplishments: ["Synthetic accomplishment"],
    skills: ["Synthetic skill"],
    toolsAndTechnologies: ["Synthetic tool"],
    evidenceReferences: [{
      version: "1",
      documentKind: "other",
      reference: "synthetic-evidence-1",
      locator: { state: "supplied", value: "Section A" },
    }],
    ownerConfirmed: false,
    ...overrides,
  };
}

function preferences(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CAREER_PREFERENCES_INPUT_VERSION_V1,
    desiredRoles: unknownList,
    employmentTypes: unknownList,
    excludedRoles: unknownList,
    industriesOfInterest: unknownList,
    industriesToAvoid: unknownList,
    locations: unknownList,
    minimumCompensation: unknown,
    scheduleConstraints: unknownList,
    travelPreference: unknownList,
    workArrangements: unknownList,
    ...overrides,
  };
}

function posting(overrides: Record<string, unknown> = {}) {
  return {
    applicationDeadline: unknown,
    certificationRequirements: unknownList,
    company: unknown,
    compensation: unknown,
    contractVersion: JOB_POSTING_INPUT_VERSION_V1,
    description: unknown,
    educationRequirements: unknownList,
    employmentType: unknown,
    location: unknown,
    preferredSkills: unknownList,
    requiredExperience: unknown,
    requiredSkills: unknownList,
    schedule: unknown,
    sourceReference: unknown,
    title: unknown,
    travel: unknown,
    workArrangement: unknown,
    ...overrides,
  };
}

function invalid(operation: () => unknown): void {
  assert.throws(operation, (error: unknown) => error instanceof CareerInputErrorV1 && error.code === "contract-invalid");
}

test("blank career-facts contract validates without creating or inferring facts", () => {
  const value = { contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [] };
  assert.deepEqual(validateCareerFactsInputV1(value), value);
});

test("career facts cover each approved entry category with explicit evidence and confirmation", () => {
  const kinds = [
    "role-title", "employer", "responsibility", "accomplishment", "skill", "tool-or-technology",
    "certification", "education", "license", "industry", "project",
  ];
  const value = {
    contractVersion: CAREER_FACTS_INPUT_VERSION_V1,
    entries: kinds.map((factKind, index) => fact({ factId: `synthetic.fact.${index + 1}`, factKind })),
  };
  assert.equal(validateCareerFactsInputV1(value).entries.length, kinds.length);
  assert.equal(value.entries.every((entry) => entry.ownerConfirmed === false), true);
});

test("career facts are closed and reject missing, unsupported, duplicate, and invalid confirmation data", () => {
  invalid(() => validateCareerFactsInputV1({ entries: [] }));
  invalid(() => validateCareerFactsInputV1({ contractVersion: "aion.career-facts-input.v2", entries: [] }));
  invalid(() => validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [], extra: true }));
  invalid(() => validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact(), fact()] }));
  invalid(() => validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact({ ownerConfirmed: "yes" })] }));
});

test("career fact dates validate shape and ordering without inventing absent dates", () => {
  validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact({ startDate: unknown, endDate: unknown })] });
  validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact({ endDate: { state: "not-applicable" } })] });
  invalid(() => validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact({ startDate: { state: "supplied", value: "2024-13" } })] }));
  invalid(() => validateCareerFactsInputV1({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [fact({ startDate: { state: "supplied", value: "2025-01" }, endDate: { state: "supplied", value: "2024-12" } })] }));
});

test("conflicting career facts remain distinct and are never silently merged", () => {
  const value = {
    contractVersion: CAREER_FACTS_INPUT_VERSION_V1,
    entries: [
      fact({ factId: "synthetic.conflict.1", value: { state: "supplied", value: "First explicit value" } }),
      fact({ factId: "synthetic.conflict.2", value: { state: "supplied", value: "Second explicit value" } }),
    ],
  };
  const validated = validateCareerFactsInputV1(value);
  assert.equal(validated.entries.length, 2);
  assert.notDeepEqual(validated.entries[0]?.value, validated.entries[1]?.value);
});

test("evidence descriptors are closed, explicit, and independently versioned", () => {
  const descriptor = { version: "1", documentKind: "resume", reference: "synthetic-reference", locator: unknown };
  assert.deepEqual(validateEvidenceDocumentDescriptorV1(descriptor), descriptor);
  invalid(() => validateEvidenceDocumentDescriptorV1({ ...descriptor, importedObjectId: "synthetic" }));
});

test("blank preferences preserve unknown separately from no preference", () => {
  const blank = preferences();
  assert.deepEqual(validateCareerPreferencesInputV1(blank), blank);
  const explicit = preferences({ desiredRoles: { state: "no-preference", values: [] } });
  assert.equal(validateCareerPreferencesInputV1(explicit).desiredRoles.state, "no-preference");
  assert.notEqual(blank.desiredRoles.state, explicit.desiredRoles.state);
});

test("preferences validate work arrangement and employment enumerations", () => {
  validateCareerPreferencesInputV1(preferences({
    workArrangements: { state: "specified", values: ["remote", "hybrid", "on-site"] },
    employmentTypes: { state: "specified", values: ["full-time", "contract"] },
  }));
  invalid(() => validateCareerPreferencesInputV1(preferences({ workArrangements: { state: "specified", values: ["anywhere"] } })));
  invalid(() => validateCareerPreferencesInputV1(preferences({ employmentTypes: { state: "specified", values: ["permanent-ish"] } })));
});

test("minimum compensation uses exact safe integers and closed currency shape", () => {
  validateCareerPreferencesInputV1(preferences({ minimumCompensation: { state: "specified", currency: "USD", minimumMinorUnits: 1 } }));
  validateCareerPreferencesInputV1(preferences({ minimumCompensation: { state: "specified", currency: "USD", minimumMinorUnits: 9_007_199_254_740_991 } }));
  invalid(() => validateCareerPreferencesInputV1(preferences({ minimumCompensation: { state: "specified", currency: "usd", minimumMinorUnits: 1 } })));
  invalid(() => validateCareerPreferencesInputV1(preferences({ minimumCompensation: { state: "specified", currency: "USD", minimumMinorUnits: 1.5 } })));
  invalid(() => validateCareerPreferencesInputV1(preferences({ minimumCompensation: { state: "specified", currency: "USD", minimumMinorUnits: 9_007_199_254_740_992 } })));
});

test("physical or other constraints are absent by default and accepted only when explicit", () => {
  const blank = validateCareerPreferencesInputV1(preferences());
  assert.equal("physicalOrOtherWorkConstraints" in blank, false);
  const explicit = validateCareerPreferencesInputV1(preferences({
    physicalOrOtherWorkConstraints: { state: "specified", values: ["Synthetic explicit constraint"] },
  }));
  assert.equal(explicit.physicalOrOtherWorkConstraints?.state, "specified");
});

test("blank and neutral job-posting contracts validate without inferred values", () => {
  assert.deepEqual(validateJobPostingInputV1(posting()), posting());
  const neutral = posting({
    title: { state: "supplied", value: "Synthetic role" },
    company: { state: "supplied", value: "Synthetic organization" },
    workArrangement: { state: "supplied", value: "remote" },
    employmentType: { state: "supplied", value: "full-time" },
    requiredSkills: { state: "specified", values: ["Synthetic skill"] },
    sourceReference: { state: "supplied", value: "https://invalid.example/synthetic-owner-reference" },
  });
  assert.equal(validateJobPostingInputV1(neutral).sourceReference.state, "supplied");
});

test("job posting is closed and compensation is exact, ordered, and optional", () => {
  invalid(() => validateJobPostingInputV1({ ...posting(), importedAt: "2026-01-01T00:00:00.000Z" }));
  validateJobPostingInputV1(posting({ compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 100, maximumMinorUnits: 200 } }));
  invalid(() => validateJobPostingInputV1(posting({ compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 200, maximumMinorUnits: 100 } })));
  invalid(() => validateJobPostingInputV1(posting({ compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 1.25, maximumMinorUnits: null } })));
});
