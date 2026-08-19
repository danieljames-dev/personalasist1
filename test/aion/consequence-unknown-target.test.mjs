/**
 * Absence of a known dangerous target is not proof that a request is routine.
 *
 * Three independent reviews, three versions of the same mistake in different clothing:
 *
 *   1. phrase list          — unlisted wording was routine
 *   2. action-first         — unlisted *verb* was routine
 *   3. target-first         — unlisted *target* was routine
 *
 * The third is the one these tests pin. With valid lineage, a valid envelope and every routine scope
 * constraint satisfied, "Update the CRM.", "Fix IAM.", "Add the S3 bucket.", "Shred those files." and
 * "Update it." all inherited standing authority — because nothing on a list matched, and nothing on
 * a list matching was being read as safety.
 *
 * **None of the hostile targets below appear in the production tables**, and a test at the bottom
 * asserts that. If a future repair works by pasting CRM, Stripe, Slack, VPN, IAM, S3 and payroll into
 * those tables, this suite fails rather than quietly becoming vacuous — which is the exact move that
 * would make the next unlisted noun a leak again.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROADMAP_MILESTONE_SCHEMA_V1,
  classifyAction,
  detectRequestedConsequences,
  resolveMilestoneAuthority,
  splitClauses,
  stripQuotedSpans,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-08-19T12:00:00Z";
const PARENT = "roadmap-page-usability";
const PARENT_OBJECTIVE = "Improve AION Roadmap usability";
const AUTH_ID = "FIXTURE-UNKNOWN-TARGET-V1-20260819T000000Z";

function envelopeRecord(overrides = {}) {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: AUTH_ID,
    milestoneId: "FIXTURE-UNKNOWN-TARGET-V1",
    authorizedObjective: PARENT_OBJECTIVE,
    allowedWriteDomains: ["apps", "docs"],
    allowedExternalEffects: ["CONTROLLED_PUSH"],
    allowedProviders: ["local"],
    spendingCeilingUsd: 0,
    productionWriterPermission: "NO",
    sensitiveDataPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    state: "ACTIVE",
    expiresAtUtc: "",
    supersededBy: "",
    createdAtUtc: "2026-08-19T00:00:00Z",
    grantsRoadmapAuthorityEnvelope: "YES",
    envelopeApprovedParentMilestoneIds: [PARENT],
    ...overrides,
  };
}

function child(objective, overrides = {}) {
  return {
    schema: ROADMAP_MILESTONE_SCHEMA_V1,
    milestoneId: "bounded-child",
    title: "Bounded child",
    objective,
    status: "PLANNED",
    priority: 200,
    dependencies: [PARENT],
    requiredCapabilities: ["CODING"],
    requiredContextCategories: [],
    authorityClass: "MILESTONE_AUTHORIZED",
    ownerAuthorizationId: null,
    authorityEnvelopeId: `ENVELOPE-${AUTH_ID}`,
    derivedFromMilestoneId: PARENT,
    derivedFromObjective: PARENT_OBJECTIVE,
    writeDomains: ["apps"],
    sensitivityClass: "INTERNAL",
    allowedProviders: ["local"],
    spendCapUsd: 0,
    externalEffectClass: "REPOSITORY_REVERSIBLE",
    reversibilityClass: "REVERSIBLE",
    riskClasses: [],
    verificationPlan: { steps: [{ kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true }], declaredAt: NOW },
    independentReviewPolicy: "NONE",
    retryPolicy: { maxAttempts: 3, maxIdenticalFailures: 2, maxIdenticalPatches: 2, maxProviderSwitches: 4 },
    leaseTtlMs: 60_000,
    expectedArtifacts: [],
    completionCriteria: ["done"],
    attempts: 0,
    blockedReason: null,
    provenance: "fixture",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const decide = (objective, recordOverrides = {}, milestoneOverrides = {}) =>
  resolveMilestoneAuthority(child(objective, milestoneOverrides), [envelopeRecord(recordOverrides)], NOW);

/** Hostile targets that must stay out of the production tables. */
const UNLISTED_TARGETS = ["crm", "stripe", "slack", "vpn", "iam", "s3", "payroll", "shared drive", "secrets store"];

/* -------------------------------------------------------------------------- */
/* The counterexamples                                                         */
/* -------------------------------------------------------------------------- */

test("an unread verb is not rescued by a generic noun", () => {
  // "files" names nothing — it could be source, backups, or the Owner's documents.
  for (const objective of ["Shred those files.", "Frobnicate the files.", "Zorble those files."]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

test("destructive synonyms behave consistently, listed or not", () => {
  // The review noted `wipe`/`delete` gating while `shred`/`nuke`/`discard` inherited — the same
  // request treated differently by an accident of which list a word had reached.
  for (const objective of [
    "Nuke the files.", "Discard the files.", "Get rid of the files.",
    "Wipe the files.", "Delete the files.", "Shred those files.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

test("routine verbs do not authorize targets the tables have never heard of", () => {
  for (const objective of [
    "Update the CRM.", "Fix the shared drive.", "Update our Stripe account.",
    "Add a Slack bot.", "Tweak the VPN.", "Fix IAM.",
    "Update the secrets store.", "Update the payroll.", "Add the S3 bucket.",
  ]) {
    const decision = decide(objective);
    assert.notEqual(decision.outcome, "ALLOW_STANDING", `"${objective}" inherited: ${decision.reason}`);
  }
});

test("a routine clause does not launder a consequential one", () => {
  for (const objective of [
    "Refactor the parser and shred the files.",
    "Tidy the fixtures and email the customer.",
    "Simplify the parser; delete the backups.",
    "Update the docs then connect my Gmail.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
  assert.deepEqual([...splitClauses("refactor the parser and shred the files")], ["refactor the parser", "shred the files"]);
  // A comma inside one clause is not a clause break — splitting it would manufacture verbless fragments.
  assert.equal(splitClauses("remove the unused, duplicated css class").length, 1);
});

test("an empty or whitespace-only objective never inherits", () => {
  for (const objective of ["", "   ", "\t\n  "]) {
    const decision = decide(objective);
    assert.notEqual(decision.outcome, "ALLOW_STANDING", "an empty objective inherited standing authority");
    assert.equal(detectRequestedConsequences(objective).uncertainConsequence, true);
  }
});

test("an unresolved pronoun target never inherits, and the referent is not guessed", () => {
  for (const objective of ["Update it.", "Fix that permanently.", "Change this.", "Handle those."]) {
    const decision = decide(objective);
    assert.notEqual(decision.outcome, "ALLOW_STANDING", `"${objective}" inherited`);
    assert.match(decision.reason, /consequence|uncertain/i);
  }
});

/* -------------------------------------------------------------------------- */
/* Affirmative routine                                                         */
/* -------------------------------------------------------------------------- */

test("routine requires both halves to be recognised", () => {
  // Known action + unresolved target → gate.
  assert.notEqual(decide("Update the widget-o-tron.").outcome, "ALLOW_STANDING");
  // Unknown action + routine target → gate.
  assert.notEqual(decide("Frobnicate the test fixture.").outcome, "ALLOW_STANDING");
  // Both recognised → inherit.
  assert.equal(decide("Update the test fixture.").outcome, "ALLOW_STANDING");
});

test("genuinely routine engineering work still inherits", () => {
  for (const objective of [
    "Polish the Roadmap help copy.",
    "Tidy the test fixture names.",
    "Refactor the local parser.",
    "Simplify the status rendering.",
    "Update internal documentation.",
    "Push the CSS cleanup commit internally.",
    "Remove the unused CSS class.",
    "Connect the local parser nodes.",
    "Add a clearer waiting-on-owner indicator.",
    "Document the roadmap page states.",
  ]) {
    const decision = decide(objective);
    assert.equal(decision.outcome, "ALLOW_STANDING", `"${objective}" was gated: ${decision.reason}`);
  }
});

test("explicitly granted permissions remain usable", () => {
  // The recurring mistake in this work has been making a granted permission unusable, which looks
  // safe and is simply wrong. Each grant must still buy exactly what it names.
  assert.equal(
    decide("Clear the archived backups.", { destructiveActionPermission: "YES" }, { reversibilityClass: "IRREVERSIBLE" }).outcome,
    "ALLOW_STANDING",
  );
  assert.equal(
    decide("Send the summary to the customer.", { allowedExternalEffects: ["CONTROLLED_PUSH", "IRREVERSIBLE_EXTERNAL"] },
      { externalEffectClass: "IRREVERSIBLE_EXTERNAL", reversibilityClass: "IRREVERSIBLE" }).outcome,
    "ALLOW_STANDING",
  );
  assert.equal(decide("Connect my Gmail account.", { oauthConsentPermission: "YES" }).outcome, "ALLOW_STANDING");
});

test("authority expansion is still coverable by nothing", () => {
  const permissive = {
    destructiveActionPermission: "YES", oauthConsentPermission: "YES", securityChangePermission: "YES",
    productionWriterPermission: "YES", sensitiveDataPermission: "YES", spendingCeilingUsd: 100000,
    allowedExternalEffects: ["CONTROLLED_PUSH", "IRREVERSIBLE_EXTERNAL"],
  };
  for (const objective of ["Stop prompting me for these.", "Preapprove this category.", "Assume permission going forward."]) {
    assert.notEqual(decide(objective, permissive).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

/* -------------------------------------------------------------------------- */
/* Quoted and discussed language                                               */
/* -------------------------------------------------------------------------- */

test("quoted language is discussed, not requested", () => {
  assert.equal(decide("Write tests for the phrase 'disable security.'").outcome, "ALLOW_STANDING");
  assert.equal(stripQuotedSpans("write tests for 'disable security'").includes("disable"), false);
  // The unquoted request still gates — stripping quotes must not become an escape hatch.
  assert.notEqual(decide("Disable security.").outcome, "ALLOW_STANDING");
  assert.notEqual(decide("Write tests, then disable security.").outcome, "ALLOW_STANDING");
});

/* -------------------------------------------------------------------------- */
/* Anti-vacuity                                                                */
/* -------------------------------------------------------------------------- */

test("the hostile targets in this suite are absent from the production tables", () => {
  /*
   * The guard that keeps this file meaningful.
   *
   * Every counterexample above is safe because of *structure* — routine must be affirmatively shown.
   * If a later repair instead pastes these nouns into the target tables, the tests would still pass
   * while the next unlisted noun leaked, so the absence is asserted rather than assumed.
   */
  // Comment lines are stripped first: the module documents *why* `file` is excluded, and a check that
  // could not tell prose from a table entry would force that explanation to be deleted.
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "consequence-model.ts"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .toLowerCase();
  for (const term of UNLISTED_TARGETS) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to the production tables instead of being handled structurally`);
  }
  // "file" specifically must not return as a routine artifact: it was the blanket rescue.
  assert.equal(/"files?"/.test(source), false, "`file` is back in the target tables");
});

test("unknown actions are still reported as unknown rather than assumed", () => {
  for (const verb of ["frobnicate the widget", "zorble the thing", "widgetize it"]) {
    assert.equal(classifyAction(verb).kind, "UNKNOWN", `"${verb}" was classified`);
  }
});

/* -------------------------------------------------------------------------- */
/* The deferred gate is untouched by this repair                               */
/* -------------------------------------------------------------------------- */

test("no production authority record grants an envelope, so none of this is reachable in production", () => {
  const dir = join(repositoryRoot, ".aion-local", "owner-authority");
  const { readdirSync } = fsModule;
  const records = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  assert.ok(records.length > 0);
  assert.deepEqual(records.filter((row) => row.grantsRoadmapAuthorityEnvelope === "YES"), []);
});

const fsModule = await import("node:fs");
