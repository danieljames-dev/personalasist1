import assert from "node:assert/strict";
import test from "node:test";
import { discoverClaude, discoverGrok, discoverLocal } from "../lib/discover-clis.mjs";

test("Claude discovery is deterministic and fail-closed", () => {
  const d = discoverClaude();
  assert.ok(d.via);
  if (d.path) {
    assert.match(d.path, /claude\.exe$/i);
    assert.ok(d.probe.ok, d.probe.versionText || "version probe failed");
    assert.ok(!/\.(cmd|ps1)$/i.test(d.path));
  } else {
    assert.equal(d.via, "UNAVAILABLE");
    assert.ok(d.reason);
  }
});

test("Grok discovery is deterministic and fail-closed", () => {
  const d = discoverGrok();
  if (d.path) {
    assert.match(d.path, /grok\.exe$/i);
    assert.ok(d.probe.ok, d.probe.versionText || "version probe failed");
  } else {
    assert.equal(d.via, "UNAVAILABLE");
  }
});

test("local node identity is the running executable", () => {
  const l = discoverLocal();
  assert.equal(l.node.path, process.execPath);
});
