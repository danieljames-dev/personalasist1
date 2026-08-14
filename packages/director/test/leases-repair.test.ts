/**
 * The three ways one owner became two.
 *
 * Each group here is a way the original lease rules could be followed exactly and still let a second
 * executor into a worktree a live run was using: the same directory spelled two ways became two
 * uncontested leases; a probe that could not answer was recorded as "not alive" and read as "dead";
 * and a PID that had been handed to a different process was accepted as evidence about the holder.
 * The store contract is tested alongside them because the same identity rules decide lock file names
 * and mission directory names, and an id that escapes its directory is the same class of fault.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireLease, reclaimStaleLease, conflicts, canonicalResource, processIdentityMatches,
  type HolderObservationV1, type LeaseV1, type ProcessIdentityV1,
} from "../src/leases.js";
import {
  canonicalizeHostPath, pathIsInside, resolveDirectorRoot, isSafePathSegment, validatePathSegment,
  validateMissionId, validateRunId, MAX_ID_SEGMENT_LENGTH,
} from "../src/store-contract.js";
import { DEFAULT_DIRECTOR_ROOT, DIRECTOR_ROOT_ENV } from "../src/contracts.js";

const NOW = "2026-08-13T12:00:00.000Z";
/** Long enough before NOW that the default TTL has run out. */
const LONG_AGO = "2026-08-13T10:00:00.000Z";
const PID_GONE: HolderObservationV1 = { outcome: "NOT_FOUND", pid: 100 };

// ---------------------------------------------------------------------------
// One spelling per resource
// ---------------------------------------------------------------------------

test("'C:/wt-a' and 'C:\\wt-a' are one worktree, not two free leases", () => {
  const first = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: NOW,
  });
  assert.equal(first.ok, true);

  const second = acquireLease({
    existing: [first.lease!], leaseId: "l2", kind: "WORKTREE", resource: "C:\\wt-a",
    missionId: "m1", runId: "r2", pid: 200, now: NOW,
  });
  assert.equal(second.ok, false, "a backslash is not a different directory");
  assert.equal(second.heldBy!.runId, "r1");
});

test("case, trailing separators, doubled separators and '..' all collapse to one key", () => {
  const aliases = ["C:/wt-a", "C:\\wt-a", "C:\\WT-A\\", "C://wt-a//", "C:/wt-a/./", "C:/wt-a/sub/.."];
  for (const alias of aliases) {
    assert.equal(canonicalResource("WORKTREE", alias), "c:/wt-a", `${alias} names the same directory`);
  }
});

test("a lease taken under one spelling is found under any of them", () => {
  const held = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: LONG_AGO,
  }).lease!;

  const reclaimed = reclaimStaleLease({
    existing: [held], kind: "WORKTREE", resource: "C:\\WT-A\\",
    holderLiveness: "DEAD_CONFIRMED", holderObservation: PID_GONE, now: NOW,
  });
  assert.equal(reclaimed.ok, true, "an alias must not hide a lease from its own reclaim");
  assert.deepEqual(reclaimed.remaining, []);
});

test("conflict detection sees through the alias, and still separates real directories", () => {
  assert.equal(conflicts({ kind: "WORKTREE", resource: "C:/wt-a" }, { kind: "WORKTREE", resource: "C:\\wt-a\\" }), true);
  assert.equal(conflicts({ kind: "WORKTREE", resource: "C:/wt-claude" }, { kind: "WORKTREE", resource: "C:/wt-grok" }), false);
  // A shared prefix is not containment: `wt-a` and `wt-alpha` are different worktrees.
  assert.equal(conflicts({ kind: "WORKTREE", resource: "C:/wt-a" }, { kind: "WORKTREE", resource: "C:/wt-alpha" }), false);
});

test("a branch name is folded but not treated as a path", () => {
  // Git on Windows stores refs as files, so two casings are one branch and must be one lease.
  assert.equal(canonicalResource("BRANCH", "Executor/Claude-Director-V01"), "executor/claude-director-v01");
  // A ref is still never path-canonicalised — "executor/x/../y" must not collapse to "executor/y"
  // and merge two branches into one lease. Git forbids ".." in a ref name outright, so the stronger
  // and more honest answer is to refuse it rather than to carry an impossible branch as an identity.
  assert.equal(canonicalResource("BRANCH", "executor/x/../y"), "", "Git forbids '..' in a ref name");
  assert.notEqual(canonicalResource("BRANCH", "executor/x/../y"), "executor/y", "and never resolves it");
});

// ---------------------------------------------------------------------------
// Liveness is three-valued
// ---------------------------------------------------------------------------

const staleLease = (over: { identity?: ProcessIdentityV1 } = {}): LeaseV1 => acquireLease({
  existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
  missionId: "m1", runId: "r1", pid: 100, now: LONG_AGO,
  ...(over.identity ? { processIdentity: over.identity } : {}),
}).lease!;

test("UNKNOWN liveness reclaims nothing, because a failed probe is not a death", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "UNKNOWN", now: NOW,
  });
  assert.equal(refused.ok, false, "an unanswered probe is the case the boolean used to swallow");
  assert.equal(refused.refusal, "LIVENESS_UNKNOWN");
  assert.equal(refused.remaining.length, 1);
});

test("saying nothing about liveness is UNKNOWN, not consent", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a", now: NOW,
  });
  assert.equal(refused.ok, false, "a caller who never looked must not be read as having looked");
  assert.equal(refused.refusal, "LIVENESS_UNKNOWN");
});

test("ALIVE reclaims nothing however long the heartbeat has been silent", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "ALIVE", now: NOW,
  });
  assert.equal(refused.ok, false, "a loaded machine looks exactly like a dead one from the clock");
  assert.equal(refused.refusal, "HOLDER_ALIVE");
});

test("DEAD_CONFIRMED plus an expired lease is the one case that reclaims", () => {
  const reclaimed = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED", holderObservation: PID_GONE, now: NOW,
  });
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.refusal, null);
  assert.deepEqual(reclaimed.remaining, []);
});

test("DEAD_CONFIRMED without an observation of the recorded pid does not reclaim", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED", now: NOW,
  });
  assert.equal(refused.ok, false, "a liveness enum with nothing observed is not a probe");
  assert.equal(refused.refusal, "HOLDER_UNOBSERVED");
  assert.equal(refused.remaining.length, 1);
});

const expiredPidOnlyWriter = (): LeaseV1 => acquireLease({
  existing: [], leaseId: "l-pw", kind: "PRODUCTION_WRITER", resource: "default",
  missionId: "m1", runId: "r1", pid: 12224, now: LONG_AGO,
}).lease!;

test("FOUND of a pid-only holder is not a death certificate", () => {
  const refused = reclaimStaleLease({
    existing: [expiredPidOnlyWriter()], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 12224 },
    now: NOW,
  });
  assert.equal(refused.ok, false, "a process occupying the recorded pid is not evidence the holder is gone");
  assert.equal(refused.refusal, "IDENTITY_UNVERIFIABLE");
  assert.equal(refused.remaining.length, 1);
});

test("UNAVAILABLE of a pid-only holder is not a death certificate", () => {
  const refused = reclaimStaleLease({
    existing: [expiredPidOnlyWriter()], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "UNAVAILABLE", pid: 12224 },
    now: NOW,
  });
  assert.equal(refused.ok, false, "an unanswered probe is not evidence the holder is gone");
  assert.equal(refused.refusal, "LIVENESS_UNKNOWN");
  assert.equal(refused.remaining.length, 1);
});

test("NOT_EXPIRED, HOLDER_ALIVE, and LIVENESS_UNKNOWN still refuse first, in that order", () => {
  const occupied = { outcome: "FOUND" as const, pid: 12224 };
  const live = acquireLease({
    existing: [], leaseId: "l-pw-live", kind: "PRODUCTION_WRITER", resource: "default",
    missionId: "m1", runId: "r1", pid: 12224, now: NOW,
  }).lease!;
  const notExpired = reclaimStaleLease({
    existing: [live], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "DEAD_CONFIRMED", holderObservation: occupied, now: NOW,
  });
  assert.equal(notExpired.ok, false);
  assert.equal(notExpired.refusal, "NOT_EXPIRED");

  const alive = reclaimStaleLease({
    existing: [expiredPidOnlyWriter()], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "ALIVE", holderObservation: occupied, now: NOW,
  });
  assert.equal(alive.ok, false);
  assert.equal(alive.refusal, "HOLDER_ALIVE");

  const unknown = reclaimStaleLease({
    existing: [expiredPidOnlyWriter()], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "UNKNOWN", holderObservation: occupied, now: NOW,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.refusal, "LIVENESS_UNKNOWN");
});

test("NOT_FOUND of the recorded pid reclaims an expired lease", () => {
  const held = staleLease({ identity: { pid: 100, runToken: "run-a" } });
  const reclaimed = reclaimStaleLease({
    existing: [held], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "NOT_FOUND", pid: 100 },
    now: NOW,
  });
  assert.equal(reclaimed.ok, true, "a gone slot is enough even when the lease recorded a run token");
  assert.deepEqual(reclaimed.remaining, []);
});

test("an expired lease that recorded no pid can still be reclaimed with DEAD_CONFIRMED", () => {
  const held = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: null, now: LONG_AGO,
  }).lease!;
  const refused = reclaimStaleLease({
    existing: [held], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED", now: NOW,
  });
  assert.equal(refused.ok, false, "a label with nothing to observe is not a death certificate");
  assert.equal(refused.refusal, "HOLDER_UNOBSERVABLE");
  assert.deepEqual(refused.remaining, [held]);
});

test("a lease with pid null and no processIdentity is refused a reclaim", () => {
  const held = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: null, now: LONG_AGO,
  }).lease!;
  assert.equal(held.pid, null);
  assert.equal(held.processIdentity, undefined);
  const refused = reclaimStaleLease({
    existing: [held], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED", now: NOW,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal, "HOLDER_UNOBSERVABLE");
});

test("DEAD_CONFIRMED against a lease that has not expired still reclaims nothing", () => {
  const live = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: NOW,
  }).lease!;

  const refused = reclaimStaleLease({
    existing: [live], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED", now: NOW,
  });
  assert.equal(refused.ok, false, "expiry is the precondition, not a consequence of the probe");
  assert.equal(refused.refusal, "NOT_EXPIRED");
});

test("the retired boolean keeps its old meaning so existing callers do not silently change", () => {
  const busy = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderProcessAlive: true, now: NOW,
  });
  assert.equal(busy.ok, false);
  assert.equal(busy.refusal, "HOLDER_ALIVE");

  const gone = reclaimStaleLease({
    existing: [staleLease()], kind: "WORKTREE", resource: "C:/wt-a",
    holderProcessAlive: false, holderObservation: PID_GONE, now: NOW,
  });
  assert.equal(gone.ok, true, "`false` was written to mean 'I confirmed it is gone'");
});

// ---------------------------------------------------------------------------
// A PID is a slot, not a process
// ---------------------------------------------------------------------------

const RECORDED: ProcessIdentityV1 = { pid: 100, startedAt: "2026-08-13T09:58:00.000Z", runToken: "run-a" };

test("FOUND of a different occupant of a strongly identified slot still reclaims", () => {
  const reclaimed = reclaimStaleLease({
    existing: [staleLease({ identity: RECORDED })], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: "2026-08-13T11:30:00.000Z", runToken: "run-b" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, true, "a later start on the same slot is PID reuse; the holder is gone");
  assert.equal(reclaimed.refusal, null);
  assert.deepEqual(reclaimed.remaining, []);
});

test("a probe of a different process cannot retire this lease", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease({ identity: RECORDED })], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    // Same PID slot, different run: the OS handed 100 to something else.
    observedIdentity: { pid: 100, startedAt: "2026-08-13T11:30:00.000Z", runToken: "run-b" },
    now: NOW,
  });
  assert.equal(refused.ok, false, "a reused PID says nothing about the run that took the lease");
  assert.equal(refused.refusal, "IDENTITY_MISMATCH");
});

test("a start time that moved is a mismatch even when the run token is absent", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease({ identity: { pid: 100, startedAt: "2026-08-13T09:58:00.000Z" } })],
    kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    observedIdentity: { pid: 100, startedAt: "2026-08-13T11:30:00.000Z" },
    now: NOW,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal, "IDENTITY_MISMATCH");
});

test("a recorded identity may not be answered with a PID-only observation", () => {
  const refused = reclaimStaleLease({
    existing: [staleLease({ identity: RECORDED })], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    observedIdentity: { pid: 100 },
    now: NOW,
  });
  assert.equal(refused.ok, false, "recording a stronger identity and then ignoring it is worse than never recording one");
  assert.equal(refused.refusal, "IDENTITY_UNVERIFIABLE");
});

test("a matching identity plus DEAD_CONFIRMED and expiry reclaims", () => {
  const reclaimed = reclaimStaleLease({
    existing: [staleLease({ identity: RECORDED })], kind: "WORKTREE", resource: "C:/wt-a",
    holderLiveness: "DEAD_CONFIRMED",
    observedIdentity: { pid: 100, startedAt: "2026-08-13T09:58:00.000Z", runToken: "run-a" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, true);
  assert.deepEqual(reclaimed.remaining, []);
});

test("two records agreeing on nothing but a PID have agreed on nothing", () => {
  assert.equal(processIdentityMatches({ pid: 100 }, { pid: 100 }), "UNVERIFIABLE");
  assert.equal(processIdentityMatches({ pid: 100 }, { pid: 101 }), "MISMATCH");
  assert.equal(processIdentityMatches(RECORDED, undefined), "UNVERIFIABLE");
  assert.equal(processIdentityMatches({ pid: null, runToken: "run-a" }, { pid: null, runToken: "run-a" }), "MATCH");
});

test("ISO-Z and DMTF of one live holder do not reclaim that holder's lease", () => {
  const iso = "2026-08-14T12:00:01.000Z";
  const dmtf = "20260814120001.000000+000";
  const held = acquireLease({
    existing: [], leaseId: "l-pw-dmtf", kind: "PRODUCTION_WRITER", resource: "default",
    missionId: "m1", runId: "r1", pid: 100, now: LONG_AGO,
    processIdentity: { pid: 100, startedAt: iso, runToken: "run-a" },
  }).lease!;
  const refused = reclaimStaleLease({
    existing: [held], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: dmtf, runToken: "run-a" },
    now: NOW,
  });
  assert.equal(refused.ok, false, "the same process in two encodings is not a death certificate");
  assert.equal(refused.refusal, "IDENTITY_UNVERIFIABLE");
  assert.equal(refused.remaining.length, 1);
});

test("unparseable startedAt values are UNVERIFIABLE, never MATCH or MISMATCH", () => {
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: "yesterday" },
      { pid: 100, startedAt: "yesterday" },
    ),
    "UNVERIFIABLE",
  );
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: "build-7" },
      { pid: 100, startedAt: "build-8" },
    ),
    "UNVERIFIABLE",
  );
});

test("a zone-less startedAt on either side is UNVERIFIABLE", () => {
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: "2026-08-14T12:00:01" },
      { pid: 100, startedAt: "2026-08-14T12:00:01.000Z" },
    ),
    "UNVERIFIABLE",
  );
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: "2026-08-14T12:00:01.000Z" },
      { pid: 100, startedAt: "2026-08-14T12:00:01" },
    ),
    "UNVERIFIABLE",
  );
});

test("two encodings of one instant MATCH; a later placeable instant is PID reuse", () => {
  const iso = "2026-08-14T12:00:01.000Z";
  const dmtf = "20260814120001.000000+000";
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: iso, runToken: "run-a" },
      { pid: 100, startedAt: dmtf, runToken: "run-a" },
    ),
    "MATCH",
  );
  const later = "2026-08-14T16:00:01.000Z";
  assert.equal(
    processIdentityMatches(
      { pid: 100, startedAt: iso },
      { pid: 100, startedAt: later },
    ),
    "MISMATCH",
  );
  const held = acquireLease({
    existing: [], leaseId: "l-pw-reuse", kind: "PRODUCTION_WRITER", resource: "default",
    missionId: "m1", runId: "r1", pid: 100, now: LONG_AGO,
    processIdentity: { pid: 100, startedAt: iso, runToken: "run-a" },
  }).lease!;
  const reclaimed = reclaimStaleLease({
    existing: [held], kind: "PRODUCTION_WRITER", resource: "default",
    holderLiveness: "DEAD_CONFIRMED",
    holderObservation: { outcome: "FOUND", pid: 100 },
    observedIdentity: { pid: 100, startedAt: later, runToken: "run-b" },
    now: NOW,
  });
  assert.equal(reclaimed.ok, true, "a later placeable instant on the same slot is reuse");
  assert.deepEqual(reclaimed.remaining, []);
});

test("the identity a refusal hands back is the one a caller must go and match", () => {
  const taken = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", processIdentity: RECORDED, now: LONG_AGO,
  }).lease!;
  const attempt = acquireLease({
    existing: [taken], leaseId: "l2", kind: "WORKTREE", resource: "C:\\wt-a",
    missionId: "m1", runId: "r2", now: NOW,
  });
  assert.equal(attempt.ok, false);
  assert.equal(attempt.requiresStalenessCheck, true, "expired means go and look");
  assert.equal(attempt.heldBy!.processIdentity!.runToken, "run-a");
  assert.equal(taken.pid, 100, "the pid is taken from the identity when not passed separately");
});

// ---------------------------------------------------------------------------
// Store contract: ids that cannot leave their directory
// ---------------------------------------------------------------------------

test("an id that could address anything other than one directory is refused", () => {
  const refused: readonly [string, string][] = [
    ["", "EMPTY"],
    ["..", "TRAVERSAL"],
    ["m..1", "TRAVERSAL"],
    ["../../windows/system32", "SEPARATOR"],
    ["m1/r1", "SEPARATOR"],
    ["m1\\r1", "SEPARATOR"],
    ["CON", "RESERVED_DEVICE_NAME"],
    ["nul.json", "RESERVED_DEVICE_NAME"],
    ["COM1", "RESERVED_DEVICE_NAME"],
    ["run1.", "TRAILING_DOT_OR_SPACE"],
    ["run1 ", "TRAILING_DOT_OR_SPACE"],
    ["run 1", "ILLEGAL_CHARACTER"],
    ["-run1", "ILLEGAL_CHARACTER"],
    ["run:1", "ILLEGAL_CHARACTER"],
    ["a".repeat(MAX_ID_SEGMENT_LENGTH + 1), "TOO_LONG"],
  ];
  for (const [value, rule] of refused) {
    const verdict = validatePathSegment(value);
    assert.equal(verdict.ok, false, `${JSON.stringify(value)} must not become a directory name`);
    assert.equal(verdict.rule, rule, `${JSON.stringify(value)} refused for the wrong reason: ${verdict.reason}`);
    assert.equal(isSafePathSegment(value), false);
  }
});

test("ordinary mission and run ids are accepted", () => {
  for (const value of ["m1", "mission-001", "run_2026-08-13T12-00-00Z", "a".repeat(MAX_ID_SEGMENT_LENGTH)]) {
    assert.equal(isSafePathSegment(value), true, `${value} is a perfectly ordinary id`);
  }
  assert.equal(validateMissionId("m1").ok, true);
  assert.equal(validateRunId("r1").ok, true);
  assert.equal(validateMissionId("m1/../m2").ok, false);
  assert.equal(validateRunId("PRN").ok, false);
});

// ---------------------------------------------------------------------------
// Store contract: the root is not in the repository
// ---------------------------------------------------------------------------

test("the Director root sits outside every worktree, so `git clean` cannot erase a mission", () => {
  const worktrees = [
    "C:/AION-HQ-claude-director-v01",
    "C:\\AION-HQ-claude-director-v01\\packages\\director",
    "C:/wt-a",
    "C:/wt-grok",
  ];
  for (const worktree of worktrees) {
    assert.equal(pathIsInside(DEFAULT_DIRECTOR_ROOT, worktree), false, `state must not live under ${worktree}`);
    assert.equal(pathIsInside(worktree, DEFAULT_DIRECTOR_ROOT), false, `a worktree must not live under the root`);
  }

  // The tree this test is running from counts too. Skipped at a drive root, where the question is
  // vacuous rather than failing.
  const cwd = canonicalizeHostPath(process.cwd());
  if (!/^[a-z]:\/$/.test(cwd)) {
    assert.equal(pathIsInside(DEFAULT_DIRECTOR_ROOT, cwd), false, "the checkout under test must not contain the runtime root");
  }
});

test("the root override is honoured, and an empty one falls back rather than rooting at nothing", () => {
  assert.equal(resolveDirectorRoot({}), DEFAULT_DIRECTOR_ROOT);
  assert.equal(resolveDirectorRoot({ [DIRECTOR_ROOT_ENV]: "D:/aion-state" }), "D:/aion-state");
  // `set AION_DIRECTOR_ROOT=` leaves an empty string, and rooting at "" writes into the cwd.
  assert.equal(resolveDirectorRoot({ [DIRECTOR_ROOT_ENV]: "  " }), DEFAULT_DIRECTOR_ROOT);
});

test("path containment does not mistake a sibling with a shared prefix for a child", () => {
  assert.equal(pathIsInside("C:/AION/director/missions/m1", "C:\\aion\\director"), true);
  assert.equal(pathIsInside("C:/AION-HQ", "C:/AION"), false, "a shared prefix is not a parent directory");
  assert.equal(pathIsInside("C:/AION", "C:/AION"), true, "a path contains itself");
  assert.equal(canonicalizeHostPath("\\\\host\\share\\..\\..\\x"), "//host/share/x", "'..' may not eat a UNC root");
});
