import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * AION's own bounded verification runner.
 *
 * Every operation below is a frozen record with a fixed argument vector written here, in the
 * repository, by hand. Nothing in this file accepts, parses, concatenates, or interpolates a
 * caller-supplied string into a command: `run` takes an operation *identifier* and looks it up.
 * That is what lets AION answer "run the tests and tell me what failed" without ever granting a
 * conversational developer agent shell access or write permission.
 *
 * Processes are spawned with `shell: false` and an explicit argument array. npm is invoked through
 * its own CLI entry point under the running Node installation rather than through a `.cmd` shim,
 * so no shell interpreter is involved on Windows either.
 */

const OUTPUT_LIMIT = 64 * 1024;

/** Resolves npm's CLI entry point next to the running Node binary. No PATH lookup, no shim. */
function npmCliPath() {
  const candidate = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(candidate) ? candidate : null;
}

/**
 * The complete allowlist. Each entry names the executable and the exact arguments. `readOnly` is
 * asserted by the test suite: an operation that could modify the repository does not belong here.
 */
function operationTable(repositoryRoot) {
  const npm = npmCliPath();
  const npmRun = (script) => (npm ? { file: process.execPath, args: Object.freeze([npm, "run", script]) } : null);
  const table = [
    {
      id: "git.status", label: "Git status", readOnly: true,
      description: "Show the working-tree status of the approved repository.",
      displayCommand: "git status --short", timeoutMs: 60_000,
      spawn: { file: "git", args: Object.freeze(["status", "--short"]) },
    },
    {
      id: "git.diff.check", label: "Git whitespace check", readOnly: true,
      description: "Report whitespace errors and conflict markers in the working tree.",
      displayCommand: "git diff --check", timeoutMs: 60_000,
      spawn: { file: "git", args: Object.freeze(["diff", "--check"]) },
    },
    {
      id: "npm.verify", label: "Full repository verification", readOnly: true,
      description: "Type-check every workspace and run the complete test suite.",
      displayCommand: "npm run verify", timeoutMs: 1_500_000,
      spawn: npmRun("verify"),
    },
    {
      id: "npm.aion.demo", label: "AION synthetic product demo", readOnly: true,
      description: "Run the complete synthetic Command Center proof in temporary directories.",
      displayCommand: "npm run aion:demo", timeoutMs: 600_000,
      spawn: npmRun("aion:demo"),
    },
    {
      id: "npm.career.demo", label: "Career synthetic demo", readOnly: true,
      description: "Run the accepted Career engine end to end on neutral synthetic data.",
      displayCommand: "npm run career:demo", timeoutMs: 600_000,
      spawn: npmRun("career:demo"),
    },
    {
      id: "npm.audit", label: "Dependency audit", readOnly: true,
      description: "Report dependency vulnerabilities at high severity or above.",
      displayCommand: "npm audit --audit-level=high", timeoutMs: 300_000,
      spawn: npm ? { file: process.execPath, args: Object.freeze([npm, "audit", "--audit-level=high"]) } : null,
    },
  ];
  return Object.freeze(table.filter((operation) => operation.spawn).map((operation) => Object.freeze({ ...operation, repositoryRoot })));
}

function bound(text) {
  const value = String(text ?? "");
  return value.length > OUTPUT_LIMIT ? { text: value.slice(-OUTPUT_LIMIT), truncated: true } : { text: value, truncated: false };
}

export class AllowlistedVerificationRunnerV1 {
  #operations;
  #repositoryRoot;
  #digest;
  constructor(repositoryRoot, digest) {
    this.#repositoryRoot = repositoryRoot;
    this.#operations = operationTable(repositoryRoot);
    this.#digest = digest;
  }
  operations() {
    return this.#operations.map(({ id, label, description, displayCommand, timeoutMs, readOnly }) => ({ id, label, description, displayCommand, timeoutMs, readOnly }));
  }
  get(id) {
    const found = this.#operations.find((operation) => operation.id === id);
    return found ? { id: found.id, label: found.label, description: found.description, displayCommand: found.displayCommand, timeoutMs: found.timeoutMs, readOnly: found.readOnly } : null;
  }
  /** Runs one allowlisted operation. The identifier is looked up; it is never used to build a command. */
  run(id, signal) {
    const operation = this.#operations.find((entry) => entry.id === id);
    if (!operation) throw new Error("Verification operation is not on the allowlist.");
    const startedAt = new Date();
    return new Promise((resolve, reject) => {
      const child = execFile(operation.spawn.file, [...operation.spawn.args], {
        cwd: this.#repositoryRoot, timeout: operation.timeoutMs, maxBuffer: 8 * 1024 * 1024,
        windowsHide: true, shell: false,
      }, (error, stdout, stderr) => {
        const completed = new Date();
        const out = bound(stdout);
        const err = bound(stderr);
        const timedOut = Boolean(error && error.killed);
        const exitCode = error ? (typeof error.code === "number" ? error.code : -1) : 0;
        if (error && error.code === "ENOENT") return reject(new Error("The verification tool is not available on this computer."));
        resolve({
          operationId: operation.id, displayCommand: operation.displayCommand,
          startedAt: startedAt.toISOString(), completedAt: completed.toISOString(),
          durationMs: completed.getTime() - startedAt.getTime(),
          exitCode, timedOut, outcome: exitCode === 0 && !timedOut ? "passed" : "failed",
          stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated,
          resultDigest: this.#digest({ operationId: operation.id, exitCode, stdout: out.text, stderr: err.text }),
        });
      });
      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });
      child.once("close", () => signal?.removeEventListener("abort", abort));
    });
  }
}
