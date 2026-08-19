/**
 * The Owner types a sentence, and the tests that matter are about what does *not* happen.
 *
 * Turning chat into work is easy and dangerous. A classifier that leans toward "actionable" produces
 * milestones nobody asked for; one that can be talked into it by a polite phrase turns the chat box
 * into a command shell. So the assertions here weight the refusals: questions stay questions,
 * ambiguity asks, repeats converge, and nothing in this layer executes.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createGoalControl, createRoadmapControl } from "../../apps/aion/roadmap-control.mjs";
import { GOAL_VERBS_V1, lineageForTypedGoal } from "../../apps/aion/goal-intake.mjs";
import {
  DUPLICATE_SIMILARITY_THRESHOLD_V1,
  PLANNABLE_CLASSES_V1,
  classifyOwnerInput,
  createFileRoadmapStore,
  createRoadmapPort,
  deriveEnvelopeFromOwnerAuthority,
  extractConstraints,
  extractSuccessCriteria,
  goalIdFor,
  objectiveSimilarity,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENVELOPE_AUTH_ID = "AION-OWNER-GOAL-INTAKE-AND-ROADMAP-AUTHORITY-V1-20260819T034500Z";

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), "aion-goal-intake-"));
  try {
    return run({
      root,
      storeRoot: join(root, "roadmap"),
      jobStoreRoot: join(root, "mva-dispatch"),
      artifactRoot: join(root, "mva-dispatch", "artifacts"),
      goalStoreRoot: join(root, "owner-goals"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seedRoadmap(paths, milestones = []) {
  createRoadmapPort({
    storeRoot: paths.storeRoot,
    authorities: [],
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    verify: () => [],
    baselineSha: "seed",
    currentHead: "seed",
    currentDirectiveId: "seed",
    dispatch: () => ({ provider: null, succeeded: false, failureClass: "SEED", detail: "seed", leaseId: null, ambiguousExternalEffect: false }),
  }).ensureRoadmap({
    roadmapId: "goal-intake-roadmap",
    ownerGoalSet: ["prove a typed goal becomes governed work"],
    provenance: "focused goal-intake test",
    milestones,
  });
}

function goals(paths, overrides = {}) {
  return createGoalControl({ repositoryRoot, ...paths, ...overrides });
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

test("an instruction is an objective and a question is a question", () => {
  const objective = classifyOwnerInput("Make routine roadmap work autonomous so I don't have to keep authorizing myself.");
  assert.equal(objective.classification, "ACTIONABLE_OBJECTIVE");
  assert.equal(objective.ambiguity, "CLEAR");

  const query = classifyOwnerInput("What is AION working on?");
  assert.equal(query.classification, "CONTEXT_QUERY");
  assert.equal(PLANNABLE_CLASSES_V1.includes(query.classification), false);

  const question = classifyOwnerInput("How does a lease work?");
  assert.equal(question.classification, "QUESTION");
});

test("a question containing an instruction verb is still a question", () => {
  // "should I add caching?" is a question about adding caching, not an instruction to add it. A
  // classifier that scanned for verbs anywhere in the sentence would get this exactly backwards.
  for (const text of ["Should I add caching to the roadmap page?", "Can you improve the matching workflow?", "Do we need to fix the watchdog?"]) {
    const result = classifyOwnerInput(text);
    assert.equal(PLANNABLE_CLASSES_V1.includes(result.classification), false, `"${text}" became actionable`);
  }
});

test("an unrecognised sentence asks rather than inventing work", () => {
  const result = classifyOwnerInput("the roadmap page and the customer thing, you know");
  assert.equal(result.classification, "QUESTION");
  assert.equal(result.ambiguity, "AMBIGUOUS");
  assert.ok(result.confidence < 0.6, "an unrecognised sentence was classified confidently");
});

test("an authorization phrase is an Owner decision, not work", () => {
  const result = classifyOwnerInput("AUTHORIZE AION-SOMETHING-V1-20260101T000000Z NORMAL abc123");
  assert.equal(result.classification, "OWNER_DECISION");
});

test("a short continuation resumes; a long one names new work", () => {
  assert.equal(classifyOwnerInput("continue").classification, "ROADMAP_CONTINUATION");
  assert.equal(classifyOwnerInput("keep going").classification, "ROADMAP_CONTINUATION");
  assert.equal(
    classifyOwnerInput("continue improving the customer matching workflow until it handles trade-ins").classification,
    "ACTIONABLE_OBJECTIVE",
  );
});

test("a polite prefix still needs a real instruction verb", () => {
  assert.equal(classifyOwnerInput("please fix the roadmap page").classification, "ACTIONABLE_OBJECTIVE");
  assert.equal(classifyOwnerInput("I want a coffee").classification, "QUESTION");
});

/* -------------------------------------------------------------------------- */
/* Intent preservation                                                         */
/* -------------------------------------------------------------------------- */

test("the Owner's exact text is preserved and never rewritten", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const text = "  Improve the Roadmap page so I can immediately see what needs my attention.  ";
    const result = goals(paths).submit(text);
    assert.equal(result.actionable, true);

    const files = readdirSync(join(paths.goalStoreRoot, "goals"));
    assert.equal(files.length, 1);
    const stored = JSON.parse(readFileSync(join(paths.goalStoreRoot, "goals", files[0]), "utf8"));
    assert.equal(stored.originalText, text, "the Owner's text was trimmed, cased or otherwise improved");
    assert.notEqual(stored.normalizedObjective, stored.originalText, "normalization should be a separate field");
  });
});

test("success criteria and constraints are extracted only where the Owner stated them", () => {
  assert.deepEqual(extractSuccessCriteria("Fix the panel."), []);
  assert.deepEqual(extractConstraints("Fix the panel."), []);

  const criteria = extractSuccessCriteria("Improve the Roadmap page so I can immediately see what needs my attention.");
  assert.equal(criteria.length, 1);
  assert.match(criteria[0], /see what needs my attention/);

  const constraints = extractConstraints("Add the panel without touching the firewall.");
  assert.equal(constraints.length, 1);
  assert.match(constraints[0], /touching the firewall/);
});

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

test("an actionable goal creates exactly one milestone", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const before = createRoadmapControl({ repositoryRoot, ...paths }).status().total;
    const result = goals(paths).submit("Improve the Roadmap page so I can immediately see what needs my attention.");

    assert.equal(result.created, true);
    assert.ok(result.milestoneId);
    const after = createRoadmapControl({ repositoryRoot, ...paths }).status();
    assert.equal(after.total, before + 1, "planning created more or less than one milestone");

    const milestone = createFileRoadmapStore(paths.storeRoot).loadMilestone(result.milestoneId);
    assert.equal(milestone.status, "PLANNED", "a goal-created milestone must not start in flight");
    assert.match(milestone.provenance, /Owner goal goal-/, "the milestone does not trace back to the Owner text");
    assert.ok(milestone.provenance.includes("Improve the Roadmap page"), "provenance lost the Owner's words");
  });
});

test("a question creates no roadmap work at all", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const before = createRoadmapControl({ repositoryRoot, ...paths }).status().total;
    const result = goals(paths).submit("What is AION working on?");

    assert.equal(result.actionable, false);
    assert.equal(result.created, false);
    assert.equal(result.milestoneId, null);
    assert.equal(createRoadmapControl({ repositoryRoot, ...paths }).status().total, before);
  });
});

test("the same goal typed twice creates one milestone, across fresh instances", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const text = "Improve the Roadmap page so I can immediately see what needs my attention.";

    const first = goals(paths).submit(text);
    assert.equal(first.created, true);

    // A fresh control is what a page refresh, a second tab and a restarted server all look like.
    const second = goals(paths).submit(text);
    assert.equal(second.created, false, "the same goal created a second milestone");
    assert.equal(second.milestoneId, first.milestoneId);
    assert.equal(goalIdFor(text), goalIdFor(`  ${text.toUpperCase()}  `), "goal identity is not stable under casing and spacing");

    const total = createRoadmapControl({ repositoryRoot, ...paths }).status().total;
    const third = goals(paths).submit(text);
    assert.equal(third.created, false);
    assert.equal(createRoadmapControl({ repositoryRoot, ...paths }).status().total, total);
  });
});

test("a near-identical goal maps onto the existing milestone rather than duplicating it", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const first = goals(paths).submit("Improve the Roadmap page so I can immediately see what needs my attention.");
    const second = goals(paths).submit("Improve the Roadmap page so that I can see immediately what needs my attention today.");

    assert.equal(second.created, false, "a restatement of the same goal created new work");
    assert.equal(second.milestoneId, first.milestoneId);
    assert.ok(
      objectiveSimilarity(
        "Improve the Roadmap page so I can immediately see what needs my attention.",
        "Improve the Roadmap page so that I can see immediately what needs my attention today.",
      ) >= DUPLICATE_SIMILARITY_THRESHOLD_V1,
    );
  });
});

test("two genuinely different goals create two milestones", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const a = goals(paths).submit("Improve the Roadmap page so I can see what needs my attention.");
    const b = goals(paths).submit("Add a customer matching report to the sales area.");
    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.notEqual(a.milestoneId, b.milestoneId);
  });
});

test("recent goals read back what the Owner actually said", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const control = goals(paths);
    control.submit("What is AION working on?");
    control.submit("Add a customer matching report to the sales area.");
    const recent = control.recent();
    assert.equal(recent.goals.length, 2, "a question was not recorded");
    assert.ok(recent.goals.some((row) => row.text === "What is AION working on?"));
    assert.ok(recent.goals.some((row) => row.classification === "ACTIONABLE_OBJECTIVE"));
  });
});

/* -------------------------------------------------------------------------- */
/* This layer executes nothing                                                 */
/* -------------------------------------------------------------------------- */

test("the intake layer has no path to execution, authority or the filesystem beyond its own store", () => {
  const source = readFileSync(join(repositoryRoot, "apps", "aion", "goal-intake.mjs"), "utf8");
  for (const forbidden of [
    "continueRoadmap(", "advanceRoadmap(", "submitJob(", "routeJob(", "executeWithFailover(",
    "approveGate", "grantAuthority", "setAuthority", "forceComplete", "bypassReview", "execFileSync", "spawnSync",
  ]) {
    assert.equal(source.includes(forbidden), false, `goal intake reaches ${forbidden}`);
  }
  // The only roadmap mutation it may perform.
  assert.ok(source.includes("port.addMilestone("), "goal intake does not go through the port");
});

test("the goal verbs are a closed pair and carry no privileged input", () => {
  assert.deepEqual([...GOAL_VERBS_V1].sort(), ["goal.recent", "goal.submit"]);
  const server = readFileSync(join(repositoryRoot, "apps", "aion", "server.mjs"), "utf8");
  const submitCase = /case "goal\.submit":\s*return goalControl\(\)\.submit\(([^;]*)\);/.exec(server);
  assert.ok(submitCase !== null, "goal.submit is not routed");
  // Only text may cross. A milestone id, provider or authority id from a browser would be the page
  // answering a question the control plane exists to answer.
  assert.match(submitCase[1], /input\.text/);
  for (const forbidden of ["input.milestoneId", "input.provider", "input.ownerAuthorizationId", "input.authority", "input.status"]) {
    assert.equal(submitCase[1].includes(forbidden), false, `goal.submit forwards ${forbidden}`);
  }
});

test("an empty or malformed goal is refused without creating work", () => {
  withScratch((paths) => {
    seedRoadmap(paths);
    const control = goals(paths);
    for (const text of ["", "   "]) {
      const result = control.submit(text);
      assert.equal(result.actionable, false, `"${text}" was treated as actionable`);
      assert.equal(result.milestoneId, null);
    }
    assert.equal(createRoadmapControl({ repositoryRoot, ...paths }).status().total, 0);
  });
});

test("goal intake refuses to be built without a repository root or a port", () => {
  assert.throws(() => createGoalControl({}), /repositoryRoot/);
});

/* -------------------------------------------------------------------------- */
/* Envelope selection                                                          */
/* -------------------------------------------------------------------------- */

test("a typed goal supplies no lineage, so it can never attach itself to an envelope", () => {
  /*
   * This replaces a test that asserted the *defective* behaviour: it checked that
   * `selectEnvelopeForGoal` picked the newest ACTIVE envelope covering a goal's write domains, and
   * it passed while "delete the production backups" was being stamped with that envelope and
   * reported as automatic work. The test was not weakened — the behaviour it described was removed,
   * and this asserts the replacement.
   */
  assert.equal(lineageForTypedGoal(), null);

  const record = JSON.parse(
    readFileSync(join(repositoryRoot, ".aion-local", "owner-authority", `${ENVELOPE_AUTH_ID}.json`), "utf8"),
  );
  // Even a real ACTIVE record projects no envelope without an explicit Owner grant.
  assert.equal(deriveEnvelopeFromOwnerAuthority(record, "2026-08-19T06:00:00Z"), null);
  assert.equal(deriveEnvelopeFromOwnerAuthority(null, "2026-08-19T06:00:00Z"), null);
});

test("the new envelope mechanism does not swallow the deferred history-access gate", () => {
  // Read against the real production roadmap, not a fixture. The failure this guards against is a
  // new autonomy mechanism quietly absorbing a gate the Owner deliberately left open — which would
  // look like progress and would be the single worst outcome of this milestone.
  const control = createRoadmapControl({ repositoryRoot });
  const status = control.status();
  const deferred = status.gates.find((gate) => gate.milestoneId === "owner-context-history-access");
  assert.ok(deferred !== undefined, "the deferred history-access gate is no longer open");
  assert.equal(deferred.status, "OPEN");
  assert.match(deferred.reason, /names no Owner authorization/);
  assert.equal(status.waitingOnOwner, true);

  // And it is not merely open — it must not have quietly acquired an envelope claim either.
  const milestone = createFileRoadmapStore(join(repositoryRoot, ".aion-local", "roadmap"))
    .loadMilestone("owner-context-history-access");
  assert.equal(milestone.ownerAuthorizationId, null);
  assert.ok(
    milestone.authorityEnvelopeId === undefined || milestone.authorityEnvelopeId === null,
    "the deferred milestone acquired an authority envelope claim",
  );
});
