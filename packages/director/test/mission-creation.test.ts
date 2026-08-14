/**
 * A new mission can deploy. A recovered one that lost its truth cannot.
 *
 * The constructor exists because `establish` cannot tell those apart. Absence is absence, so the
 * only honest place to write `NOT_STARTED` is the moment a caller knows the mission is new. These
 * tests therefore do not stop at the field value. Each case builds a record, serialises it, parses
 * it back, reads it through the fail-closed reader, and asks `advance` what it will then permit.
 * A test that only compared the enum would stay green while the mission was still unable to move.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  MISSION_SCHEMA_V1,
  type DeploymentTruthV1,
  type MissionContextV1,
  type MissionEventKindV1,
  type MissionStateRecordV1,
  type MissionStateV1,
} from "../src/mission.js";
import { createNewMission, missionRecordFrom } from "../src/mission-creation.js";

const NOW = "2026-08-13T12:00:00.000Z";

/**
 * Every prerequisite satisfied, so deployment truth is the only thing that can refuse.
 *
 * A test that left a gate closed would pass for the wrong reason and keep passing after the
 * constructor was deleted.
 */
const ALL_TRUE: MissionContextV1 = {
  unresolvedRequiredGates: 0,
  unsatisfiedMandatoryWorkItems: 0,
  independentWorkRemains: false,
  postIntegrationVerificationPassed: true,
  postDeployVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
  productionWriterLeaseReleasedByThisRun: true,
  deploymentTruth: "NOT_STARTED",
};

const RECORD_KEYS: readonly (keyof MissionStateRecordV1)[] = [
  "schema", "missionId", "state", "resumeState", "interruptedFrom",
  "deploymentTruth", "currentRunId", "currentExecutor", "updatedAt", "revision",
];

function mustCreate(missionId = "mission-new"): MissionStateRecordV1 {
  const created = createNewMission({ missionId, now: NOW });
  if (!created.ok) throw new Error(created.reason);
  return created.record;
}

function mustRead(parsed: unknown): MissionStateRecordV1 {
  const read = missionRecordFrom(parsed);
  if (!read.ok) throw new Error(read.problems.join("; "));
  return read.record;
}

function persistAndReload(value: unknown): MissionStateRecordV1 {
  return mustRead(JSON.parse(JSON.stringify(value)) as unknown);
}

function boardFrom(record: MissionStateRecordV1): MissionContextV1 {
  return { ...ALL_TRUE, deploymentTruth: record.deploymentTruth };
}

function tryDeploy(record: MissionStateRecordV1) {
  return advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: boardFrom(record) });
}

function tryComplete(record: MissionStateRecordV1) {
  return advance("VERIFYING", "MISSION_COMPLETED", null, { context: boardFrom(record) });
}

// ---------------------------------------------------------------------------
// The constructor records NOT_STARTED because it knows the mission is new
// ---------------------------------------------------------------------------

test("createNewMission writes NOT_STARTED as its own field, not as a default", () => {
  const created = createNewMission({ missionId: "mission-new", now: NOW });
  assert.equal(created.ok, true, created.ok ? "" : created.reason);
  if (!created.ok) return;
  const record = created.record;
  assert.equal(record.schema, MISSION_SCHEMA_V1);
  assert.equal(record.missionId, "mission-new");
  assert.equal(record.state, "CREATED");
  assert.equal(record.resumeState, null);
  assert.equal(record.interruptedFrom, null);
  assert.equal(record.currentRunId, null);
  assert.equal(record.currentExecutor, null);
  assert.equal(record.updatedAt, NOW);
  assert.equal(record.revision, 1);
  assert.ok(
    Object.prototype.hasOwnProperty.call(record, "deploymentTruth"),
    "NOT_STARTED must be a recorded property, not an inherited default",
  );
  assert.equal(record.deploymentTruth, "NOT_STARTED");
  for (const key of RECORD_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, key), `${key} must be present on a new record`);
  }
});

test("a deploymentTruth smuggled on the input cannot choose what a new mission records", () => {
  const sneaky = {
    missionId: "mission-new",
    now: NOW,
    deploymentTruth: "MAY_HAVE_WRITTEN" as DeploymentTruthV1,
  };
  const created = createNewMission(sneaky);
  assert.equal(created.ok, true, created.ok ? "" : created.reason);
  if (!created.ok) return;
  assert.equal(created.record.deploymentTruth, "NOT_STARTED");
});

test("an id that cannot be a directory name never becomes a mission", () => {
  const refused: readonly string[] = [
    "",
    "..",
    "m1/r1",
    "m1\\r1",
    "CON",
    "NUL",
    "COM1",
    "run1.",
    "run1 ",
    "mission\u0000id",
  ];
  for (const missionId of refused) {
    const created = createNewMission({ missionId, now: NOW });
    assert.equal(created.ok, false, `${JSON.stringify(missionId)} must not become a directory`);
    assert.equal(created.record, null);
  }
  const badTime = createNewMission({ missionId: "mission-new", now: "yesterday" });
  assert.equal(badTime.ok, false);
  assert.equal(badTime.record, null);
});

// ---------------------------------------------------------------------------
// The three cases: persist, reload, then ask advance
// ---------------------------------------------------------------------------

test("createNewMission → persist → reload is NOT_STARTED, and the mission can deploy", () => {
  const created = mustCreate();
  const reloaded = persistAndReload(created);
  assert.equal(reloaded.deploymentTruth, "NOT_STARTED");
  assert.equal(reloaded.state, "CREATED");

  const started = tryDeploy(reloaded);
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.to, "DEPLOYING");
  assert.equal(started.deploymentTruth, "MAY_HAVE_WRITTEN");

  const completed = tryComplete(reloaded);
  assert.equal(completed.ok, true, completed.reason);
  assert.equal(completed.to, "COMPLETED");
});

test("a legacy record with no deploymentTruth field is UNRECORDED and cannot deploy", () => {
  const created = mustCreate();
  const { deploymentTruth: _dropped, ...legacy } = created;
  const serialised = JSON.stringify(legacy);
  assert.equal(serialised.includes("deploymentTruth"), false, "the fixture must actually omit the field");

  const reloaded = persistAndReload(legacy);
  assert.equal(reloaded.deploymentTruth, "UNRECORDED");

  const started = tryDeploy(reloaded);
  assert.equal(started.ok, false, "absence is not permission to write production");
  assert.equal(started.to, null);
  assert.match(started.reason, /nothing on record says/);

  const completed = tryComplete(reloaded);
  assert.equal(completed.ok, false, "a mission that cannot say what it did to production has not finished");
  assert.equal(completed.to, null);
});

test("a corrupt or unknown-enum deploymentTruth is UNRECORDED and cannot deploy", () => {
  const created = mustCreate();
  const forged: readonly unknown[] = [
    "UNKNOWN",
    "ROLLED_BACK",
    "may_have_written",
    "MAY_HAVE_WRITTEN ",
    "NOT_STARTED ",
    "",
    0,
    1,
    true,
    {},
    [],
    null,
  ];
  for (const value of forged) {
    const reloaded = persistAndReload({ ...created, deploymentTruth: value });
    assert.equal(reloaded.deploymentTruth, "UNRECORDED", `${describe(value)} must not be trusted as truth`);

    const started = tryDeploy(reloaded);
    assert.equal(started.ok, false, `${describe(value)} must not authorise a production write`);
    assert.equal(started.to, null);

    const completed = tryComplete(reloaded);
    assert.equal(completed.ok, false, `${describe(value)} must not complete a mission`);
    assert.equal(completed.to, null);
  }
});

// ---------------------------------------------------------------------------
// The test that matters most: a legitimate new mission can still move
// ---------------------------------------------------------------------------

test("LIVENESS: a newly created mission can reach a deployment and then complete", () => {
  // Every other check in this package hunts for permission granted wrongly. A machine that
  // permits nothing at all passes all of them. This one fails if a brand-new mission cannot
  // make forward progress — which is the failure the fail-closed defaults would otherwise hide.
  const reloaded = persistAndReload(mustCreate("mission-live"));
  assert.equal(reloaded.deploymentTruth, "NOT_STARTED");
  assert.equal(reloaded.state, "CREATED");

  const toReady: readonly MissionEventKindV1[] = [
    "MISSION_AUTHORIZED",
    "PLAN_SELECTED",
    "EXECUTOR_STARTED",
    "EXECUTOR_COMPLETED",
    "GIT_VERIFIED",
    "REVIEW_REQUESTED",
    "REVIEW_COMPLETED",
    "INTEGRATION_STARTED",
    "INTEGRATION_COMPLETED",
    "POST_INTEGRATION_VERIFIED",
  ];

  let state: MissionStateV1 = reloaded.state;
  let truth: DeploymentTruthV1 = reloaded.deploymentTruth;
  for (const event of toReady) {
    const moved = advance(state, event, null, { context: { ...ALL_TRUE, deploymentTruth: truth } });
    assert.equal(moved.ok, true, `${event} from ${state} must succeed: ${moved.reason}`);
    assert.ok(moved.to, `${event} from ${state} must name a destination`);
    state = moved.to;
    if (moved.deploymentTruth !== null) truth = moved.deploymentTruth;
  }
  assert.equal(state, "READY_FOR_DEPLOYMENT");
  assert.equal(truth, "NOT_STARTED", "the walk must not invent a deployment that has not happened");

  const started = advance(state, "DEPLOY_STARTED", null, { context: { ...ALL_TRUE, deploymentTruth: truth } });
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.to, "DEPLOYING");
  assert.equal(started.deploymentTruth, "MAY_HAVE_WRITTEN");
  state = started.to;
  truth = started.deploymentTruth;

  const finished = advance(state, "DEPLOY_COMPLETED", null, {
    context: { ...ALL_TRUE, deploymentTruth: truth },
  });
  assert.equal(finished.ok, true, finished.reason);
  assert.equal(finished.to, "POST_DEPLOY_VERIFY");
  assert.equal(finished.deploymentTruth, "WRITER_FINISHED_UNVERIFIED");
  state = finished.to;
  truth = finished.deploymentTruth ?? truth;

  const observed = advance(state, "PRODUCTION_VERIFIED_TARGET", null, {
    context: { ...ALL_TRUE, deploymentTruth: truth },
  });
  assert.equal(observed.ok, true, observed.reason);
  assert.equal(observed.deploymentTruth, "VERIFIED_TARGET_PRODUCTION");
  truth = observed.deploymentTruth ?? truth;

  const done = advance(state, "MISSION_COMPLETED", null, {
    context: { ...ALL_TRUE, deploymentTruth: truth },
  });
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.to, "COMPLETED");
});

// ---------------------------------------------------------------------------
// The reader validates every other field rather than trusting it
// ---------------------------------------------------------------------------

test("a well-formed in-flight record keeps the truth it actually recorded", () => {
  const inFlight: MissionStateRecordV1 = {
    schema: MISSION_SCHEMA_V1,
    missionId: "mission-fly",
    state: "DEPLOYING",
    resumeState: null,
    interruptedFrom: null,
    deploymentTruth: "MAY_HAVE_WRITTEN",
    currentRunId: "run-1",
    currentExecutor: "grok",
    updatedAt: NOW,
    revision: 7,
  };
  const reloaded = persistAndReload(inFlight);
  assert.equal(reloaded.deploymentTruth, "MAY_HAVE_WRITTEN");
  assert.equal(reloaded.state, "DEPLOYING");
  assert.equal(reloaded.currentRunId, "run-1");
  assert.equal(tryDeploy(reloaded).ok, false, "an in-flight write must not authorise a second one");
});

test("the reader refuses a corrupt record rather than guessing at it", () => {
  const base = mustCreate();
  const attacks: readonly { label: string; value: unknown }[] = [
    { label: "not an object", value: "CREATED" },
    { label: "array", value: [base] },
    { label: "null", value: null },
    { label: "wrong schema", value: { ...base, schema: "aion.director.mission.v0" } },
    { label: "missing schema", value: omit(base, "schema") },
    { label: "unknown state", value: { ...base, state: "ROLLING_BACK" } },
    { label: "missing state", value: omit(base, "state") },
    { label: "bad resumeState", value: { ...base, resumeState: "not-a-state" } },
    { label: "missing resumeState", value: omit(base, "resumeState") },
    { label: "bad interruptedFrom", value: { ...base, interruptedFrom: "toString" } },
    { label: "missing interruptedFrom", value: omit(base, "interruptedFrom") },
    { label: "unsafe mission id", value: { ...base, missionId: "NUL" } },
    { label: "path-escaping mission id", value: { ...base, missionId: "../other" } },
    { label: "unsafe run id", value: { ...base, currentRunId: "COM1" } },
    { label: "missing currentRunId", value: omit(base, "currentRunId") },
    { label: "missing currentExecutor", value: omit(base, "currentExecutor") },
    { label: "empty executor", value: { ...base, currentExecutor: "" } },
    { label: "revision zero", value: { ...base, revision: 0 } },
    { label: "fractional revision", value: { ...base, revision: 1.5 } },
    { label: "revision string", value: { ...base, revision: "1" } },
    { label: "missing revision", value: omit(base, "revision") },
    { label: "bad timestamp", value: { ...base, updatedAt: "2026-08-13" } },
    { label: "missing timestamp", value: omit(base, "updatedAt") },
  ];
  for (const attack of attacks) {
    const read = missionRecordFrom(JSON.parse(JSON.stringify(attack.value)) as unknown);
    assert.equal(read.ok, false, `${attack.label} must be refused`);
    assert.equal(read.record, null, `${attack.label} must not yield a record`);
    assert.ok(read.problems.length > 0, `${attack.label} must name a problem`);
  }
});

test("every recognised deployment truth survives persist and reload unchanged", () => {
  const created = mustCreate();
  const truths: readonly DeploymentTruthV1[] = [
    "UNRECORDED",
    "NOT_STARTED",
    "MAY_HAVE_WRITTEN",
    "WRITER_FINISHED_UNVERIFIED",
    "VERIFIED_OLD_PRODUCTION",
    "VERIFIED_TARGET_PRODUCTION",
    "VERIFIED_UNEXPECTED",
  ];
  for (const truth of truths) {
    const reloaded = persistAndReload({ ...created, deploymentTruth: truth });
    assert.equal(reloaded.deploymentTruth, truth, `${truth} must not be rewritten by the reader`);
  }
});

function omit(record: MissionStateRecordV1, key: keyof MissionStateRecordV1): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...record };
  delete copy[key];
  return copy;
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return Object.prototype.toString.call(value);
}
