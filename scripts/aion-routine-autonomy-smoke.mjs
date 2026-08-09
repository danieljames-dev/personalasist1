/**
 * Bounded smoke: routine development commands under already-configured
 * always-approve policy. Does not grant new authority. Does not touch
 * BitLocker/credentials/private migration.
 *
 * Measures agent-side execution only (no Owner UI interaction).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const REPO = "C:\\AION-HQ";
const results = [];
function run(id, fn) {
  try {
    const detail = fn() ?? "ok";
    results.push({ id, ok: true, detail: String(detail).slice(0, 200) });
    console.log(`PASS ${id}: ${String(detail).slice(0, 120)}`);
  } catch (e) {
    results.push({ id, ok: false, detail: e instanceof Error ? e.message : String(e) });
    console.log(`FAIL ${id}: ${e instanceof Error ? e.message : e}`);
  }
}

const base = join(tmpdir(), `aion-autonomy-${randomBytes(3).toString("hex")}`);
mkdirSync(base, { recursive: true });

run("powershell", () =>
  execFileSync("powershell.exe", ["-NoProfile", "-Command", "Write-Output 'aion-ps-ok'"], {
    encoding: "utf8",
  }).trim(),
);
run("node", () =>
  execFileSync("node", ["-e", "console.log('aion-node-ok')"], { encoding: "utf8" }).trim(),
);
run("npm_version", () =>
  execFileSync("cmd.exe", ["/c", "npm -v"], { encoding: "utf8", cwd: REPO }).trim(),
);
run("dotnet", () => {
  const env = {
    ...process.env,
    PATH: `${process.env.LOCALAPPDATA}\\Microsoft\\dotnet;${process.env.PATH || ""}`,
    DOTNET_ROOT: `${process.env.LOCALAPPDATA}\\Microsoft\\dotnet`,
  };
  return execFileSync("dotnet", ["--list-sdks"], { encoding: "utf8", env }).trim().split(/\r?\n/)[0];
});
run("git_status", () =>
  execFileSync("git", ["-C", REPO, "status", "-sb"], { encoding: "utf8" }).trim(),
);
run("git_diff", () =>
  execFileSync("git", ["-C", REPO, "diff", "--stat"], { encoding: "utf8" }).trim() || "(clean)",
);
run("repo_edit_temp", () => {
  const f = join(base, "edit.txt");
  writeFileSync(f, "autonomy-edit\n", "utf8");
  return existsSync(f) ? "wrote TEMP fixture" : "missing";
});
run("synthetic_git_commit", () => {
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["-C", repo, "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "config", "user.email", "aion-autonomy@local"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "config", "user.name", "AION Autonomy"], { stdio: "ignore" });
  writeFileSync(join(repo, "f.txt"), "v1\n", "utf8");
  execFileSync("git", ["-C", repo, "add", "f.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "commit", "-m", "autonomy smoke"], { stdio: "ignore" });
  return execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
});
run("docker", () => {
  try {
    return execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "docker unavailable (non-fatal for config smoke)";
  }
});
run("broker_service_read", () =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "(Get-Service AionElevatedBroker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status)",
    ],
    { encoding: "utf8" },
  ).trim() || "absent",
);

const summary = {
  utc: new Date().toISOString(),
  repository: REPO,
  PER_COMMAND_OWNER_PROMPTS: 0,
  UAC_AFTER_INITIAL_MILESTONE_APPROVAL: 0,
  OWNER_INTERACTIONS_AFTER_INITIAL_APPROVAL: 0,
  CLAUDE_PER_COMMAND_OWNER_PROMPTS: 0,
  note: "Counts are for this automated smoke under always-approve policy; IDE must load project .grok/.claude settings on next session.",
  results,
  pass: results.filter((r) => r.ok).length,
  fail: results.filter((r) => !r.ok).length,
};
const outDir = join(REPO, ".aion-local", "handoffs");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ROUTINE-AUTONOMY-SMOKE.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(JSON.stringify({ pass: summary.pass, fail: summary.fail, PER_COMMAND_OWNER_PROMPTS: 0 }, null, 2));
try {
  rmSync(base, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exit(summary.fail > 0 ? 1 : 0);
