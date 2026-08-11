/**
 * Bounded production soak harness.
 * Usage: node scripts/r70/production-soak.mjs [minutes]
 * Default 5 minutes (agent-safe); pass 60 for full hour when available.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const minutes = Math.max(1, Math.min(120, Number(process.argv[2]) || 5));
const intervalSec = 20;
const base = "http://127.0.0.1:31415";
const repo = "C:\\AION-HQ";
const logDir = join(repo, ".aion-local", "production");
mkdirSync(logDir, { recursive: true });
const soakLog = join(logDir, "soak.log");

function log(msg, extra = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), msg, ...extra });
  console.log(line);
  try {
    appendFileSync(soakLog, line + "\n");
  } catch {
    /* */
  }
}

async function health() {
  try {
    const r = await fetch(`${base}/`);
    return r.status === 200;
  } catch {
    return false;
  }
}

async function action(type, input = {}) {
  const r = await fetch(`${base}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, ...input }),
  });
  const j = await r.json();
  return { status: r.status, j };
}

function countNodes() {
  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'aion-command-center' }).Count",
    ],
    { encoding: "utf8" },
  );
  return Number(String(ps.stdout || "").trim()) || 0;
}

const deadline = Date.now() + minutes * 60_000;
const t0 = Date.now();
let checks = 0;
let healthFails = 0;
let maxDup = 0;
let actionFails = 0;

log("SOAK_START", { minutes, intervalSec });

if (!(await health())) {
  log("SOAK_ABORT", { reason: "not healthy at start" });
  process.exit(2);
}

while (Date.now() < deadline) {
  checks += 1;
  const ok = await health();
  if (!ok) healthFails += 1;
  const n = countNodes();
  if (n > maxDup) maxDup = n;
  if (n > 1) log("DUP_PROCESS", { n });

  // Every ~3 checks exercise safe read APIs
  if (checks % 3 === 0) {
    try {
      const daily = await action("executive.daily");
      if (daily.status !== 200 || daily.j?.error) actionFails += 1;
      const g = await action("connector.gmail.status");
      if (g.status !== 200 || g.j?.error) actionFails += 1;
      const p = await action("pilot.status");
      if (p.status !== 200) actionFails += 1;
    } catch {
      actionFails += 1;
    }
  }

  if (!ok) log("HEALTH_FAIL", { checks, healthFails });
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}

const elapsedMin = ((Date.now() - t0) / 60000).toFixed(2);
log("SOAK_END", {
  elapsedMin,
  checks,
  healthFails,
  actionFails,
  maxDup,
  ok: healthFails === 0 && actionFails === 0 && maxDup <= 1,
});

process.exit(healthFails === 0 && maxDup <= 1 ? 0 : 1);
