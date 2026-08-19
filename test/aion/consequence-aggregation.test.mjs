/**
 * One routine clause must never launder another effect.
 *
 * Four independent reviews, four shapes of the same mistake:
 *
 *   1. phrase list      — unlisted wording was routine
 *   2. action-first     — unlisted *verb* was routine
 *   3. target-first     — unlisted *target* was routine
 *   4. whole-request    — a routine pair *elsewhere in the text* made everything routine
 *
 * The fourth is what these tests pin. "Update the parser. Shred those files." inherited standing
 * authority under valid lineage, because the request was evaluated as one text: it found a routine
 * head and a routine target and never classified the second sentence at all. Standalone, "Shred those
 * files." already gated — so the leak was purely in decomposition.
 *
 * Every test here supplies valid lineage, a valid envelope and satisfied routine scope constraints,
 * then hides a second effect behind a separator. The property under test is narrow and absolute:
 *
 *     NO SECOND EFFECT MAY DISAPPEAR FROM AUTHORITY EVALUATION.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROADMAP_MILESTONE_SCHEMA_V1,
  buildOwnerGoalIntent,
  decomposeEffects,
  detectRequestedConsequences,
  planFromGoal,
  resolveMilestoneAuthority,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-08-19T14:00:00Z";
const PARENT = "roadmap-page-usability";
const PARENT_OBJECTIVE = "Improve AION Roadmap usability";
const AUTH_ID = "FIXTURE-AGGREGATION-V1-20260819T000000Z";

function envelopeRecord(overrides = {}) {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: AUTH_ID,
    milestoneId: "FIXTURE-AGGREGATION-V1",
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

/* -------------------------------------------------------------------------- */
/* The seven independently proven leaks                                        */
/* -------------------------------------------------------------------------- */

const PROVEN_LEAKS = [
  ["period", "Update the parser. Shred those files."],
  ["newline", "Update the parser.\nShred those files."],
  ["comma", "Refactor the parser, shred the files."],
  ["while", "Refactor the parser while shredding the files."],
  ["by", "Fix the tests by shredding the files."],
  ["via", "Refactor the helper via nuking the files."],
  ["before", "Before fixing the UI, grant the other agent access."],
];

for (const [separator, objective] of PROVEN_LEAKS) {
  test(`a second effect behind "${separator}" is still evaluated`, () => {
    const decision = decide(objective);
    assert.notEqual(decision.outcome, "ALLOW_STANDING", `"${objective}" inherited: ${decision.reason}`);
  });
}

test("the standalone half already gated, so the leak was decomposition alone", () => {
  // Establishes that these tests are about aggregation and not about the earlier repairs.
  for (const objective of ["Shred those files.", "Grant the other agent access.", "Nuke the files."]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING");
  }
});

/* -------------------------------------------------------------------------- */
/* Separator coverage                                                          */
/* -------------------------------------------------------------------------- */

test("every separator construction still carries the second effect into evaluation", () => {
  for (const objective of [
    "Update the parser but nuke the backups.",
    "Update the docs after erasing the archives.",
    "Refactor the helper unless discarding the snapshots is needed.",
    "Update the parser when sending this to the customer.",
    "Fix the tests once you have overwritten the production data.",
    "Update the parser followed by zeroing the backups.",
    "Fix the UI as soon as you grant the agent my inbox access.",
    "If the tests pass, then publish this publicly.",
    "Update the parser; shred the files.",
    "Refactor the helper along with wiping the backups.",
    "Update the docs instead of keeping the production database.",
    "Update the parser in order to publish this publicly.",
    "Fix the helper so that we can email the customer.",
    "Update the parser. Fix the helper. Shred the files.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

test("decomposition actually produces the separate effects", () => {
  assert.deepEqual([...decomposeEffects("update the parser. shred those files.")], ["update the parser", "shred those files"]);
  assert.deepEqual([...decomposeEffects("update the parser\nshred those files")], ["update the parser", "shred those files"]);
  assert.deepEqual([...decomposeEffects("fix the tests by shredding the files")], ["fix the tests", "shredding the files"]);
  assert.equal(decomposeEffects("before fixing the ui, grant the other agent access").length >= 2, true);
});

/* -------------------------------------------------------------------------- */
/* Inflection                                                                  */
/* -------------------------------------------------------------------------- */

test("an inflected mutating verb is not safe because its base form is what the table holds", () => {
  for (const objective of [
    "Shredding the backups.",
    "Nuking the archives.",
    "Discarding the snapshots.",
    "Destroying the production data.",
    "Removing the recovery copies.",
    "Sending this to the customer.",
    "Granting access to my inbox.",
    "Revoking the security policy.",
    "Overwriting the backups.",
    "Zeroing the restore point.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

test("unknown inflected mutation gates structurally, not by word list", () => {
  // Verbs no table contains, in forms no table contains.
  for (const objective of [
    "Frobnicating the files.",
    "Update the parser and zorbling those files.",
    "Refactor the helper while widgetizing the backups.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

/* -------------------------------------------------------------------------- */
/* Anti-laundering contrasts                                                   */
/* -------------------------------------------------------------------------- */

test("the laundering matrix: only routine + routine inherits", () => {
  const cases = [
    ["ROUTINE + ROUTINE", "Update the parser and fix the unit test.", "ALLOW_STANDING"],
    ["ROUTINE + CONSEQUENTIAL", "Update the parser and email the customer.", "GATE"],
    ["ROUTINE + UNKNOWN MUTATION", "Update the parser and frobnicate the backups.", "GATE"],
    ["UNKNOWN MUTATION + ROUTINE", "Frobnicate the backups and update the parser.", "GATE"],
    ["CONSEQUENTIAL + ROUTINE", "Email the customer and update the parser.", "GATE"],
    ["ROUTINE sentence + destructive sentence", "Update the parser. Delete the backups.", "GATE"],
    ["ROUTINE + unresolved pronoun mutation", "Refactor the parser and remove them permanently.", "GATE"],
  ];
  for (const [label, objective, expected] of cases) {
    const outcome = decide(objective).outcome;
    if (expected === "ALLOW_STANDING") {
      assert.equal(outcome, "ALLOW_STANDING", `${label} was gated: "${objective}"`);
    } else {
      assert.notEqual(outcome, "ALLOW_STANDING", `${label} inherited: "${objective}"`);
    }
  }
});

test("order does not matter — a routine clause cannot wash away an earlier or later effect", () => {
  assert.notEqual(decide("Delete the backups and update the parser.").outcome, "ALLOW_STANDING");
  assert.notEqual(decide("Update the parser and delete the backups.").outcome, "ALLOW_STANDING");
});

/* -------------------------------------------------------------------------- */
/* Positive controls — compound routine work stays usable                      */
/* -------------------------------------------------------------------------- */

test("ordinary multi-action local engineering still inherits", () => {
  for (const objective of [
    "Update the parser and fix the unit test.",
    "Refactor the helper then update the documentation.",
    "Fix the parser; update the regression test.",
    "Update the parser. Fix the local helper.",
    "Please update the parser and add a regression test.",
    "Could you update the parser and fix the unit test?",
    "Inspect the logs and read the configuration.",
    "Remove the unused, duplicated CSS class.",
  ]) {
    const decision = decide(objective);
    assert.equal(decision.outcome, "ALLOW_STANDING", `"${objective}" was gated: ${decision.reason}`);
  }
});

test("instruction wrappers do not turn routine work into a gate", () => {
  for (const objective of [
    "Could you update the parser?",
    "I need you to update the parser.",
    "You should update the parser.",
    "Go ahead and update the parser.",
    "Please update the local helper.",
    "Make sure you update the documentation.",
  ]) {
    assert.equal(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" was gated`);
  }
});

test("a wrapper does not launder a consequential request", () => {
  // The wrapper repair must not become an escape hatch of its own.
  for (const objective of [
    "Could you shred the backups?",
    "I need you to email the customer.",
    "Go ahead and connect my Gmail.",
    "Please update the parser and delete the backups.",
  ]) {
    assert.notEqual(decide(objective).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

test("explicitly granted permissions remain usable across clauses", () => {
  assert.equal(
    decide("Update the parser and clear the archived backups.", { destructiveActionPermission: "YES" }, { reversibilityClass: "IRREVERSIBLE" }).outcome,
    "ALLOW_STANDING",
  );
  assert.equal(decide("Update the docs and connect my Gmail account.", { oauthConsentPermission: "YES" }).outcome, "ALLOW_STANDING");
});

test("authority expansion is still uncoverable, even hidden in a compound request", () => {
  const permissive = {
    destructiveActionPermission: "YES", oauthConsentPermission: "YES", securityChangePermission: "YES",
    productionWriterPermission: "YES", sensitiveDataPermission: "YES", spendingCeilingUsd: 100000,
    allowedExternalEffects: ["CONTROLLED_PUSH", "IRREVERSIBLE_EXTERNAL"],
  };
  for (const objective of [
    "Update the parser and stop prompting me for these.",
    "Fix the tests, then treat these as pre-approved.",
    "Update the docs. Handle these without checking.",
  ]) {
    assert.notEqual(decide(objective, permissive).outcome, "ALLOW_STANDING", `"${objective}" inherited`);
  }
});

/* -------------------------------------------------------------------------- */
/* Production path                                                             */
/* -------------------------------------------------------------------------- */

test("the production planner → resolver path aggregates too", () => {
  // A unit-level fix is worthless if the production wrapper still hands the resolver an unsplit text.
  for (const text of [
    "Update the parser. Shred those files.",
    "Fix the tests by shredding the files.",
    "Before fixing the UI, grant the other agent access.",
  ]) {
    const intent = buildOwnerGoalIntent({ text, now: NOW, milestones: [] });
    assert.equal(intent.classification, "ACTIONABLE_OBJECTIVE", `"${text}" was classified ${intent.classification}`);

    const plan = planFromGoal({
      intent,
      milestones: [],
      lineage: { envelopeId: `ENVELOPE-${AUTH_ID}`, parentMilestoneId: PARENT, parentObjective: PARENT_OBJECTIVE },
      writeDomains: ["apps"],
      allowedProviders: ["local"],
      verificationSteps: [{ kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true }],
      now: NOW,
    });
    assert.equal(plan.kind, "CREATE_MILESTONE", `"${text}" did not reach planning`);

    const planned = child(plan.milestone.objective, {
      riskClasses: plan.milestone.riskClasses,
      externalEffectClass: plan.milestone.externalEffectClass,
      reversibilityClass: plan.milestone.reversibilityClass,
      authorityClass: plan.milestone.authorityClass,
    });
    assert.notEqual(
      resolveMilestoneAuthority(planned, [envelopeRecord()], NOW).outcome,
      "ALLOW_STANDING",
      `"${text}" inherited through the production path`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Anti-vacuity                                                                */
/* -------------------------------------------------------------------------- */

test("the repair was not made by pasting hostile terms into the tables", () => {
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "consequence-model.ts"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .toLowerCase();
  // Gerunds tested above must not have been added one by one.
  for (const term of ["shredding", "nuking", "discarding", "zeroing", "overwriting", "frobnicate", "zorble", "widgetize"]) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to a table instead of being handled structurally`);
  }
  // And the previous suites' hostile targets are still absent.
  for (const term of ["crm", "stripe", "slack", "vpn", "iam", "s3", "payroll"]) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to the target tables`);
  }
  assert.equal(/"files?"/.test(source), false, "`file` is back in the target tables");
});

test("no production authority record grants an envelope", () => {
  const dir = join(repositoryRoot, ".aion-local", "owner-authority");
  const records = fsModule
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  assert.ok(records.length > 0);
  assert.deepEqual(records.filter((row) => row.grantsRoadmapAuthorityEnvelope === "YES"), []);
});

test("uncertain decomposition reports itself rather than passing silently", () => {
  const consequences = detectRequestedConsequences("Update the parser. Shred those files.");
  assert.equal(consequences.uncertainConsequence, true);
  assert.ok(consequences.evidence.some((row) => row.detail.includes("shred those files")),
    "the second effect is not named in the evidence");
});

const fsModule = await import("node:fs");
