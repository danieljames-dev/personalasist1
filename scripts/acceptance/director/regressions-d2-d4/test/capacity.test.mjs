import assert from "node:assert/strict";
import test from "node:test";
import {
  canStart,
  defectiveCapacityBypassesLease,
  defectiveLeaseBypassesCapacity,
} from "../lib/capacity-lease.mjs";

test("same executor at capacity cannot start even with a free lease", () => {
  const r = canStart({
    executor: "claude",
    runningByExecutor: { claude: 1 },
    resourceKey: "worktree:wt-b",
    heldResourceKeys: [],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "capacity-exhausted");
});

test("free capacity cannot start on a held resource key", () => {
  const r = canStart({
    executor: "grok",
    runningByExecutor: { grok: 0 },
    resourceKey: "worktree:wt-a",
    heldResourceKeys: ["worktree:wt-a"],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "lease-held");
});

test("nonconflicting executors and worktrees may both start", () => {
  const a = canStart({
    executor: "claude",
    runningByExecutor: {},
    resourceKey: "worktree:wt-claude",
    heldResourceKeys: [],
  });
  const b = canStart({
    executor: "grok",
    runningByExecutor: { claude: 1 },
    resourceKey: "worktree:wt-grok",
    heldResourceKeys: ["worktree:wt-claude"],
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("PRODUCTION_WRITER and INTEGRATION singletons collide by key", () => {
  const prod = canStart({
    executor: "local",
    resourceKey: "singleton:production-writer:default",
    heldResourceKeys: ["singleton:production-writer:default"],
  });
  const integ = canStart({
    executor: "local",
    resourceKey: "singleton:integration:repo",
    heldResourceKeys: ["singleton:integration:repo"],
  });
  assert.equal(prod.reason, "lease-held");
  assert.equal(integ.reason, "lease-held");
});

test("defective capacity-only and lease-only oracles fail the dual-gate property", () => {
  const held = {
    executor: "claude",
    runningByExecutor: { claude: 0 },
    resourceKey: "worktree:wt-a",
    heldResourceKeys: ["worktree:wt-a"],
  };
  assert.equal(defectiveCapacityBypassesLease(held).ok, true);
  assert.equal(canStart(held).ok, false);

  const full = {
    executor: "claude",
    runningByExecutor: { claude: 1 },
    resourceKey: "worktree:wt-b",
    heldResourceKeys: [],
  };
  assert.equal(defectiveLeaseBypassesCapacity(full).ok, true);
  assert.equal(canStart(full).ok, false);
});
