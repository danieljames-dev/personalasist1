/**
 * The autonomy status action.
 *
 * One read, wired the way `createGoalControl` is wired: a separate factory, so the roadmap
 * control's surface — which its own tests pin key by key — is untouched. The properties worth
 * pinning here are that it answers the Owner's question across businesses, and that it is the only
 * autonomy verb the app exposes.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTONOMY_STORE_RELATIVE_PATH,
  buildBusinessWorkspace,
  buildOwnerGoalIntent,
  buildStandingObjective,
  createFileAutonomyStore,
} from "../../packages/director/dist/index.js";
import { AUTONOMY_VERBS_V1, createAutonomyControl } from "../../apps/aion/roadmap-control.mjs";

const NOW = "2026-08-21T16:39:24Z";

test("autonomy.status reports the portfolio, and the verb list stays closed", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-autonomy-status-"));
  try {
    const storeRoot = join(root, ...AUTONOMY_STORE_RELATIVE_PATH.split("/"));
    const store = createFileAutonomyStore(storeRoot);

    for (const name of ["Compassionate Choice", "LocalFinds"]) {
      const business = buildBusinessWorkspace({ canonicalName: name, provenance: "Owner direction", now: NOW });
      store.saveBusiness(business);
      const intent = buildOwnerGoalIntent({
        text: "understand this business and identify the highest-value next actions",
        provenance: "Owner direction",
        now: NOW,
        milestones: [],
      });
      store.saveObjective(buildStandingObjective({ intent, businessId: business.businessId, now: NOW }));
    }

    const status = createAutonomyControl({ repositoryRoot: root }).status();
    assert.equal(status.businesses.length, 2);
    assert.deepEqual(
      status.businesses.map((b) => b.name).sort(),
      ["Compassionate Choice", "LocalFinds"],
    );
    assert.deepEqual(status.blocked, []);
    assert.deepEqual(status.recentlyCompleted, []);

    // The viewer must never present a category nobody recorded.
    for (const business of store.businesses()) assert.equal(business.category, null);

    assert.deepEqual([...AUTONOMY_VERBS_V1],
      ["autonomy.status", "autonomy.start", "autonomy.startWithResearch",
        "autonomy.pause", "autonomy.resume", "autonomy.answer"],
      "a closed list. `answer` carries the Owner's words and nothing that grades them: no state, no "
      + "confidence, no source class, no supersession target, no authority id. "
      + "`startWithResearch` is `start` preceded by a bounded public-research pass; it is separate "
      + "because a caller should have to ask for the network, and it exposes no research parameters "
      + "of its own — bounds, seeds and destinations are all decided server-side.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("autonomy control refuses to be constructed without a repository root", () => {
  assert.throws(() => createAutonomyControl({}), /repositoryRoot/u);
});
