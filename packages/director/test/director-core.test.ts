/**
 * The Director's core guarantees.
 *
 * These are the properties that make it safe to hand a long job to a machine and walk away: state
 * only moves along enumerated paths, an executor's account of itself is checked rather than
 * believed, a resource has one owner, and the questions that belong to a person survive a reboot.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance, legalEventsFrom, awaitsOwner, needsEngineer, TERMINAL_STATES,
  type MissionStateV1,
} from "../src/mission.js";
import { openGate, resolveGate, describeGate, openGates } from "../src/gates.js";
import {
  verifyGitTruth, isForbiddenGitOperation, FORBIDDEN_GIT_OPERATIONS,
  LARGE_TRACKED_FILE_BYTES, describeVerdict, type GitSnapshotV1,
} from "../src/git-truth.js";
import {
  parseHandoff, findHandoffContradictions, handoffIsTrustworthy, HANDOFF_SCHEMA_V1,
} from "../src/handoff.js";
import {
  acquireLease, heartbeat, releaseLease, reclaimStaleLease, conflicts, LEASE_TTL_MS,
} from "../src/leases.js";
import { DIRECTOR_BIND_HOST, DIRECTOR_BUSINESS_STATE_WRITER } from "../src/contracts.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:30:00.000Z";

// ---------------------------------------------------------------------------
// Mission state
// ---------------------------------------------------------------------------

test("a mission moves only along enumerated transitions", () => {
  const authorized = advance("CREATED", "MISSION_AUTHORIZED");
  assert.equal(authorized.ok, true);
  assert.equal(authorized.to, "AUTHORIZED");

  // Model prose cannot invent a path. Deploying straight from creation is simply not a move.
  const leap = advance("CREATED", "DEPLOY_STARTED");
  assert.equal(leap.ok, false);
  assert.equal(leap.to, null);
  assert.match(leap.reason, /not a legal move/);
});

test("an executor finishing is not the same as its work being correct", () => {
  const done = advance("EXECUTOR_RUNNING", "EXECUTOR_COMPLETED");
  assert.equal(done.to, "EXECUTOR_RESULT_RECEIVED", "a completed run still has to be verified");
  // And there is no path from a received result to integration without verification in between.
  assert.equal(advance("EXECUTOR_RESULT_RECEIVED", "INTEGRATION_STARTED").ok, false);
});

test("a SHA that does not match blocks rather than continues", () => {
  const mismatch = advance("EXECUTOR_RESULT_RECEIVED", "GIT_MISMATCH");
  assert.equal(mismatch.to, "BLOCKED");
});

test("deployment is always gated, and integration is verified before it", () => {
  // There is no transition from integration completing straight into deploying.
  assert.equal(advance("INTEGRATING", "DEPLOY_STARTED").ok, false);
  // This assertion used to expect READY_FOR_DEPLOYMENT, which is the defect independent review
  // found: integrating went straight to deployment-ready with nothing checking that the integrated
  // tree was sound. Integration now feeds verification, and only verification can hand on.
  assert.equal(advance("INTEGRATING", "INTEGRATION_COMPLETED").to, "VERIFYING");
  assert.equal(advance("READY_FOR_DEPLOYMENT", "OWNER_GATE_OPENED").to, "OWNER_GATE_REQUIRED");
});

test("pause remembers where it came from, and resume returns there", () => {
  const paused = advance("VERIFYING", "MISSION_PAUSED");
  assert.equal(paused.to, "PAUSED");
  assert.equal(paused.resumeState, "VERIFYING");

  const resumed = advance("PAUSED", "MISSION_RESUMED", paused.resumeState);
  assert.equal(resumed.to, "VERIFYING", "a pause that forgot its origin would be a restart");
});

test("resuming without a remembered origin refuses rather than guesses", () => {
  // This asserted `VERIFYING` and thereby asserted the defect: pause always records the state it
  // suspended, so a paused mission with no origin has lost one, and VERIFYING is two events from
  // writing production again. Having no target and having an unusable one are the same situation.
  const resumed = advance("PAUSED", "MISSION_RESUMED", null);
  assert.equal(resumed.ok, false);
  assert.equal(resumed.to, null);
  assert.match(resumed.reason, /no recorded origin/);
  assert.deepEqual(resumed.missing, ["the state the pause suspended"]);
});

test("an interrupted run is a question, not a verdict", () => {
  const interrupted = advance("EXECUTOR_RUNNING", "MISSION_INTERRUPTED");
  assert.equal(interrupted.to, "INTERRUPTED");
  // The work may well have finished before the process died, so the next move is to look — but only
  // when the record still says what was in flight. See the no-origin case below.
  assert.equal(advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: "EXECUTOR_RUNNING" }).to, "VERIFYING");
  assert.equal(advance("INTERRUPTED", "GIT_MISMATCH").to, "BLOCKED");
});

test("an interruption with no recorded origin is never verified back into flight", () => {
  // The regression this file previously asserted as correct. `advance("INTERRUPTED","GIT_VERIFIED")`
  // with the optional origin omitted returned VERIFYING, from which the deploy chain below all
  // succeeds on the context that was true when the first deploy began — production written twice.
  const blind = advance("INTERRUPTED", "GIT_VERIFIED");
  assert.equal(blind.ok, false, "a matching repository is not evidence of what was interrupted");
  assert.equal(blind.to, null);
  assert.deepEqual(blind.missing, ["the condition the interruption interrupted"]);
  // GIT_MISMATCH -> BLOCKED stays available, so a mission with a lost origin still reaches a person.
  assert.equal(advance("INTERRUPTED", "GIT_MISMATCH").to, "BLOCKED");
});

test("a finished mission is never restarted", () => {
  for (const state of TERMINAL_STATES) {
    const attempt = advance(state, "PLAN_SELECTED");
    assert.equal(attempt.ok, false, `${state} must be terminal`);
    assert.match(attempt.reason, /terminal/);
    assert.deepEqual(legalEventsFrom(state), []);
  }
});

test("waiting on a person is distinguishable from needing an engineer", () => {
  assert.equal(awaitsOwner("OWNER_GATE_REQUIRED"), true);
  assert.equal(awaitsOwner("WAITING_FOR_OWNER"), true);
  assert.equal(awaitsOwner("BLOCKED"), false);
  assert.equal(needsEngineer("BLOCKED"), true);
  assert.equal(needsEngineer("WAITING_FOR_OWNER"), false);
});

test("a rejected review returns to planning so a repair is a new run", () => {
  assert.equal(advance("INDEPENDENT_REVIEW", "REVIEW_REJECTED").to, "PLANNING");
  assert.equal(advance("INDEPENDENT_REVIEW", "REVIEW_COMPLETED").to, "READY_FOR_INTEGRATION");
});

// ---------------------------------------------------------------------------
// Owner gates
// ---------------------------------------------------------------------------

const gateFixture = () => openGate({
  gateId: "g1", missionId: "m1",
  type: "PHYSICAL_IPHONE_TEST_REQUIRED",
  why: "the multi-photo and voice paths have never run on a real device",
  requiredInput: "open the preview on your iPhone and try three photos and the microphone",
  at: NOW,
  safeFrozenState: { mainSha: "1ce25ba", productionSha: "d18c792" },
  resumeState: "VERIFYING",
});

test("a gate survives as an object, and says what is needed in plain words", () => {
  const gate = gateFixture();
  assert.equal(gate.status, "OPEN");
  const described = describeGate(gate);
  assert.match(described, /iPhone/);
  assert.ok(!/[A-Z_]{8,}/.test(described), "the Owner never sees the enum");
});

test("an answer resumes the same mission rather than starting a new one", () => {
  const gate = gateFixture();
  const resolved = resolveGate({ gate, approved: true, at: LATER, ownerNote: "worked" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.gate.status, "APPROVED");
  assert.equal(resolved.gate.resumeState, "VERIFYING", "the mission continues where it stopped");
  // This used to assert that resolution always lands on PLANNING, which is the defect independent
  // review found: the gate's own resumeState was computed, stored, and then ignored. Where the
  // mission goes is now derived from the durable board rather than fixed by the event, so the
  // assertion is that resolution is accepted and does not invent a destination of its own.
  const resumed = advance("WAITING_FOR_OWNER", "OWNER_GATE_RESOLVED");
  assert.equal(resumed.ok, true, resumed.reason);
  assert.notEqual(resumed.to, "COMPLETED", "answering a gate never completes a mission");
  assert.notEqual(resumed.to, "FAILED");
});

test("approval does not carry to a world that has moved since the question", () => {
  const gate = gateFixture();
  const stale = resolveGate({
    gate, approved: true, at: LATER,
    currentFacts: { mainSha: "9999999", productionSha: "d18c792" },
  });
  assert.equal(stale.ok, false, "consent was to a specific situation");
  assert.equal(stale.gate.status, "SUPERSEDED");
  assert.match(stale.staleFacts.join(" "), /mainSha/);
});

test("declining is recorded, and a gate is answered once", () => {
  const gate = gateFixture();
  const declined = resolveGate({ gate, approved: false, at: LATER });
  assert.equal(declined.gate.status, "REJECTED");
  const again = resolveGate({ gate: declined.gate, approved: true, at: LATER });
  assert.equal(again.ok, false);
});

test("open gates are listed oldest first", () => {
  const a = { ...gateFixture(), gateId: "a", requestedAt: "2026-08-13T09:00:00.000Z" };
  const b = { ...gateFixture(), gateId: "b", requestedAt: "2026-08-13T08:00:00.000Z" };
  const closed = { ...gateFixture(), gateId: "c", status: "APPROVED" as const };
  assert.deepEqual(openGates([a, b, closed]).map((g) => g.gateId), ["b", "a"]);
});

// ---------------------------------------------------------------------------
// Git truth
// ---------------------------------------------------------------------------

const snapshot = (over: Partial<GitSnapshotV1> = {}): GitSnapshotV1 => ({
  worktreePath: "C:/AION-HQ-claude-director-v01",
  attachedBranch: "executor/claude-director-v01",
  head: "a".repeat(40),
  localBranchHead: "a".repeat(40),
  remoteBranchHead: "a".repeat(40),
  originMainHead: "b".repeat(40),
  dirtyPaths: [],
  largeTrackedFiles: [],
  readAt: NOW,
  ...over,
});

test("an executor's claimed SHA is compared, never believed", () => {
  const verdict = verifyGitTruth(snapshot(), { claimedHead: "c".repeat(40) });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.findings[0]!.kind, "CLAIMED_HEAD_MISMATCH");
  assert.match(describeVerdict(verdict), /repository shows/);
});

test("a detached HEAD is caught for the specific reason it is dangerous", () => {
  const verdict = verifyGitTruth(snapshot({ attachedBranch: null }), {
    expectedBranch: "executor/claude-director-v01",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.findings[0]!.kind, "DETACHED_HEAD");
  // The real failure it prevents: a push that reports success while the branch never moved.
  assert.match(verdict.findings[0]!.detail, /push would not carry it/);
});

test("local and remote disagreeing is not settled by a successful-looking push", () => {
  const verdict = verifyGitTruth(
    snapshot({ remoteBranchHead: "d".repeat(40) }),
    { requireLocalEqualsRemote: true },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.findings[0]!.kind, "LOCAL_REMOTE_DIVERGED");
});

test("a non-fast-forward is refused", () => {
  const verdict = verifyGitTruth(snapshot(), {
    mustDescendFrom: "b".repeat(40),
    descendsFromExpected: false,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.findings[0]!.kind, "NOT_A_DESCENDANT");
});

test("a large tracked artifact is reported without blocking, because some are legitimate", () => {
  // The case this exists for: a 5.2 MB generated language file that passed every check looking for
  // images, keys and secrets, because none of them looked at size.
  const verdict = verifyGitTruth(snapshot({
    largeTrackedFiles: [{ path: "eng.traineddata", bytes: 5_199_098 }],
  }));
  assert.equal(verdict.ok, true, "a person should look, but this alone does not stop a mission");
  assert.equal(verdict.findings[0]!.kind, "UNEXPECTED_LARGE_ARTIFACT");
  assert.match(verdict.findings[0]!.detail, /5\.0 MB|5\.2 MB/);
  assert.ok(LARGE_TRACKED_FILE_BYTES > 0);
});

test("a clean repository against met expectations produces no findings", () => {
  const verdict = verifyGitTruth(snapshot(), {
    expectedBranch: "executor/claude-director-v01",
    expectedHead: "a".repeat(40),
    claimedHead: "a".repeat(40),
    requireClean: true,
    requireLocalEqualsRemote: true,
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.findings, []);
});

test("the irreversible Git operations are refused by name", () => {
  for (const op of ["reset --hard", "push --force", "rebase", "filter-repo", "clean -fd", "stash"]) {
    const check = isForbiddenGitOperation(["git", ...op.split(" ")]);
    assert.equal(check.forbidden, true, `${op} must be refused`);
  }
  assert.equal(isForbiddenGitOperation(["git", "status", "--porcelain"]).forbidden, false);
  assert.ok(FORBIDDEN_GIT_OPERATIONS.length >= 8);
});

// ---------------------------------------------------------------------------
// Structured handoff
// ---------------------------------------------------------------------------

const handoffJson = (over: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: HANDOFF_SCHEMA_V1,
  executor: "claude",
  missionId: "m1",
  runId: "r1",
  branch: "executor/claude-director-v01",
  headBefore: "a".repeat(40),
  headAfter: "b".repeat(40),
  status: "PASS",
  tests: [{ suite: "local-assistant", total: 1051, passed: 1051, failed: 0, skipped: 0 }],
  productionMutated: false,
  spendUsd: 0,
  requiresOwner: false,
  nextRecommendedGate: null,
  artifacts: [],
  startedAt: NOW,
  finishedAt: LATER,
  capacityStatus: "AVAILABLE",
  summary: "done",
  ...over,
});

test("a handoff wrapped in prose or fences still parses", () => {
  const wrapped = `Here is my report:\n\`\`\`json\n${handoffJson()}\n\`\`\`\nThanks.`;
  const parsed = parseHandoff(wrapped);
  assert.equal(parsed.ok, true, parsed.problems.join("; "));
  assert.equal(parsed.handoff!.executor, "claude");
});

test("a malformed handoff names every problem, not just the first", () => {
  const bad = parseHandoff(handoffJson({ headAfter: "not-a-sha", status: "MAYBE" }));
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length >= 2, `expected several problems, saw ${JSON.stringify(bad.problems)}`);
});

test("unparseable output is a failed run, not a run to be guessed at", () => {
  const parsed = parseHandoff("the tests all passed, everything is fine");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.handoff, null);
});

test("the claims with the worst consequences are the ones checked hardest", () => {
  const parsed = parseHandoff(handoffJson());
  const contradictions = findHandoffContradictions({
    handoff: parsed.handoff!,
    observedHeadAfter: "c".repeat(40),
    productionActuallyMutated: true,
  });
  const fields = contradictions.map((c) => c.field);
  assert.ok(fields.includes("headAfter"), "a SHA nobody can find is not a SHA");
  assert.ok(fields.includes("productionMutated"), "production moving during a run that denied it");
  assert.equal(handoffIsTrustworthy(contradictions), false);
});

test("any spend at all contradicts the envelope the run was launched under", () => {
  const parsed = parseHandoff(handoffJson({ spendUsd: 0.01 }));
  const contradictions = findHandoffContradictions({ handoff: parsed.handoff! });
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0]!.field, "spendUsd");
});

test("a handoff agreeing with observation is trustworthy", () => {
  const parsed = parseHandoff(handoffJson());
  const contradictions = findHandoffContradictions({
    handoff: parsed.handoff!,
    observedHeadAfter: "b".repeat(40),
    observedBranch: "executor/claude-director-v01",
    productionActuallyMutated: false,
  });
  assert.deepEqual(contradictions, []);
  assert.equal(handoffIsTrustworthy(contradictions), true);
});

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

test("a second run cannot take a worktree another run holds", () => {
  const first = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: NOW,
  });
  assert.equal(first.ok, true);

  const second = acquireLease({
    existing: [first.lease!], leaseId: "l2", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r2", pid: 200, now: NOW,
  });
  assert.equal(second.ok, false, "two executors in one worktree is a corrupted run");
  assert.equal(second.heldBy!.runId, "r1");
});

test("different worktrees run in parallel, which is the normal case", () => {
  const claude = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-claude",
    missionId: "m1", runId: "r1", now: NOW,
  });
  const grok = acquireLease({
    existing: [claude.lease!], leaseId: "l2", kind: "WORKTREE", resource: "C:/wt-grok",
    missionId: "m1", runId: "r2", now: NOW,
  });
  assert.equal(grok.ok, true, "Claude implementing while Grok reviews is expected");
  assert.equal(conflicts({ kind: "WORKTREE", resource: "C:/wt-claude" }, { kind: "WORKTREE", resource: "C:/wt-grok" }), false);
  assert.equal(conflicts({ kind: "INTEGRATION", resource: "x" }, { kind: "INTEGRATION", resource: "y" }), true);
});

test("an expired lease asks a question rather than granting permission", () => {
  const stale = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: "2026-08-13T10:00:00.000Z",
  }).lease!;

  const attempt = acquireLease({
    existing: [stale], leaseId: "l2", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r2", now: NOW,
  });
  assert.equal(attempt.ok, false, "a stopped heartbeat is not proof the holder is gone");
  assert.equal(attempt.requiresStalenessCheck, true);
});

test("reclaiming requires evidence the holder is actually gone", () => {
  const stale = acquireLease({
    existing: [], leaseId: "l1", kind: "WORKTREE", resource: "C:/wt-a",
    missionId: "m1", runId: "r1", pid: 100, now: "2026-08-13T10:00:00.000Z",
  }).lease!;

  const busy = reclaimStaleLease({
    existing: [stale], kind: "WORKTREE", resource: "C:/wt-a",
    holderProcessAlive: true, now: NOW,
  });
  assert.equal(busy.ok, false, "a loaded machine looks exactly like a dead one from the clock");

  const gone = reclaimStaleLease({
    existing: [stale], kind: "WORKTREE", resource: "C:/wt-a",
    holderProcessAlive: false, now: NOW,
  });
  assert.equal(gone.ok, true);
  assert.deepEqual(gone.remaining, []);
});

test("a heartbeat extends a lease, and release frees it", () => {
  const lease = acquireLease({
    existing: [], leaseId: "l1", kind: "BRANCH", resource: "executor/x",
    missionId: "m1", runId: "r1", now: NOW,
  }).lease!;
  const beat = heartbeat(lease, LATER);
  assert.ok(Date.parse(beat.expiresAt) > Date.parse(lease.expiresAt));
  assert.equal(Date.parse(beat.expiresAt) - Date.parse(LATER), LEASE_TTL_MS);
  assert.deepEqual(releaseLease([beat], "l1"), []);
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

test("the Director is loopback only and never writes business state", () => {
  assert.equal(DIRECTOR_BIND_HOST, "127.0.0.1");
  assert.equal(DIRECTOR_BUSINESS_STATE_WRITER, false);
});
