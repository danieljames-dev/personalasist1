import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("production ensure never kills alive+listening process (HOLD_ALIVE_DEGRADED)", async () => {
  const ps1 = await readFile(join(root, "scripts", "aion-production.ps1"), "utf8");
  assert.match(ps1, /HOLD_ALIVE_DEGRADED/);
  assert.match(ps1, /ENSURE_HOLD_DEGRADED/);
  assert.match(ps1, /will NOT kill|refusing kill|alive\+listen/i);
  // CLEANUP_STALE only when no healthy alive+listen pair
  assert.match(ps1, /CLEANUP_STALE \(no healthy alive\+listen pair\)/);
});

test("command center has lifecycle exit logging and single-instance lock", async () => {
  const cc = await readFile(join(root, "apps", "aion-command-center.mjs"), "utf8");
  assert.match(cc, /uncaughtException/);
  assert.match(cc, /unhandledRejection/);
  assert.match(cc, /INSTANCE_LOCK|instance\.lock/);
  assert.match(cc, /process\.log/);
  assert.match(cc, /BEFORE_EXIT|EXIT/);
  assert.doesNotMatch(cc, /AION_GMAIL_CLIENT_SECRET|refresh_token|client_secret/i);
});

test("production launch prefers scheduled task breakaway (not redirected Start-Process)", async () => {
  const ps1 = await readFile(join(root, "scripts", "aion-production.ps1"), "utf8");
  assert.match(ps1, /AION-Production-Launch/);
  // Register-ScheduledTask (not schtasks /TR) — Program Files path quoting is safe
  assert.match(ps1, /Register-ScheduledTask/);
  assert.match(ps1, /New-ScheduledTaskAction/);
  assert.match(ps1, /HOLD_ALIVE_DEGRADED/);
  assert.match(ps1, /START_FALLBACK_WScript|START_FALLBACK WScript/);
  // Primary launch path must not RedirectStandardOutput (pipe-kill from short-lived parent)
  const startFn = ps1.slice(ps1.indexOf("function Start-AionDetached"), ps1.indexOf("function Status-Aion"));
  assert.doesNotMatch(startFn, /RedirectStandardOutput/);
  // Do not use nested PowerShell Start-Process as primary (Job Object inheritance)
  assert.doesNotMatch(startFn, /START_NESTED_PS/);
});
