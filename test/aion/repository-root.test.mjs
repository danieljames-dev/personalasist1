/**
 * A malformed repository root must cost nothing.
 *
 * On 2026-08-19T03:09Z a restart was invoked through a shell that consumed the backslash in
 * `C:\AION-HQ-main-integrate`. `aion-production.ps1` accepted the drive-relative
 * `C:AION-HQ-main-integrate`, stopped the healthy service, and wrote that path into the
 * AION-Production-Launch Scheduled Task. Node could not find the entry point, both start paths timed
 * out, and production stayed down until the task was rewritten by hand.
 *
 * `C:foo` is legal Windows syntax meaning "foo, relative to the current directory on drive C:". It
 * reads as absolute and resolves differently for every process, which is exactly why it has to be
 * rejected rather than normalized into something plausible.
 *
 * These tests run the real scripts. They deliberately never pass a *valid* root to a mutating action,
 * because a test that registers Scheduled Tasks or restarts production is not a test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWindows = process.platform === "win32";

function powershell(args) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

/** Run the shared validator directly and report what it decided. */
function validate(candidate, { requireMarkers = true } = {}) {
  const script = join(repositoryRoot, "scripts", "aion-repository-root.ps1");
  const result = powershell([
    "-Command",
    `. '${script}'; try { $r = Assert-AionRepositoryRoot -Path '${candidate}' -RequireRepositoryMarkers $${requireMarkers ? "true" : "false"}; "OK:$r" } catch { "THROW:" + $_.Exception.Message }`,
  ]);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

/** Invoke the production script with a bad root. Never with a good one — it controls production. */
function productionWithRoot(root, action = "status") {
  const script = join(repositoryRoot, "scripts", "aion-production.ps1");
  return powershell(["-File", script, "-Action", action, "-RepositoryRoot", root]);
}

function scheduledTaskArguments(name) {
  const result = powershell([
    "-Command",
    `$t = Get-ScheduledTask -TaskName '${name}' -ErrorAction SilentlyContinue; if ($t) { $t.Actions[0].Arguments } else { 'ABSENT' }`,
  ]);
  return `${result.stdout ?? ""}`.trim();
}

/* -------------------------------------------------------------------------- */
/* The validator                                                               */
/* -------------------------------------------------------------------------- */

test("a valid absolute repository root is accepted and normalized", { skip: !isWindows }, () => {
  const out = validate(repositoryRoot);
  assert.match(out, /^OK:/, `valid root was rejected: ${out}`);
  assert.ok(out.includes("AION-HQ"), out);
  assert.equal(out.endsWith("\\"), false, "the normalized root kept a trailing separator");
});

test("a trailing separator normalizes away rather than being rejected", { skip: !isWindows }, () => {
  const out = validate(`${repositoryRoot}\\`);
  assert.match(out, /^OK:/, out);
  assert.equal(out.endsWith("\\"), false);
});

test("the drive-relative form that caused the outage is rejected", { skip: !isWindows }, () => {
  const out = validate("C:AION-HQ-main-integrate");
  assert.match(out, /^THROW:/, "the exact input that took production down was accepted");
  assert.match(out, /drive-relative/);
  // The message has to name the fix, or the next person reaches for the same broken command.
  assert.match(out, /C:\\AION-HQ-main-integrate/);
});

test("relative and root-relative paths are rejected", { skip: !isWindows }, () => {
  for (const candidate of ["AION-HQ-main-integrate", ".\\AION-HQ", "..\\AION-HQ", "\\AION-HQ"]) {
    const out = validate(candidate);
    assert.match(out, /^THROW:/, `'${candidate}' was accepted as a repository root`);
    assert.match(out, /not a fully qualified Windows path|drive-relative/);
  }
});

test("an empty or whitespace root is rejected", { skip: !isWindows }, () => {
  for (const candidate of ["", "   "]) {
    const out = validate(candidate);
    assert.match(out, /^THROW:/, "an empty root was accepted");
    assert.match(out, /empty/i);
  }
});

test("a well-formed path that does not exist is rejected", { skip: !isWindows }, () => {
  const out = validate("C:\\AION-HQ-does-not-exist-9f3a1c");
  assert.match(out, /^THROW:/);
  assert.match(out, /does not exist/);
});

test("an existing directory that is not the AION repository is rejected", { skip: !isWindows }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "aion-root-check-"));
  try {
    const out = validate(scratch);
    assert.match(out, /^THROW:/, "an unrelated directory was accepted as the repository");
    assert.match(out, /does not look like the AION repository/);
    assert.match(out, /missing:/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("marker checking is what rejects a lookalike, and it can be turned off deliberately", { skip: !isWindows }, () => {
  const scratch = mkdtempSync(join(tmpdir(), "aion-root-markers-"));
  try {
    assert.match(validate(scratch, { requireMarkers: true }), /^THROW:/);
    assert.match(validate(scratch, { requireMarkers: false }), /^OK:/, "an existing directory should pass without marker checking");

    // With the markers present it passes even though it is not the real repository — the check is
    // "looks like the repository", and the test says so rather than implying it proves identity.
    mkdirSync(join(scratch, ".git"));
    mkdirSync(join(scratch, "scripts"));
    writeFileSync(join(scratch, "package.json"), "{}\n", "utf8");
    assert.match(validate(scratch, { requireMarkers: true }), /^OK:/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* The production script refuses before doing anything                         */
/* -------------------------------------------------------------------------- */

test("the production script exits non-zero on a drive-relative root", { skip: !isWindows }, () => {
  const result = productionWithRoot("C:AION-HQ-main-integrate", "status");
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${output}`);
  assert.match(output, /INVALID_REPOSITORY_ROOT/);
  assert.match(output, /drive-relative/);
});

test("an invalid root mutates no Scheduled Task and stops no service", { skip: !isWindows }, () => {
  const before = {
    launch: scheduledTaskArguments("AION-Production-Launch"),
    watchdog: scheduledTaskArguments("AION-Production-Watchdog"),
  };

  // `restart` is the action that took production down. It must now refuse before the stop.
  const result = productionWithRoot("C:AION-HQ-main-integrate", "restart");
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 2, output);
  assert.equal(output.includes("STOPPED"), false, "a service was stopped on an invalid root");
  assert.equal(output.includes("START_SCHEDULED_TASK"), false, "a task was started on an invalid root");

  const after = {
    launch: scheduledTaskArguments("AION-Production-Launch"),
    watchdog: scheduledTaskArguments("AION-Production-Watchdog"),
  };
  assert.deepEqual(after, before, "an invalid root changed a Scheduled Task");
  // Whatever the launch task holds, it must never hold the malformed form.
  assert.equal(after.launch.includes("C:AION-HQ-main-integrate\\"), false, "the malformed root reached a Scheduled Task");
});

test("every script that registers a Scheduled Task validates its root first", { skip: !isWindows }, () => {
  // Comment lines are stripped first. These scripts document their own mechanism in prose near the
  // top — `aion-production.ps1` names Register-ScheduledTask in its header comment — and a check that
  // could not tell a comment from a call would force the documentation to go quiet.
  const executableLines = (source) =>
    source.split(/\r?\n/).map((line) => (line.trim().startsWith("#") ? "" : line));

  for (const name of ["aion-production.ps1", "install-aion-autostart.ps1", "install-aion-watchdog.ps1"]) {
    const lines = executableLines(readFileSync(join(repositoryRoot, "scripts", name), "utf8"));
    const firstLineWith = (needle) => lines.findIndex((line) => line.includes(needle));

    const validationAt = firstLineWith("Assert-AionRepositoryRoot");
    assert.notEqual(validationAt, -1, `${name} does not validate its repository root`);

    for (const mutation of ["Register-ScheduledTask ", "schtasks /Create", "Stop-AionAll"]) {
      const mutationAt = firstLineWith(mutation);
      if (mutationAt === -1) continue;
      assert.ok(validationAt < mutationAt, `${name} reaches ${mutation.trim()} on line ${mutationAt + 1} before validating on line ${validationAt + 1}`);
    }
  }
});
