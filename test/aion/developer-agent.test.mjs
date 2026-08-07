import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import test from "node:test";
import { developerAgentCandidates, resolveDeveloperAgentBridge } from "../../apps/aion/developer-agent.mjs";

const repositoryRoot = process.cwd();

test("developer-agent discovery checks only a small fixed list of documented absolute paths", () => {
  const candidates = developerAgentCandidates({ APPDATA: "C:\\synthetic\\AppData\\Roaming", npm_config_prefix: "C:\\synthetic\\prefix" }, "win32", "x64");
  assert.ok(candidates.length > 0 && candidates.length <= 8, "discovery stays a short explicit list, never a scan");
  for (const candidate of candidates) {
    assert.ok(isAbsolute(candidate), "every candidate is an absolute path");
    assert.match(candidate, /codex\.exe$/u, "only a real executable is considered");
  }
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh)$/u.test(c)), false, "shell shims are never used");
});

test("an owner override is honoured only when it is an explicit normalized absolute path", () => {
  const relative = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "..\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(relative.some((c) => c.includes("..")), false, "a relative override is rejected");
  const absolute = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\codex\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(absolute[0], "C:\\synthetic\\codex\\codex.exe", "an explicit override is checked first");
});

test("discovery finds nothing when no documented location exists and reports unavailable truthfully", async () => {
  assert.deepEqual(developerAgentCandidates({}, "win32", "x64"), [], "no environment means no candidate");
  const bridge = await resolveDeveloperAgentBridge(repositoryRoot, { AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\definitely\\absent\\codex.exe" });
  const status = await bridge.status();
  assert.equal(typeof status.available, "boolean");
  if (!status.available) {
    assert.equal(status.executable, null);
    assert.match(status.detail, /does not search your computer/u);
  }
});

test("a resolved bridge refuses tasks aimed outside the one approved repository root", async () => {
  const bridge = await resolveDeveloperAgentBridge(repositoryRoot);
  await assert.rejects(bridge.run({ repositoryRoot: process.platform === "win32" ? "C:\\synthetic\\elsewhere" : "/synthetic/elsewhere", instruction: "Do something" }, new AbortController().signal), /approved boundary|available/iu);
  await assert.rejects(bridge.run({ repositoryRoot, instruction: "   " }, new AbortController().signal), /approved boundary|available/iu);
});
