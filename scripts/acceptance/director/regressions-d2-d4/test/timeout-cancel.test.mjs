import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSafe } from "../lib/spawn-safe.mjs";
import { cancelRun, processAlive, taskkillTree } from "../lib/cancel-tree.mjs";

const hang = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "hang-child.cjs");

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test("killing only the root leaves a detached grandchild (defective cancel)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-cancel-"));
  const marker = join(dir, "child.pid");
  const root = spawnSafe(process.execPath, [hang, "tree", marker], { stdio: ["ignore", "ignore", "ignore"] });
  let childPid = null;
  for (let i = 0; i < 30 && !childPid; i += 1) {
    await wait(100);
    try { childPid = Number(readFileSync(marker, "utf8")); } catch { /* not yet */ }
  }
  assert.ok(childPid, "grandchild pid marker missing");
  try { root.kill(); } catch { /* ignore */ }
  await wait(400);
  const orphaned = processAlive(childPid);
  assert.equal(orphaned, true, "if grandchild died with root, this host does not demonstrate the tree leak");
  taskkillTree(childPid);
  await wait(400);
  assert.equal(processAlive(childPid), false);
});

test("hard tree cancel stops the tracked pid within bound", async () => {
  const child = spawnSafe(process.execPath, [hang, "self"], { stdio: ["ignore", "ignore", "ignore"] });
  const pid = child.pid;
  assert.ok(pid);
  await wait(200);
  const result = await cancelRun({ child, pid, softMs: 200, hardMs: 4000 });
  assert.ok(result.stage === "SOFT" || result.stage === "HARD", JSON.stringify(result));
  assert.equal(result.alive, false);
  assert.equal(processAlive(pid), false);
});
