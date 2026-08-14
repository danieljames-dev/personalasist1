/**
 * Persist-before-spawn, and the questions a reboot has to answer without a process.
 *
 * The ordering is the property. A test that only checks the JSON shape stays green while spawn
 * still happens after a failed write, and while a crash between persist and spawn still looks like
 * "we never tried".
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExecutorProcessIdentityV1 } from "../src/process-identity.js";
import {
  answersAfterReboot,
  isSpawnPermit,
  persistRunIntent,
  readRunIntent,
  recordSpawnAttempt,
  recordSpawnObservation,
  requireSpawnPermit,
  RUN_INTENT_SCHEMA_V1,
  withPersistedIntent,
  type IntentStoreV1,
  type PersistRunIntentInputV1,
  type SpawnPermitV1,
} from "../src/run-intent.js";

const NOW = "2026-08-13T12:00:00.000Z";
const SPAWNED_AT = "2026-08-13T12:00:01.000Z";
const EXE = "C:\\Tools\\grok.exe";
const NONCE = "nonce-9f3c2a1b7e44";

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "aion-run-intent-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function inputIn(dir: string, over: Partial<PersistRunIntentInputV1> = {}): PersistRunIntentInputV1 {
  return {
    intentPath: join(dir, "intent.json"),
    runId: "run-1",
    missionId: "mission-1",
    workItemId: "work-1",
    worktree: dir,
    branch: "executor/grok-director-d2",
    executablePath: EXE,
    argv: ["--prompt-file", join(dir, "PROMPT.md"), "--cwd", dir],
    cwd: dir,
    runNonce: NONCE,
    now: NOW,
    promptPath: join(dir, "PROMPT.md"),
    ...over,
  };
}

const IDENTITY: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: "2026-08-13T12:00:01.100Z",
  executablePath: EXE,
  runNonce: NONCE,
};

function failingStore(reason: string): IntentStoreV1 {
  return {
    writeDurable() {
      throw new Error(reason);
    },
    readUtf8() {
      // Guard read of a missing file. Absence is ENOENT; any other code is
      // unreadability and never reaches this write-failure path.
      const error = new Error("ENOENT");
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    },
  };
}

function lyingStore(): IntentStoreV1 {
  return {
    writeDurable() {
      // Pretend the bytes landed. They did not.
    },
    readUtf8() {
      return "{\"schema\":\"not-an-intent\"}\n";
    },
  };
}

// ---------------------------------------------------------------------------
// Crash between intent and spawn
// ---------------------------------------------------------------------------

test("a crash between persist and spawn leaves a readable intent with no process identity", () => {
  // Defect: identity defaulted to a pid of 0 / "pending", so recovery thinks the run started.
  withDir((dir) => {
    const input = inputIn(dir);
    const persisted = persistRunIntent(input);
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;
    assert.ok(isSpawnPermit(persisted.permit));

    // Crash: the permit dies with the process. Nothing is spawned. Nothing is attached.
    const raw = readFileSync(input.intentPath, "utf8");
    assert.match(raw, /"schema": "aion.director.run-intent.v1"/);
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{10,}/);

    const reloaded = readRunIntent(input.intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.processIdentity, null);
    assert.equal(reloaded.intent.spawnObservedAt, null);
    assert.equal(reloaded.intent.spawnAttemptedAt, null);
    assert.equal(reloaded.intent.spawnPid, null);

    const answers = answersAfterReboot(reloaded.intent);
    assert.equal(answers.supposedToRun, true, "the file must say a launch was decided");
    assert.equal(answers.started, false, "no spawn attempt and no identity means it never started");
  });
});

// ---------------------------------------------------------------------------
// Failed persist makes spawn impossible
// ---------------------------------------------------------------------------

test("a failed persist does not produce a spawn permit and never calls the launch", () => {
  // Defect: persist failure logged, spawn proceeds on the in-memory record.
  withDir((dir) => {
    let launched = false;
    const result = withPersistedIntent(
      inputIn(dir),
      () => {
        launched = true;
        return "spawned";
      },
      failingStore("disk full"),
    );
    assert.equal(result.ok, false);
    assert.equal(result.permit, null);
    assert.equal(result.intent, null);
    assert.equal(result.launched, null);
    assert.equal(launched, false, "launch must be unreachable when persist fails");
    assert.match(result.reason, /persist failed|spawn is refused/);
  });
});

test("a persist whose read-back does not match makes spawning impossible", () => {
  // Defect: write() returning is treated as durable; a torn or lying write still launches.
  withDir((dir) => {
    let launched = false;
    const result = withPersistedIntent(
      inputIn(dir),
      (permit: SpawnPermitV1) => {
        launched = true;
        requireSpawnPermit(permit);
        return "spawned";
      },
      lyingStore(),
    );
    assert.equal(result.ok, false);
    assert.equal(result.permit, null);
    assert.equal(launched, false);
  });
});

test("requireSpawnPermit refuses a forged handle, so spawn cannot be invented", () => {
  assert.throws(
    () => requireSpawnPermit({ intentPath: "C:\\AION\\director\\RUNS\\run-1\\intent.json" }),
    /spawn is refused/,
  );
  assert.equal(isSpawnPermit({}), false);
  assert.equal(isSpawnPermit(null), false);
});

test("an inherited-prototype permit is not a minted permit", () => {
  // Defect: isSpawnPermit read the brand as a property. Object.create(realPermit)
  // inherited it — Object.freeze does not stop prototype inheritance — and
  // defineProperty(intentPath) redirected recordSpawnAttempt into another run.
  withDir((dir) => {
    const victim = persistRunIntent(inputIn(dir, {
      intentPath: join(dir, "victim", "intent.json"),
      runId: "run-victim",
      runNonce: "nonce-victim",
    }));
    assert.equal(victim.ok, true, victim.ok ? "" : victim.reason);
    if (!victim.ok) return;

    const attacker = persistRunIntent(inputIn(dir, {
      intentPath: join(dir, "attacker", "intent.json"),
      runId: "run-attacker",
      runNonce: "nonce-attacker",
    }));
    assert.equal(attacker.ok, true, attacker.ok ? "" : attacker.reason);
    if (!attacker.ok) return;

    const inherited = Object.create(attacker.permit) as SpawnPermitV1;
    Object.defineProperty(inherited, "intentPath", {
      value: victim.permit.intentPath,
    });

    assert.equal(isSpawnPermit(inherited), false);
    assert.throws(() => requireSpawnPermit(inherited), /spawn is refused/);

    const recorded = recordSpawnAttempt({
      permit: inherited,
      pid: 9090,
      now: SPAWNED_AT,
    });
    assert.equal(recorded.ok, false, "an inherited permit must not write another run's intent");

    const victimAfter = readRunIntent(victim.permit.intentPath);
    assert.equal(victimAfter.ok, true, victimAfter.ok ? "" : victimAfter.reason);
    if (!victimAfter.ok) return;
    assert.equal(victimAfter.intent.spawnPid, null);
    assert.equal(answersAfterReboot(victimAfter.intent).started, false);

    assert.throws(
      () => requireSpawnPermit(new Proxy({}, { get: () => true })),
      /spawn is refused/,
    );
    assert.equal(isSpawnPermit(new Proxy({}, { get: () => true })), false);
  });
});

test("a stale permit cannot record a spawn against a later intent at the same path", () => {
  // Defect (R5-2): recordSpawnAttempt wrote spawnPid onto whatever sat at
  // permit.intentPath. Persist of run B over unstarted run A used to plant
  // that later intent; that overwrite is now refused (R7-1). The later
  // intent is planted so the binding check is still the thing under test.
  withDir((dir) => {
    const first = persistRunIntent(inputIn(dir, { runId: "run-a", runNonce: "nonceA" }));
    assert.equal(first.ok, true, first.ok ? "" : first.reason);
    if (!first.ok) return;

    const overwritten = persistRunIntent(inputIn(dir, { runId: "run-b", runNonce: "nonceB" }));
    assert.equal(overwritten.ok, false, "a readable intent is unresolvable, not a template to overwrite");
    assert.equal(overwritten.permit, null);
    assert.match(overwritten.reason, /unresolvable|refusing to overwrite/);

    const planted = {
      ...first.intent,
      runId: "run-b",
      runNonce: "nonceB",
    };
    writeFileSync(inputIn(dir).intentPath, `${JSON.stringify(planted, null, 2)}\n`);

    const replayed = recordSpawnAttempt({
      permit: first.permit,
      pid: 4242,
      now: SPAWNED_AT,
    });
    assert.equal(replayed.ok, false);
    assert.match(replayed.reason, /not bound|different run/);

    const observed = recordSpawnObservation({
      permit: first.permit,
      identity: { ...IDENTITY, runNonce: "nonceA" },
      now: SPAWNED_AT,
    });
    assert.equal(observed.ok, false);

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.runId, "run-b");
    assert.equal(reloaded.intent.runNonce, "nonceB");
    assert.equal(reloaded.intent.spawnPid, null);
    assert.equal(reloaded.intent.processIdentity, null);
    assert.equal(answersAfterReboot(reloaded.intent).started, false);
  });
});

test("a permit cannot record a spawn against the same run whose command was swapped", () => {
  // Defect: permitMatchesIntent compared runId and runNonce only. An
  // intent.json swap that kept those two and changed executable/argv/cwd
  // was accepted as the same intent.
  withDir((dir) => {
    const first = persistRunIntent(inputIn(dir));
    assert.equal(first.ok, true, first.ok ? "" : first.reason);
    if (!first.ok) return;

    const planted = {
      ...first.intent,
      executablePath: "C:\\Tools\\evil.exe",
      argv: ["--exfiltrate"],
      cwd: "C:\\somewhere-else",
    };
    writeFileSync(inputIn(dir).intentPath, `${JSON.stringify(planted, null, 2)}\n`);

    const replayed = recordSpawnAttempt({
      permit: first.permit,
      pid: 4242,
      now: SPAWNED_AT,
    });
    assert.equal(replayed.ok, false);
    assert.match(replayed.reason, /not bound|different run/);

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.executablePath, "C:\\Tools\\evil.exe");
    assert.equal(reloaded.intent.spawnPid, null);
    assert.equal(answersAfterReboot(reloaded.intent).started, false);
  });
});

test("a second persist on an unstarted path does not mint another spendable permit", () => {
  // Defect: persistRunIntent refused only "spawned" and "unreadable". Two
  // calls on one unstarted path minted two simultaneously spendable permits.
  withDir((dir) => {
    const first = persistRunIntent(inputIn(dir));
    assert.equal(first.ok, true, first.ok ? "" : first.reason);
    if (!first.ok) return;
    assert.ok(isSpawnPermit(first.permit));

    const second = persistRunIntent(inputIn(dir));
    assert.equal(second.ok, false);
    assert.equal(second.permit, null);
    assert.equal(isSpawnPermit(second.permit), false);
    assert.match(second.reason, /unresolvable|refusing to overwrite/);

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.runId, first.intent.runId);
    assert.equal(reloaded.intent.runNonce, first.intent.runNonce);
    assert.equal(reloaded.intent.spawnAttemptedAt, null);
    assert.equal(answersAfterReboot(reloaded.intent).started, false);
  });
});

test("a secret in argv refuses persist, so the secret never becomes the 2am record", () => {
  withDir((dir) => {
    const result = persistRunIntent(inputIn(dir, {
      argv: ["--prompt-file", join(dir, "PROMPT.md"), "--token=sk-abcdefghijklmnopqrstuvwxyz"],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.permit, null);
    assert.match(result.reason, /secret/);
  });
});

// ---------------------------------------------------------------------------
// The record answers the reboot questions
// ---------------------------------------------------------------------------

test("after a reboot the intent answers each question a person has to ask", () => {
  // Defect: the file exists but omits branch / nonce / times, so recovery has to read a chat.
  withDir((dir) => {
    const input = inputIn(dir);
    const persisted = persistRunIntent(input);
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;

    const beforeSpawn = answersAfterReboot(readRunIntent(input.intentPath).intent);
    assert.equal(beforeSpawn.supposedToRun, true);
    assert.equal(beforeSpawn.started, false);
    assert.equal(beforeSpawn.spawnAttemptedAt, null);
    assert.equal(beforeSpawn.spawnPid, null);
    assert.equal(beforeSpawn.worktree, dir);
    assert.equal(beforeSpawn.branch, "executor/grok-director-d2");
    assert.equal(beforeSpawn.missionId, "mission-1");
    assert.equal(beforeSpawn.workItemId, "work-1");
    assert.equal(beforeSpawn.executablePath, EXE);
    assert.deepEqual(beforeSpawn.argv, input.argv);
    assert.equal(beforeSpawn.runNonce, NONCE);
    assert.equal(beforeSpawn.intentWrittenAt, NOW);
    assert.equal(beforeSpawn.spawnObservedAt, null);

    const recorded = recordSpawnObservation({
      permit: persisted.permit,
      identity: IDENTITY,
      now: SPAWNED_AT,
    });
    assert.equal(recorded.ok, true, recorded.ok ? "" : recorded.reason);
    if (!recorded.ok) return;

    const afterSpawn = answersAfterReboot(readRunIntent(input.intentPath).intent);
    assert.equal(afterSpawn.supposedToRun, true);
    assert.equal(afterSpawn.started, true, "a recorded identity still means it started");
    assert.equal(afterSpawn.spawnObservedAt, SPAWNED_AT);
    assert.equal(afterSpawn.worktree, dir);
    assert.equal(afterSpawn.branch, "executor/grok-director-d2");
    assert.equal(afterSpawn.missionId, "mission-1");
    assert.equal(afterSpawn.workItemId, "work-1");
    assert.equal(afterSpawn.executablePath, EXE);
    assert.equal(afterSpawn.runNonce, NONCE);

    const raw = readFileSync(input.intentPath, "utf8");
    const parsed = JSON.parse(raw) as { schema: string; secretsPresent: boolean; processIdentity: unknown };
    assert.equal(parsed.schema, RUN_INTENT_SCHEMA_V1);
    assert.equal(parsed.secretsPresent, false);
    assert.ok(parsed.processIdentity);
  });
});

test("an absent intent answers supposedToRun false, not 'we do not know so try again'", () => {
  const answers = answersAfterReboot(null);
  assert.equal(answers.supposedToRun, false);
  assert.equal(answers.started, false);
  assert.equal(answers.worktree, null);
  assert.equal(answers.missionId, null);
});

test("a spawn whose identity cannot be captured is still a started run", () => {
  // Defect: processIdentity stayed null and started was inferred from that, so recovery relaunched.
  withDir((dir) => {
    const persisted = persistRunIntent(inputIn(dir));
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;

    const attempted = recordSpawnAttempt({
      permit: persisted.permit,
      pid: 4812,
      now: SPAWNED_AT,
    });
    assert.equal(attempted.ok, true, attempted.ok ? "" : attempted.reason);
    if (!attempted.ok) return;

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.processIdentity, null);
    assert.equal(reloaded.intent.spawnObservedAt, null);
    assert.equal(reloaded.intent.spawnAttemptedAt, SPAWNED_AT);
    assert.equal(reloaded.intent.spawnPid, 4812);

    const answers = answersAfterReboot(reloaded.intent);
    assert.equal(answers.started, true, "started is the spawn returning, not a successful probe");
    assert.equal(answers.spawnPid, 4812);
    assert.equal(answers.spawnAttemptedAt, SPAWNED_AT);
  });
});

test("persistRunIntent refuses to overwrite an intent that already recorded a spawn", () => {
  // Defect: persistRunIntent rewrote a file that recordSpawnAttempt refuses to
  // overwrite, wiping spawnAttemptedAt / spawnPid so a live process read as never started.
  withDir((dir) => {
    const persisted = persistRunIntent(inputIn(dir));
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;

    const attempted = recordSpawnAttempt({
      permit: persisted.permit,
      pid: 4812,
      now: SPAWNED_AT,
    });
    assert.equal(attempted.ok, true, attempted.ok ? "" : attempted.reason);
    if (!attempted.ok) return;

    const again = persistRunIntent(inputIn(dir));
    assert.equal(again.ok, false);
    assert.equal(again.permit, null);
    assert.match(again.reason, /already recorded|refusing to overwrite/);

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.spawnPid, 4812);
    assert.equal(reloaded.intent.spawnAttemptedAt, SPAWNED_AT);
  });
});

test("a transient guard-read error is unreadable, not absence, and does not erase a live spawn", () => {
  // Defect: existingIntentOn caught every readUtf8 failure as "none". EBUSY /
  // EACCES / EMFILE / EIO from a scanner holding intent.json open looked like
  // "file never existed", persist overwrote spawnPid, and a second executor
  // launched. Truncated / unparseable already refused; only errno was treated
  // as absence.
  withDir((dir) => {
    const persisted = persistRunIntent(inputIn(dir));
    assert.equal(persisted.ok, true, persisted.ok ? "" : persisted.reason);
    if (!persisted.ok) return;

    const attempted = recordSpawnAttempt({
      permit: persisted.permit,
      pid: 4812,
      now: SPAWNED_AT,
    });
    assert.equal(attempted.ok, true, attempted.ok ? "" : attempted.reason);
    if (!attempted.ok) return;

    const codes = ["EBUSY", "EACCES", "EMFILE", "EIO"] as const;
    for (const code of codes) {
      let guardReads = 0;
      const flaky: IntentStoreV1 = {
        writeDurable() {
          throw new Error(`write must not run after a ${code} guard read`);
        },
        readUtf8() {
          guardReads += 1;
          const error = new Error(code);
          (error as NodeJS.ErrnoException).code = code;
          throw error;
        },
      };
      const again = persistRunIntent(inputIn(dir), flaky);
      assert.equal(again.ok, false, `${code} must not look like a missing file`);
      assert.equal(again.permit, null);
      assert.equal(guardReads, 1, `${code} must fail on the guard read, not skip it`);
      assert.match(again.reason, /unreadable|refusing to overwrite/);
    }

    const reloaded = readRunIntent(inputIn(dir).intentPath);
    assert.equal(reloaded.ok, true, reloaded.ok ? "" : reloaded.reason);
    if (!reloaded.ok) return;
    assert.equal(reloaded.intent.spawnPid, 4812, "the first writer's record must survive a busy guard read");
    assert.equal(reloaded.intent.spawnAttemptedAt, SPAWNED_AT);
    assert.equal(answersAfterReboot(reloaded.intent).started, true);
  });
});
