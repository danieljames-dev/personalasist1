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
  classifyTargets,
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
  /*
   * `cleanup` was on this list and has deliberately been taken off it.
   *
   * It was here as evidence that "Update the CSS cleanup commit." had not been special-cased — at the
   * time that sentence worked through a same-class compound rule, and the absence of the word proved
   * the rule was doing the work. A sixth review then proved that rule was itself the bypass: class
   * identity excused unknown *operational* middles too. With it gone, a compound's middle has to be
   * affirmatively recognised, and `cleanup` is one of four ordinary nouns of the trade named so that
   * legitimate compounds survive. Naming an object grants nothing about what may be done to it, which
   * is what the four assertions below pin.
   *
   * The hostile vocabulary stays absent, and the list has grown by the six words the review used.
   */
  for (const term of [
    "murk", "zorb", "flurb", "grunk", "splot", "vexx", "quon", "brindle", "yeet", "zap", "bin",
    "shred", "nix", "overwrit", "crm", "stripe", "slack", "vpn", "iam", "payroll",
    "leak", "exfiltrate", "expose", "loot", "zorp", "glorp", "siphon", "zint", "blip", "frob",
  ]) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to a table instead`);
  }
  // Naming an object is not permission to act on it: the four added nouns rescue no action.
  for (const objective of [
    "Zorble the regression.", "Nuke the integration.", "Send the cleanup.", "Exfiltrate the error.",
  ]) gates(objective);
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

/* -------------------------------------------------------------------------- */
/* Same-class compound: class identity is not authorisation evidence          */
/* -------------------------------------------------------------------------- */

/*
 * A sixth independent review found the compound rule these tests introduced was itself a bypass.
 *
 * An unread word flanked by two target nouns of the *same* `TARGET_CLASSES` row was excused as
 * compound-noun material. Known verbs still gated, so what granted permission was a word's *absence*
 * from a table — the exact shape every repair in this file exists to remove:
 *
 *     "Update the parser leak tests."   ALLOW      "Update the parser leak logs."    GATE
 *     "Update the parser zorp tests."   ALLOW      "Update the parser zorp logs."    GATE
 *
 * The only difference between the columns is whether `tests` and `parser` happened to be relatives.
 * 118 leaks were reproduced before the change, across eight reported sentences and a matrix of
 * invented middles. A compound is now permitted only where its middle is affirmatively recognised.
 */

test("an unread word between two same-class routine nouns is still its own effect", () => {
  for (const objective of [
    "Update the parser leak tests.",
    "Update the parser exfiltrate tests.",
    "Update the parser expose tests.",
    "Update the parser yeet tests.",
    "Update the parser loot tests.",
    "Update the parser zorp tests.",
    "Fix the helper exfiltrate fixture.",
    "Update the log exfiltrate cache.",
  ]) gates(objective);
});

test("target-class identity no longer decides the outcome", () => {
  // The contrast that proved the bypass. Both columns must now agree, and agree on gating.
  for (const middle of ["zorp", "murk", "blip", "frob", "leak", "exfiltrate"]) {
    gates(`Update the parser ${middle} tests.`);   // same class
    gates(`Update the parser ${middle} logs.`);    // different class
    gates(`Fix the helper ${middle} docs.`);
    gates(`Fix the helper ${middle} cache.`);
  }
});

test("unseen middles gate whether or not any table has heard of them", () => {
  // None of these appears in a production table, and the repair must not depend on that either way.
  const middles = [
    "glorp", "murk", "zint", "siphon", "bridge", "relay", "frob", "blip", "quon", "brindle",
    "export", "harvest", "scrape", "smuggle", "divert", "vexx", "splot", "zorble",
  ];
  const frames = [
    ["Update the parser", "tests"], ["Fix the helper", "fixture"], ["Update the log", "cache"],
    ["Update the test", "fixture"], ["Fix the docs", "readme"], ["Update the row", "column"],
  ];
  for (const middle of middles) {
    for (const [lead, tail] of frames) gates(`${lead} ${middle} ${tail}.`);
  }
});

test("a consequential verb's noun form is not compound-noun material either", () => {
  // Nominals are derived from *routine* verbs only. The consequential side must find no way in.
  for (const objective of [
    "Update the parser sending tests.",
    "Update the parser deletion tests.",
    "Update the parser nuking tests.",
    "Update the parser publishing tests.",
    "Fix the helper wiping fixture.",
    "Fix the helper grant fixture.",
  ]) gates(objective);
});

test("malformed same-class grammar is not evidence of safety", () => {
  for (const objective of [
    "Update parser exfiltrate tests.",
    "Parser update leak tests.",
    "Fix helper expose fixture.",
    "Tests update siphon parser.",
  ]) gates(objective);
});

test("legitimate engineering compounds remain usable", () => {
  // The cost of removing the shortcut, paid back by recognising the middle instead of guessing it.
  for (const objective of [
    "Update the CSS cleanup commit.",
    "Fix the parser regression test.",
    "Update the build cache config.",
    "Fix the unit test fixture.",
    "Update the local integration test.",
    "Refactor the request validation helper.",
    "Update the parser error handling test.",
  ]) inherits(objective);
});

/* -------------------------------------------------------------------------- */
/* Target accounting cannot contribute permission                             */
/* -------------------------------------------------------------------------- */

test("first-match-per-class is evidence for a reader, never authority", () => {
  /*
   * `classifyTargets` reports one matched word per class so a gate can be read. That reporting must
   * not be what the accounting sees: reusing it once made every *other* recognised noun in the
   * sentence look unaccounted, and gated "Rename the test fixture names." on `fixture`.
   *
   * Pinned from both sides — every recognised noun is accounted for however many share a class, and
   * an unrecognised one is not rescued by a sibling that matched first.
   */
  for (const objective of [
    "Rename the test fixture names.",
    "Simplify the local parser module.",
    "Tidy the test fixture names.",
    "Update the build script package config.",
  ]) inherits(objective);
  for (const objective of [
    "Update the parser zorp tests.",
    "Update the test fixture zorp names.",
  ]) gates(objective);
});

test("a determiner inside a multi-word target never counts as a noun", () => {
  /*
   * Targets like "the list" and "the ledger" carry their determiner. Registering `the` as a noun
   * made every determiner look like the head of a noun phrase, which suppressed the leftover check.
   * The consequential phrase must still match as a phrase, and `the` alone must name nothing.
   */
  assert.equal(classifyTargets("the list").consequential.length > 0, true);
  assert.equal(classifyTargets("the parser").consequential.length, 0);
  assert.equal(classifyTargets("update the thing").routine.length, 0);
  // `the` may not act as the recognised noun that excuses an unread neighbour.
  gates("Update the zorp.");
  gates("Update the parser zorp the tests.");
});

/* -------------------------------------------------------------------------- */
/* Trailing unread text: a recognised prefix proves only itself               */
/* -------------------------------------------------------------------------- */

/*
 * A seventh independent review found the last positional excuse, and it was one this file had
 * documented as acceptable rather than treated as a fail condition:
 *
 *     "Update the parser exfiltrate."   "Update the helper backdoor."   "Refactor the helper weaponize."
 *
 * all inherited. The argument had been that a trailing word governs nothing and so cannot be the
 * mutation. That was wrong: a trailing imperative is a second instruction with its separator missing,
 * and *known* verbs gated in the same slot while unknown ones did not — which makes absence from a
 * table the thing granting permission, for the fifth time in this file.
 *
 * Attacking the rule rather than the reported sentences turned up three further branches the review
 * had not reported, and they are pinned below alongside it:
 *
 *   - `-al -ive -ous -able -ible -less -ful` conferred modifier status by shape alone, so
 *     "Update the parser removal." and "Update the log retrieval." inherited;
 *   - a modifier on the left reopened the same-class hatch: "Update the broken zorp tests.";
 *   - a determiner on the left excused a trailing word: "Update the parser for the zorp."
 *
 * 579 leaks were reproduced before the change. Every positional excuse is gone except one, and that
 * one is pinned explicitly at the end of this section rather than left implicit.
 */

test("a trailing unread word is a second instruction, not part of the object", () => {
  for (const objective of [
    "Update the parser exfiltrate.",
    "Update the parser leak.",
    "Update the helper backdoor.",
    "Update the helper trojan.",
    "Refactor the helper weaponize.",
    "Update the parser yeet.",
    "Update the parser siphon.",
    "Update the docs harvest.",
    "Update the log beacon.",
  ]) gates(objective);
});

test("trailing tokens gate across invented, real, short, long and inflected forms", () => {
  const tokens = [
    "glorp", "murk", "zindle", "frob", "quux", "zorp", "blip", "zint", "vexx", "splot", "brindle",
    "quon", "flurb", "grunk", "zorble", "krell", "plonk", "snarf", "wibble", "gronk",
    "exfiltrate", "leak", "backdoor", "trojan", "weaponize", "siphon", "harvest", "beacon",
    "tunnel", "pivot", "escalate", "persist", "implant", "stash", "smuggle", "divert", "scrape",
    "mirror", "clone", "fork", "spawn", "inject", "tamper", "forge", "spoof", "hijack",
    "bridge", "relay", "proxy", "gateway", "stream", "shard", "broker",
    "ax", "rip", "fry", "gut", "lop", "dig",
    "reconfigurate", "transmogrify", "deauthenticate", "decommission", "expropriate",
    "glorping", "glorped", "glorpize", "glorpify", "glorpen", "glorps", "glorpes",
    "murking", "murked", "murkize", "murkify", "murken", "murks",
    "removal", "retrieval", "disposal", "reversal", "extractive", "erasable", "disposable",
    "exfiltrable", "leakable", "siphonal",
  ];
  const frames = [
    (x) => `Update the parser ${x}.`,
    (x) => `Fix the helper ${x}.`,
    (x) => `Refactor the test ${x}.`,
    (x) => `Update the log ${x}.`,
    (x) => `Fix the fixture ${x}.`,
  ];
  for (const token of tokens) for (const frame of frames) gates(frame(token));
});

test("moving an unread word to another slot does not make it safe", () => {
  for (const token of ["glorp", "exfiltrate", "murk", "zindle", "backdoor", "removal"]) {
    for (const objective of [
      `${token} update the parser.`,
      `Update ${token} parser.`,
      `Update parser ${token}.`,
      `Update parser ${token} tests.`,
      `Update parser tests ${token}.`,
      `Update the parser ${token} tests.`,
      `Update the parser tests ${token}.`,
      `Update the parser for the ${token}.`,
      `Update the parser and the ${token}.`,
      `Update the parser with ${token}.`,
      `Update the broken ${token} tests.`,
      `Update the stale ${token}.`,
    ]) gates(objective);
  }
});

test("morphology confers nothing: adjective-shaped operative words still gate", () => {
  // The suffix rule that granted these has been removed rather than narrowed.
  for (const objective of [
    "Update the parser removal.",
    "Update the parser disposal.",
    "Update the helper erasable.",
    "Update the parser extractive.",
    "Update the log retrieval.",
  ]) gates(objective);
});

test("a modifier on the left does not reopen the between-nouns hatch", () => {
  // The same defect as the same-class compound, one word further left: a noun-phrase word vouching
  // for its neighbour. Only a determiner may introduce an unread run.
  for (const objective of [
    "Update the broken zorp tests.",
    "Fix the stale glorp fixture.",
    "Update the old murk logs.",
    "Refactor the legacy zindle helper.",
    "Update the unused exfiltrate tests.",
  ]) gates(objective);
});

test("a determiner does not excuse a trailing word either", () => {
  for (const objective of [
    "Update the parser for the zorp.",
    "Fix the helper with the glorp.",
    "Update the test to the murk.",
    "Refactor the parser of the backdoor.",
  ]) gates(objective);
});

/*
 * The one excuse that remains, stated plainly so it can be attacked rather than assumed.
 *
 * An unread run introduced by a determiner and closed by a recognised noun — "the *unit* test",
 * "a *clearer waiting-on-owner* indicator" — is read as attributive. The claim is grammatical rather
 * than positional: a determiner cannot attach to a verb, so there is no parse of "the X parser" in
 * which X is a second instruction. The tests below try to give such a word an object by every route
 * available, and every one of them gates.
 *
 * Closing it instead would cost "Fix the unit test." and "Fix the flaky test.", which are required
 * routine work, and the adjective vocabulary needed to recognise those affirmatively is unbounded.
 * It is therefore kept, and the residual is recorded rather than hidden: an unread word in that exact
 * slot inherits, and a *known* verb in the same slot gates. A reviewer should treat this as the
 * remaining permission-producing condition in this module.
 */

test("the attributive slot cannot give an unread word an object", () => {
  for (const objective of [
    "Update the exfiltrate the parser.",
    "Update the exfiltrate parser and the logs.",
    "Update the parser, the exfiltrate logs.",
    "Update the exfiltrate parser: shred the files.",
    "Update the exfiltrate parser exfiltrate.",
    "Update the exfiltrate parser, exfiltrate the cache.",
  ]) gates(objective);
  // Known verbs are refused there too, as defence in depth rather than as the basis of the excuse.
  for (const objective of [
    "Update the send parser.", "Update the nuke parser.", "Update the grant parser.",
    "Update the shredding parser.", "Update the deleted parser.",
  ]) gates(objective);
});

test("ordinary and compound routine work survives the removal of the positional excuses", () => {
  for (const objective of [
    "Update the parser test.", "Update the parser regression test.", "Update the CSS cleanup commit.",
    "Fix the unit test fixture.", "Update the build cache config.", "Update the local integration test.",
    "Refactor the request validation helper.", "Update the parser error handling test.",
    "Update the parser.", "Fix the unit test.", "Refactor the helper.", "Update the documentation.",
    "Could you update the parser?", "Please fix the test.", "Go ahead and refactor the helper.",
    "Fix the flaky test.", "Fix the small UI bug.", "Update the parser code.",
    "Add a clearer waiting-on-owner indicator.",
  ]) inherits(objective);
});

test("the trailing repair added no hostile vocabulary", () => {
  const source = readFileSync(join(repositoryRoot, "packages", "director", "src", "consequence-model.ts"), "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n")
    .toLowerCase();
  for (const term of [
    "exfiltrate", "backdoor", "trojan", "weaponize", "siphon", "harvest", "beacon", "tunnel",
    "implant", "smuggle", "hijack", "spoof", "tamper", "glorp", "zindle", "quux", "krell",
    "removal", "retrieval", "disposal", "erasable",
  ]) {
    assert.equal(source.includes(`"${term}"`), false, `"${term}" was added to a table instead`);
  }
  // The nouns that were named grant nothing about what may be done to them.
  for (const objective of [
    "Exfiltrate the bug.", "Nuke the code.", "Send the phrase.", "Zorble the bug.",
  ]) gates(objective);
});
