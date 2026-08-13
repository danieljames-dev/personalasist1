import assert from "node:assert/strict";
import test from "node:test";
import { discoverClaude, discoverGrok } from "../lib/discover-clis.mjs";
import { smokeClaude, smokeGrok } from "../probes/cli-smoke.mjs";

test("Claude --version/--help probe without a model call", () => {
  const d = discoverClaude();
  assert.ok(d.path, `Claude unavailable: ${d.reason || d.via}`);
  const s = smokeClaude({ skipModel: true });
  assert.ok(s.cases.version);
  assert.ok(s.cases.version.status === 0 || s.cases.version.stdout, JSON.stringify(s.cases.version).slice(0, 400));
  assert.ok(s.flags.print || s.flags.outputFormat, JSON.stringify(s.flags));
  assert.equal(s.cases.missingExe.status === 0, false);
});

test("Grok --version/--help lists prompt-file cwd json-schema permission-mode", () => {
  const d = discoverGrok();
  assert.ok(d.path, `Grok unavailable: ${d.reason || d.via}`);
  const s = smokeGrok({ skipModel: true });
  assert.ok(s.cases.version.status === 0 || s.cases.version.stdout);
  assert.equal(s.flags.promptFile, true);
  assert.equal(s.flags.cwd, true);
  assert.equal(s.flags.outputFormat, true);
  assert.equal(s.flags.jsonSchema, true);
  assert.equal(s.flags.permissionMode, true);
});

test("one optional print-mode smoke per CLI is recorded; timeout is FINDINGS not spend", () => {
  const c = smokeClaude();
  const g = smokeGrok();
  const claudeTurn = c.cases.printPrompt || {};
  const grokTurn = g.cases.promptFileDontAsk || {};
  assert.ok("status" in claudeTurn || claudeTurn.timedOut);
  assert.ok("status" in grokTurn || grokTurn.timedOut);
});
