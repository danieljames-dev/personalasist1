/**
 * The app is a window onto the roadmap, and the tests that matter are about what it cannot do.
 *
 * Reading status is easy. What decides whether putting this on a phone is safe is the absence of a
 * route that approves a gate, forces a milestone complete, skips review, or hands the browser a
 * dump of Personal Context. Those are asserted directly against the shipped verb table rather than
 * inferred from the UI, because a verb the switch accepts is reachable whether or not a button
 * exists for it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRoadmapControl, ROADMAP_VERBS_V1 } from "../../apps/aion/roadmap-control.mjs";
import {
  createFileRoadmapStore,
  createRoadmapPort,
} from "../../packages/director/dist/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NOW = "2026-08-19T00:00:00Z";
const AUTH_ID = "AION-APP-ROADMAP-CONTROL-V1-20260818T231945Z";

function scratch() {
  return mkdtempSync(join(tmpdir(), "aion-app-roadmap-"));
}

/** A roadmap with one milestone under real standing authority and one that needs the Owner. */
function seed(storeRoot, options = {}) {
  const port = createRoadmapPort({
    storeRoot,
    authorities: [],
    now: () => NOW,
    dispatch: () => ({ provider: "local", succeeded: true, failureClass: "NONE", detail: "ok", leaseId: "l", ambiguousExternalEffect: false }),
    verify: () => [],
    baselineSha: "test",
    currentHead: "test",
    currentDirectiveId: "TEST",
  });
  port.ensureRoadmap({
    roadmapId: "app-test-roadmap",
    ownerGoalSet: ["prove the app can drive the roadmap"],
    provenance: "focused app integration test",
    milestones: [
      {
        milestoneId: "safe-work",
        title: "Safe covered work",
        objective: "a harmless repository-reversible milestone",
        priority: 500,
        dependencies: [],
        ownerAuthorizationId: options.authorized === false ? null : AUTH_ID,
        authorityClass: "MILESTONE_AUTHORIZED",
        externalEffectClass: "REPOSITORY_REVERSIBLE",
        riskClasses: [],
        reviewPolicy: "NONE",
        allowedProviders: ["local"],
        provenance: "test",
      },
      {
        milestoneId: "needs-owner",
        title: "Needs an Owner decision",
        objective: "a milestone with no Owner authorization",
        priority: 900,
        dependencies: [],
        ownerAuthorizationId: null,
        authorityClass: "MILESTONE_AUTHORIZED",
        externalEffectClass: "NONE",
        riskClasses: ["SENSITIVE_DATA"],
        reviewPolicy: "INDEPENDENT",
        provenance: "stands in for the deferred history-access directive",
      },
    ],
  });
}

/** A control whose dispatch and verification are injected, so no provider process is involved. */
function control(storeRoot, overrides = {}) {
  return createRoadmapControl({
    repositoryRoot,
    storeRoot,
    now: () => NOW,
    dispatch: () => ({ provider: "local", succeeded: true, failureClass: "NONE", detail: "ok", leaseId: "l", ambiguousExternalEffect: false }),
    verify: (milestone) => milestone.verificationPlan.steps.map((s) => ({ step: s.name, result: "PASS", detail: "ok" })),
    ...overrides,
  });
}

function withStore(run) {
  const root = scratch();
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

test("status reports real stored roadmap state", () => {
  withStore((root) => {
    seed(root);
    const s = control(root).status();
    assert.equal(s.exists, true);
    assert.equal(s.state, "ACTIVE");
    assert.equal(s.paused, false);
    assert.equal(s.total, 2);
    assert.equal(s.readyCount, 2);
    assert.deepEqual(s.goals, ["prove the app can drive the roadmap"]);
    assert.ok(s.fingerprint.length > 0);
  });
});

test("an empty store reports no roadmap rather than inventing one", () => {
  withStore((root) => {
    const s = control(root).status();
    assert.equal(s.exists, false);
    assert.equal(s.total, 0);
    assert.equal(s.readyCount, 0);
    assert.equal(s.waitingOnOwner, false);
  });
});

test("current, ready, gates and workers each return their own bounded shape", () => {
  withStore((root) => {
    seed(root);
    const c = control(root);
    assert.equal(c.current().current, null, "nothing has run yet");
    assert.equal(c.ready().ready.length, 2);
    assert.equal(c.gates().gates.length, 0, "no gate exists until the loop evaluates authority");
    assert.deepEqual(c.workers().workers, [], "nothing is in flight");
    assert.deepEqual(c.recent(), { completed: [], stuck: [] });
  });
});

test("app loads cleanly with no active worker", () => {
  withStore((root) => {
    seed(root);
    const s = control(root).status();
    assert.deepEqual(s.workers, []);
    assert.equal(s.current, null);
  });
});

/* -------------------------------------------------------------------------- */
/* Continue, pause, resume                                                     */
/* -------------------------------------------------------------------------- */

test("Continue invokes the real port: safe covered work runs and the gated one waits", () => {
  withStore((root) => {
    seed(root);
    const result = control(root).continueRoadmap();

    assert.deepEqual([...result.completed], ["safe-work"], "standing-authority work executed");
    assert.deepEqual([...result.gated], ["needs-owner"], "the unauthorized milestone was gated, not run");
    assert.equal(result.ownerPrompts, 0, "no interactive Owner prompt in the chain");
    assert.equal(result.status.current.milestoneId, "safe-work");
    assert.equal(result.status.waitingOnOwner, true);

    // The gate is durable and readable afterwards.
    const gates = control(root).gates().gates;
    assert.equal(gates.length, 1);
    assert.equal(gates[0].milestoneId, "needs-owner");
    assert.equal(gates[0].status, "OPEN");
    assert.ok(gates[0].exactScope.length >= 3, "the gate says exactly what it is asking for");
  });
});

test("Continue surfaces an Owner gate and offers no way around it", () => {
  withStore((root) => {
    seed(root, { authorized: false });
    const result = control(root).continueRoadmap();
    assert.equal(result.completed.length, 0, "nothing ran without authority");
    assert.equal(result.gated.length, 2);

    const gate = control(root).gates().gates[0];
    // Whatever help the panel offers is text the Owner runs elsewhere; it is never an approval.
    if (gate.authorization !== null && gate.authorization !== undefined) {
      assert.match(gate.authorization.note, /computer running AION/);
      assert.equal(Object.hasOwn(gate.authorization, "approve"), false);
    }
    assert.equal(Object.hasOwn(gate, "approve"), false);
    assert.equal(gate.status, "OPEN");
  });
});

test("the Owner never picks a model: no provider appears in the request path", () => {
  withStore((root) => {
    seed(root);
    let sawProviderArgument = false;
    const c = control(root, {
      dispatch: (milestone) => {
        // The milestone carries its own provider constraint; the caller supplies none.
        sawProviderArgument = milestone.allowedProviders.length > 0;
        return { provider: "local", succeeded: true, failureClass: "NONE", detail: "ok", leaseId: "l", ambiguousExternalEffect: false };
      },
    });
    const result = c.continueRoadmap();
    assert.equal(result.completed.length, 1);
    assert.equal(sawProviderArgument, true, "the backend decided the provider from durable state");
    assert.equal(Object.hasOwn(result, "provider"), false, "no provider choice is returned to the browser");
  });
});

test("pause is durable and survives a fresh control instance", () => {
  withStore((root) => {
    seed(root);
    const paused = control(root).pause();
    assert.equal(paused.state, "PAUSED");
    assert.equal(paused.status.paused, true);

    // A new control over the same store — the equivalent of a page reload or a restart.
    const reloaded = control(root).status();
    assert.equal(reloaded.state, "PAUSED");
    assert.equal(reloaded.paused, true);

    const blocked = control(root).continueRoadmap();
    assert.equal(blocked.stopReason, "ROADMAP_NOT_ACTIVE");
    assert.equal(blocked.completed.length, 0, "a paused roadmap runs nothing");
  });
});

test("resume restores ACTIVE and survives a fresh control instance", () => {
  withStore((root) => {
    seed(root);
    control(root).pause();
    const resumed = control(root).resume();
    assert.equal(resumed.state, "ACTIVE");
    assert.equal(control(root).status().paused, false);
    assert.equal(control(root).continueRoadmap().completed.length, 1, "work runs again after resume");
  });
});

test("reload preserves completed work and does not re-run it", () => {
  withStore((root) => {
    seed(root);
    let dispatches = 0;
    const counting = () => control(root, {
      dispatch: () => {
        dispatches += 1;
        return { provider: "local", succeeded: true, failureClass: "NONE", detail: "ok", leaseId: "l", ambiguousExternalEffect: false };
      },
    });
    counting().continueRoadmap();
    assert.equal(dispatches, 1);

    const again = counting().continueRoadmap();
    assert.equal(dispatches, 1, "a reload must not re-dispatch completed work");
    assert.equal(again.completed.length, 0);

    assert.equal(createFileRoadmapStore(root).loadMilestone("safe-work").status, "COMPLETED");
    assert.deepEqual(control(root).recent().completed.map((m) => m.milestoneId), ["safe-work"]);
  });
});

test("a blocked milestone is reported as stuck rather than hidden", () => {
  withStore((root) => {
    seed(root);
    const store = createFileRoadmapStore(root);
    const milestone = store.loadMilestone("safe-work");
    store.saveMilestone({ ...milestone, status: "BLOCKED", blockedReason: "a person must look" });

    const stuck = control(root).recent().stuck;
    assert.equal(stuck.length, 1);
    assert.equal(stuck[0].status, "BLOCKED");
    assert.equal(stuck[0].blockedReason, "a person must look");
  });
});

/* -------------------------------------------------------------------------- */
/* What the surface must never allow                                           */
/* -------------------------------------------------------------------------- */

test("the verb table is closed and contains no authority-mutating or bypass verb", () => {
  for (const forbidden of [
    "roadmap.approveGate", "roadmap.grantAuthority", "roadmap.setAuthority", "roadmap.broadenAuthority",
    "roadmap.forceComplete", "roadmap.bypassVerification", "roadmap.bypassReview",
    "roadmap.activateProduction", "roadmap.invoke", "roadmap.exec", "roadmap.call",
  ]) {
    assert.equal(ROADMAP_VERBS_V1.includes(forbidden), false, `${forbidden} must not be routable`);
  }
  assert.deepEqual([...ROADMAP_VERBS_V1].sort(), [
    "roadmap.continue", "roadmap.current", "roadmap.gates", "roadmap.pause",
    "roadmap.ready", "roadmap.resume", "roadmap.status", "roadmap.workers",
  ]);
});

test("the control object exposes only the intended operations", () => {
  withStore((root) => {
    const surface = Object.keys(control(root)).sort();
    assert.deepEqual(surface, ["continueRoadmap", "current", "gates", "ready", "recent", "resume", "status", "workers", "pause"].sort());
    for (const forbidden of ["approveGate", "grantAuthority", "setAuthority", "forceComplete", "bypassReview", "bypassVerification", "saveMilestone", "saveGate"]) {
      assert.equal(surface.includes(forbidden), false, `${forbidden} must not exist on the control surface`);
    }
  });
});

test("the app server routes exactly the roadmap verbs and nothing adjacent", () => {
  const server = readFileSync(join(repositoryRoot, "apps", "aion", "server.mjs"), "utf8");
  for (const verb of ROADMAP_VERBS_V1) {
    assert.ok(server.includes(`case "${verb}"`), `server does not route ${verb}`);
  }
  for (const forbidden of ["roadmap.approveGate", "roadmap.forceComplete", "roadmap.grantAuthority", "roadmap.bypassReview"]) {
    assert.equal(server.includes(forbidden), false, `server must not route ${forbidden}`);
  }
  // An unknown verb still falls through to the closed default.
  assert.ok(server.includes('default: throw new Error("Unsupported Command Center action.")'));
});

test("responses carry no objectives, provenance, verification plans or filesystem paths", () => {
  withStore((root) => {
    seed(root);
    const c = control(root);
    c.continueRoadmap();
    const status = c.status();
    const blob = JSON.stringify({
      status, current: c.current(), ready: c.ready(),
      gates: c.gates(), workers: c.workers(), recent: c.recent(),
    });

    for (const leak of ["verificationPlan", "completionCriteria", "provenance", "takeoverPacket", "baselineSha", "requiredCapabilities"]) {
      assert.equal(blob.includes(leak), false, `response leaked ${leak}`);
    }

    // A milestone projection never carries its objective. The one place an objective legitimately
    // appears is inside a gate's exactScope, which exists so the Owner can see what they are being
    // asked to approve — withholding it there would make the gate unreviewable.
    const milestoneShapes = [...status.ready, ...(status.current ? [status.current] : []), ...c.recent().completed, ...c.recent().stuck];
    for (const shape of milestoneShapes) {
      assert.deepEqual(
        Object.keys(shape).sort(),
        ["blockedReason", "dependencies", "milestoneId", "priority", "status", "title"],
        "a milestone projection grew a field",
      );
    }
    const objectiveMentions = JSON.stringify({ ready: status.ready, current: status.current, workers: status.workers });
    assert.equal(objectiveMentions.includes("objective"), false, "an objective escaped outside a gate");
    // No host paths, and nothing that looks like Personal Context.
    assert.equal(/[A-Za-z]:\\\\/.test(blob), false, "response leaked a Windows path");
    assert.equal(blob.includes(".aion-local"), false, "response leaked a store path");
    assert.equal(blob.includes("personal-context"), false, "response referenced Personal Context");
  });
});

test("a response stays small enough to render on a phone", () => {
  withStore((root) => {
    seed(root);
    const c = control(root);
    c.continueRoadmap();
    const size = JSON.stringify(c.status()).length;
    assert.ok(size < 20_000, `status response is ${size} bytes, which is not a bounded panel payload`);
  });
});

test("the control refuses to be built without a repository root", () => {
  assert.throws(() => createRoadmapControl({}), /repositoryRoot/);
  assert.throws(() => createRoadmapControl({ repositoryRoot: "   " }), /repositoryRoot/);
});

/* -------------------------------------------------------------------------- */
/* Durable governance truth                                                     */
/* -------------------------------------------------------------------------- */

test("D2 remains GRANTED and the Owner standing authority records remain ACTIVE", () => {
  const d2 = JSON.parse(readFileSync(join(repositoryRoot, ".aion-local", "certifications", "d2", "state.json"), "utf8"));
  assert.equal(d2.d2Certification, "GRANTED");
  assert.equal(d2.d2CertifiedSha, "17b012b28d911fe563aab19f6e4a697a05b9b718");

  const authority = JSON.parse(
    readFileSync(join(repositoryRoot, ".aion-local", "owner-authority", `${AUTH_ID}.json`), "utf8"),
  );
  assert.equal(authority.state, "ACTIVE");
  assert.equal(authority.sensitiveDataPermission, "NO");
});
