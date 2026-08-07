import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import test from "node:test";
import { claudeCodeCandidates, developerAgentCandidates, resolveDeveloperAgentBridge, resolveDeveloperAgentBridges } from "../../apps/aion/developer-agent.mjs";

const repositoryRoot = process.cwd();
const absentEnvironment = { AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\definitely\\absent\\codex.exe", AION_CLAUDE_CODE_PATH: "C:\\synthetic\\definitely\\absent\\claude.exe" };

test("developer-agent discovery checks only a small fixed list of documented absolute paths", () => {
  const candidates = developerAgentCandidates({ APPDATA: "C:\\synthetic\\AppData\\Roaming", npm_config_prefix: "C:\\synthetic\\prefix" }, "win32", "x64");
  assert.ok(candidates.length > 0 && candidates.length <= 8, "discovery stays a short explicit list, never a scan");
  for (const candidate of candidates) {
    assert.ok(isAbsolute(candidate), "every candidate is an absolute path");
    assert.match(candidate, /codex\.exe$/u, "only a real executable is considered");
  }
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh)$/u.test(c)), false, "shell shims are never used");
});

test("Claude Code discovery is an equally short list of documented executables, never a scan", () => {
  const candidates = claudeCodeCandidates({}, "win32", "C:\\synthetic\\home");
  assert.ok(candidates.length > 0 && candidates.length <= 8, "discovery stays a short explicit list, never a scan");
  for (const candidate of candidates) {
    assert.ok(isAbsolute(candidate), "every candidate is an absolute path");
    assert.match(candidate, /claude\.exe$/u, "only a real executable is considered");
  }
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh|js|mjs|cjs)$/u.test(c)), false, "shell shims and script entry points are never used");
  assert.deepEqual(claudeCodeCandidates({}, "win32", "relative-home"), [], "an unusable home directory yields no candidate");
});

test("an owner override is honoured only when it is an explicit normalized absolute path", () => {
  const relative = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "..\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(relative.some((c) => c.includes("..")), false, "a relative override is rejected");
  const absolute = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\codex\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(absolute[0], "C:\\synthetic\\codex\\codex.exe", "an explicit override is checked first");
  const claudeRelative = claudeCodeCandidates({ AION_CLAUDE_CODE_PATH: "..\\claude.exe" }, "win32", "C:\\synthetic\\home");
  assert.equal(claudeRelative.some((c) => c.includes("..")), false, "a relative Claude override is rejected");
  assert.equal(claudeCodeCandidates({ AION_CLAUDE_CODE_PATH: "C:\\synthetic\\claude\\claude.exe" }, "win32", "C:\\synthetic\\home")[0], "C:\\synthetic\\claude\\claude.exe");
});

test("discovery finds nothing when no documented location exists and reports unavailable truthfully", async () => {
  assert.deepEqual(developerAgentCandidates({}, "win32", "x64"), [], "no environment means no Codex candidate");
  const bridge = await resolveDeveloperAgentBridge(repositoryRoot, absentEnvironment);
  const status = await bridge.status();
  assert.equal(typeof status.available, "boolean");
  if (!status.available) {
    assert.equal(status.executable, null);
    assert.match(status.detail, /does not search your computer|is available on this computer/u);
  }
});

test("the registry reports every bridge, and an unregistered selection fails closed", async () => {
  const registry = await resolveDeveloperAgentBridges(repositoryRoot, absentEnvironment);
  assert.ok(registry.list().length >= 1, "there is always at least a truthful unavailable bridge");
  assert.equal(new Set(registry.list().map((bridge) => bridge.id)).size, registry.list().length, "bridge identifiers are unique");
  assert.equal(registry.selected(), registry.list()[0], "the default selection is AION's first preference");
  assert.throws(() => registry.select("definitely-not-installed"), /not registered/iu);
  registry.select("");
  assert.equal(registry.selected(), registry.list()[0], "an empty selection restores the default");
});

test("a resolved bridge refuses tasks aimed outside the one approved repository root", async () => {
  const bridge = await resolveDeveloperAgentBridge(repositoryRoot);
  const foreign = process.platform === "win32" ? "C:\\synthetic\\elsewhere" : "/synthetic/elsewhere";
  await assert.rejects(bridge.run({ repositoryRoot: foreign, instruction: "Do something", mode: "read-only" }, new AbortController().signal), /approved repository root|available|configured/iu);
  await assert.rejects(bridge.run({ repositoryRoot, instruction: "   ", mode: "read-only" }, new AbortController().signal), /instruction is invalid|available|configured/iu);
});

test("no part of a task instruction can ever become an argument or shell text", async () => {
  const registry = await resolveDeveloperAgentBridges(repositoryRoot);
  for (const bridge of registry.list()) {
    const status = await bridge.status();
    for (const mode of status.modes) {
      const { executable, args } = bridge.describe(mode);
      assert.equal(typeof executable, "string");
      assert.doesNotMatch(executable, /[A-Za-z]:\\|\//u, "the bridge reports an executable name, never a local path");
      for (const arg of args) assert.equal(typeof arg, "string");
      assert.doesNotMatch(args.join(" "), /[A-Za-z]:\\/u, "no local path appears in the disclosed command");
      assert.equal(args.some((arg) => /^(?:-c|--config|--dangerously|--allow-dangerously|--full-auto)/u.test(arg)), false, "no bypass flag is ever used");
    }
    if (status.modes.includes("read-only")) {
      const readOnly = bridge.describe("read-only").args.join(" ");
      const writing = bridge.describe("workspace-write").args.join(" ");
      assert.notEqual(readOnly, writing, "the two boundaries are genuinely different commands");
      assert.doesNotMatch(readOnly, /workspace-write|danger-full-access|bypassPermissions/u, "a read-only task never asks for write or bypass authority");
    }
  }
});
