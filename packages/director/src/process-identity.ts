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
import { statSync } from "node:fs";
import { join } from "node:path";
import { CONTROL_BYTES, asUsableToken } from "./control-bytes.js";
import type { IdentityMatchV1, ProcessLivenessV1 } from "./leases.js";
import { canonicalizeHostPath, isResolvedHostPath } from "./host-path.js";

/**
 * Host binaries that answer "is this process still alive?" and that perform
 * the kill. Resolved from `%SystemRoot%` and `statSync`-verified. A PATH
 * search is not this fact: the supervised executor shares this account
 * and can create the first PATH entry.
 */
const WINDOWS_SYSTEM_EXECUTABLES = {
  "powershell.exe": ["System32", "WindowsPowerShell", "v1.0", "powershell.exe"],
  "taskkill.exe": ["System32", "taskkill.exe"],
} as const;

export type WindowsSystemExecutableV1 = keyof typeof WINDOWS_SYSTEM_EXECUTABLES;

export function windowsSystemRoot(): string | null {
  const raw = process.env.SystemRoot ?? process.env.WINDIR;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return null;
  if (!isResolvedHostPath(trimmed)) return null;
  return trimmed;
}

/**
 * Absolute `%SystemRoot%`-anchored path for a system binary. Refuses a
 * bare basename: the caller must spawn this return value, never the
 * lookup key.
 */
export function resolveWindowsSystemExecutable(basename: WindowsSystemExecutableV1): string {
  const root = windowsSystemRoot();
  if (root === null) {
    throw new Error(`SystemRoot is unset or not an identifiable absolute path; refusing to spawn bare ${basename}`);
  }
  const resolved = join(root, ...WINDOWS_SYSTEM_EXECUTABLES[basename]);
  try {
    if (!statSync(resolved).isFile()) {
      throw new Error(`system executable is not a file: ${resolved}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`system executable missing or unreadable (${basename}): ${message}`);
  }
  return resolved;
}

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
  /** Win32_Process.Name of this row, when the scan emitted it. */
  readonly name?: string;
  readonly creationDate?: string;
  readonly runNonce?: string;
  readonly parentPid?: number;
  /** True only when the PEB environment block was actually read. */
  readonly nonceReadable?: boolean;
  /** True only when ParentProcessId names a row present in the same CIM snapshot. */
  readonly parentPresent?: boolean;
  /** Win32_Process.Name of ParentProcessId, when that parent row was in the same snapshot. */
  readonly parentName?: string;
  /**
   * Win32_Process.CreationDate of the occupant of ParentProcessId in the
   * same CIM snapshot. Missing or unplaceable is UNKNOWN: a live parent
   * slot is not proof of a capable creator.
   */
  readonly parentCreationDate?: string;
  /**
   * Win32_Process.ExecutablePath. A basename is not this fact and must
   * not be used as a negative membership test.
   */
  readonly executablePath?: string;
}

export type OrphanScanInterpretationV1 =
  | { readonly outcome: "SCANNED"; readonly sightings: readonly NonceBearingProcessV1[]; readonly reason: string }
  | {
      readonly outcome: "UNAVAILABLE";
      readonly reason: string;
      /**
       * Present only when `reason` is undecidable membership, so a later
       * snapshot can ask whether those rows are still alive. Other failures
       * have no row list to persist.
       */
      readonly sightings?: readonly NonceBearingProcessV1[];
    };

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
  input: { readonly pid: number; readonly runNonce: string; readonly expectedExecutable?: string },
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
  if (input.expectedExecutable !== undefined) {
    const expected = asUsableToken(input.expectedExecutable);
    if (expected === null || !isResolvedHostPath(expected)) {
      return {
        ok: false,
        identity: null,
        observation,
        reason: "expected executable is not an identifiable path; an unbindable slot is not a holder record",
      };
    }
    if (!sameExecutable(expected, executablePath)) {
      return {
        ok: false,
        identity: null,
        observation,
        reason: "the occupant of this pid is not the executable this run launched; a reused slot is not a holder record",
      };
    }
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
    const observedNonce = normaliseRunNonce(sighting.runNonce);
    const recordedNonce = normaliseRunNonce(recorded.runNonce);
    if (observedNonce !== recordedNonce) return "MISMATCH";
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
      if (observedCreationIsStrictlyLater(recorded.creationDate, observation.creationDate)) {
        return "DEAD_CONFIRMED";
      }
      return "UNKNOWN";
    }
  }
  return "UNKNOWN";
}

/**
 * The one ordering rule for "the occupant of this slot started after the holder".
 *
 * An earlier instant, or one that cannot be placed on a timeline, is not proof of
 * death or of a different process. Only a strictly later observed instant is.
 */
export function observedCreationIsStrictlyLater(recorded: string, observed: string): boolean {
  const recordedMs = parseProcessTimestamp(recorded);
  const observedMs = parseProcessTimestamp(observed);
  return recordedMs !== null && observedMs !== null && observedMs > recordedMs;
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
  /**
   * Bounded sleep used by undecidable-row persistence. Tests inject a
   * no-op so the loop stays deterministic. Production uses a process-local
   * Atomics.wait. The delay is {@link UNDECIDABLE_MEMBERSHIP_CONFIRM_DELAY_MS},
   * never a value the executor can set.
   */
  readonly waitSync?: (ms: number) => void;
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
        const powershell = resolveWindowsSystemExecutable("powershell.exe");
        result = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
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
  /** This run's nonce. A parentless other-nonce row after the floor is undecidable. */
  readonly runNonce?: string;
  /** Holder pid for this run, if known. Used by the single plausibility predicate. */
  readonly holderPid?: number;
  /** Pids this run has already observed (holder + earlier tree scans). */
  readonly observedPids?: readonly number[];
  /**
   * Observed holder-exit instant. Closes the broker-row window. Absent or
   * unplaceable means a broker-parented row has no lifetime tie to this run.
   */
  readonly holderExitedAt?: string;
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

  if (!Object.prototype.hasOwnProperty.call(parsed, "processes") || parsed.processes === null) {
    return { outcome: "UNAVAILABLE", reason: "scan did not return a process list" };
  }
  const rows = asObjectArray(parsed.processes);
  if (rows === null) {
    return { outcome: "UNAVAILABLE", reason: "scan did not return a process list" };
  }

  // unreadable > 0 is not an empty match list. A PEB read that failed on a
  // descendant of the recorded holder is UNKNOWN about that occupant, not
  // "not ours". Missing `unreadable` is treated as 0 so a well-formed empty
  // envelope from a host that could read every descendant stays SCANNED.
  // A present non-number is not "missing": that is a malformed envelope.
  const unreadableRaw = parsed.unreadable;
  if (unreadableRaw !== undefined && typeof unreadableRaw !== "number") {
    return { outcome: "UNAVAILABLE", reason: "scan unreadable count is not a usable integer" };
  }
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
    const parentName = asUsableToken(row.parentName) ?? undefined;
    const name = asUsableToken(row.name) ?? undefined;
    const parentCreationDate = normalisedCreationDate(row.parentCreationDate);
    const executablePath = asUsableToken(row.executablePath) ?? undefined;
    sightings.push({
      pid: row.pid,
      ...(name !== undefined ? { name } : {}),
      ...(creationDate !== null ? { creationDate } : {}),
      ...(runNonce !== null ? { runNonce } : {}),
      ...(parentPid !== undefined ? { parentPid } : {}),
      ...(nonceReadable !== undefined ? { nonceReadable } : {}),
      ...(parentPresent !== undefined ? { parentPresent } : {}),
      ...(parentName !== undefined ? { parentName } : {}),
      ...(parentCreationDate !== null ? { parentCreationDate } : {}),
      ...(executablePath !== undefined ? { executablePath } : {}),
    });
  }

  const observedPids = new Set<number>();
  if (isUsablePid(input.holderPid)) observedPids.add(input.holderPid);
  for (const pid of input.observedPids ?? []) {
    if (isUsablePid(pid)) observedPids.add(pid);
  }
  const holderExitedAt = asUsableToken(input.holderExitedAt) ?? undefined;
  const plausibility = {
    runNonce: input.runNonce ?? "",
    createdNotBefore: input.createdNotBefore ?? "",
    ...(isUsablePid(input.holderPid) ? { holderPid: input.holderPid } : {}),
    ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
    observedPids,
    rows: sightings,
  };
  // A row whose membership cannot be decided is UNKNOWN, not absent.
  // Collect the full snapshot so persistence can ask whether those
  // occupants are still alive; do not fail on the first hit and drop
  // the rest of the list.
  if (undecidableRowsOf(sightings, plausibility).length > 0) {
    return {
      outcome: "UNAVAILABLE",
      reason: "undecidable process-tree membership",
      sightings,
    };
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
  readonly holderExitedAt?: string;
  /** Pids earlier scans of this run already judged in-tree. */
  readonly observedPids?: readonly number[];
}) => readonly NonceBearingProcessV1[] {
  const spawn = host?.spawnSync ?? spawnSync;
  const waitSync = host?.waitSync ?? sleepSync;
  return (query) => {
    const runNonce = asUsableToken(query.runNonce);
    if (runNonce === null) {
      throw new Error("orphan scan unavailable: run nonce is empty or contains control bytes");
    }

    const holderPid = isUsablePid(query.holderPid) ? query.holderPid : 0;
    const floorMs = placeableInstantMs(query.createdNotBefore);
    if (floorMs === null) {
      throw new Error("orphan scan unavailable: createdNotBefore is not a placeable instant");
    }
    const floorIso = new Date(floorMs).toISOString();
    const holderExitedAt = asUsableToken(query.holderExitedAt) ?? undefined;
    const exitMs = holderExitedAt !== undefined ? placeableInstantMs(holderExitedAt) : null;
    const quotedExit = exitMs !== null ? psSingleQuoted(new Date(exitMs).toISOString()) : "''";
    const script = windowsOrphanScanScript(
      psSingleQuoted(runNonce),
      holderPid,
      psSingleQuoted(floorIso),
      quotedExit,
    );
    const observedPids = [
      ...(holderPid > 0 ? [holderPid] : []),
      ...(query.observedPids ?? []),
    ];

    const interpretInput = (result: WindowsProbeSpawnResultV1) => interpretWindowsOrphanScanOutput({
      status: result.status,
      stdout: stripBom(String(result.stdout ?? "")).trim(),
      stderr: String(result.stderr ?? "").trim(),
      createdNotBefore: query.createdNotBefore,
      runNonce,
      ...(holderPid > 0 ? { holderPid } : {}),
      ...(observedPids.length > 0 ? { observedPids } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
    });

    const snapshot = ():
      | { readonly ok: true; readonly rows: readonly NonceBearingProcessV1[] }
      | { readonly ok: false; readonly reason: string } => {
      let result: WindowsProbeSpawnResultV1;
      try {
        const powershell = resolveWindowsSystemExecutable("powershell.exe");
        result = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        return { ok: false, reason: `probe failed to start: ${errorMessage(error)}` };
      }

      if (result.error) {
        const message = errorMessage(result.error);
        return {
          ok: false,
          reason: /timed? ?out/i.test(message)
            ? "probe timed out"
            : `probe failed: ${message}`,
        };
      }

      const interpreted = interpretInput(result);
      if (interpreted.outcome === "SCANNED") {
        return { ok: true, rows: interpreted.sightings };
      }
      if (interpreted.reason === "undecidable process-tree membership") {
        return { ok: true, rows: interpreted.sightings ?? [] };
      }
      return { ok: false, reason: interpreted.reason };
    };

    const first = snapshot();
    if (!first.ok) {
      throw new Error(`orphan scan unavailable: ${first.reason}`);
    }

    const ctxFor = (rows: readonly NonceBearingProcessV1[]): ProcessRowPlausibilityContextV1 => ({
      runNonce,
      createdNotBefore: query.createdNotBefore,
      ...(holderPid > 0 ? { holderPid } : {}),
      ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
      observedPids: new Set(observedPids.filter((pid) => isUsablePid(pid))),
      rows,
    });

    let rows = first.rows;
    let undecidable = undecidableRowsOf(rows, ctxFor(rows));
    if (undecidable.length > 0) {
      let clean: readonly NonceBearingProcessV1[] | null = null;
      for (let attempt = 1; attempt < UNDECIDABLE_MEMBERSHIP_CONFIRM_ATTEMPTS; attempt++) {
        waitSync(UNDECIDABLE_MEMBERSHIP_CONFIRM_DELAY_MS);
        const next = snapshot();
        if (!next.ok) {
          throw new Error(`orphan scan unavailable: ${next.reason}`);
        }
        const decision = nextUndecidablePersistenceDecision(undecidable, next.rows, ctxFor(next.rows));
        if (decision.action === "unavailable") {
          throw new Error("orphan scan unavailable: undecidable process-tree membership");
        }
        if (decision.action === "scan-clean") {
          clean = next.rows;
          break;
        }
        undecidable = decision.undecidable;
        rows = next.rows;
      }
      if (clean === null) {
        throw new Error("orphan scan unavailable: undecidable process-tree membership");
      }
      rows = clean;
    }

    // Kill-list only: nonce match or a live ParentProcessId chain. A parentless
    // unreadable in-window row that persisted is undecidable, so we already
    // threw and this filter never runs. Do not widen this into a kill of
    // a row we cannot attribute.
    return rows.filter((sighting) => {
      const nonce = asUsableToken(sighting.runNonce);
      const nonceMatch = nonce === runNonce;
      const descendant = holderPid > 0
        && sighting.pid !== holderPid
        && isInHolderTree(
          sighting,
          holderPid,
          rows,
          holderChainBounds(query.createdNotBefore, holderExitedAt),
        );
      if (!nonceMatch && !descendant) return false;
      return sightingCreatedNotBefore(sighting, query.createdNotBefore);
    });
  };
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isInHolderTree(
  sighting: NonceBearingProcessV1,
  holderPid: number,
  rows: readonly NonceBearingProcessV1[],
  bounds?: HolderChainBoundsV1,
): boolean {
  return descendantPidsOf(holderPid, rows, bounds).has(sighting.pid);
}

export type HolderChainBoundsV1 = {
  readonly holderExitedAt?: string;
  /** Spawn floor. The exit ceiling is applied only when it is strictly after this instant. */
  readonly createdNotBefore?: string;
};

function holderChainBounds(
  createdNotBefore?: string,
  holderExitedAt?: string,
): HolderChainBoundsV1 | undefined {
  if (createdNotBefore === undefined && holderExitedAt === undefined) return undefined;
  return {
    ...(createdNotBefore !== undefined ? { createdNotBefore } : {}),
    ...(holderExitedAt !== undefined ? { holderExitedAt } : {}),
  };
}

/**
 * The exit ceiling is a proof test. A degenerate ceiling (missing, or not
 * strictly after the spawn floor) proves nothing, so the edge stays ours.
 */
function holderExitedAtCeilingIsUsable(bounds?: HolderChainBoundsV1): boolean {
  return provenCreatedStrictlyAfter(bounds?.holderExitedAt, bounds?.createdNotBefore);
}

type ChainRowV1 = {
  readonly pid: number;
  readonly parentPid?: number;
  readonly creationDate?: string;
};

/**
 * Walk ParentProcessId from CIM rows. A PID is a slot: each *edge* is
 * dropped only when a date comparison *proves* it cannot be descent.
 * Missing or unplaceable dates keep the edge (UNKNOWN stays ours).
 */
export function descendantPidsOf(
  holderPid: number,
  rows: readonly ChainRowV1[],
  bounds?: HolderChainBoundsV1,
): Set<number> {
  const children = new Map<number, ChainRowV1[]>();
  const byPid = new Map<number, ChainRowV1>();
  for (const row of rows) {
    byPid.set(row.pid, row);
    if (row.parentPid === undefined) continue;
    const list = children.get(row.parentPid) ?? [];
    list.push(row);
    children.set(row.parentPid, list);
  }
  const out = new Set<number>();
  const stack = [holderPid];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (out.has(child.pid)) continue;
      if (!holderChainEdgeIsPossible(holderPid, current, child, byPid.get(current), bounds)) continue;
      out.add(child.pid);
      stack.push(child.pid);
    }
  }
  return out;
}

/**
 * Bound the edge, not the row. A genuine grandchild born after the
 * holder exited stays in the chain because its edge is from the still-
 * live intermediate, not from the holder.
 *
 * - Edge out of `holderPid`: drop only when the exit ceiling is
 *   strictly after the spawn floor *and* the child is *proven*
 *   created strictly after `holderExitedAt`. A degenerate ceiling
 *   (equal to the floor, missing, or unplaceable) proves nothing.
 * - Edge out of a snapshot parent: drop only when the child is *proven*
 *   created strictly before that parent's `creationDate`.
 * Missing or unplaceable dates keep the edge.
 */
function holderChainEdgeIsPossible(
  holderPid: number,
  parentPid: number,
  child: ChainRowV1,
  parentRow: ChainRowV1 | undefined,
  bounds?: HolderChainBoundsV1,
): boolean {
  if (
    parentPid === holderPid
    && holderExitedAtCeilingIsUsable(bounds)
    && provenCreatedStrictlyAfter(child.creationDate, bounds?.holderExitedAt)
  ) {
    return false;
  }
  if (
    parentRow !== undefined
    && provenCreatedStrictlyBefore(child.creationDate, parentRow.creationDate)
  ) {
    return false;
  }
  return true;
}

/**
 * Interval floor for ancestry-only samples while the holder is alive.
 * Shorter than this would turn a cheap CIM listing into a host load.
 */
export const ANCESTRY_SAMPLE_INTERVAL_MS = 500;

/**
 * Hard cap on ancestry samples per run. An intermediate that is born and
 * dies entirely between two samples is still missed; raising the rate
 * cannot close that gap. The complete closure is a Windows Job Object
 * on the holder (kill-on-close, breakaway denied, membership queried
 * with `JOBOBJECT_BASIC_PROCESS_ID_LIST`). That is an Owner decision
 * and is not this sampler.
 */
export const ANCESTRY_SAMPLE_MAX_PER_RUN = 240;

export type AncestrySampleRowV1 = {
  readonly pid: number;
  readonly parentPid?: number;
  readonly creationDate?: string;
};

/**
 * Record pids this Director actually walked as descendants of `holderPid`
 * on an ancestry-only sample. A failed sample must not call this with an
 * invented empty listing and must not be treated as "no descendants".
 *
 * Limit: an intermediate that is born and dies entirely between two
 * samples is never added. Closing that gap is the Job Object named
 * above, not another predicate on image name or environment block.
 */
export function rememberSampledDescendantPids(
  seen: Set<number>,
  holderPid: number,
  rows: readonly { readonly pid: number; readonly parentPid?: number }[],
): void {
  if (!isUsablePid(holderPid)) return;
  seen.add(holderPid);
  for (const pid of descendantPidsOf(holderPid, rows)) {
    seen.add(pid);
  }
}

/**
 * Cheap ancestry-only listing: `Win32_Process` projected to ProcessId,
 * ParentProcessId, CreationDate. No PEB read — that is what makes the
 * orphan scan cost seconds.
 *
 * A failed sample throws. The caller must ignore the throw: a failed
 * sample is not a scan and must never be read as "no descendants".
 *
 * Limit: an intermediate that is born and dies entirely between two
 * samples is missed. The complete closure is a Windows Job Object on
 * the holder (kill-on-close, breakaway denied,
 * `JOBOBJECT_BASIC_PROCESS_ID_LIST`), which no image name, environment
 * block, or dead intermediate can evade. That primitive is an Owner
 * decision and is not in scope this round.
 */
export function createWindowsAncestrySampler(host?: WindowsProbeHostV1): (query: {
  readonly holderPid: number;
}) => readonly AncestrySampleRowV1[] {
  const spawn = host?.spawnSync ?? spawnSync;
  const script = windowsAncestrySampleScript();
  return (_query) => {
    let result: WindowsProbeSpawnResultV1;
    try {
      result = spawn(resolveWindowsSystemExecutable("powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      throw new Error(`ancestry sample unavailable: probe failed to start: ${errorMessage(error)}`);
    }
    if (result.error) {
      const message = errorMessage(result.error);
      throw new Error(
        /timed? ?out/i.test(message)
          ? "ancestry sample unavailable: probe timed out"
          : `ancestry sample unavailable: probe failed: ${message}`,
      );
    }
    return interpretWindowsAncestrySampleOutput({
      status: result.status,
      stdout: stripBom(String(result.stdout ?? "")).trim(),
      stderr: String(result.stderr ?? "").trim(),
    });
  };
}

/**
 * Map a PowerShell ancestry-sample spawn result to pid/parent/creation
 * rows. Empty, unparseable, or non-zero-exit output throws — the caller
 * ignores the throw. A throw is not an empty descendant set.
 */
export function interpretWindowsAncestrySampleOutput(input: {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}): readonly AncestrySampleRowV1[] {
  const combined = `${input.stdout}\n${input.stderr}`;
  if (/access is denied/i.test(combined)) {
    throw new Error("ancestry sample unavailable: access-denied");
  }

  let parsed: unknown = null;
  if (input.stdout !== "") {
    try {
      parsed = JSON.parse(input.stdout);
    } catch {
      parsed = null;
    }
  }
  if (input.status !== 0) {
    if (isPlainObject(parsed) && typeof parsed.reason === "string" && parsed.reason.trim() !== "") {
      throw new Error(`ancestry sample unavailable: ${parsed.reason}`);
    }
    throw new Error(
      input.status === null
        ? "ancestry sample unavailable: sample exited without a status"
        : `ancestry sample unavailable: sample exited ${input.status}`,
    );
  }
  if (input.stdout === "") {
    throw new Error("ancestry sample unavailable: sample produced no output");
  }
  if (!isPlainObject(parsed)) {
    throw new Error("ancestry sample unavailable: sample output was not parseable");
  }
  if (parsed.ok !== true) {
    const why = typeof parsed.reason === "string" ? parsed.reason : "sample returned a failure envelope";
    throw new Error(`ancestry sample unavailable: ${why}`);
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "processes") || parsed.processes === null) {
    throw new Error("ancestry sample unavailable: sample did not return a process list");
  }
  const rows = asObjectArray(parsed.processes);
  if (rows === null) {
    throw new Error("ancestry sample unavailable: sample did not return a process list");
  }

  const sightings: AncestrySampleRowV1[] = [];
  for (const row of rows) {
    if (!isUsablePid(row.pid)) continue;
    const creationDate = normalisedCreationDate(row.creationDate);
    const parentPid = isUsablePid(row.parentPid) ? row.parentPid : undefined;
    sightings.push({
      pid: row.pid,
      ...(parentPid !== undefined ? { parentPid } : {}),
      ...(creationDate !== null ? { creationDate } : {}),
    });
  }
  return sightings;
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
/**
 * Broker hosts that mint a fresh environment and a live parent, so neither
 * nonce inheritance nor a live ParentProcessId chain can see the child.
 * One list; the PowerShell emit predicate interpolates the same names.
 */
export const BROKER_HOST_PROCESS_NAMES = [
  "WmiPrvSE.exe",
  "dllhost.exe",
  "svchost.exe",
  "taskeng.exe",
] as const;

export type ProcessRowPlausibilityV1 = {
  readonly pid?: number;
  readonly name?: string | null;
  readonly parentPid?: number;
  readonly parentPresent?: boolean;
  readonly parentName?: string | null;
  readonly parentCreationDate?: string;
  readonly executablePath?: string | null;
  readonly runNonce?: string | null;
  readonly creationDate?: string;
  /** True only when the PEB environment block was actually read. */
  readonly nonceReadable?: boolean;
};

/**
 * Three CIM snapshots, two delays of 300 ms = 600 ms of injected wait.
 * Console-host and `start /b ping` processes live well under that; a
 * writer leftover that is still in the tree is still there. Total wall
 * time with CIM stays around one second.
 *
 * Persistence is continued existence of the same occupant: pid AND
 * creationDate (PIDs recycle; {@link compareCreationDates} is the
 * equality). A leftover that exits and respawns under a new pid is a
 * *new* row. That new row is undecidable on the later snapshot, so the
 * snapshot is not clean and the scan stays UNAVAILABLE. The delay is
 * this constant, not an executor-supplied value, so the executor cannot
 * stretch the window.
 */
export const UNDECIDABLE_MEMBERSHIP_CONFIRM_ATTEMPTS = 3;
export const UNDECIDABLE_MEMBERSHIP_CONFIRM_DELAY_MS = 300;

/**
 * Cap on PEB environment reads per orphan-scan snapshot. The emit set
 * can include ordinary in-window host rows (live parent not proven
 * capable). Reading every PEB is what hung the suite; hitting this cap
 * marks the scan UNAVAILABLE rather than silently dropping rows.
 */
export const ORPHAN_SCAN_PEB_READ_CAP = 64;

export type ProcessRowPlausibilityContextV1 = {
  readonly runNonce: string;
  readonly createdNotBefore: string;
  readonly holderPid?: number;
  /**
   * Observed holder-exit instant. A broker-parented row is tied to this run
   * only when it is proven created in [createdNotBefore, holderExitedAt].
   * Missing or unplaceable: no closed interval, so the broker branch is not
   * a tie.
   */
  readonly holderExitedAt?: string;
  readonly observedPids: ReadonlySet<number>;
  readonly rows: readonly {
    readonly pid: number;
    readonly parentPid?: number;
    readonly creationDate?: string;
  }[];
};

export function isBrokerHostName(name: string | undefined | null): boolean {
  if (name === undefined || name === null || name === "") return false;
  const lower = name.toLowerCase();
  for (const host of BROKER_HOST_PROCESS_NAMES) {
    if (host.toLowerCase() === lower) return true;
  }
  return false;
}

export function nonceMatchesRun(sighting: ProcessRowPlausibilityV1, runNonce: string): boolean {
  const nonce = asUsableToken(sighting.runNonce);
  const target = asUsableToken(runNonce);
  return target !== null && nonce === target;
}

export function rowIsInHolderChain(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (sighting.pid === undefined || !isUsablePid(sighting.pid)) return false;
  if (ctx.holderPid === undefined || ctx.holderPid <= 0) return false;
  return descendantPidsOf(
    ctx.holderPid,
    ctx.rows,
    holderChainBounds(ctx.createdNotBefore, ctx.holderExitedAt),
  ).has(sighting.pid);
}

/**
 * Positive identity: this run's nonce, or a ParentProcessId walk to the holder.
 * A process image name is not a positive fact and must not appear here.
 */
export function rowHasPositiveRunIdentity(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  return nonceMatchesRun(sighting, ctx.runNonce) || rowIsInHolderChain(sighting, ctx);
}

/**
 * One answer to "could this row belong to this run?".
 *
 * A row is plausible when its nonce matches, it is in the holder's pid chain,
 * it was created in [floor, holder exit] with a broker parent, or it is
 * parentless (dead parent) with either a previously observed parent pid or
 * a creation instant in the closed [floor, holder exit] window.
 *
 * A nonce may exclude a row only when it is a fact about the process —
 * `nonceReadable === true` and the token identifies a different run — and
 * even then only after the floor and parentage tests have had their say.
 * A rewritten `AION_RUN_NONCE`, a CommandLine scrape, or a missing nonce
 * are the same UNKNOWN: the environment block does not contain *this*
 * run's nonce. That is not proof the process is not ours. See
 * {@link parentlessRowTiedToThisRun}. An image basename is not a
 * negative fact and must not exclude a row. Everything else is host
 * noise.
 */
export function processRowCouldBelongToThisRun(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (rowHasPositiveRunIdentity(sighting, ctx)) return true;
  // Do not return early on a foreign or unprovenanced nonce. A PEB that
  // contains AION_RUN_NONCE=not-ours, or a CommandLine scrape of one,
  // does not contain this run's nonce. That is the same UNKNOWN as a
  // successful PEB read that found no nonce at all.
  // A process image name is not a negative fact either: the executor
  // chooses the basename. Do not exclude on Name.
  if (!provenCreatedAtOrAfterFloor(sighting.creationDate, ctx.createdNotBefore)) return false;
  if (brokerParentedRowTiedToThisRun(sighting, ctx)) return true;
  return parentlessRowTiedToThisRun(sighting, ctx);
}

/**
 * Parentless membership. Observed-parent widening is unchanged: a parent
 * pid this Director actually recorded (holder, nonce match, live chain,
 * or an ancestry sample while the holder was alive) ties the row to this
 * run regardless of the child's image name or environment block.
 *
 * The closed-interval half fires for any parentless in-window row whose
 * parent was never sampled. A successful PEB read that found no
 * `AION_RUN_NONCE` proves only that this process's environment block
 * does not contain the nonce. It does not prove the process is not
 * ours: `CreateProcess` takes `lpEnvironment`, and a caller that
 * supplies one (`ProcessStartInfo.EnvironmentVariables.Remove`, or
 * `spawn(..., { env })`) mints a readable block without the nonce.
 * That bit is executor-controllable. A readable block without the nonce
 * is the same UNKNOWN as an unreadable one: the row stays tied when it
 * sits in `[floor, holderExitedAt]`, and
 * {@link processRowMakesScanUndecidable} turns that into UNAVAILABLE.
 *
 * An intermediate that is born and dies entirely between two ancestry
 * samples is never added to `observedPids`, so this function still
 * cannot see that grandchild except through the closed interval. Closing
 * that gap requires a Windows Job Object on the holder (kill-on-close,
 * breakaway denied, membership queried with
 * `JOBOBJECT_BASIC_PROCESS_ID_LIST`). No image name, environment block,
 * or dead intermediate can evade that. That primitive is an Owner
 * decision and is not in scope this round.
 */
export function parentlessRowTiedToThisRun(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (sighting.parentPid === undefined) return false;
  // A live parent excludes this branch only when it is proven capable of
  // being the creator. Occupancy of ParentProcessId is not that proof:
  // slots recycle and ShellExecute re-parents onto explorer.
  if (parentIsProvenCapableCreator(sighting, ctx)) return false;
  if (ctx.observedPids.has(sighting.parentPid)) return true;
  return provenCreatedAtOrBeforeCeiling(sighting.creationDate, ctx.holderExitedAt);
}

/**
 * A live parent may exclude a row only when both hold:
 * the occupant is proven created at or before the row, and the occupant
 * is the holder itself or a descendant in the holder chain. "Parent
 * existed before the spawn floor" is not used as a standalone exclusion:
 * explorer and notepad satisfy that and are the demonstrated
 * ShellExecute / recycled-slot fail-open. Missing or unplaceable
 * parentCreationDate is UNKNOWN → not capable.
 */
export function parentIsProvenCapableCreator(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (sighting.parentPresent !== true) return false;
  if (!provenCreatedAtOrBeforeCeiling(sighting.parentCreationDate, sighting.creationDate)) {
    return false;
  }
  return parentOccupantIsInHolderChain(sighting, ctx);
}

function parentOccupantIsInHolderChain(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (ctx.holderPid === undefined || ctx.holderPid <= 0) return false;
  if (!isUsablePid(sighting.parentPid)) return false;
  if (sighting.parentPid === ctx.holderPid) return true;
  return descendantPidsOf(
    ctx.holderPid,
    ctx.rows,
    holderChainBounds(ctx.createdNotBefore, ctx.holderExitedAt),
  ).has(sighting.parentPid);
}

/**
 * Same occupant across two CIM snapshots. Pid alone is reusable;
 * {@link compareCreationDates} must report SAME. Missing or uncomparable
 * dates cannot prove identity, so they do not count as persistence.
 */
export function processRowIdentityEquals(
  left: ProcessRowPlausibilityV1,
  right: ProcessRowPlausibilityV1,
): boolean {
  if (!isUsablePid(left.pid) || left.pid !== right.pid) return false;
  if (left.creationDate === undefined || right.creationDate === undefined) return false;
  return compareCreationDates(left.creationDate, right.creationDate) === "SAME";
}

export function undecidableRowsOf(
  rows: readonly ProcessRowPlausibilityV1[],
  ctx: ProcessRowPlausibilityContextV1,
): readonly ProcessRowPlausibilityV1[] {
  return rows.filter((row) => processRowMakesScanUndecidable(row, ctx));
}

/**
 * Whether any previous undecidable occupant is still in `next`.
 * Positive-identity rows never appear here: {@link processRowMakesScanUndecidable}
 * excludes them, so they stay on the leftover sweep.
 */
export function undecidableRowsStillPresent(
  previous: readonly ProcessRowPlausibilityV1[],
  next: readonly ProcessRowPlausibilityV1[],
): boolean {
  return previous.some((row) => next.some((other) => processRowIdentityEquals(row, other)));
}

export type UndecidablePersistenceDecisionV1 =
  | { readonly action: "unavailable" }
  | { readonly action: "scan-clean"; readonly rows: readonly ProcessRowPlausibilityV1[] }
  | { readonly action: "continue"; readonly undecidable: readonly ProcessRowPlausibilityV1[] };

/**
 * One re-scan step. A persisted occupant (same pid and creationDate) or
 * a hard failure is UNAVAILABLE. A later snapshot with no undecidable
 * rows is SCANNED. New undecidable rows (a respawn under a new pid) are
 * not a clean snapshot: the caller keeps confirming until the budget
 * expires, then stays UNAVAILABLE.
 */
export function nextUndecidablePersistenceDecision(
  previousUndecidable: readonly ProcessRowPlausibilityV1[],
  nextRows: readonly ProcessRowPlausibilityV1[],
  nextCtx: ProcessRowPlausibilityContextV1,
): UndecidablePersistenceDecisionV1 {
  const nextUndecidable = undecidableRowsOf(nextRows, nextCtx);
  if (undecidableRowsStillPresent(previousUndecidable, nextUndecidable)) {
    return { action: "unavailable" };
  }
  if (nextUndecidable.length === 0) {
    return { action: "scan-clean", rows: nextRows };
  }
  return { action: "continue", undecidable: nextUndecidable };
}

/**
 * A plausible row we cannot classify as ours (no nonce match, not in the
 * holder chain) makes the scan UNAVAILABLE. Derived from
 * {@link processRowCouldBelongToThisRun} — one definition.
 */
export function processRowMakesScanUndecidable(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (!processRowCouldBelongToThisRun(sighting, ctx)) return false;
  if (rowHasPositiveRunIdentity(sighting, ctx)) return false;
  return true;
}

/**
 * A broker-parented row is this run's only when it was minted while the
 * holder was actually alive. The floor alone is open-ended and covers the
 * whole tail after exit, including this Director's own CIM side effects.
 */
function brokerParentedRowTiedToThisRun(
  sighting: ProcessRowPlausibilityV1,
  ctx: ProcessRowPlausibilityContextV1,
): boolean {
  if (!isBrokerHostName(sighting.parentName)) return false;
  return provenCreatedAtOrBeforeCeiling(sighting.creationDate, ctx.holderExitedAt);
}

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
 * Whether `candidate` is *proven* at or before `ceiling`. An unplaceable
 * operand does not establish the claim — UNKNOWN stays UNKNOWN, so this
 * returns false. A missing ceiling is not a closed interval.
 */
export function provenCreatedAtOrBeforeCeiling(
  candidate: string | undefined,
  ceiling: string | undefined,
): boolean {
  const ceilingToken = asUsableToken(ceiling);
  if (ceilingToken === null) return false;
  const ceilingMs = placeableInstantMs(ceilingToken);
  if (ceilingMs === null) return false;
  if (candidate === undefined) return false;
  const at = placeableInstantMs(candidate);
  if (at === null) return false;
  return at <= ceilingMs;
}

/**
 * Whether `candidate` is proven strictly earlier than `floor`. Unplaceable
 * operands are not proven earlier.
 */
export function createdBeforeFloor(
  candidate: string | undefined,
  floor: string | undefined,
): boolean {
  return provenCreatedStrictlyBefore(candidate, floor);
}

/**
 * Whether `candidate` is *proven* strictly after `instant`. Unplaceable
 * operands are not proven later — UNKNOWN keeps the edge.
 */
export function provenCreatedStrictlyAfter(
  candidate: string | undefined,
  instant: string | undefined,
): boolean {
  const instantToken = asUsableToken(instant);
  if (instantToken === null) return false;
  const instantMs = placeableInstantMs(instantToken);
  if (instantMs === null) return false;
  if (candidate === undefined) return false;
  const at = placeableInstantMs(candidate);
  if (at === null) return false;
  return at > instantMs;
}

/**
 * Whether `candidate` is *proven* strictly before `instant`. Unplaceable
 * operands are not proven earlier — UNKNOWN keeps the edge.
 */
export function provenCreatedStrictlyBefore(
  candidate: string | undefined,
  instant: string | undefined,
): boolean {
  const instantToken = asUsableToken(instant);
  if (instantToken === null) return false;
  const instantMs = placeableInstantMs(instantToken);
  if (instantMs === null) return false;
  if (candidate === undefined) return false;
  const at = placeableInstantMs(candidate);
  if (at === null) return false;
  return at < instantMs;
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

/**
 * Build a UTC instant from the calendar the token named. Range-checking
 * the components is not enough: `Date.UTC` rolls Feb 31 into March and
 * remaps years 0–99 onto 1900–1999. A token that names no real day must
 * be refused, not invented.
 */
function utcFromNamedCalendar(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (!Number.isFinite(ms)) return null;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  if (!Number.isFinite(asUtc)) return null;
  const calendar = new Date(asUtc);
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
  ) {
    return null;
  }
  return asUtc;
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
  const ms = fraction === "" ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
  const asUtc = utcFromNamedCalendar(year, month, day, hour, minute, second, ms);
  if (asUtc === null) return null;
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
  const asUtc = utcFromNamedCalendar(
    year,
    month,
    day,
    hour,
    minute,
    second,
    Math.floor(micro / 1000),
  );
  if (asUtc === null) return null;
  // DMTF/WMI UTC offset is minutes, documented maximum ±720 (14 hours).
  // A value outside that range is not a placeable instant.
  if (offsetMinutes > 720) return null;
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
  if (value === undefined || value === null) return null;
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

function windowsAncestrySampleScript(): string {
  return [
    "$ProgressPreference = 'SilentlyContinue';",
    "try {",
    "$rows = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate -ErrorAction Stop;",
    "$hits = New-Object System.Collections.Generic.List[object];",
    "foreach ($p in $rows) {",
    "  $cd = if ($p.CreationDate) { $p.CreationDate.ToString('o') } else { $null };",
    "  [void]$hits.Add([ordered]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; creationDate = $cd });",
    "}",
    "[ordered]@{ ok = $true; processes = $hits } | ConvertTo-Json -Compress -Depth 5;",
    "exit 0",
    "} catch {",
    "Write-Output '{\"ok\":false,\"reason\":\"cim-error\"}';",
    "exit 1",
    "}",
  ].join("\n");
}

function windowsOrphanScanScript(
  quotedNonce: string,
  holderPid: number,
  quotedFloorIso: string,
  quotedHolderExitIso = "''",
): string {
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
    `$floorUtc = [datetimeoffset]::Parse(${quotedFloorIso}).UtcDateTime;`,
    `$exitQuoted = ${quotedHolderExitIso};`,
    "$exitUtc = $null;",
    "if ($exitQuoted -ne '') { try { $exitUtc = [datetimeoffset]::Parse($exitQuoted).UtcDateTime } catch { $exitUtc = $null } };",
    "$rows = Get-CimInstance Win32_Process -ErrorAction Stop;",
    "$byParent = @{};",
    "$byPid = @{};",
    "foreach ($p in $rows) {",
    "  $pp = [int]$p.ParentProcessId;",
    "  if (-not $byParent.ContainsKey($pp)) { $byParent[$pp] = New-Object System.Collections.Generic.List[object] };",
    "  [void]$byParent[$pp].Add($p);",
    "  $byPid[[int]$p.ProcessId] = $p;",
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
    "        $chUtc = $null;",
    "        if ($ch.CreationDate) { try { $chUtc = ([datetime]$ch.CreationDate).ToUniversalTime() } catch { $chUtc = $null } };",
    "        if ($cur -eq $holderPid -and $exitUtc -ne $null -and $chUtc -ne $null -and $chUtc -gt $exitUtc) { continue };",
    "        if ($byPid.ContainsKey($cur) -and $byPid[$cur].CreationDate -and $chUtc -ne $null) {",
    "          try {",
    "            $parUtc = ([datetime]$byPid[$cur].CreationDate).ToUniversalTime();",
    "            if ($chUtc -lt $parUtc) { continue };",
    "          } catch { }",
    "        };",
    "        if ($desc.Add($id)) { $stack.Push($id) };",
    "      }",
    "    }",
    "  }",
    "}",
    "$pidSet = New-Object 'System.Collections.Generic.HashSet[int]';",
    "foreach ($p in $rows) { [void]$pidSet.Add([int]$p.ProcessId) };",
    "$candidates = New-Object System.Collections.Generic.List[object];",
    "foreach ($p in $rows) {",
    "  $id = [int]$p.ProcessId;",
    "  $isDesc = $desc.Contains($id);",
    "  $ppid = [int]$p.ParentProcessId;",
    "  $parentPresent = $pidSet.Contains($ppid);",
    "  $atOrAfterFloor = $false;",
    "  $childUtc = $null;",
    "  if ($p.CreationDate) {",
    "    try {",
    "      $childUtc = ([datetime]$p.CreationDate).ToUniversalTime();",
    "      $atOrAfterFloor = $childUtc -ge $floorUtc;",
    "    } catch { $atOrAfterFloor = $false; $childUtc = $null }",
    "  };",
    "  $parentName = $null;",
    "  $parentCreationDate = $null;",
    "  $parentUtc = $null;",
    "  if ($parentPresent -and $byPid.ContainsKey($ppid)) {",
    "    $q = $byPid[$ppid];",
    "    $parentName = [string]$q.Name;",
    "    if ($q.CreationDate) {",
    "      try {",
    "        $parentUtc = ([datetime]$q.CreationDate).ToUniversalTime();",
    "        $parentCreationDate = $q.CreationDate.ToString('o');",
    "      } catch { $parentUtc = $null; $parentCreationDate = $null }",
    "    }",
    "  };",
    "  $name = [string]$p.Name;",
    `  $brokerNames = @(${BROKER_HOST_PROCESS_NAMES.map((name) => `'${name.replace(/'/g, "''")}'`).join(", ")});`,
    "  $isBroker = $false;",
    "  if ($parentName) { foreach ($b in $brokerNames) { if ($parentName -ieq $b) { $isBroker = $true } } };",
    "  $parentInChain = $false;",
    "  if ($holderPid -gt 0 -and (($ppid -eq $holderPid) -or $desc.Contains($ppid))) { $parentInChain = $true };",
    "  $parentBeforeChild = $false;",
    "  if ($parentUtc -ne $null -and $childUtc -ne $null -and $parentUtc -le $childUtc) { $parentBeforeChild = $true };",
    "  $parentProvenCapable = [bool]($parentPresent -and $parentInChain -and $parentBeforeChild);",
    "  $emit = $isDesc -or ($atOrAfterFloor -and -not $parentProvenCapable);",
    "  if ($emit) {",
    "    $cd = if ($p.CreationDate) { $p.CreationDate.ToString('o') } else { $null };",
    "    $exe = if ($p.ExecutablePath) { [string]$p.ExecutablePath } else { $null };",
    "    $cmd = if ($p.CommandLine) { [string]$p.CommandLine } else { '' };",
    "    [void]$candidates.Add([ordered]@{ pid = $id; name = $name; creationDate = $cd; parentPid = $ppid; parentPresent = [bool]$parentPresent; parentName = $parentName; parentCreationDate = $parentCreationDate; executablePath = $exe; isDesc = [bool]$isDesc; commandLine = $cmd });",
    "  }",
    "}",
    `$pebCap = ${ORPHAN_SCAN_PEB_READ_CAP};`,
    "$pebUsed = 0;",
    "$pebCapped = $false;",
    "$hits = New-Object System.Collections.Generic.List[object];",
    "$unreadable = 0;",
    "foreach ($c in $candidates) {",
    "  $n = $null;",
    "  $nonceReadable = $false;",
    "  if ($pebUsed -ge $pebCap) {",
    "    $pebCapped = $true;",
    "  } else {",
    "    $pebUsed++;",
    "    $n = [AionPebEnv]::GetNonce([int]$c.pid);",
    "    $nonceReadable = $null -ne $n;",
    "    if (-not $nonceReadable) {",
    "      if ($c.commandLine -match 'AION_RUN_NONCE=([^\\s]+)') { $n = $Matches[1] };",
    "    } elseif ($n -eq '') {",
    "      $n = $null;",
    "    }",
    "  };",
    "  if ($c.isDesc -and -not $nonceReadable -and -not $n) { $unreadable++ };",
    "  [void]$hits.Add([ordered]@{ pid = $c.pid; name = $c.name; creationDate = $c.creationDate; runNonce = $n; parentPid = $c.parentPid; nonceReadable = [bool]$nonceReadable; parentPresent = $c.parentPresent; parentName = $c.parentName; parentCreationDate = $c.parentCreationDate; executablePath = $c.executablePath });",
    "}",
    "if ($pebCapped) { $unreadable = [Math]::Max($unreadable, 1) };",
    "[ordered]@{ ok = $true; processes = $hits; unreadable = [int]$unreadable } | ConvertTo-Json -Compress -Depth 5;",
    "exit 0",
    "} catch {",
    "Write-Output '{\"ok\":false,\"reason\":\"cim-error\"}';",
    "exit 1",
    "}",
  ].join("\n");
}
