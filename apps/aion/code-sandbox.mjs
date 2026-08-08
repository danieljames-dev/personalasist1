import { spawn } from "node:child_process";
import {
  CODE_SANDBOX_RUNNER_DIGEST,
  CODE_SANDBOX_RUNNER_IMAGE,
} from "../../packages/local-assistant/dist/index.js";

/**
 * Docker-only behavioural code grading adapter.
 *
 * Evaluator composition only. Ordinary Chat never imports or resolves this module.
 * Domain package remains free of child_process / eval / vm for model code.
 */

const MAX_STDOUT = 64 * 1024;
const MAX_STDERR = 32 * 1024;

function scrubEnv() {
  return {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/tmp",
    NODE_ENV: "evaluation",
    LANG: "C.UTF-8",
  };
}

function runProcess(command, args, { timeoutMs, signal, env }) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: null, timedOut: false, aborted: true, stdout: "", stderr: "aborted" });
      return;
    }
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT) stdout += chunk.toString("utf8").slice(0, MAX_STDOUT - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8").slice(0, MAX_STDERR - stderr.length);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code: null, timedOut, aborted, stdout, stderr: String(error?.message || error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, timedOut, aborted, stdout, stderr });
    });
  });
}

async function dockerAvailable(signal) {
  const result = await runProcess("docker", ["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: 5000,
    signal,
    env: scrubEnv(),
  });
  return result.code === 0 && Boolean(result.stdout.trim());
}

async function imagePresent(signal) {
  const result = await runProcess("docker", ["image", "inspect", CODE_SANDBOX_RUNNER_IMAGE, "--format", "{{.Id}}"], {
    timeoutMs: 10_000,
    signal,
    env: scrubEnv(),
  });
  return result.code === 0 && Boolean(result.stdout.trim());
}

/**
 * Build a node -e program executed only inside the disposable container.
 * Host process never evals candidate code. Container gets no network, no mounts, scrubbed env.
 */
function buildHarness(code, testExpression) {
  const codeJson = JSON.stringify(String(code).slice(0, 50_000));
  const testJson = JSON.stringify(String(testExpression).slice(0, 4_000));
  // vm with timeout bounds runaway candidates; require is stubbed so host fs cannot be reached.
  return [
    `"use strict";`,
    `const vm = require("node:vm");`,
    `const __code = ${codeJson};`,
    `const __test = ${testJson};`,
    `const sandbox = {`,
    `  module: { exports: {} },`,
    `  exports: {},`,
    `  console: { log(){}, error(){}, warn(){} },`,
    `  Buffer,`,
    `  require(name) { throw new Error("require denied: " + name); },`,
    `  process: { env: {}, exit() { throw new Error("process.exit denied"); } },`,
    `};`,
    `sandbox.global = sandbox;`,
    `sandbox.globalThis = sandbox;`,
    `sandbox.exports = sandbox.module.exports;`,
    `vm.createContext(sandbox);`,
    `try { vm.runInContext(__code, sandbox, { timeout: 1500, displayErrors: true }); }`,
    `catch (error) { console.error(String(error && error.message ? error.message : error)); process.exit(2); }`,
    `let __ok = false;`,
    `try { __ok = Boolean(vm.runInContext(__test, sandbox, { timeout: 500, displayErrors: true })); }`,
    `catch (error) { console.error(String(error && error.message ? error.message : error)); process.exit(3); }`,
    `if (!__ok) { console.error("assertion failed"); process.exit(4); }`,
    `console.log("ok");`,
  ].join("");
}

/**
 * @returns {import('../../packages/local-assistant/dist/index.js').CodeSandboxPortV1}
 */
export function createDockerCodeSandboxV1() {
  return {
    async capability() {
      const engine = await dockerAvailable();
      if (!engine) {
        return {
          mode: "structural",
          available: false,
          detail: "Docker engine unavailable. Code cases use structural-only grading.",
          imageDigest: null,
          ownerAction: "Start Docker Desktop (or the Docker engine) if behavioural code grading is required.",
        };
      }
      const present = await imagePresent();
      if (!present) {
        return {
          mode: "structural",
          available: false,
          detail: `Docker engine available but pinned runner image missing: ${CODE_SANDBOX_RUNNER_IMAGE}`,
          imageDigest: null,
          ownerAction: `Pull the pinned image: docker pull ${CODE_SANDBOX_RUNNER_IMAGE}`,
        };
      }
      return {
        mode: "behavioural",
        available: true,
        detail: `Behavioural container grading available via ${CODE_SANDBOX_RUNNER_IMAGE}`,
        imageDigest: CODE_SANDBOX_RUNNER_DIGEST,
        ownerAction: null,
      };
    },
    async run(request) {
      if (request.signal?.aborted) {
        return { ok: false, timedOut: false, stdout: "", stderr: "aborted", detail: "sandbox aborted", mode: "behavioural" };
      }
      const cap = await this.capability();
      if (!cap.available) {
        return {
          ok: false,
          timedOut: false,
          stdout: "",
          stderr: cap.detail,
          detail: cap.detail,
          mode: "behavioural",
        };
      }

      const harness = buildHarness(request.code, request.testExpression);
      const args = [
        "run",
        "--rm",
        "--network=none",
        "--read-only",
        "--tmpfs", "/work:size=8m,mode=1777",
        "--workdir", "/work",
        "--memory=128m",
        "--pids-limit=32",
        "--cpus=0.5",
        "--cap-drop=ALL",
        "--security-opt", "no-new-privileges",
        "--user", "65534:65534",
        CODE_SANDBOX_RUNNER_IMAGE,
        "node",
        "-e",
        harness,
      ];

      const deadline = Math.max(500, Math.min(request.deadlineMs || 3000, 15_000));
      const result = await runProcess("docker", args, {
        timeoutMs: deadline,
        signal: request.signal,
        env: scrubEnv(),
      });

      if (result.aborted) {
        return { ok: false, timedOut: false, stdout: result.stdout, stderr: result.stderr, detail: "sandbox aborted", mode: "behavioural" };
      }
      if (result.timedOut) {
        return { ok: false, timedOut: true, stdout: result.stdout, stderr: result.stderr, detail: "terminated at deadline", mode: "behavioural" };
      }
      if (result.code === null && /docker/iu.test(result.stderr)) {
        return { ok: false, timedOut: false, stdout: result.stdout, stderr: result.stderr, detail: "Docker unavailable mid-run", mode: "behavioural" };
      }
      const ok = result.code === 0 && /\bok\b/u.test(result.stdout);
      return {
        ok,
        timedOut: false,
        stdout: result.stdout.slice(0, MAX_STDOUT),
        stderr: result.stderr.slice(0, MAX_STDERR),
        detail: ok ? "passed" : (result.stderr.trim() || `exit ${result.code}`),
        mode: "behavioural",
      };
    },
  };
}

export { CODE_SANDBOX_RUNNER_IMAGE, CODE_SANDBOX_RUNNER_DIGEST };
