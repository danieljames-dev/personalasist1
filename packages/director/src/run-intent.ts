/**
 * The record written before anything is launched.
 *
 * A run intent says: the Director decided to launch this, with these arguments, in this directory.
 * It is written and flushed to disk *before* the process is spawned, so a crash in between never
 * reads as "nothing was ever attempted". An existing readable intent at this path is unresolvable,
 * not resumable: a crash may have left a live child, and the file cannot tell that from a clean
 * abort. After a reboot the file still answers: was this supposed to run; did it start; which
 * worktree, branch, mission and work item; what exact executable and argv; the run nonce; when
 * the intent was written; when the spawn was observed.
 *
 * Known limit, not closed this round: if both durable records (intent.json and
 * result.json) are wiped and the lease is released, nothing durable binds
 * `runId` to "already executed". The same runId can spawn again because the
 * record is addressed by path.
 *
 * ## The ordering is the property
 *
 * The only value that permits a spawn is returned after the intent has been durably written and
 * read back. A caller cannot obtain that value first and persist later, because the persist
 * function is the only constructor. If the write fails, the spawn-permitting value does not exist.
 * A failed persist is a refusal, not a warning.
 *
 * The record is for a person debugging at 2am. It carries no secrets, no environment, and no
 * prompt body — only paths, ids, argv the Director built, and the identity recorded after spawn.
 */
import { readFileSync } from "node:fs";
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import { writeAtomic } from "./atomic-write.js";
import { CONTROL_BYTES, asUsableToken } from "./control-bytes.js";
import { redactLogText } from "./bounded-log.js";
import { isResolvedHostPath } from "./host-path.js";
import {
  isPlaceableInstant,
  isUsablePid,
  processIdentityFrom,
  type ExecutorProcessIdentityV1,
} from "./process-identity.js";
import { isExecutorRole, type ExecutorRoleV1 } from "./executors.js";
import { validatePathSegment } from "./store-contract.js";

export const RUN_INTENT_SCHEMA_V1 = "aion.director.run-intent.v1" as const;

const SPAWN_PERMIT = Symbol("aion.director.spawn-permit.v1");

/** Values this module minted. A property read asks "does this look like a permit"; membership asks "did I mint this". */
const MINTED_PERMITS = new WeakSet<object>();

/** Minted permits already spent by a spawn. Membership, not a property. */
const CONSUMED_PERMITS = new WeakSet<object>();

export interface RunIntentV1 {
  readonly schema: typeof RUN_INTENT_SCHEMA_V1;
  readonly runId: OpaqueId;
  readonly missionId: OpaqueId;
  readonly workItemId: OpaqueId;
  readonly worktree: string;
  readonly branch: string | null;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly runNonce: string;
  readonly intendedAt: IsoTimestamp;
  readonly spawnAttemptedAt: IsoTimestamp | null;
  readonly spawnPid: number | null;
  readonly spawnObservedAt: IsoTimestamp | null;
  readonly processIdentity: ExecutorProcessIdentityV1 | null;
  /** Always false on a record this module wrote. Stated so a 2am reader does not have to guess. */
  readonly secretsPresent: false;
  readonly promptPath?: string;
  readonly role?: ExecutorRoleV1;
  /**
   * Keys of the environment object handed to the child (not values).
   * Values can contain secrets; keys are the durable record of what
   * a bypassPermissions executor was given.
   */
  readonly childEnvKeys?: readonly string[];
}

export interface PersistRunIntentInputV1 {
  readonly intentPath: string;
  readonly runId: string;
  readonly missionId: string;
  readonly workItemId: string;
  readonly worktree: string;
  readonly branch: string | null;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly runNonce: string;
  readonly now: IsoTimestamp;
  readonly promptPath?: string;
  readonly role?: ExecutorRoleV1;
  readonly childEnvKeys?: readonly string[];
}

/**
 * Disk, injected so a failed persist is a test rather than a hope.
 *
 * `writeDurable` must flush. A store that writes and returns without a flush is how a crash
 * between "we wrote" and "the disk has it" reads as "nothing was ever attempted".
 */
export interface IntentStoreV1 {
  writeDurable(absolutePath: string, utf8: string): void;
  readUtf8(absolutePath: string): string;
}

/**
 * The launch this permit authorises. Copied at mint time so a later spawn is
 * checked against what was persisted, not against whatever the caller passes.
 */
export interface AuthorisedSpawnV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly runId: OpaqueId;
  readonly runNonce: string;
}

/**
 * The only value that makes a spawn legal.
 *
 * Produced solely by {@link persistRunIntent} after write-and-read-back. There is no public
 * constructor: {@link isSpawnPermit} is set membership, not a property read, so an inherited
 * brand or a Proxy cannot satisfy the gate. {@link spendSpawnPermit} binds the launch to
 * {@link AuthorisedSpawnV1} and consumes the handle.
 */
export interface SpawnPermitV1 {
  readonly [SPAWN_PERMIT]: true;
  readonly intentPath: string;
  readonly intent: RunIntentV1;
  readonly authorised: AuthorisedSpawnV1;
}

export type PersistRunIntentResultV1 =
  | { readonly ok: true; readonly permit: SpawnPermitV1; readonly intent: RunIntentV1; readonly reason: string }
  | { readonly ok: false; readonly permit: null; readonly intent: null; readonly reason: string };

export type ReadRunIntentResultV1 =
  | { readonly ok: true; readonly intent: RunIntentV1; readonly path: string; readonly reason: string }
  | { readonly ok: false; readonly intent: null; readonly path: string; readonly reason: string };

export type WithPersistedIntentV1<T> =
  | {
      readonly ok: true;
      readonly permit: SpawnPermitV1;
      readonly intent: RunIntentV1;
      readonly launched: T;
      readonly reason: string;
    }
  | {
      readonly ok: false;
      readonly permit: null;
      readonly intent: null;
      readonly launched: null;
      readonly reason: string;
    };

/**
 * What a later process can answer from the file alone, with nothing alive and no chat to read.
 */
export interface RebootAnswersV1 {
  readonly supposedToRun: boolean;
  readonly started: boolean;
  readonly worktree: string | null;
  readonly branch: string | null;
  readonly missionId: string | null;
  readonly workItemId: string | null;
  readonly executablePath: string | null;
  readonly argv: readonly string[] | null;
  readonly runNonce: string | null;
  readonly intentWrittenAt: IsoTimestamp | null;
  readonly spawnAttemptedAt: IsoTimestamp | null;
  readonly spawnPid: number | null;
  readonly spawnObservedAt: IsoTimestamp | null;
}

/**
 * Write the intent, flush it, read it back, and only then return the spawn permit.
 *
 * If any of those steps fail, `permit` is null and a spawn is impossible. The failure is the
 * result, not a log line next to a successful launch.
 *
 * An existing readable intent at this path is unresolvable, not resumable. `existing !== "none"`
 * is a refusal — including `"unstarted"`. A crash between persist and `recordSpawnAttempt` leaves
 * the same bytes as a clean abort, and a reminted permit is a second executor.
 */
export function persistRunIntent(
  input: PersistRunIntentInputV1,
  store: IntentStoreV1 = createNodeIntentStore(),
): PersistRunIntentResultV1 {
  const built = buildIntent(input);
  if (!built.ok) return built;

  const { intent, intentPath } = built;
  const existing = existingIntentOn(store, intentPath);
  if (existing !== "none") {
    if (existing === "spawned") {
      return refused("a recorded spawn already exists; refusing to overwrite it");
    }
    if (existing === "unreadable") {
      return refused("an existing intent at this path is unreadable; refusing to overwrite it");
    }
    return refused("an existing intent at this path is unresolvable; refusing to overwrite it");
  }

  const serialised = serialiseIntent(intent);

  // KNOWN LIMIT, next to the permit mint: writeAtomic opens the temp with
  // `w` (create-or-truncate), not O_EXCL. Two Director processes that both
  // observe `existing === "none"` can both persist and both receive a permit.
  // Single-process-correct only.
  try {
    store.writeDurable(intentPath, serialised);
  } catch (error) {
    return refused(`persist failed; spawn is refused: ${errorMessage(error)}`);
  }

  let raw: string;
  try {
    raw = store.readUtf8(intentPath);
  } catch (error) {
    return refused(`read-back failed; spawn is refused: ${errorMessage(error)}`);
  }

  const readBack = runIntentFrom(parseJson(raw));
  if (!readBack.ok) {
    return refused(`read-back did not parse; spawn is refused: ${readBack.reason}`);
  }
  if (!sameIntent(intent, readBack.intent)) {
    return refused("read-back does not match what was written; spawn is refused");
  }

  return {
    ok: true,
    permit: makePermit(intentPath, readBack.intent),
    intent: readBack.intent,
    reason: "intent is durable; spawn is permitted",
  };
}

/**
 * Persist, then call `launch` with the permit. If persist fails, `launch` is not called.
 *
 * This is the shape a caller cannot invert: there is no launch handle to invoke on the failure
 * path, because the failure path never received one.
 */
export function withPersistedIntent<T>(
  input: PersistRunIntentInputV1,
  launch: (permit: SpawnPermitV1) => T,
  store: IntentStoreV1 = createNodeIntentStore(),
): WithPersistedIntentV1<T> {
  const persisted = persistRunIntent(input, store);
  if (!persisted.ok) {
    return { ok: false, permit: null, intent: null, launched: null, reason: persisted.reason };
  }
  return {
    ok: true,
    permit: persisted.permit,
    intent: persisted.intent,
    launched: launch(persisted.permit),
    reason: persisted.reason,
  };
}

/** True only for a permit this module minted after a durable write. */
export function isSpawnPermit(value: unknown): value is SpawnPermitV1 {
  return typeof value === "object" && value !== null && MINTED_PERMITS.has(value);
}

/**
 * The spawn gate. A missing or forged permit throws; it does not return a "best-effort" go-ahead.
 *
 * This does not spend the permit. Membership is reusable so a caller can check
 * before handing the same handle to the spawner. Spending happens in
 * {@link spendSpawnPermit}.
 */
export function requireSpawnPermit(value: unknown): SpawnPermitV1 {
  if (!isSpawnPermit(value)) {
    throw new Error("spawn is refused: no durable run intent permit");
  }
  return value;
}

/** True only for a minted permit that {@link spendSpawnPermit} has already consumed. */
export function isSpawnPermitSpent(value: unknown): boolean {
  return isSpawnPermit(value) && CONSUMED_PERMITS.has(value);
}

/**
 * Membership plus the authorised `{executable, argv, cwd}` binding.
 *
 * Does not spend. The node spawner uses this after the run manager has already
 * consumed the permit so the same rule can deny twice.
 */
export function assertSpawnPermitBinding(
  value: unknown,
  launch: { readonly executable: string; readonly argv: readonly string[]; readonly cwd: string },
): SpawnPermitV1 {
  const permit = requireSpawnPermit(value);
  if (!launchMatchesAuthorised(permit.authorised, launch)) {
    throw new Error("spawn is refused: launch does not match the persisted intent");
  }
  return permit;
}

/**
 * Bind a launch to the permit and spend it.
 *
 * The authorised `{executable, argv, cwd, runId, runNonce}` was copied at mint
 * time. A mismatch is a refusal, not a different process. The first matching
 * spend consumes the permit; a second spawn with the same handle is refused.
 * A reminted permit for an intent that already recorded a spawn is born spent.
 */
export function spendSpawnPermit(
  value: unknown,
  launch: { readonly executable: string; readonly argv: readonly string[]; readonly cwd: string },
): SpawnPermitV1 {
  const permit = requireSpawnPermit(value);
  if (CONSUMED_PERMITS.has(permit)) {
    throw new Error("spawn is refused: permit has already been spent");
  }
  if (!launchMatchesAuthorised(permit.authorised, launch)) {
    throw new Error("spawn is refused: launch does not match the persisted intent");
  }
  CONSUMED_PERMITS.add(permit);
  return permit;
}

/**
 * Record that `spawn` returned, under the permit that authorised it.
 *
 * This is written before identity capture. A probe that cannot see the process (access-denied,
 * another account, an elevated executor) must not leave the intent looking like nothing started.
 * `started` after a reboot is this record, not a successful probe.
 */
export function recordSpawnAttempt(input: {
  readonly permit: SpawnPermitV1;
  readonly pid: number;
  readonly now: IsoTimestamp;
  readonly store?: IntentStoreV1;
}): PersistRunIntentResultV1 {
  if (!isSpawnPermit(input.permit)) {
    return refused("spawn attempt is refused: no durable run intent permit");
  }
  if (!isIsoTimestamp(input.now)) {
    return refused("spawnAttemptedAt is not an ISO-8601 instant in UTC");
  }

  const store = input.store ?? createNodeIntentStore();
  const current = readRunIntent(input.permit.intentPath, store);
  if (!current.ok) {
    return refused(`cannot record spawn attempt against an unreadable intent: ${current.reason}`);
  }
  if (!permitMatchesIntent(input.permit, current.intent)) {
    return refused("permit is not bound to the intent at this path; refusing to record a spawn for a different run");
  }

  const pid = isUsablePid(input.pid) ? input.pid : null;

  if (current.intent.spawnAttemptedAt !== null || current.intent.spawnPid !== null) {
    if (current.intent.spawnPid !== null && pid !== null && current.intent.spawnPid !== pid) {
      return refused("a different spawn pid is already recorded; refusing to overwrite it");
    }
    return {
      ok: true,
      permit: makePermit(current.path, current.intent),
      intent: current.intent,
      reason: "spawn attempt already recorded",
    };
  }

  const updated: RunIntentV1 = {
    ...current.intent,
    spawnAttemptedAt: input.now,
    spawnPid: pid,
  };
  const serialised = serialiseIntent(updated);

  try {
    store.writeDurable(current.path, serialised);
  } catch (error) {
    return refused(`recording spawn attempt failed: ${errorMessage(error)}`);
  }

  const readBack = readRunIntent(current.path, store);
  if (!readBack.ok) {
    return refused(`spawn attempt read-back failed: ${readBack.reason}`);
  }
  if (readBack.intent.spawnAttemptedAt === null) {
    return refused("spawn attempt read-back has no spawnAttemptedAt; the start is not recorded");
  }

  return {
    ok: true,
    permit: makePermit(readBack.path, readBack.intent),
    intent: readBack.intent,
    reason: "spawn attempt is durable",
  };
}

/**
 * Record that a spawn was observed, under the permit that authorised it.
 *
 * The identity is written only after the intent already exists. Calling this without a permit is
 * a refusal, so a crash between persist and spawn cannot be papered over by inventing a start.
 */
export function recordSpawnObservation(input: {
  readonly permit: SpawnPermitV1;
  readonly identity: ExecutorProcessIdentityV1;
  readonly now: IsoTimestamp;
  readonly store?: IntentStoreV1;
}): PersistRunIntentResultV1 {
  if (!isSpawnPermit(input.permit)) {
    return refused("spawn observation is refused: no durable run intent permit");
  }
  if (!isIsoTimestamp(input.now)) {
    return refused("spawnObservedAt is not an ISO-8601 instant in UTC");
  }
  const parsedIdentity = processIdentityFrom(input.identity);
  if (!parsedIdentity.ok) {
    return refused(`process identity is not recordable: ${parsedIdentity.reason}`);
  }

  const store = input.store ?? createNodeIntentStore();
  const current = readRunIntent(input.permit.intentPath, store);
  if (!current.ok) {
    return refused(`cannot record spawn against an unreadable intent: ${current.reason}`);
  }
  if (!permitMatchesIntent(input.permit, current.intent)) {
    return refused("permit is not bound to the intent at this path; refusing to record a spawn for a different run");
  }

  if (current.intent.processIdentity !== null) {
    if (!sameRecordedIdentity(current.intent.processIdentity, parsedIdentity.identity)) {
      return refused("a different process identity is already recorded; refusing to overwrite it");
    }
    return {
      ok: true,
      permit: makePermit(current.path, current.intent),
      intent: current.intent,
      reason: "spawn observation already recorded",
    };
  }

  const updated: RunIntentV1 = {
    ...current.intent,
    spawnObservedAt: input.now,
    processIdentity: parsedIdentity.identity,
  };
  const serialised = serialiseIntent(updated);

  try {
    store.writeDurable(current.path, serialised);
  } catch (error) {
    return refused(`recording spawn observation failed: ${errorMessage(error)}`);
  }

  const readBack = readRunIntent(current.path, store);
  if (!readBack.ok) {
    return refused(`spawn observation read-back failed: ${readBack.reason}`);
  }
  if (readBack.intent.processIdentity === null) {
    return refused("spawn observation read-back has no process identity; the start is not recorded");
  }

  return {
    ok: true,
    permit: makePermit(readBack.path, readBack.intent),
    intent: readBack.intent,
    reason: "spawn observation is durable",
  };
}

/** Read the file a restarted Director finds after a reboot. */
export function readRunIntent(
  intentPath: string,
  store: IntentStoreV1 = createNodeIntentStore(),
): ReadRunIntentResultV1 {
  let raw: string;
  try {
    raw = store.readUtf8(intentPath);
  } catch (error) {
    return { ok: false, intent: null, path: intentPath, reason: `intent could not be read: ${errorMessage(error)}` };
  }
  const parsed = runIntentFrom(parseJson(raw));
  if (!parsed.ok) {
    return { ok: false, intent: null, path: intentPath, reason: parsed.reason };
  }
  return { ok: true, intent: parsed.intent, path: intentPath, reason: "intent reloaded" };
}

/**
 * Read an untrusted parsed document. A corrupt record is refused rather than repaired: guessing
 * at an identity or a nonce is how a hand-edited file reports that a run started.
 */
export function runIntentFrom(parsed: unknown): { ok: true; intent: RunIntentV1 } | { ok: false; reason: string } {
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "run intent is not a JSON object" };
  }
  if (own(parsed, "schema") !== RUN_INTENT_SCHEMA_V1) {
    return { ok: false, reason: `schema must be ${RUN_INTENT_SCHEMA_V1}` };
  }

  const runId = readId(parsed, "runId");
  if (runId === null) return { ok: false, reason: "runId is not a usable directory name" };
  const missionId = readId(parsed, "missionId");
  if (missionId === null) return { ok: false, reason: "missionId is not a usable directory name" };
  const workItemId = readId(parsed, "workItemId");
  if (workItemId === null) return { ok: false, reason: "workItemId is not a usable directory name" };

  const worktree = readHostPath(parsed, "worktree");
  if (worktree === null) return { ok: false, reason: "worktree is not an identifiable absolute path" };
  const cwd = readHostPath(parsed, "cwd");
  if (cwd === null) return { ok: false, reason: "cwd is not an identifiable absolute path" };
  const executablePath = readHostPath(parsed, "executablePath");
  if (executablePath === null) return { ok: false, reason: "executablePath is not an identifiable absolute path" };

  const rawBranch = own(parsed, "branch");
  let branch: string | null;
  if (rawBranch === null) {
    branch = null;
  } else if (typeof rawBranch === "string") {
    const token = asUsableToken(rawBranch);
    if (token === null || token.includes("..")) {
      return { ok: false, reason: "branch is not a usable ref name" };
    }
    branch = token;
  } else {
    return { ok: false, reason: "branch must be a string or null" };
  }

  const rawArgv = own(parsed, "argv");
  if (!Array.isArray(rawArgv) || !rawArgv.every((item) => typeof item === "string")) {
    return { ok: false, reason: "argv must be an array of strings" };
  }
  const argv: string[] = [];
  for (const item of rawArgv) {
    if (CONTROL_BYTES.test(item)) return { ok: false, reason: "argv contains a control byte" };
    argv.push(item);
  }

  const runNonce = asUsableToken(own(parsed, "runNonce"));
  if (runNonce === null) return { ok: false, reason: "runNonce is empty or contains control bytes" };

  const intendedAt = own(parsed, "intendedAt");
  if (!isIsoTimestamp(intendedAt)) return { ok: false, reason: "intendedAt is not an ISO-8601 instant in UTC" };

  const rawAttempted = own(parsed, "spawnAttemptedAt");
  let spawnAttemptedAt: IsoTimestamp | null;
  if (rawAttempted === null || rawAttempted === undefined) {
    spawnAttemptedAt = null;
  } else if (isIsoTimestamp(rawAttempted)) {
    spawnAttemptedAt = rawAttempted;
  } else {
    return { ok: false, reason: "spawnAttemptedAt is not an ISO-8601 instant in UTC" };
  }

  const rawSpawnPid = own(parsed, "spawnPid");
  let spawnPid: number | null;
  if (rawSpawnPid === null || rawSpawnPid === undefined) {
    spawnPid = null;
  } else if (isUsablePid(rawSpawnPid)) {
    spawnPid = rawSpawnPid;
  } else {
    return { ok: false, reason: "spawnPid is not a positive integer" };
  }

  const rawSpawned = own(parsed, "spawnObservedAt");
  let spawnObservedAt: IsoTimestamp | null;
  if (rawSpawned === null || rawSpawned === undefined) {
    spawnObservedAt = null;
  } else if (isIsoTimestamp(rawSpawned)) {
    spawnObservedAt = rawSpawned;
  } else {
    return { ok: false, reason: "spawnObservedAt is not an ISO-8601 instant in UTC" };
  }

  const rawIdentity = own(parsed, "processIdentity");
  let processIdentity: ExecutorProcessIdentityV1 | null;
  if (rawIdentity === null || rawIdentity === undefined) {
    processIdentity = null;
  } else {
    const identity = processIdentityFrom(rawIdentity);
    if (!identity.ok) return { ok: false, reason: `processIdentity is unreadable: ${identity.reason}` };
    processIdentity = identity.identity;
  }

  const promptRaw = own(parsed, "promptPath");
  let promptPath: string | undefined;
  if (promptRaw !== undefined && promptRaw !== null) {
    const path = asUsableToken(promptRaw);
    if (path === null || !isResolvedHostPath(path)) {
      return { ok: false, reason: "promptPath is not an identifiable absolute path" };
    }
    promptPath = path;
  }

  const roleRaw = own(parsed, "role");
  let role: ExecutorRoleV1 | undefined;
  if (roleRaw !== undefined && roleRaw !== null) {
    if (!isExecutorRole(roleRaw)) {
      return { ok: false, reason: "role is not an enumerated executor role" };
    }
    role = roleRaw;
  }

  const childEnvKeysRaw = own(parsed, "childEnvKeys");
  let childEnvKeys: readonly string[] | undefined;
  if (childEnvKeysRaw !== undefined && childEnvKeysRaw !== null) {
    if (!Array.isArray(childEnvKeysRaw) || !childEnvKeysRaw.every((item) => typeof item === "string")) {
      return { ok: false, reason: "childEnvKeys must be an array of strings" };
    }
    const keys: string[] = [];
    for (const item of childEnvKeysRaw) {
      if (CONTROL_BYTES.test(item)) return { ok: false, reason: "childEnvKeys contains a control byte" };
      keys.push(item);
    }
    childEnvKeys = Object.freeze(keys);
  }

  const intent: RunIntentV1 = {
    schema: RUN_INTENT_SCHEMA_V1,
    runId,
    missionId,
    workItemId,
    worktree,
    branch,
    executablePath,
    argv: Object.freeze([...argv]),
    cwd,
    runNonce,
    intendedAt,
    spawnAttemptedAt,
    spawnPid,
    spawnObservedAt,
    processIdentity,
    secretsPresent: false,
    ...(promptPath !== undefined ? { promptPath } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(childEnvKeys !== undefined ? { childEnvKeys } : {}),
  };
  return { ok: true, intent };
}

/**
 * The reboot questions, answered from the record alone.
 *
 * `supposedToRun` is the existence of an executable and argv. `started` is a recorded spawn
 * attempt — the pid and time written when `spawn` returned — not a successful identity probe,
 * which a reboot may not be able to make, and not a missing file, which is how "we never tried"
 * used to look. Absence of `processIdentity` is not "never started".
 */
export function answersAfterReboot(intent: RunIntentV1 | null | undefined): RebootAnswersV1 {
  if (intent === null || intent === undefined) {
    return {
      supposedToRun: false,
      started: false,
      worktree: null,
      branch: null,
      missionId: null,
      workItemId: null,
      executablePath: null,
      argv: null,
      runNonce: null,
      intentWrittenAt: null,
      spawnAttemptedAt: null,
      spawnPid: null,
      spawnObservedAt: null,
    };
  }
  return {
    supposedToRun: intent.executablePath !== "" && Array.isArray(intent.argv),
    started: intent.spawnAttemptedAt !== null || intent.spawnPid !== null || intent.processIdentity !== null,
    worktree: intent.worktree,
    branch: intent.branch,
    missionId: intent.missionId,
    workItemId: intent.workItemId,
    executablePath: intent.executablePath,
    argv: intent.argv,
    runNonce: intent.runNonce,
    intentWrittenAt: intent.intendedAt,
    spawnAttemptedAt: intent.spawnAttemptedAt,
    spawnPid: intent.spawnPid,
    spawnObservedAt: intent.spawnObservedAt,
  };
}

/** Temp file, fsync, rename — the durability contract `store-contract.ts` names and this realises. */
export function createNodeIntentStore(): IntentStoreV1 {
  return {
    writeDurable(absolutePath: string, utf8: string): void {
      if (!isResolvedHostPath(absolutePath)) {
        throw new Error("intent path is not an identifiable absolute path");
      }
      writeAtomic(absolutePath, utf8);
    },
    readUtf8(absolutePath: string): string {
      return readFileSync(absolutePath, "utf8");
    },
  };
}

type BuiltIntentV1 =
  | { readonly ok: true; readonly intent: RunIntentV1; readonly intentPath: string }
  | { readonly ok: false; readonly permit: null; readonly intent: null; readonly reason: string };

function buildIntent(input: PersistRunIntentInputV1): BuiltIntentV1 {
  if (!isPlainObject(input)) return refused("a run intent needs the launch, the place, and the ids");

  if (!isResolvedHostPath(input.intentPath)) {
    return refused("intentPath is not an identifiable absolute path");
  }

  const runId = validatePathSegment(input.runId);
  if (!runId.ok) return refused(`runId is not a usable directory name: ${runId.reason}`);
  const missionId = validatePathSegment(input.missionId);
  if (!missionId.ok) return refused(`missionId is not a usable directory name: ${missionId.reason}`);
  const workItemId = validatePathSegment(input.workItemId);
  if (!workItemId.ok) return refused(`workItemId is not a usable directory name: ${workItemId.reason}`);

  if (!isResolvedHostPath(input.worktree)) return refused("worktree is not an identifiable absolute path");
  if (!isResolvedHostPath(input.cwd)) return refused("cwd is not an identifiable absolute path");
  if (!isResolvedHostPath(input.executablePath)) return refused("executablePath is not an identifiable absolute path");

  let branch: string | null;
  if (input.branch === null) {
    branch = null;
  } else {
    const token = asUsableToken(input.branch);
    if (token === null || token.includes("..")) return refused("branch is not a usable ref name");
    branch = token;
  }

  if (!Array.isArray(input.argv) || !input.argv.every((item) => typeof item === "string")) {
    return refused("argv must be an array of strings");
  }
  for (const item of input.argv) {
    if (CONTROL_BYTES.test(item)) return refused("argv contains a control byte");
  }

  const runNonce = asUsableToken(input.runNonce);
  if (runNonce === null) return refused("run nonce is empty or contains control bytes");
  if (!isIsoTimestamp(input.now)) return refused("now is not an ISO-8601 instant in UTC");

  let promptPath: string | undefined;
  if (input.promptPath !== undefined) {
    if (!isResolvedHostPath(input.promptPath)) return refused("promptPath is not an identifiable absolute path");
    promptPath = input.promptPath;
  }

  if (input.role !== undefined && !isExecutorRole(input.role)) {
    return refused("role is not an enumerated executor role");
  }

  const intent: RunIntentV1 = {
    schema: RUN_INTENT_SCHEMA_V1,
    runId: input.runId,
    missionId: input.missionId,
    workItemId: input.workItemId,
    worktree: input.worktree,
    branch,
    executablePath: input.executablePath,
    argv: Object.freeze([...input.argv]),
    cwd: input.cwd,
    runNonce,
    intendedAt: input.now,
    spawnAttemptedAt: null,
    spawnPid: null,
    spawnObservedAt: null,
    processIdentity: null,
    secretsPresent: false,
    ...(promptPath !== undefined ? { promptPath } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.childEnvKeys !== undefined
      ? { childEnvKeys: Object.freeze([...input.childEnvKeys]) }
      : {}),
  };

  if (containsSecret(serialiseIntent(intent))) {
    return refused("intent would contain a secret; spawn is refused");
  }

  return { ok: true, intent, intentPath: input.intentPath };
}

export function existingIntentOn(store: IntentStoreV1, intentPath: string): "none" | "unstarted" | "spawned" | "unreadable" {
  let raw: string;
  try {
    raw = store.readUtf8(intentPath);
  } catch (error) {
    // Absence is ENOENT. EBUSY, EACCES, EMFILE, EIO, a throw with no code —
    // those are unreadability. Treating them as "none" lets a second executor
    // overwrite a live spawn the moment a scanner holds the file open.
    if (errorCode(error) === "ENOENT") return "none";
    return "unreadable";
  }
  const parsed = runIntentFrom(parseJson(raw));
  if (!parsed.ok) return "unreadable";
  return answersAfterReboot(parsed.intent).started ? "spawned" : "unstarted";
}

function permitMatchesIntent(permit: SpawnPermitV1, current: RunIntentV1): boolean {
  return permit.intent.runId === current.runId
    && permit.intent.runNonce === current.runNonce
    && launchMatchesAuthorised(permit.authorised, {
      executable: current.executablePath,
      argv: current.argv,
      cwd: current.cwd,
    });
}

function makePermit(intentPath: string, intent: RunIntentV1): SpawnPermitV1 {
  const authorised = Object.freeze({
    executable: intent.executablePath,
    argv: Object.freeze([...intent.argv]),
    cwd: intent.cwd,
    runId: intent.runId,
    runNonce: intent.runNonce,
  });
  const permit = Object.freeze({
    [SPAWN_PERMIT]: true as const,
    intentPath,
    intent: Object.freeze(intent),
    authorised,
  });
  MINTED_PERMITS.add(permit);
  if (intentAlreadySpawned(intent)) {
    CONSUMED_PERMITS.add(permit);
  }
  return permit;
}

function intentAlreadySpawned(intent: RunIntentV1): boolean {
  return answersAfterReboot(intent).started;
}

function launchMatchesAuthorised(
  authorised: AuthorisedSpawnV1,
  launch: { readonly executable: string; readonly argv: readonly string[]; readonly cwd: string },
): boolean {
  return authorised.executable === launch.executable
    && authorised.cwd === launch.cwd
    && authorised.argv.length === launch.argv.length
    && authorised.argv.every((item, index) => item === launch.argv[index]);
}

function refused(reason: string): { readonly ok: false; readonly permit: null; readonly intent: null; readonly reason: string } {
  return { ok: false, permit: null, intent: null, reason };
}

function serialiseIntent(intent: RunIntentV1): string {
  return `${JSON.stringify(intent, null, 2)}\n`;
}

function sameIntent(expected: RunIntentV1, actual: RunIntentV1): boolean {
  return serialiseIntent(expected) === serialiseIntent(actual);
}

function sameRecordedIdentity(a: ExecutorProcessIdentityV1, b: ExecutorProcessIdentityV1): boolean {
  return a.pid === b.pid
    && a.creationDate === b.creationDate
    && a.executablePath === b.executablePath
    && a.runNonce === b.runNonce;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readId(obj: Record<string, unknown>, key: string): OpaqueId | null {
  const value = own(obj, key);
  if (typeof value !== "string") return null;
  return validatePathSegment(value).ok ? value : null;
}

function readHostPath(obj: Record<string, unknown>, key: string): string | null {
  const value = asUsableToken(own(obj, key));
  if (value === null || !isResolvedHostPath(value)) return null;
  return value;
}

function isIsoTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string" || value === "") return false;
  if (CONTROL_BYTES.test(value)) return false;
  return isPlaceableInstant(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { readonly code: unknown }).code;
  return typeof code === "string" && code !== "" ? code : null;
}

function containsSecret(text: string): boolean {
  if (redactLogText(text) !== text) return true;
  return /tskey-[A-Za-z0-9_-]+/.test(text)
    || /(api[_-]?key|token)\s*[:=]\s*\S+/i.test(text);
}
