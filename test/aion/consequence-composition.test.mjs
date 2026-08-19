/**
 * Effect authority is action consequence *plus* target consequence — never one rescuing the other.
 *
 * A fifth independent review found the whole-request aggregation repair still leaking, in four
 * related places. Every one of them is the same mistake wearing a new coat: something the model
 * recognised was allowed to vouch for something it had not read.
 *
 *   1. `MODIFIER_SUFFIX` — any unknown `-ing`/`-ed` word counted as a harmless modifier, so
 *      "Refactor the parser, murking the log." merged into one effect and inherited, while the very
 *      same "Murking the log." on its own gated.
 *
 *   2. Delimiters — the splitter knew a fixed list, so a colon, dash, slash, pipe, ampersand,
 *      ellipsis or the word "because" carried a whole second instruction through untouched.
 *
 *   3. Head-only reading — "Refactor the helper for grant the agent access." was one effect, headed
 *      by `refactor`, and `grant` was never evaluated at all.
 *
 *   4. Composition — "consequential action + routine target -> allow" meant "Send the log.",
 *      "Nuke the parser.", "Email the cache." and "Grant the helper." all inherited, because `log`,
 *      `parser`, `cache` and `helper` are ordinary engineering objects.
 *
 * The focused aggregation suite was 26/26 green throughout. A green suite is not safety; these tests
 * exist because that turned out to be provable. They all supply valid lineage, a valid envelope and
 * satisfied routine scope constraints, and they pin two properties:
 *
 *     A ROUTINE TARGET DOES NOT MAKE EVERY ACTION ROUTINE.
 *     NO OPERATIVE EFFECT MAY DISAPPEAR FROM AUTHORITY EVALUATION.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ROADMAP_MILESTONE_SCHEMA_V1,
  decomposeEffects,
  detectRequestedConsequences,
  resolveMilestoneAuthority,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-08-19T14:00:00Z";
const PARENT = "roadmap-page-usability";
const PARENT_OBJECTIVE = "Improve AION Roadmap usability";
const AUTH_ID = "FIXTURE-COMPOSITION-V1-20260819T000000Z";

function envelopeRecord(overrides = {}) {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: AUTH_ID,
    milestoneId: "FIXTURE-COMPOSITION-V1",
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

const inherits = (objective, overrides = {}) =>
  assert.equal(decide(objective, overrides).outcome, "ALLOW_STANDING", `"${objective}" was gated`);
const gates = (objective, overrides = {}) =>
  assert.notEqual(decide(objective, overrides).outcome, "ALLOW_STANDING", `"${objective}" inherited`);

/* -------------------------------------------------------------------------- */
/* 1. Morphology is not evidence of harmlessness                              */
/* -------------------------------------------------------------------------- */

test("an unknown participle is not a modifier just because it ends in -ing or -ed", () => {
  for (const objective of [
    "Refactor the parser, murking the log.",
    "Refactor the parser, zapping the log.",
    "Refactor the parser, binning the log.",
    "Refactor the parser, axed the log.",
    "Refactor the parser, yeeting the log.",
    "Refactor the parser, zorbling the log.",
    "Refactor the parser, overwriting the cache.",
    "Update the helper, zapping the cache.",
    "Fix the UI, binning the row.",
    "Update the docs, axed the log.",
    "Refactor the helper, zapped the cache.",
    "Update the parser, nixed the log.",
    "Fix the tests, zorbling the row.",
  ]) gates(objective);
});

test("the merged form gates for the same reason the standalone form always did", () => {
  // The contrast that proves this was aggregation laundering rather than a gap in action detection.
  for (const half of ["Overwriting the cache.", "Murking the log.", "Zorbling the row."]) gates(half);
});

test("morphology cannot manufacture a modifier, across suffixes and invented stems", () => {
  // No stem below appears in any production table; none is added by this repair.
  for (const stem of ["murk", "zorb", "flurb", "grunk", "splot", "vexx", "quon", "brindle"]) {
    for (const suffix of ["ing", "ed", "s", "es", "er", "en", "ize", "ise", "ify"]) {
      for (const target of ["the log", "the cache", "the row", "logs"]) {
        gates(`Refactor the parser, ${stem}${suffix} ${target}.`);
      }
    }
  }
});

test("recognised modifiers, including their participles, still read as one noun phrase", () => {
  // `duplicated` reached this reading through the `-ed` rule that has just been removed; it is now
  // derived from `duplicate`, which the model does know. Generated, not listed.
  for (const objective of [
    "Remove the unused, duplicated CSS class.",
    "Update the old, broken parser.",
    "Fix the stale, redundant test fixture.",
    "Fix the failing test in the roadmap page.",
  ]) inherits(objective);
  assert.equal(decomposeEffects("remove the unused, duplicated css class").length, 1);
});

/* -------------------------------------------------------------------------- */
/* 2. Effect boundaries do not depend on knowing the punctuation              */
/* -------------------------------------------------------------------------- */

test("a second instruction survives every separator, not just the listed ones", () => {
  for (const objective of [
    "Update the parser: shred those files.",
    "Update the parser — shred those files.",
    "Update the parser – shred those files.",
    "Update the parser / shred those files.",
    "Update the parser … shred those files.",
    "Update the parser | shred those files.",
    "Update the parser & shred those files.",
    "Refactor the parser because we must shred the files.",
  ]) gates(objective);
});

test("separator coverage is a property, not a list — the whole cross product gates", () => {
  const separators = [
    ". ", "\n", "\r\n", "\t", ", ", "; ", ": ", " — ", " – ", " - ", " / ", " \\ ", " | ", " & ",
    "… ", " (", " [", "\n  ", " because ", " while ", " by ", " via ", " before ", " after ",
    " but ", " unless ", " when ", " once ", " so ", " so that ", " for ", " with ",
  ];
  const mutations = [
    "shred those files", "murk the log", "zorble the cache",
    "grant the agent access", "send the customer list", "nuke the backups",
  ];
  for (const separator of separators) {
    for (const mutation of mutations) gates(`Update the parser${separator}${mutation}.`);
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Routine recognition proves only its own span                            */
/* -------------------------------------------------------------------------- */

test("a mid-clause effect is evaluated even when the head is routine", () => {
  gates("Refactor the helper for grant the agent access.");
});

test("malformed grammar is not evidence of safety", () => {
  // Unclear requested effects gate. The alternative is authorising what could not be read.
  for (const objective of [
    "Refactor helper for grant access.",
    "Parser fix send logs.",
    "Update parser shred file.",
    "Fix helper because grant agent.",
  ]) gates(objective);
});

/* -------------------------------------------------------------------------- */
/* 4. Action consequence and target consequence combine independently         */
/* -------------------------------------------------------------------------- */

test("a routine target does not make every action against it routine", () => {
  // Same target, opposite outcomes. This is the whole invariant in five lines.
  for (const objective of ["Read the log.", "Inspect the log.", "Update the log."]) inherits(objective);
  for (const objective of [
    "Send the log.", "Email the log.", "Publish the log.", "Destroy the log.",
    "Grant access to the log.", "Nuke the parser.", "Email the cache.", "Grant the helper.",
  ]) gates(objective);
});

test("a routine action does not make every target it names routine", () => {
  inherits("Update the parser.");
  for (const objective of [
    "Update the unknown external tenant.",
    "Update the security policy.",
    "Update the billing account.",
    "Update it.",
  ]) gates(objective);
});

test("the action's own consequence reaches the permission check, so a grant still works", () => {
  // The failure this guards against is the opposite one: a repair that gates by inferring the wrong
  // consequence category leaves a valid grant permanently unusable.
  const granted = {
    destructiveActionPermission: "YES", securityChangePermission: "YES", oauthConsentPermission: "YES",
  };
  for (const objective of ["Nuke the parser.", "Grant the helper.", "Disable the protection."]) {
    gates(objective);
    inherits(objective, granted);
  }
});

/* -------------------------------------------------------------------------- */
/* Positive controls — the model must stay usable                             */
/* -------------------------------------------------------------------------- */

test("ordinary routine work, single and multiple, still inherits", () => {
  for (const objective of [
    "Update the parser.", "Fix the unit test.", "Refactor the helper.", "Update the documentation.",
    "Update the parser and fix the unit test.", "Refactor the helper then update the docs.",
    "Fix the parser; update the regression test.", "Update the parser. Fix the local helper.",
    "Please update the parser.", "Could you fix the unit test?", "Go ahead and refactor the helper.",
    "Inspect the logs and read the configuration.",
    "Fix the flaky test.", "Fix the small UI bug.", "Update the local test fixture.",
    "Add a clearer waiting-on-owner indicator.", "Push the CSS cleanup commit internally.",
    "Clean up the duplicate helper function.", "Rename the test fixture names.",
  ]) inherits(objective);
});

/* -------------------------------------------------------------------------- */
/* Anti-vacuity — the repair must be structural                               */
/* -------------------------------------------------------------------------- */

test("nothing in this suite was made to pass by growing a table", () => {
  /*
   * The guard that keeps the rest of the file meaningful. Every hostile case above gates because of
   * structure; if a later repair instead pastes these words into the production tables, these tests
   * would keep passing while the next unlisted word leaked.
   */
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "consequence-model.ts"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .toLowerCase();
  for (const term of [
    "murk", "zorb", "flurb", "grunk", "splot", "vexx", "quon", "brindle", "yeet", "zap", "bin",
    "shred", "nix", "overwrit", "crm", "stripe", "slack", "vpn", "iam", "payroll", "cleanup",
  ]) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to a table instead`);
  }
  // `file` must not have returned as a blanket routine rescue, and the delimiter repair must not
  // have been a longer punctuation list.
  assert.equal(source.includes('"file"'), false, "`file` returned as a blanket routine target");
  assert.equal(source.includes('"because"'), false, "`because` was added as a delimiter instead");
});

test("the leftover check is what gates the delimiter cases, not a lexical danger list", () => {
  // Structured detection alone, with no envelope and no lexical union, must already see it.
  assert.equal(detectRequestedConsequences("update the parser: zorble those rows").uncertainConsequence, true);
  assert.equal(detectRequestedConsequences("update the parser | zorble those rows").uncertainConsequence, true);
  // And the action's own consequence is structured, not lexical.
  assert.equal(detectRequestedConsequences("send the log").externalSend, true);
  assert.equal(detectRequestedConsequences("nuke the parser").destructiveImportantData, true);
});
