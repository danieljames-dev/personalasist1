/**
 * Where a mission record is born, and where a restarted Director is allowed to trust one.
 *
 * `advance` fails closed on deployment truth: a context that lost the field, or carried a value
 * outside the union, becomes `UNRECORDED`, which permits neither a first deployment nor completion.
 * That is the right answer for a record whose field disappeared. It is the wrong permanent condition
 * of a mission that has genuinely never deployed. The two are indistinguishable after the fact —
 * absence is absence — so the distinction has to be made at the only moment "this record is new" is
 * actually known: construction.
 *
 * This module is that moment, and the matching reader. The constructor writes `NOT_STARTED` because
 * the caller is creating a mission, not because a default supplied the value. The reader never
 * invents `NOT_STARTED`. A missing or unrecognised `deploymentTruth` becomes `UNRECORDED`. Every
 * other field is validated rather than trusted, because a restarted Director is reading a file an
 * older schema, a hand edit or a torn write may have left behind.
 *
 * Nothing here weakens `mission.ts`. That file is the accepted D1.2 safety checkpoint. Construction
 * and recovery sit in front of it so a legitimate new mission can satisfy the check it already has.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import {
  MISSION_SCHEMA_V1,
  MISSION_STATES,
  type DeploymentTruthV1,
  type MissionStateRecordV1,
  type MissionStateV1,
} from "./mission.js";
import { CONTROL_BYTES } from "./control-bytes.js";
import { validatePathSegment } from "./store-contract.js";

/**
 * The instants this module will persist. Stricter than `Date.parse` alone: a year or a date without
 * a time is a finite parse and not an instant a later process can order against.
 */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Every value the union admits. Copied here because `mission.ts` does not export the membership
 * list, and this reader must not import a private name. A value added to the union without a row
 * here is read as `UNRECORDED`, which is the fail-closed answer rather than a gap.
 */
const DEPLOYMENT_TRUTHS: readonly DeploymentTruthV1[] = [
  "UNRECORDED",
  "NOT_STARTED",
  "MAY_HAVE_WRITTEN",
  "WRITER_FINISHED_UNVERIFIED",
  "VERIFIED_OLD_PRODUCTION",
  "VERIFIED_TARGET_PRODUCTION",
  "VERIFIED_UNEXPECTED",
];

export interface NewMissionInputV1 {
  readonly missionId: string;
  /** The instant recorded as `updatedAt`. The constructor does not consult a clock. */
  readonly now: IsoTimestamp;
}

export type MissionCreateResultV1 =
  | { readonly ok: true; readonly record: MissionStateRecordV1; readonly reason: string }
  | { readonly ok: false; readonly record: null; readonly reason: string };

export type MissionRecordReadV1 =
  | { readonly ok: true; readonly record: MissionStateRecordV1; readonly problems: readonly string[] }
  | { readonly ok: false; readonly record: null; readonly problems: readonly string[] };

/**
 * Mint a mission that has never deployed, and say so on the record.
 *
 * `deploymentTruth` is not taken from the input and is not a default that an omitted field would
 * inherit. The caller is constructing a new mission; that fact is what authorises `NOT_STARTED`.
 * A value smuggled in on a wider object is ignored. An id that cannot be a directory name is
 * refused: the mission id becomes a path segment under the store root.
 */
export function createNewMission(input: NewMissionInputV1): MissionCreateResultV1 {
  if (!isPlainObject(input)) {
    return { ok: false, record: null, reason: "a new mission needs an id and a timestamp" };
  }
  if (typeof input.missionId !== "string") {
    return { ok: false, record: null, reason: "missionId must be a string" };
  }
  const id = validatePathSegment(input.missionId);
  if (!id.ok) {
    return { ok: false, record: null, reason: `missionId is not a usable directory name: ${id.reason}` };
  }
  if (!isIsoTimestamp(input.now)) {
    return { ok: false, record: null, reason: "now is not an ISO-8601 instant in UTC" };
  }

  // Written as a literal on a freshly built object. Not merged from a prototype, not copied from
  // the input, not left for a later default to fill in.
  const record: MissionStateRecordV1 = {
    schema: MISSION_SCHEMA_V1,
    missionId: input.missionId as OpaqueId,
    state: "CREATED",
    resumeState: null,
    interruptedFrom: null,
    deploymentTruth: "NOT_STARTED",
    currentRunId: null,
    currentExecutor: null,
    updatedAt: input.now,
    revision: 1,
  };
  return { ok: true, record, reason: "new mission; no deployment has been attempted" };
}

/**
 * Read a mission record that outlived the process which wrote it.
 *
 * The parsed value is untrusted. A missing or unrecognised `deploymentTruth` becomes `UNRECORDED`
 * — never `NOT_STARTED`, which only the constructor may write. Every other field is required and
 * checked. A corrupt record is refused rather than repaired: guessing at a state, a resume target
 * or a revision is how a hand-edited file finishes a mission.
 */
export function missionRecordFrom(parsed: unknown): MissionRecordReadV1 {
  if (!isPlainObject(parsed)) {
    return { ok: false, record: null, problems: ["mission record is not a JSON object"] };
  }

  const problems: string[] = [];

  const schema = own(parsed, "schema");
  if (schema === undefined) {
    problems.push(`schema is missing; expected ${MISSION_SCHEMA_V1}`);
  } else if (schema !== MISSION_SCHEMA_V1) {
    problems.push(`schema must be ${MISSION_SCHEMA_V1}`);
  }

  let missionId: OpaqueId | null = null;
  const rawId = own(parsed, "missionId");
  if (rawId === undefined) {
    problems.push("missionId is missing");
  } else if (typeof rawId !== "string") {
    problems.push("missionId must be a string");
  } else {
    const id = validatePathSegment(rawId);
    if (!id.ok) problems.push(`missionId is not a usable directory name: ${id.reason}`);
    else missionId = rawId;
  }

  const state = readRequiredState(parsed, "state", problems);

  const resumeState = readNullableState(parsed, "resumeState", problems);
  const interruptedFrom = readNullableState(parsed, "interruptedFrom", problems);

  // Absence and an unknown spelling are the same fact: nobody recorded a member of the union.
  // Mapped, not refused — a pre-field record must reload, and it must reload as uncertain.
  const rawTruth = own(parsed, "deploymentTruth");
  const deploymentTruth: DeploymentTruthV1 =
    (DEPLOYMENT_TRUTHS as readonly unknown[]).includes(rawTruth)
      ? (rawTruth as DeploymentTruthV1)
      : "UNRECORDED";

  let currentRunId: OpaqueId | null = null;
  const rawRunId = own(parsed, "currentRunId");
  if (rawRunId === undefined) {
    problems.push("currentRunId is missing");
  } else if (rawRunId === null) {
    currentRunId = null;
  } else if (typeof rawRunId !== "string") {
    problems.push("currentRunId must be a string or null");
  } else {
    const id = validatePathSegment(rawRunId);
    if (!id.ok) problems.push(`currentRunId is not a usable directory name: ${id.reason}`);
    else currentRunId = rawRunId;
  }

  let currentExecutor: string | null = null;
  const rawExecutor = own(parsed, "currentExecutor");
  if (rawExecutor === undefined) {
    problems.push("currentExecutor is missing");
  } else if (rawExecutor === null) {
    currentExecutor = null;
  } else if (typeof rawExecutor !== "string") {
    problems.push("currentExecutor must be a string or null");
  } else if (rawExecutor === "" || CONTROL_BYTES.test(rawExecutor)) {
    problems.push("currentExecutor is not a usable executor name");
  } else {
    currentExecutor = rawExecutor;
  }

  let updatedAt: IsoTimestamp | null = null;
  const rawUpdated = own(parsed, "updatedAt");
  if (rawUpdated === undefined) {
    problems.push("updatedAt is missing");
  } else if (!isIsoTimestamp(rawUpdated)) {
    problems.push("updatedAt is not an ISO-8601 instant in UTC");
  } else {
    updatedAt = rawUpdated;
  }

  let revision: number | null = null;
  const rawRevision = own(parsed, "revision");
  if (rawRevision === undefined) {
    problems.push("revision is missing");
  } else if (
    typeof rawRevision !== "number"
    || !Number.isInteger(rawRevision)
    || rawRevision < 1
    || rawRevision > Number.MAX_SAFE_INTEGER
  ) {
    problems.push("revision must be a positive integer");
  } else {
    revision = rawRevision;
  }

  if (problems.length > 0 || state === null || missionId === null || updatedAt === null || revision === null) {
    return { ok: false, record: null, problems };
  }

  const record: MissionStateRecordV1 = {
    schema: MISSION_SCHEMA_V1,
    missionId,
    state,
    resumeState,
    interruptedFrom,
    deploymentTruth,
    currentRunId,
    currentExecutor,
    updatedAt,
    revision,
  };
  return { ok: true, record, problems: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string" || value === "") return false;
  if (CONTROL_BYTES.test(value)) return false;
  if (!ISO_UTC.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function readRequiredState(
  obj: Record<string, unknown>,
  key: string,
  problems: string[],
): MissionStateV1 | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    problems.push(`${key} is missing`);
    return null;
  }
  const value = obj[key];
  if (typeof value !== "string" || !(MISSION_STATES as readonly string[]).includes(value)) {
    problems.push(`${key} is not a mission state`);
    return null;
  }
  return value as MissionStateV1;
}

function readNullableState(
  obj: Record<string, unknown>,
  key: string,
  problems: string[],
): MissionStateV1 | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    problems.push(`${key} is missing`);
    return null;
  }
  const value = obj[key];
  if (value === null) return null;
  if (typeof value !== "string" || !(MISSION_STATES as readonly string[]).includes(value)) {
    problems.push(`${key} is not a mission state`);
    return null;
  }
  return value as MissionStateV1;
}
