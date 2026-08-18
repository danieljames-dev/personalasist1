/**
 * What one job is allowed to see, and the account of everything it was not shown.
 *
 * The invariant worth stating plainly: a takeover changes who runs the work, never what the work is
 * shown. The way that breaks in practice is not malice — it is building the context payload once for
 * the first executor and reusing it when the job moves. So disclosure is recomputed per provider
 * here, and the failover case is asserted directly rather than left to call ordering.
 *
 * The omission list is tested as hard as the disclosure list, because a retrieval that quietly drops
 * six stale facts and returns four fresh ones looks identical, to its caller, to a store that only
 * ever had four.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  claimKeyOf,
  PERSONAL_CONTEXT_SCHEMA_V1,
  type ContextCategoryV1,
  type PersonalContextFactV1,
} from "../src/contracts.js";
import { discloseForProvider, failoverBroadensDisclosure, failoverDisclosure } from "../src/disclosure.js";
import { setSourceState } from "../src/enrollment.js";
import { getContextForJob, type ContextRequestV1 } from "../src/retrieval.js";
import { createMemoryPersonalContextStore } from "../src/store.js";
import { makeSource, NOW } from "./fixtures.js";

function fact(overrides: Partial<PersonalContextFactV1> & { factId: string }): PersonalContextFactV1 {
  const subject = overrides.subject ?? "owner";
  const category: ContextCategoryV1 = overrides.category ?? "SKILL";
  const predicate = overrides.predicate ?? `predicate-${overrides.factId}`;
  return {
    schema: PERSONAL_CONTEXT_SCHEMA_V1,
    claimKey: claimKeyOf(subject, category, predicate),
    subject,
    category,
    predicate,
    value: "value",
    normalizedValue: "value",
    sourceId: "src-a",
    sourceReference: "declaration.json",
    evidenceReference: "doc-1#facts[0]",
    observedAt: "2026-08-01T00:00:00Z",
    sourceModifiedAt: null,
    extractedAt: NOW,
    confidence: "HIGH",
    sensitivity: "INTERNAL",
    freshnessState: "CURRENT",
    freshnessEvidence: "observed recently",
    temporalState: "CURRENT",
    validFrom: null,
    validTo: null,
    conflictState: "NONE",
    conflictsWith: [],
    supersedes: [],
    supersededBy: null,
    eligibleUses: ["JOB_MATCHING"],
    eligibleProviders: ["codex", "grok", "claude", "local"],
    contentFingerprint: `fp-${overrides.factId}`,
    version: 1,
    lastConfirmedAt: null,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ContextRequestV1> = {}): ContextRequestV1 {
  return {
    jobId: "job-1",
    objective: "Find roles that match the Owner's current work",
    subject: "owner",
    categories: [],
    provider: "claude",
    sensitivityCeiling: "CONFIDENTIAL",
    minimumFreshness: "UNKNOWN_FRESHNESS",
    maxItems: 50,
    maxCharacters: 100_000,
    allowedUses: ["JOB_MATCHING"],
    ...overrides,
  };
}

function storeWith(facts: readonly PersonalContextFactV1[], sources = [makeSource({ sourceId: "src-a" })]) {
  const store = createMemoryPersonalContextStore();
  for (const source of sources) store.saveSource(source);
  store.saveFacts(facts);
  return store;
}

test("a revoked source stops being disclosed while its facts stay on record", () => {
  const store = storeWith([fact({ factId: "f1" }), fact({ factId: "f2" })]);
  assert.equal(getContextForJob(baseRequest(), { store }).facts.length, 2);

  setSourceState("src-a", "REVOKED", { store, now: NOW });
  const after = getContextForJob(baseRequest(), { store });

  assert.equal(after.facts.length, 0);
  assert.equal(after.omissions.find((entry) => entry.reason === "SOURCE_REVOKED")?.count, 2);
  assert.equal(store.listFacts().length, 2, "the evidence itself is retained for audit");
});

test("a disabled source is withheld too, and reported as disabled rather than revoked", () => {
  const store = storeWith([fact({ factId: "f1" })]);
  setSourceState("src-a", "DISABLED", { store, now: NOW });
  const response = getContextForJob(baseRequest(), { store });
  assert.equal(response.facts.length, 0);
  assert.equal(response.omissions[0]?.reason, "SOURCE_DISABLED");
});

test("a provider sees only the classes Provider Bridge V1 says it may see", () => {
  const facts = [
    fact({ factId: "f-int", sensitivity: "INTERNAL" }),
    fact({ factId: "f-conf", sensitivity: "CONFIDENTIAL", eligibleProviders: ["claude", "local"] }),
  ];
  const store = storeWith(facts);

  const toClaude = getContextForJob(baseRequest({ provider: "claude" }), { store });
  assert.deepEqual(toClaude.facts.map((row) => row.factId).sort(), ["f-conf", "f-int"]);

  const toGrok = getContextForJob(baseRequest({ provider: "grok" }), { store });
  assert.deepEqual(toGrok.facts.map((row) => row.factId), ["f-int"]);
  assert.equal(toGrok.omissions.find((entry) => entry.reason === "PROVIDER_NOT_ELIGIBLE")?.count, 1);
  // The withheld fact's value never appears in the response.
  assert.equal(JSON.stringify(toGrok).includes("f-conf"), true, "its id is reported");
  assert.equal(toGrok.facts.some((row) => row.sensitivity === "CONFIDENTIAL"), false);
});

test("failover changes the executor and cannot widen what is disclosed", () => {
  const facts = [
    fact({ factId: "f-int", sensitivity: "INTERNAL" }),
    fact({ factId: "f-conf", sensitivity: "CONFIDENTIAL", eligibleProviders: ["claude", "local"] }),
  ];

  const handover = failoverDisclosure(facts, "claude", "grok");
  assert.deepEqual(handover.from.disclosed.map((row) => row.factId).sort(), ["f-conf", "f-int"]);
  assert.deepEqual(handover.to.disclosed.map((row) => row.factId), ["f-int"]);
  assert.deepEqual(handover.newlyDisclosed, [], "a takeover never adds a fact the first executor could not see");
  assert.deepEqual(handover.newlyWithheld, ["f-conf"]);
  assert.equal(failoverBroadensDisclosure(handover), false);

  // The confidential fact is absent from the successor's payload entirely, not merely flagged.
  assert.equal(discloseForProvider(facts, "grok").disclosed.some((row) => row.factId === "f-conf"), false);
});

test("a fact allowlist can narrow the bridge but never widen it", () => {
  const narrowed = fact({ factId: "f-narrow", sensitivity: "INTERNAL", eligibleProviders: ["local"] });
  assert.equal(discloseForProvider([narrowed], "claude").disclosed.length, 0);
  assert.equal(discloseForProvider([narrowed], "claude").withheld[0]?.reason, "PROVIDER_NOT_ON_FACT_ALLOWLIST");

  const widened = fact({ factId: "f-wide", sensitivity: "RESTRICTED", eligibleProviders: ["grok"] });
  assert.equal(discloseForProvider([widened], "grok").disclosed.length, 0, "an allowlist cannot grant class eligibility");
});

test("the category filter is enforced and the rest is accounted for", () => {
  const store = storeWith([
    fact({ factId: "f-skill", category: "SKILL" }),
    fact({ factId: "f-pref", category: "WORK_MODE_PREFERENCE" }),
    fact({ factId: "f-job", category: "CURRENT_EMPLOYMENT" }),
  ]);

  const response = getContextForJob(baseRequest({ categories: ["CURRENT_EMPLOYMENT", "SKILL"] }), { store });
  assert.deepEqual(response.facts.map((row) => row.factId).sort(), ["f-job", "f-skill"]);
  assert.deepEqual(response.omissions.find((entry) => entry.reason === "CATEGORY_NOT_REQUESTED")?.factIds, ["f-pref"]);
});

test("the freshness floor is enforced, and unknown never satisfies a real requirement", () => {
  const store = storeWith([
    fact({ factId: "f-current", freshnessState: "CURRENT" }),
    fact({ factId: "f-stale", freshnessState: "STALE" }),
    fact({ factId: "f-unknown", freshnessState: "UNKNOWN_FRESHNESS" }),
  ]);

  const strict = getContextForJob(baseRequest({ minimumFreshness: "RECENT" }), { store });
  assert.deepEqual(strict.facts.map((row) => row.factId), ["f-current"]);
  assert.deepEqual(
    strict.omissions.find((entry) => entry.reason === "FRESHNESS_BELOW_REQUIREMENT")?.factIds,
    ["f-stale", "f-unknown"],
  );

  const permissive = getContextForJob(baseRequest({ minimumFreshness: "UNKNOWN_FRESHNESS" }), { store });
  assert.equal(permissive.facts.length, 3);
});

test("the use filter keeps a fact out of a job it was not approved for", () => {
  const store = storeWith([
    fact({ factId: "f-match", eligibleUses: ["JOB_MATCHING"] }),
    fact({ factId: "f-diag", eligibleUses: ["INTERNAL_DIAGNOSTIC"] }),
  ]);
  const response = getContextForJob(baseRequest({ allowedUses: ["JOB_MATCHING"] }), { store });
  assert.deepEqual(response.facts.map((row) => row.factId), ["f-match"]);
  assert.deepEqual(response.omissions.find((entry) => entry.reason === "USE_NOT_ALLOWED")?.factIds, ["f-diag"]);
});

test("the sensitivity ceiling of the request is honoured independently of the provider", () => {
  const store = storeWith([
    fact({ factId: "f-int", sensitivity: "INTERNAL" }),
    fact({ factId: "f-conf", sensitivity: "CONFIDENTIAL", eligibleProviders: ["claude", "local"] }),
  ]);
  const response = getContextForJob(baseRequest({ provider: "claude", sensitivityCeiling: "INTERNAL" }), { store });
  assert.deepEqual(response.facts.map((row) => row.factId), ["f-int"]);
  assert.equal(response.omissions.find((entry) => entry.reason === "SENSITIVITY_ABOVE_CEILING")?.count, 1);
});

test("the size budget is enforced and the truncation is visible", () => {
  const store = storeWith([
    fact({ factId: "f1" }), fact({ factId: "f2" }), fact({ factId: "f3" }),
  ]);

  const byItems = getContextForJob(baseRequest({ maxItems: 2 }), { store });
  assert.equal(byItems.facts.length, 2);
  assert.equal(byItems.truncated, true);
  assert.equal(byItems.omissions.find((entry) => entry.reason === "MAX_ITEMS_REACHED")?.count, 1);

  const byCharacters = getContextForJob(baseRequest({ maxCharacters: 1 }), { store });
  assert.equal(byCharacters.facts.length, 0);
  assert.equal(byCharacters.truncated, true);
  assert.equal(byCharacters.omissions.find((entry) => entry.reason === "MAX_CHARACTERS_REACHED")?.count, 3);
});

test("a superseded fact is not disclosed, and says so", () => {
  const store = storeWith([
    fact({ factId: "f-old", supersededBy: "f-new" }),
    fact({ factId: "f-new" }),
  ]);
  const response = getContextForJob(baseRequest(), { store });
  assert.deepEqual(response.facts.map((row) => row.factId), ["f-new"]);
  assert.deepEqual(response.omissions.find((entry) => entry.reason === "SUPERSEDED")?.factIds, ["f-old"]);
});

test("disclosed facts carry provenance and conflict warnings rather than a settled answer", () => {
  const store = storeWith(
    [
      fact({ factId: "f-a", sourceId: "src-a", category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Lead", conflictState: "CONFIRMED", conflictsWith: ["f-b"] }),
      fact({ factId: "f-b", sourceId: "src-b", category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Manager", conflictState: "CONFIRMED", conflictsWith: ["f-a"] }),
    ],
    [makeSource({ sourceId: "src-a", displayName: "Current job record" }), makeSource({ sourceId: "src-b", displayName: "Resume" })],
  );

  const response = getContextForJob(baseRequest(), { store });

  assert.equal(response.facts.length, 2, "both statements are disclosed");
  assert.equal(response.conflictWarnings.length, 1);
  assert.match(String(response.conflictWarnings[0]?.message), /not settled truth/);
  assert.deepEqual(response.conflictWarnings[0]?.factIds, ["f-a", "f-b"]);
  const provenance = response.facts.map((row) => row.provenance.sourceDisplayName).sort();
  assert.deepEqual(provenance, ["Current job record", "Resume"]);
  assert.equal(response.facts.every((row) => row.provenance.evidenceReference.length > 0), true);
});

test("the context fingerprint changes exactly when the disclosed set changes", () => {
  const store = storeWith([fact({ factId: "f1" }), fact({ factId: "f2" })]);
  const first = getContextForJob(baseRequest(), { store });
  const again = getContextForJob(baseRequest(), { store });
  assert.equal(first.contextFingerprint, again.contextFingerprint);

  const narrower = getContextForJob(baseRequest({ maxItems: 1 }), { store });
  assert.notEqual(narrower.contextFingerprint, first.contextFingerprint);
});

test("a request for another subject gets nothing rather than the Owner's context", () => {
  const store = storeWith([fact({ factId: "f1" })]);
  const response = getContextForJob(baseRequest({ subject: "someone-else" }), { store });
  assert.equal(response.facts.length, 0);
  assert.equal(response.omissions[0]?.reason, "SUBJECT_MISMATCH");
});
