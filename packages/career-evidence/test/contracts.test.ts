import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAREER_FACT_PAYLOAD_VERSION_V1,
  CareerEvidenceOperationErrorV1,
  Sha256CareerEvidenceIdDeriverV1,
  privateObjectReferenceSummaryV1,
  validateCareerFactCandidateV1,
  validateCareerFactPayloadV1,
} from "../src/index.js";

const parser = {
  version: "1" as const,
  parserId: "aion.parser.synthetic",
  parserVersion: "1" as const,
  sourceLocationFormat: "json-pointer-v1" as const,
};

test("fact states keep owner-confirmed, extracted, inferred, and missing distinct", () => {
  for (const candidate of [
    { assertion: "owner-confirmed", ownerConfirmed: true, confidence: "owner-asserted", method: "structured-owner-input", state: "supplied" },
    { assertion: "extracted", ownerConfirmed: false, confidence: "deterministic-extraction", method: "deterministic-structured-extraction", state: "supplied" },
    { assertion: "inferred", ownerConfirmed: false, confidence: "deterministic-inference", method: "deterministic-rule", state: "supplied" },
    { assertion: "missing", ownerConfirmed: false, confidence: "not-assessed", method: "deterministic-missing-state", state: "unknown" },
  ] as const) {
    assert.doesNotThrow(() => validateCareerFactCandidateV1({
      version: "1", sourceClaimId: `synthetic-${candidate.assertion}`, factType: "role-title",
      normalizedValue: candidate.state === "supplied" ? { state: "supplied", value: "Synthetic value" } : { state: candidate.state },
      sourceLocation: "/entries/0/value", confidence: candidate.confidence,
      ownerConfirmed: candidate.ownerConfirmed,
      status: { version: "1", verification: "unverified", assertion: candidate.assertion, conflict: "none" },
      extractionMethod: { version: "1", method: candidate.method, parser, ruleId: candidate.method === "deterministic-rule" ? "aion.rule.synthetic" : null },
    }));
  }
});

test("owner-confirmed cannot be inferred or asserted without the explicit marker", () => {
  assert.throws(() => validateCareerFactCandidateV1({
    version: "1", sourceClaimId: "synthetic-invalid", factType: "role-title",
    normalizedValue: { state: "supplied", value: "Synthetic value" }, sourceLocation: "/entries/0/value",
    confidence: "deterministic-inference", ownerConfirmed: true,
    status: { version: "1", verification: "unverified", assertion: "inferred", conflict: "none" },
    extractionMethod: { version: "1", method: "deterministic-rule", parser, ruleId: "aion.rule.synthetic" },
  }), CareerEvidenceOperationErrorV1);
});

test("fact payload is closed, versioned, and rejects embedded relationship arrays", () => {
  const ids = new Sha256CareerEvidenceIdDeriverV1();
  const factId = ids.derive("synthetic", "fact", "one");
  const sourceObjectId = ids.derive("synthetic", "source", "one");
  const value = {
    contractVersion: CAREER_FACT_PAYLOAD_VERSION_V1, factId, factType: "role-title",
    normalizedValue: { state: "supplied", value: "Synthetic value" }, sourceObjectId,
    sourceLocation: "/entries/0/value", confidence: "deterministic-extraction", ownerConfirmed: false,
    status: { version: "1", verification: "unverified", assertion: "extracted", conflict: "none" },
    extractionMethod: { version: "1", method: "deterministic-structured-extraction", parser, ruleId: null },
    createdAt: "2026-08-06T12:00:00.000Z", conflict: { version: "1", state: "none" },
    supersession: { version: "1", state: "current" },
  };
  assert.equal(validateCareerFactPayloadV1(value).factId, factId);
  assert.throws(() => validateCareerFactPayloadV1({ ...value, relationships: [] }), CareerEvidenceOperationErrorV1);
});

test("deterministic identifiers are opaque, type-valid, stable, purpose-separated, and redacted", () => {
  const ids = new Sha256CareerEvidenceIdDeriverV1();
  const first = ids.derive("synthetic-operation", "fact", "alpha");
  assert.equal(first, ids.derive("synthetic-operation", "fact", "alpha"));
  assert.notEqual(first, ids.derive("synthetic-operation", "source", "alpha"));
  const redacted = privateObjectReferenceSummaryV1(first);
  assert.match(redacted.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(JSON.stringify(redacted).includes(first), false);
});
