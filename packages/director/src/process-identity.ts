/**
 * A PID is a slot, not a process.
 *
 * The OS reuses PIDs quickly on a machine that spawns executors all day. "PID 4812 is alive" is
 * therefore not "the holder is alive", and worse, "PID 4812 is alive but it is now node.exe" reads
 * as evidence about a holder that has actually been gone for an hour. The identity of a run is
 * `{ pid, creationDate, executablePath, runNonce }` — four fields, all required on the record —
 * and an observation that cannot produce them cannot answer for the holder.
 *
 * ## Liveness is three-valued, and the third value is the point
 *
 * A boolean forces the one honest outcome — the probe failed, the process is on another account,
 * the host returned access-denied — into either "alive" or "dead". Whichever way that flag falls,
 * one of them hands a live run's worktree to a second executor. `UNKNOWN` grants nothing: it
 * permits neither a reclaim nor a "the writer finished" conclusion. Every consumer treats it as
 * "leave it alone and let a person look".
 *
 * The three values are {@link ProcessLivenessV1} from `leases.ts`. This module does not declare a
 * second union. A second spelling is how one call site starts treating `UNKNOWN` as dead.
 *
 * ## The host is injected
 *
 * Looking at a process is a host operation. Every branch of comparison, liveness and orphan
 * detection takes a probe result it is handed, so the near-misses — same PID, later creation
 * date; same PID, different executable; a nonce that is not ours — are testable without spawning
 * anything. A real Windows probe exists so one test can confirm the probe works at all. A real
 * Windows orphan scanner enumerates CIM `Win32_Process` rows and reads `AION_RUN_NONCE` from
 * the PEB environment block first. CommandLine is a proxy used only when that read failed.
 * A row whose membership in this run's tree cannot be decided is UNKNOWN, not absent. A failed
 * scan is `UNAVAILABLE`, never "no orphans".
 */
import { spawnSync } from "node:child_process";
import type { IdentityMatchV1, ProcessLivenessV1 } from "./leases.js";
import { canonicalizeHostPath, isResolvedHostPath } from "./host-path.js";

/** Control bytes, NUL first. Written as escapes; a raw control byte in source is how it reaches a file. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

/**
 * Who was spawned, in more than a PID.
 *
 * Distinct from `ProcessIdentityV1` in `leases.ts`, which is the weaker optional-field record a
 * lease may carry. A run identity is complete or it is not recorded: omitting a field and then
 * matching without it is how PID reuse becomes "the holder is still here".
 */
export interface ExecutorProcessIdentityV1 {
  readonly pid: number;
  /** Process start instant. A reused PID belongs to a process that started later. */
  readonly creationDate: string;
  readonly executablePath: string;
  /** The token the run wrote at launch. Survives PID reuse outright. */
  readonly runNonce: string;
}

/**
 * What a probe actually saw. Missing fields stay missing — a probe that could not read an
 * executable path must not invent one, and a missing nonce is not a nonce of `""`.
 */
export type ProcessObservationV1 =
  | {
      readonly outcome: "FOUND";
      readonly reason: string;
      readonly pid: number;
      readonly creationDate?: string;
      readonly executablePath?: string;
      readonly runNonce?: string | null;
      readonly parentPid?: number | null;
      readonly name?: string;
    }
  | {
      readonly outcome: "NOT_FOUND";
      readonly reason: string;
    }
  | {
      readonly outcome: "UNAVAILABLE";
      readonly reason: string;
    };

/**
 * Injected host. Tests supply one; production uses {@link createWindowsProcessProbe}.
 *
 * A missing process is `NOT_FOUND`. A probe that failed, timed out, or was denied is
 * `UNAVAILABLE` — never `NOT_FOUND`, which would read as death.
 */
export interface HostProcessProbe {
  observe(pid: number): ProcessObservationV1;
}

export type CaptureIdentityResultV1 =
  | { readonly ok: true; readonly identity: ExecutorProcessIdentityV1; readonly observation: ProcessObservationV1; readonly reason: string }
  | { readonly ok: false; readonly identity: null; readonly observation: ProcessObservationV1 | null; readonly reason: string };

export type ProcessIdentityReadV1 =
  | { readonly ok: true; readonly identity: ExecutorProcessIdentityV1 }
  | { readonly ok: false; readonly identity: null; readonly reason: string };

/**
 * What process liveness is allowed to authorise. `writerFinished` is never granted from a probe:
 * a dead process is not a finished writer, and an unanswered probe is not one either.
 */
export interface LivenessGrantV1 {
  readonly reclaim: boolean;
  readonly writerFinished: boolean;
}

/**
 * A live process that carries this run's nonce. Produced by {@link createWindowsOrphanScanner}
 * or by a test double. Missing fields stay missing.
 */
export interface NonceBearingProcessV1 {
  readonly pid: number;
  readonly creationDate?: string;
  readonly runNonce?: string;
  readonly parentPid?: number;
  /** True only when the PEB environment block was actually read. */
  readonly nonceReadable?: boolean;
  /** True only when ParentProcessId names a row present in the same CIM snapshot. */
  readonly parentPresent?: boolean;
}

export type OrphanScanInterpretationV1 =
  | { readonly outcome: "SCANNED"; readonly sightings: readonly NonceBearingProcessV1[]; readonly reason: string }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string };

export type OrphanKindV1 = "NONCE_MISMATCH" | "EXECUTABLE_MISMATCH" | "DEAD_PARENT_LIVE_CHILD";

export interface OrphanVerdictV1 {
  readonly orphan: boolean;
  readonly kind: OrphanKindV1 | null;
  readonly reason: string;
}

/**
 * Capture the identity of a just-spawned process.
 *
 * The nonce is the one the caller put in the child environment, not a value guessed from the
 * observation: argv must not carry it, and a CIM command line often will not either. A probe that
 * cannot produce a creation date and an executable path fails — a PID-only record is how reuse
 * later reads as the same process.
 */
export function captureProcessIdentity(
  probe: HostProcessProbe,
  input: { readonly pid: number; readonly runNonce: string },
): CaptureIdentityResultV1 {
  if (!isUsablePid(input.pid)) {
    return { ok: false, identity: null, observation: null, reason: "pid is not a positive integer" };
  }
  const runNonce = asUsableToken(input.runNonce);
  if (runNonce === null) {
    return { ok: false, identity: null, observation: null, reason: "run nonce is empty or contains control bytes" };
  }

  let observation: ProcessObservationV1;
  try {
    observation = probe.observe(input.pid);
  } catch (error) {
    return {
      ok: false,
      identity: null,
      observation: { outcome: "UNAVAILABLE", reason: "probe threw" },
      reason: `probe threw: ${errorMessage(error)}`,
    };
  }

  if (observation.outcome === "UNAVAILABLE") {
    return { ok: false, identity: null, observation, reason: `probe could not answer: ${observation.reason}` };
  }
  if (observation.outcome === "NOT_FOUND") {
    return { ok: false, identity: null, observation, reason: "the process was gone before its identity could be recorded" };
  }
  if (!isUsablePid(observation.pid)) {
    return { ok: false, identity: null, observation, reason: "observation did not name a pid" };
  }
  if (observation.pid !== input.pid) {
    return { ok: false, identity: null, observation, reason: "observation is about a different pid than the one just spawned" };
  }
  const creationDate = normalisedCreationDate(observation.creationDate);
  if (creationDate === null) {
    return { ok: false, identity: null, observation, reason: "observation has no creation date; a pid-only record is how reuse is misread as the holder" };
  }
  const executablePath = asUsableToken(observation.executablePath);
  if (executablePath === null || !isResolvedHostPath(executablePath)) {
    return { ok: false, identity: null, observation, reason: "observation has no identifiable executable path" };
  }

  return {
    ok: true,
    observation,
    reason: "identity captured at spawn",
    identity: { pid: observation.pid, creationDate, executablePath, runNonce },
  };
}

/**
 * Compare an observation against the identity recorded at spawn.
 *
 * `MATCH` requires agreement on pid, creation date and executable. A nonce, when the observation
 * actually produced one, must agree too. Missing strong fields are `UNVERIFIABLE`, not a match:
 * agreeing on a PID is agreeing on a slot number.
 */
export function compareProcessIdentity(
  recorded: ExecutorProcessIdentityV1,
  observed: ExecutorProcessIdentityV1 | ProcessObservationV1,
): IdentityMatchV1 {
  const sighting = asFoundObservation(observed);
  if (sighting === null) return "UNVERIFIABLE";

  if (!isUsablePid(sighting.pid)) return "UNVERIFIABLE";
  if (recorded.pid !== sighting.pid) return "MISMATCH";

  if (sighting.creationDate === undefined) return "UNVERIFIABLE";
  const dates = compareCreationDates(recorded.creationDate, sighting.creationDate);
  if (dates === "UNCOMPARABLE") return "UNVERIFIABLE";
  if (dates === "DIFFERENT") return "MISMATCH";

  if (sighting.executablePath === undefined) return "UNVERIFIABLE";
  if (!sameExecutable(recorded.executablePath, sighting.executablePath)) return "MISMATCH";

  if (sighting.runNonce !== undefined && sighting.runNonce !== null) {
    if (recorded.runNonce !== sighting.runNonce) return "MISMATCH";
  }

  return "MATCH";
}

/**
 * Liveness of the *recorded holder*, not of whoever currently occupies the PID slot.
 *
 * `UNAVAILABLE` is `UNKNOWN`. `NOT_FOUND` is `DEAD_CONFIRMED`. A found process that matches is
 * `ALIVE`. A found process whose creation date disagrees is the slot after reuse — unless the
 * observed nonce still equals the recorded one, in which case the date cannot mint death.
 * Any other disagreement, or a found process that cannot be compared, is `UNKNOWN`.
 */
export function holderLiveness(
  recorded: ExecutorProcessIdentityV1,
  observation: ProcessObservationV1,
): ProcessLivenessV1 {
  if (observation.outcome === "UNAVAILABLE") return "UNKNOWN";
  if (observation.outcome === "NOT_FOUND") return "DEAD_CONFIRMED";
  // An answer about another slot is not an answer about the recorded holder.
  if (observation.pid !== recorded.pid) return "UNKNOWN";

  const verdict = compareProcessIdentity(recorded, observation);
  if (verdict === "MATCH") return "ALIVE";
  if (verdict === "UNVERIFIABLE") return "UNKNOWN";

  // MISMATCH. Same slot, *later* start: the original process is gone — but only when
  // the nonce does not contradict that certificate and the observed instant is
  // strictly later than the recorded one. An earlier instant, or one that cannot
  // be ordered, is UNKNOWN: two timestamps that cannot both be true prove nothing
  // about the holder. A date-encoding difference that still carries our nonce is
  // UNKNOWN, not death.
  if (observation.creationDate !== undefined) {
    const dates = compareCreationDates(recorded.creationDate, observation.creationDate);
    if (dates === "DIFFERENT") {
      const observedNonce = asUsableToken(observation.runNonce);
      if (observedNonce !== null && observedNonce === recorded.runNonce) {
        return "UNKNOWN";
      }
      const recordedMs = parseProcessTimestamp(recorded.creationDate);
      const observedMs = parseProcessTimestamp(observation.creationDate);
      if (recordedMs !== null && observedMs !== null && observedMs > recordedMs) {
        return "DEAD_CONFIRMED";
      }
      return "UNKNOWN";
    }
  }
  return "UNKNOWN";
}

/**
 * What a liveness value is allowed to authorise.
 *
 * `UNKNOWN` grants nothing — that is the defect a boolean liveness used to have. `ALIVE` grants
 * nothing. `DEAD_CONFIRMED` permits a reclaim and still does not permit "the writer finished":
 * a process that is gone is not a writer that completed.
 */
export function livenessGrants(liveness: ProcessLivenessV1): LivenessGrantV1 {
  return {
    reclaim: liveness === "DEAD_CONFIRMED",
    writerFinished: false,
  };
}

/**
 * The identity a probe actually saw, not the identity we recorded at spawn.
 *
 * A comparison that uses the recorded record as both sides cannot fail. Missing fields stay
 * missing: a FOUND observation that did not produce a nonce is not given the recorded one.
 */
export function identityFromObservation(observation: ProcessObservationV1): ExecutorProcessIdentityV1 | null {
  if (observation.outcome !== "FOUND") return null;
  if (!isUsablePid(observation.pid)) return null;
  const creationDate = normalisedCreationDate(observation.creationDate);
  const executablePath = asUsableToken(observation.executablePath);
  const runNonce = asUsableToken(observation.runNonce);
  if (creationDate === null || executablePath === null || runNonce === null) return null;
  if (!isResolvedHostPath(executablePath)) return null;
  return { pid: observation.pid, creationDate, executablePath, runNonce };
}

/**
 * Orphan: a nonce or executable mismatch, or a dead parent with a live child.
 *
 * `UNKNOWN` never produces an orphan finding. A probe that could not answer is not evidence the
 * child is ours to kill, and a parent whose liveness is `UNKNOWN` is not a dead parent.
 */
export function detectOrphan(input: {
  readonly recorded: ExecutorProcessIdentityV1;
  readonly observed: ProcessObservationV1;
  readonly parentLiveness?: ProcessLivenessV1;
}): OrphanVerdictV1 {
  const { recorded, observed } = input;

  if (observed.outcome === "UNAVAILABLE") {
    return { orphan: false, kind: null, reason: "the observation is UNKNOWN; leave it alone and let a person look" };
  }

  if (observed.outcome === "FOUND") {
    const observedNonce = asUsableToken(observed.runNonce);
    if (observedNonce !== null && observedNonce !== recorded.runNonce) {
      return {
        orphan: true,
        kind: "NONCE_MISMATCH",
        reason: "the process in this slot carries a different run nonce; it is not the holder",
      };
    }
    if (
      observed.executablePath !== undefined
      && !sameExecutable(recorded.executablePath, observed.executablePath)
    ) {
      return {
        orphan: true,
        kind: "EXECUTABLE_MISMATCH",
        reason: "the process in this slot is a different executable; it is not the holder",
      };
    }
  }

  if (input.parentLiveness === "UNKNOWN") {
    return { orphan: false, kind: null, reason: "parent liveness is UNKNOWN; leave it alone and let a person look" };
  }

  if (input.parentLiveness === "DEAD_CONFIRMED" && observed.outcome === "FOUND") {
    return {
      orphan: true,
      kind: "DEAD_PARENT_LIVE_CHILD",
      reason: "the parent is gone and this child is still running",
    };
  }

  return { orphan: false, kind: null, reason: "no orphan signal" };
}

/** Read an untrusted identity object, typically from a file that outlived the process. */
export function processIdentityFrom(value: unknown): ProcessIdentityReadV1 {
  if (!isPlainObject(value)) {
    return { ok: false, identity: null, reason: "process identity is not an object" };
  }

  const pid = own(value, "pid");
  if (!isUsablePid(pid)) {
    return { ok: false, identity: null, reason: "pid is not a positive integer" };
  }

  const creationDate = normalisedCreationDate(own(value, "creationDate"));
  if (creationDate === null) {
    return { ok: false, identity: null, reason: "creationDate is missing or not a usable token" };
  }

  const executablePath = asUsableToken(own(value, "executablePath"));
  if (executablePath === null || !isResolvedHostPath(executablePath)) {
    return { ok: false, identity: null, reason: "executablePath is not an identifiable absolute path" };
  }

  const runNonce = asUsableToken(own(value, "runNonce"));
  if (runNonce === null) {
    return { ok: false, identity: null, reason: "runNonce is missing or not a usable token" };
  }

  return { ok: true, identity: { pid, creationDate, executablePath, runNonce } };
}

/** What the Windows probe's `spawnSync` must return. Tests inject a shadowed host. */
export interface WindowsProbeSpawnResultV1 {
  readonly status: number | null;
  readonly stdout?: string | Buffer | null;
  readonly stderr?: string | Buffer | null;
  readonly error?: Error | null;
}

export interface WindowsProbeHostV1 {
  readonly spawnSync: (
    command: string,
    args: readonly string[],
    options: { encoding: "utf8"; timeout: number; windowsHide: boolean; shell: false },
  ) => WindowsProbeSpawnResultV1;
}

/**
 * CIM query of one PID on this Windows host.
 *
 * Access-denied, a timeout, a parser failure, a non-zero exit and a process on another
 * account all come back as `UNAVAILABLE`. Absence comes back as `NOT_FOUND` only from
 * `status === 0` and an explicit `{ ok: false, reason: "not-found" }` envelope.
 * Those two must not be collapsed: a failed probe is not a dead process.
 */
export function createWindowsProcessProbe(host?: WindowsProbeHostV1): HostProcessProbe {
  const spawn = host?.spawnSync ?? spawnSync;
  return {
    observe(pid: number): ProcessObservationV1 {
      if (!isUsablePid(pid)) {
        return { outcome: "UNAVAILABLE", reason: "pid is not a positive integer" };
      }

      const script = [
        "$ProgressPreference = 'SilentlyContinue';",
        "try {",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop;`,
        "if (-not $p) { Write-Output '{\"ok\":false,\"reason\":\"not-found\"}'; exit 0 };",
        "$o = [ordered]@{ ok = $true; pid = [int]$p.ProcessId; name = $p.Name; executablePath = $p.ExecutablePath; commandLine = $p.CommandLine; creationDate = $p.CreationDate.ToString('o'); parentPid = [int]$p.ParentProcessId };",
        "$o | ConvertTo-Json -Compress;",
        "exit 0",
        "} catch {",
        "Write-Output '{\"ok\":false,\"reason\":\"cim-error\"}';",
        "exit 1",
        "}",
      ].join(" ");

      let result: WindowsProbeSpawnResultV1;
      try {
        result = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          encoding: "utf8",
          timeout: 15_000,
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        return { outcome: "UNAVAILABLE", reason: `probe failed to start: ${errorMessage(error)}` };
      }

      if (result.error) {
        const message = errorMessage(result.error);
        return {
          outcome: "UNAVAILABLE",
          reason: /timed? ?out/i.test(message) ? "probe timed out" : `probe failed: ${message}`,
        };
      }

      return interpretWindowsProbeOutput({
        status: result.status,
        stdout: stripBom(String(result.stdout ?? "")).trim(),
        stderr: String(result.stderr ?? "").trim(),
      });
    },
  };
}

/**
 * Map a PowerShell spawn result to a process observation.
 *
 * Empty, unparseable, or non-zero-exit output is `UNAVAILABLE`. `NOT_FOUND` requires
 * exit 0 and an explicit not-found envelope. A missing `reason` is never treated as
 * not-found.
 */
export function interpretWindowsProbeOutput(input: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}): ProcessObservationV1 {
  const combined = `${input.stdout}\n${input.stderr}`;
  if (/access is denied/i.test(combined)) {
    return { outcome: "UNAVAILABLE", reason: "access-denied" };
  }

  if (input.status !== 0) {
    return {
      outcome: "UNAVAILABLE",
      reason: input.status === null ? "probe exited without a status" : `probe exited ${input.status}`,
    };
  }

  if (input.stdout === "") {
    return { outcome: "UNAVAILABLE", reason: "probe produced no output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stdout);
  } catch {
    return { outcome: "UNAVAILABLE", reason: "probe output was not parseable" };
  }
  if (!isPlainObject(parsed)) {
    return { outcome: "UNAVAILABLE", reason: "probe output was not an object" };
  }

  if (parsed.ok !== true) {
    if (parsed.reason === "not-found") {
      return { outcome: "NOT_FOUND", reason: "no process occupies this pid" };
    }
    const why = typeof parsed.reason === "string" ? parsed.reason : "probe returned a failure envelope";
    return { outcome: "UNAVAILABLE", reason: why };
  }

  const observedPid = parsed.pid;
  if (!isUsablePid(observedPid)) {
    return { outcome: "UNAVAILABLE", reason: "probe did not return a pid" };
  }

  const creationDate = normalisedCreationDate(parsed.creationDate);
  return {
    outcome: "FOUND",
    reason: "cim",
    pid: observedPid,
    ...(creationDate !== null ? { creationDate } : {}),
    ...(usableOrOmit("executablePath", parsed.executablePath)),
    ...(usableOrOmit("name", parsed.name)),
    ...(parentPidField(parsed.parentPid)),
    ...nonceFromThisProcess(observedPid, parsed.commandLine),
  };
}

/**
 * Map a PowerShell orphan-scan spawn result to a list of nonce-bearing processes.
 *
 * Empty, unparseable, or non-zero-exit output is `UNAVAILABLE`. `SCANNED`
 * requires exit 0 and `{ ok: true }`. A failed scan is never an empty match
 * list: that is how a writer lease would be released while children remain.
 */
export function interpretWindowsOrphanScanOutput(input: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Spawn floor. Used to decide whether an unread orphan is in this run's window. */
  readonly createdNotBefore?: string;
}): OrphanScanInterpretationV1 {
  const combined = `${input.stdout}\n${input.stderr}`;
  if (/access is denied/i.test(combined)) {
    return { outcome: "UNAVAILABLE", reason: "access-denied" };
  }

  if (input.status !== 0) {
    return {
      outcome: "UNAVAILABLE",
      reason: input.status === null ? "scan exited without a status" : `scan exited ${input.status}`,
    };
  }

  if (input.stdout === "") {
    return { outcome: "UNAVAILABLE", reason: "scan produced no output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stdout);
  } catch {
    return { outcome: "UNAVAILABLE", reason: "scan output was not parseable" };
  }
  if (!isPlainObject(parsed)) {
    return { outcome: "UNAVAILABLE", reason: "scan output was not an object" };
  }

  if (parsed.ok !== true) {
    const why = typeof parsed.reason === "string" ? parsed.reason : "scan returned a failure envelope";
    return { outcome: "UNAVAILABLE", reason: why };
  }

  const rows = asObjectArray(parsed.processes);
  if (rows === null) {
    return { outcome: "UNAVAILABLE", reason: "scan did not return a process list" };
  }

  // unreadable > 0 is not an empty match list. A PEB read that failed on a
  // descendant of the recorded holder is UNKNOWN about that occupant, not
  // "not ours". Missing `unreadable` is treated as 0 so a well-formed empty
  // envelope from a host that could read every descendant stays SCANNED.
  const unreadableRaw = parsed.unreadable;
  if (typeof unreadableRaw === "number") {
    if (!Number.isInteger(unreadableRaw) || unreadableRaw < 0) {
      return { outcome: "UNAVAILABLE", reason: "scan unreadable count is not a usable integer" };
    }
    if (unreadableRaw > 0) {
      return { outcome: "UNAVAILABLE", reason: "unreadable descendants" };
    }
  }

  const sightings: NonceBearingProcessV1[] = [];
  for (const row of rows) {
    if (!isUsablePid(row.pid)) continue;
    const runNonce = asUsableToken(row.runNonce);
    const creationDate = normalisedCreationDate(row.creationDate);
    const parentPid = isUsablePid(row.parentPid) ? row.parentPid : undefined;
    const nonceReadable = typeof row.nonceReadable === "boolean" ? row.nonceReadable : undefined;
    const parentPresent = typeof row.parentPresent === "boolean" ? row.parentPresent : undefined;
    sightings.push({
      pid: row.pid,
      ...(creationDate !== null ? { creationDate } : {}),
      ...(runNonce !== null ? { runNonce } : {}),
      ...(parentPid !== undefined ? { parentPid } : {}),
      ...(nonceReadable !== undefined ? { nonceReadable } : {}),
      ...(parentPresent !== undefined ? { parentPresent } : {}),
    });
  }

  // A row whose membership cannot be decided is UNKNOWN, not absent.
  for (const sighting of sightings) {
    if (sighting.nonceReadable !== false) continue;
    if (sighting.parentPresent !== false) continue;
    if (!provenCreatedAtOrAfterFloor(sighting.creationDate, input.createdNotBefore)) continue;
    return { outcome: "UNAVAILABLE", reason: "undecidable process-tree membership" };
  }

  return { outcome: "SCANNED", sightings, reason: "cim" };
}

/**
 * Enumerate processes that carry this run's `AION_RUN_NONCE`.
 *
 * Uses the same CIM `Win32_Process` path as {@link createWindowsProcessProbe}.
 * The adapter puts the nonce in the child environment, not argv, so CommandLine
 * alone cannot see a correctly-spawned writer. After the CIM listing, each
 * row's PEB environment is read first; CommandLine is consulted only when that
 * read failed. A successful PEB read that found no nonce is not overridden by
 * argv text. A CIM, parser, or host failure throws — `collectWriterOrphans`
 * treats a throw as `{performed: false}`, never as "no orphans found".
 */
export function createWindowsOrphanScanner(host?: WindowsProbeHostV1): (query: {
  readonly runNonce: string;
  readonly createdNotBefore: string;
  readonly holderPid?: number;
}) => readonly NonceBearingProcessV1[] {
  const spawn = host?.spawnSync ?? spawnSync;
  return (query) => {
    const runNonce = asUsableToken(query.runNonce);
    if (runNonce === null) {
      throw new Error("orphan scan unavailable: run nonce is empty or contains control bytes");
    }

    const holderPid = isUsablePid(query.holderPid) ? query.holderPid : 0;
    const script = windowsOrphanScanScript(psSingleQuoted(runNonce), holderPid);
    let result: WindowsProbeSpawnResultV1;
    try {
      result = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      throw new Error(`orphan scan unavailable: probe failed to start: ${errorMessage(error)}`);
    }

    if (result.error) {
      const message = errorMessage(result.error);
      throw new Error(
        /timed? ?out/i.test(message)
          ? "orphan scan unavailable: probe timed out"
          : `orphan scan unavailable: probe failed: ${message}`,
      );
    }

    const interpreted = interpretWindowsOrphanScanOutput({
      status: result.status,
      stdout: stripBom(String(result.stdout ?? "")).trim(),
      stderr: String(result.stderr ?? "").trim(),
      createdNotBefore: query.createdNotBefore,
    });
    if (interpreted.outcome === "UNAVAILABLE") {
      throw new Error(`orphan scan unavailable: ${interpreted.reason}`);
    }

    return interpreted.sightings.filter((sighting) => {
      const nonce = asUsableToken(sighting.runNonce);
      const nonceMatch = nonce === runNonce;
      const descendant = holderPid > 0
        && sighting.pid !== holderPid
        && isInHolderTree(sighting, holderPid, interpreted.sightings);
      if (!nonceMatch && !descendant) return false;
      return sightingCreatedNotBefore(sighting, query.createdNotBefore);
    });
  };
}

function isInHolderTree(
  sighting: NonceBearingProcessV1,
  holderPid: number,
  rows: readonly NonceBearingProcessV1[],
): boolean {
  return descendantPidsOf(holderPid, rows).has(sighting.pid);
}

/** Walk ParentProcessId from CIM rows. No PEB read is required. */
export function descendantPidsOf(
  holderPid: number,
  rows: readonly { readonly pid: number; readonly parentPid?: number }[],
): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentPid === undefined) continue;
    const list = children.get(row.parentPid) ?? [];
    list.push(row.pid);
    children.set(row.parentPid, list);
  }
  const out = new Set<number>();
  const stack = [holderPid];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

function asFoundObservation(
  observed: ExecutorProcessIdentityV1 | ProcessObservationV1,
): {
  pid: number;
  creationDate?: string;
  executablePath?: string;
  runNonce?: string | null;
} | null {
  if ("outcome" in observed) {
    if (observed.outcome !== "FOUND") return null;
    return observed;
  }
  return observed;
}

type CreationDateComparisonV1 = "SAME" | "DIFFERENT" | "UNCOMPARABLE";

/**
 * CIM DATETIME as WMI emits it: `yyyymmddHHMMSS.mmmmmmsUUU` where `sUUU` is
 * the signed UTC offset in minutes (`+000` is UTC).
 */
const DMTF_DATETIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/;

/**
 * ISO-8601 instants this module will accept. The zone group is optional in the
 * pattern so a zone-less string can still be recognised as a timestamp — but a
 * zone-less string is not a comparable instant. `compareCreationDates` refuses
 * to place one on a timeline. Do not treat a missing zone as UTC or as local.
 */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|([+-])(\d{2}):?(\d{2}))?$/;

function timestampHasExplicitZone(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (DMTF_DATETIME.test(trimmed)) return true;
  const match = ISO_INSTANT.exec(trimmed);
  if (match === null) return false;
  if (/Z$/i.test(trimmed)) return true;
  return match[8] !== undefined;
}

/**
 * The one answer to "is this a placeable instant": an explicit zone, and a
 * parse that does not invent one.
 */
export function isPlaceableInstant(value: string): boolean {
  return timestampHasExplicitZone(value) && parseProcessTimestamp(value) !== null;
}

/** Milliseconds since epoch, or null when the token is not a placeable instant. */
export function placeableInstantMs(value: string): number | null {
  if (!timestampHasExplicitZone(value)) return null;
  return parseProcessTimestamp(value);
}

/**
 * Whether `candidate` is at or after `floor`. An unplaceable operand cannot
 * exclude the candidate: UNKNOWN stays UNKNOWN, so this returns true.
 */
export function createdAtOrAfterFloor(
  candidate: string | undefined,
  floor: string | undefined,
): boolean {
  const floorToken = asUsableToken(floor);
  if (floorToken === null) return true;
  const floorMs = placeableInstantMs(floorToken);
  if (floorMs === null) return true;
  if (candidate === undefined) return true;
  const at = placeableInstantMs(candidate);
  if (at === null) return true;
  return at >= floorMs;
}

/**
 * Whether `candidate` is *proven* at or after `floor`. An unplaceable operand
 * does not establish the claim — UNKNOWN stays UNKNOWN, so this returns false.
 */
export function provenCreatedAtOrAfterFloor(
  candidate: string | undefined,
  floor: string | undefined,
): boolean {
  const floorToken = asUsableToken(floor);
  if (floorToken === null) return false;
  const floorMs = placeableInstantMs(floorToken);
  if (floorMs === null) return false;
  if (candidate === undefined) return false;
  const at = placeableInstantMs(candidate);
  if (at === null) return false;
  return at >= floorMs;
}

/**
 * Whether `candidate` is proven strictly earlier than `floor`. Unplaceable
 * operands are not proven earlier.
 */
export function createdBeforeFloor(
  candidate: string | undefined,
  floor: string | undefined,
): boolean {
  const floorToken = asUsableToken(floor);
  if (floorToken === null) return false;
  const floorMs = placeableInstantMs(floorToken);
  if (floorMs === null) return false;
  if (candidate === undefined) return false;
  const at = placeableInstantMs(candidate);
  if (at === null) return false;
  return at < floorMs;
}

export function compareCreationDates(recorded: string, observed: string): CreationDateComparisonV1 {
  if (!timestampHasExplicitZone(recorded) || !timestampHasExplicitZone(observed)) {
    return "UNCOMPARABLE";
  }
  const a = parseProcessTimestamp(recorded);
  const b = parseProcessTimestamp(observed);
  if (a !== null && b !== null) return a === b ? "SAME" : "DIFFERENT";
  if (recorded === observed) return "SAME";
  return "UNCOMPARABLE";
}

function parseProcessTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const dmtf = parseDmtfDatetime(trimmed);
  if (dmtf !== null) return dmtf;
  return parseIso8601Instant(trimmed);
}

function parseIso8601Instant(value: string): number | null {
  const match = ISO_INSTANT.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = fraction === "" ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  if (!Number.isFinite(ms)) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (!Number.isFinite(asUtc)) return null;
  if (/Z$/i.test(value)) return asUtc;
  if (match[8] === undefined) return null;
  const offsetHours = Number(match[9]);
  const offsetMinutes = Number(match[10]);
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const offsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000;
  return match[8] === "+" ? asUtc - offsetMs : asUtc + offsetMs;
}

function parseDmtfDatetime(value: string): number | null {
  const match = DMTF_DATETIME.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const micro = Number(match[7]);
  const sign = match[8];
  const offsetMinutes = Number(match[9]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(micro / 1000));
  if (!Number.isFinite(asUtc)) return null;
  const offsetMs = offsetMinutes * 60 * 1000;
  return sign === "+" ? asUtc - offsetMs : asUtc + offsetMs;
}

export function normalisedCreationDate(value: unknown): string | null {
  const token = asUsableToken(value);
  if (token === null || !timestampHasExplicitZone(token)) return null;
  const ms = parseProcessTimestamp(token);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

function sameExecutable(recorded: string, observed: string): boolean {
  const a = canonicalizeHostPath(recorded);
  const b = canonicalizeHostPath(observed);
  if (a !== "" && b !== "") return a === b;
  return recorded.replace(/\\/g, "/").toLowerCase() === observed.replace(/\\/g, "/").toLowerCase();
}

export function isUsablePid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * The single spelling of a run nonce: trimmed, no control bytes.
 *
 * Persist, the child environment, and the orphan scan must all see this token.
 * Comparing a raw request string to a trimmed record is how a live grandchild
 * used to disappear from the writer-release decision.
 */
export function normaliseRunNonce(value: unknown): string | null {
  return asUsableToken(value);
}

function asUsableToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return null;
  return trimmed;
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

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function usableOrOmit<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  const token = asUsableToken(value);
  return token === null ? {} : { [key]: token } as Partial<Record<K, string>>;
}

function parentPidField(value: unknown): { parentPid: number } | Record<string, never> {
  return isUsablePid(value) ? { parentPid: value } : {};
}

/**
 * Best-effort nonce from a CIM row. This is not a source the writer-exit
 * proof can rely on.
 *
 * The adapter puts `AION_RUN_NONCE` in the child environment and forbids it
 * on argv. Win32_Process.CommandLine therefore does not carry it. Reading
 * another process's environment block needs PROCESS_VM_READ of the PEB;
 * that fails for protected occupants (pid 4 / System has no executablePath
 * either), elevated children, and WOW64 mismatches. Absence here must not
 * be treated as identity agreement.
 */
function nonceFromThisProcess(
  pid: number,
  commandLine: unknown,
): { runNonce: string } | Record<string, never> {
  if (pid === process.pid) {
    const fromEnv = asUsableToken(process.env.AION_RUN_NONCE);
    if (fromEnv !== null) return { runNonce: fromEnv };
  }
  const line = asUsableToken(commandLine);
  if (line === null) return {};
  const match = /AION_RUN_NONCE=([^\s]+)/.exec(line);
  const token = asUsableToken(match?.[1]);
  return token === null ? {} : { runNonce: token };
}

function asObjectArray(value: unknown): readonly Record<string, unknown>[] | null {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    const rows: Record<string, unknown>[] = [];
    for (const item of value) {
      if (!isPlainObject(item)) return null;
      rows.push(item);
    }
    return rows;
  }
  if (isPlainObject(value)) return [value];
  return null;
}

function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sightingCreatedNotBefore(
  sighting: NonceBearingProcessV1,
  createdNotBefore: string,
): boolean {
  return createdAtOrAfterFloor(sighting.creationDate, createdNotBefore);
}

function windowsOrphanScanScript(quotedNonce: string, holderPid: number): string {
  return [
    "$ProgressPreference = 'SilentlyContinue';",
    "try {",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "using System.Text;",
    "public static class AionPebEnv {",
    "  [DllImport(\"kernel32.dll\", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool b, int c);",
    "  [DllImport(\"kernel32.dll\", SetLastError=true)] static extern bool CloseHandle(IntPtr h);",
    "  [DllImport(\"kernel32.dll\", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, [Out] byte[] buf, int n, out IntPtr read);",
    "  [DllImport(\"ntdll.dll\")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref PBI p, int n, out int r);",
    "  [StructLayout(LayoutKind.Sequential)] struct PBI { public IntPtr A; public IntPtr Peb; public IntPtr C; public IntPtr D; public IntPtr E; public IntPtr F; }",
    "  public static string GetNonce(int pid) {",
    "    IntPtr h = OpenProcess(0x0410, false, pid);",
    "    if (h == IntPtr.Zero) return null;",
    "    try {",
    "      PBI pbi = new PBI(); int rl;",
    "      int st = NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out rl);",
    "      if (st != 0 || pbi.Peb == IntPtr.Zero) return null;",
    "      byte[] ptr = new byte[8]; IntPtr read;",
    "      if (!ReadProcessMemory(h, pbi.Peb + 0x20, ptr, 8, out read)) return null;",
    "      long pp = BitConverter.ToInt64(ptr, 0);",
    "      if (pp == 0) return null;",
    "      if (!ReadProcessMemory(h, new IntPtr(pp + 0x80), ptr, 8, out read)) return null;",
    "      long env = BitConverter.ToInt64(ptr, 0);",
    "      if (env == 0) return null;",
    "      byte[] buf = new byte[65536];",
    "      if (!ReadProcessMemory(h, new IntPtr(env), buf, buf.Length, out read)) return null;",
    "      string s = Encoding.Unicode.GetString(buf, 0, (int)read);",
    "      foreach (string e in s.Split(new char[]{(char)0})) {",
    "        if (e.StartsWith(\"AION_RUN_NONCE=\")) return e.Substring(15);",
    "      }",
    "      return \"\";",
    "    } finally { CloseHandle(h); }",
    "  }",
    "}",
    "'@ -ErrorAction Stop;",
    `$target = ${quotedNonce};`,
    `$holderPid = ${holderPid};`,
    "$rows = Get-CimInstance Win32_Process -ErrorAction Stop;",
    "$byParent = @{};",
    "foreach ($p in $rows) {",
    "  $pp = [int]$p.ParentProcessId;",
    "  if (-not $byParent.ContainsKey($pp)) { $byParent[$pp] = New-Object System.Collections.Generic.List[object] };",
    "  [void]$byParent[$pp].Add($p);",
    "}",
    "$desc = New-Object 'System.Collections.Generic.HashSet[int]';",
    "if ($holderPid -gt 0) {",
    "  $stack = New-Object System.Collections.Generic.Stack[int];",
    "  $stack.Push([int]$holderPid);",
    "  while ($stack.Count -gt 0) {",
    "    $cur = $stack.Pop();",
    "    if ($byParent.ContainsKey($cur)) {",
    "      foreach ($ch in $byParent[$cur]) {",
    "        $id = [int]$ch.ProcessId;",
    "        if ($desc.Add($id)) { $stack.Push($id) };",
    "      }",
    "    }",
    "  }",
    "}",
    "$pidSet = New-Object 'System.Collections.Generic.HashSet[int]';",
    "foreach ($p in $rows) { [void]$pidSet.Add([int]$p.ProcessId) };",
    "$hits = New-Object System.Collections.Generic.List[object];",
    "$unreadable = 0;",
    "foreach ($p in $rows) {",
    "  $id = [int]$p.ProcessId;",
    "  $isDesc = $desc.Contains($id);",
    "  $ppid = [int]$p.ParentProcessId;",
    "  $parentPresent = $pidSet.Contains($ppid);",
    "  $n = [AionPebEnv]::GetNonce($id);",
    "  $nonceReadable = $null -ne $n;",
    "  if (-not $nonceReadable) {",
    "    if ($p.CommandLine -match 'AION_RUN_NONCE=([^\\s]+)') { $n = $Matches[1] };",
    "  } elseif ($n -eq '') {",
    "    $n = $null;",
    "  };",
    "  if ($isDesc -and -not $nonceReadable -and -not $n) { $unreadable++ };",
    "  if ($n -eq $target -or $isDesc -or (-not $nonceReadable -and -not $parentPresent)) {",
    "    $cd = if ($p.CreationDate) { $p.CreationDate.ToString('o') } else { $null };",
    "    [void]$hits.Add([ordered]@{ pid = $id; creationDate = $cd; runNonce = $n; parentPid = $ppid; nonceReadable = [bool]$nonceReadable; parentPresent = [bool]$parentPresent });",
    "  }",
    "}",
    "[ordered]@{ ok = $true; processes = $hits; unreadable = [int]$unreadable } | ConvertTo-Json -Compress -Depth 5;",
    "exit 0",
    "} catch {",
    "Write-Output '{\"ok\":false,\"reason\":\"cim-error\"}';",
    "exit 1",
    "}",
  ].join("\n");
}
