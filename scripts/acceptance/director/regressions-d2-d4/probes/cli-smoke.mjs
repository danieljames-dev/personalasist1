/**
 * Harmless real CLI smokes. Subscription CLIs only. No paid API keys.
 */
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSafeSync } from "../lib/spawn-safe.mjs";
import { discoverClaude, discoverGrok } from "../lib/discover-clis.mjs";

function run(exe, argv, opts = {}) {
  const started = Date.now();
  const r = spawnSafeSync(exe, argv, {
    timeout: opts.timeout ?? 25_000,
    cwd: opts.cwd,
    env: { CI: "1", CLAUDE_CODE_SIMPLE: "1", ...(opts.env || {}) },
  });
  return {
    status: r.status,
    signal: r.signal,
    timedOut: Boolean(r.error && /TIMEOUT/i.test(r.error.code || r.error.message || "")),
    error: r.error ? r.error.message : null,
    stdout: (r.stdout || "").slice(0, 4000),
    stderr: (r.stderr || "").slice(0, 4000),
    ms: Date.now() - started,
    argv,
  };
}

export function smokeClaude(opts = {}) {
  const d = discoverClaude();
  const out = { discovery: d, cases: {} };
  if (!d.path) {
    out.cases.missing = { status: null, note: "UNAVAILABLE" };
    return out;
  }
  out.cases.version = run(d.path, ["--version"], { timeout: 12_000 });
  out.cases.help = run(d.path, ["--help"], { timeout: 15_000 });
  const help = `${out.cases.help.stdout}\n${out.cases.help.stderr}`.toLowerCase();
  out.flags = {
    print: help.includes("-p") || help.includes("print"),
    outputFormat: help.includes("output-format"),
    jsonSchema: help.includes("json-schema"),
    permissionMode: help.includes("permission-mode"),
    sessionId: help.includes("session-id"),
  };
  const scratch = mkdtempSync(join(tmpdir(), "aion-claude-smoke-"));
  const prompt = join(scratch, "prompt.txt");
  writeFileSync(prompt, "Reply with the single word PONG and nothing else.");
  if (!opts.skipModel) {
    out.cases.printPrompt = run(d.path, ["-p", "--output-format", "text", prompt], {
      timeout: 40_000,
      cwd: scratch,
    });
  }
  out.cases.invalidCwd = run(d.path, ["--version"], {
    timeout: 12_000,
    cwd: join(scratch, "does-not-exist"),
  });
  out.cases.missingExe = run(join(scratch, "no-such-claude.exe"), ["--version"], { timeout: 5000 });
  return out;
}

export function smokeGrok(opts = {}) {
  const d = discoverGrok();
  const out = { discovery: d, cases: {} };
  if (!d.path) {
    out.cases.missing = { status: null, note: "UNAVAILABLE" };
    return out;
  }
  out.cases.version = run(d.path, ["--version"], { timeout: 12_000 });
  out.cases.help = run(d.path, ["--help"], { timeout: 15_000 });
  const help = `${out.cases.help.stdout}\n${out.cases.help.stderr}`.toLowerCase();
  out.flags = {
    promptFile: help.includes("--prompt-file"),
    cwd: help.includes("--cwd"),
    outputFormat: help.includes("--output-format"),
    jsonSchema: help.includes("--json-schema"),
    permissionMode: help.includes("--permission-mode"),
  };
  const scratch = mkdtempSync(join(tmpdir(), "aion-grok-smoke-"));
  const prompt = join(scratch, "prompt.md");
  writeFileSync(prompt, "Reply with the single word PONG and nothing else. Do not edit files.");
  if (!opts.skipModel) {
    out.cases.promptFileDontAsk = run(d.path, [
      "-p",
      "--prompt-file", prompt,
      "--output-format", "text",
      "--permission-mode", "dontAsk",
      "--cwd", scratch,
      "--max-turns", "1",
    ], { timeout: 45_000, cwd: scratch });
  }
  out.cases.invalidCwd = run(d.path, ["--version"], {
    timeout: 12_000,
    cwd: join(scratch, "does-not-exist"),
  });
  out.cases.missingPromptFile = run(d.path, [
    "-p",
    "--prompt-file", join(scratch, "missing.md"),
    "--permission-mode", "dontAsk",
    "--max-turns", "1",
  ], { timeout: 20_000, cwd: scratch });
  return out;
}

const invoked = process.argv[1] && /cli-smoke\.mjs$/i.test(process.argv[1]);
if (invoked) {
  const which = process.argv[2] || "both";
  const report = {};
  if (which === "claude" || which === "both") report.claude = smokeClaude();
  if (which === "grok" || which === "both") report.grok = smokeGrok();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
