/**
 * The contract's refusals, which are the part that has to hold.
 *
 * Accepting a well-formed fact is easy and mostly uninteresting. What decides whether this package is
 * safe is what it refuses: a claim with no approved use, a category nobody defined, a document that
 * tries to raise its own sensitivity, credential material wearing a fact's clothes, and — the one
 * that matters most — the idea that knowing something implies being allowed to do something.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_SHAPED_USE,
  authorityFromPersonalContext,
  claimKeyOf,
  CONTEXT_CATEGORIES_V1,
  ELIGIBLE_USES_V1,
  MILESTONE_SENSITIVITY_CEILING_V1,
  PERSONAL_CONTEXT_SCHEMA_V1,
  sensitivityWithin,
  SOURCE_STATES_V1,
  SOURCE_TYPES_V1,
  validateContextSource,
  validatePersonalContextFact,
  type PersonalContextFactV1,
} from "../src/contracts.js";
import { extractFactsFromFile } from "../src/extraction.js";
import { declaration, makeSource, NOW } from "./fixtures.js";

function wellFormedFact(overrides: Partial<PersonalContextFactV1> = {}): PersonalContextFactV1 {
  const subject = overrides.subject ?? "owner";
  const category = overrides.category ?? "SKILL";
  const predicate = overrides.predicate ?? "skill";
  return {
    schema: PERSONAL_CONTEXT_SCHEMA_V1,
    factId: "fact-1",
    claimKey: claimKeyOf(subject, category, predicate),
    subject,
    category,
    predicate,
    value: "TypeScript",
    normalizedValue: "typescript",
    sourceId: "test-source",
    sourceReference: "declaration.json",
    evidenceReference: "doc-1#facts[0]",
    observedAt: "2026-07-01T00:00:00Z",
    sourceModifiedAt: null,
    extractedAt: NOW,
    confidence: "HIGH",
    sensitivity: "INTERNAL",
    freshnessState: "CURRENT",
    freshnessEvidence: "observed 48 day(s) ago",
    temporalState: "CURRENT",
    validFrom: null,
    validTo: null,
    conflictState: "NONE",
    conflictsWith: [],
    supersedes: [],
    supersededBy: null,
    eligibleUses: ["JOB_MATCHING"],
    eligibleProviders: ["claude"],
    contentFingerprint: "abc",
    version: 1,
    lastConfirmedAt: null,
    ...overrides,
  } as PersonalContextFactV1;
}

test("every category the milestone requires is defined", () => {
  for (const required of [
    "IDENTITY_REFERENCE", "CAREER", "CURRENT_EMPLOYMENT", "WORK_HISTORY", "SKILL", "EDUCATION",
    "CERTIFICATION", "PROJECT", "TECHNOLOGY", "PREFERENCE", "GOAL", "CONSTRAINT",
    "LOCATION_PREFERENCE", "WORK_MODE_PREFERENCE", "COMPENSATION_PREFERENCE", "BUSINESS_CONTEXT",
    "OTHER_APPROVED",
  ]) {
    assert.ok(CONTEXT_CATEGORIES_V1.includes(required as never), `missing category ${required}`);
  }
});

test("every source type the milestone requires is defined, and revocation is a state", () => {
  for (const required of [
    "AION_REPOSITORY", "APPROVED_GIT_REPOSITORY", "APPROVED_LOCAL_FILE", "APPROVED_LOCAL_FOLDER",
    "RESUME_CV", "WORK_HISTORY", "OWNER_ENTERED_CURRENT_JOB", "APPROVED_PROJECT_ARTIFACT",
  ]) {
    assert.ok(SOURCE_TYPES_V1.includes(required as never), `missing source type ${required}`);
  }
  assert.deepEqual([...SOURCE_STATES_V1], ["ACTIVE", "DISABLED", "REVOKED"]);
});

test("a well-formed fact validates and a malformed one names its first problem", () => {
  assert.equal(validatePersonalContextFact(wellFormedFact()), null);
  assert.match(String(validatePersonalContextFact(wellFormedFact({ category: "NOPE" as never }))), /category/);
  assert.match(String(validatePersonalContextFact(wellFormedFact({ eligibleUses: [] }))), /eligibleUses/);
  assert.match(String(validatePersonalContextFact(wellFormedFact({ freshnessEvidence: "" }))), /freshnessEvidence/);
  assert.match(String(validatePersonalContextFact(null)), /not an object/);
});

test("claimKey must agree with subject, category and predicate", () => {
  const wrong = { ...wellFormedFact(), claimKey: "owner|SKILL|something-else" } as PersonalContextFactV1;
  assert.match(String(validatePersonalContextFact(wrong)), /claimKey/);
});

test("a claim cannot be current and already ended", () => {
  const contradiction = wellFormedFact({ temporalState: "CURRENT", validTo: "2020-01-01T00:00:00Z" });
  assert.match(String(validatePersonalContextFact(contradiction)), /already have ended/);
});

test("credential-shaped material is refused rather than stored and guarded", () => {
  assert.match(String(validatePersonalContextFact(wellFormedFact({ predicate: "password" }))), /credential/);
  assert.match(
    String(validatePersonalContextFact(wellFormedFact({ predicate: "note", value: "api_key ABC123" }))),
    /credential/,
  );
  const source = makeSource({ purpose: "store the owner's api key" });
  assert.match(String(validateContextSource(source)), /credential/);
});

test("no approved use names an action, and the action pattern would catch one", () => {
  for (const use of ELIGIBLE_USES_V1) {
    assert.equal(ACTION_SHAPED_USE.test(use), false, `${use} reads like an action`);
  }
  assert.equal(ACTION_SHAPED_USE.test("SUBMIT_APPLICATION"), true);
  assert.equal(ACTION_SHAPED_USE.test("SEND_EMAIL"), true);
});

test("knowledge never becomes permission, whatever the fact says", () => {
  for (const fact of [
    wellFormedFact({ category: "CURRENT_EMPLOYMENT", predicate: "employer", value: "Example Motors" }),
    wellFormedFact({ category: "TECHNOLOGY", predicate: "platform", value: "Tekion" }),
    wellFormedFact({ category: "IDENTITY_REFERENCE", predicate: "contactChannel", value: "a work address" }),
  ]) {
    const answer = authorityFromPersonalContext(fact);
    assert.equal(answer.granted, false);
    assert.match(answer.reason, /not permission/);
    assert.match(answer.requiredInstead, /Owner-authorized directive/);
  }
});

test("the milestone ceiling refuses classes the authorizing directive did not grant", () => {
  assert.equal(MILESTONE_SENSITIVITY_CEILING_V1, "INTERNAL");
  assert.equal(sensitivityWithin("PUBLIC", MILESTONE_SENSITIVITY_CEILING_V1), true);
  assert.equal(sensitivityWithin("INTERNAL", MILESTONE_SENSITIVITY_CEILING_V1), true);
  assert.equal(sensitivityWithin("CONFIDENTIAL", MILESTONE_SENSITIVITY_CEILING_V1), false);
  assert.equal(sensitivityWithin("RESTRICTED", MILESTONE_SENSITIVITY_CEILING_V1), false);
});

test("current employment is a first-class claim with its own evidence", () => {
  const result = extractFactsFromFile({
    source: makeSource(),
    sourceReference: "current-job.json",
    contents: declaration([
      {
        category: "CURRENT_EMPLOYMENT",
        predicate: "employer",
        value: "Example Motors",
        temporalState: "CURRENT",
        validFrom: "2024-02-01T00:00:00Z",
        lastConfirmedAt: "2026-08-01T00:00:00Z",
      },
      {
        category: "CURRENT_EMPLOYMENT",
        predicate: "title",
        value: "Operations Lead",
        temporalState: "CURRENT",
        lastConfirmedAt: "2026-08-01T00:00:00Z",
      },
    ]),
    sourceModifiedAt: null,
    now: NOW,
  });

  assert.equal(result.facts.length, 2);
  const employer = result.facts.find((fact) => fact.predicate === "employer");
  assert.ok(employer);
  assert.equal(employer.category, "CURRENT_EMPLOYMENT");
  assert.equal(employer.temporalState, "CURRENT");
  assert.equal(employer.freshnessState, "CURRENT");
  assert.equal(employer.validTo, null);
  assert.equal(employer.sourceReference, "current-job.json");
  assert.match(employer.evidenceReference, /doc-1/);
});

test("an absent current job is absent, not invented", () => {
  const result = extractFactsFromFile({
    source: makeSource(),
    sourceReference: "history.json",
    contents: declaration([
      {
        category: "WORK_HISTORY",
        predicate: "employer",
        value: "Former Dealer Group",
        temporalState: "HISTORICAL",
        validFrom: "2018-01-01T00:00:00Z",
        validTo: "2022-06-30T00:00:00Z",
        observedAt: "2022-06-30T00:00:00Z",
      },
    ]),
    sourceModifiedAt: null,
    now: NOW,
  });

  assert.equal(result.facts.length, 1);
  assert.equal(result.facts.every((fact) => fact.category !== "CURRENT_EMPLOYMENT"), true);
  assert.equal(result.facts[0]?.temporalState, "HISTORICAL");
});

test("prose produces no facts at all rather than a plausible guess", () => {
  const result = extractFactsFromFile({
    source: makeSource(),
    sourceReference: "resume.md",
    contents: "# Resume\n\nSenior Operations Lead at Example Motors since 2024.\nSkills: TypeScript, SQL.\n",
    sourceModifiedAt: "2026-08-18T00:00:00Z",
    now: NOW,
  });

  assert.equal(result.facts.length, 0);
  assert.equal(result.recognized, false);
  assert.equal(result.skips[0]?.reason, "UNSUPPORTED_CONTENT");
  assert.match(String(result.skips[0]?.detail), /no facts were inferred/);
});

test("a document cannot raise its own sensitivity above the source the Owner approved", () => {
  const result = extractFactsFromFile({
    source: makeSource({ sensitivityClass: "INTERNAL" }),
    sourceReference: "declaration.json",
    contents: declaration([
      { category: "SKILL", predicate: "skill", value: "TypeScript", sensitivity: "RESTRICTED" },
    ]),
    sourceModifiedAt: null,
    now: NOW,
  });

  assert.equal(result.facts.length, 0);
  assert.equal(result.skips[0]?.reason, "SENSITIVITY_ABOVE_SOURCE");
});

test("a row with no approved use is refused rather than given a default one", () => {
  const result = extractFactsFromFile({
    source: makeSource(),
    sourceReference: "declaration.json",
    contents: JSON.stringify({
      schema: "aion.personalContext.declaration.v1",
      subject: "owner",
      documentId: "doc-1",
      facts: [{ category: "SKILL", predicate: "skill", value: "TypeScript", eligibleUses: [] }],
    }),
    sourceModifiedAt: null,
    now: NOW,
  });

  assert.equal(result.facts.length, 0);
  assert.equal(result.skips[0]?.reason, "FACT_REJECTED");
  assert.match(String(result.skips[0]?.detail), /no supported eligibleUses/);
});

test("a declaration that claims the schema and is broken is an error, not a shrug", () => {
  const result = extractFactsFromFile({
    source: makeSource(),
    sourceReference: "declaration.json",
    contents: JSON.stringify({ schema: "aion.personalContext.declaration.v1", subject: "owner" }),
    sourceModifiedAt: null,
    now: NOW,
  });

  assert.equal(result.recognized, true);
  assert.equal(result.skips[0]?.reason, "MALFORMED_DECLARATION");
});
