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
 * anything. A real Windows probe exists so one test can confirm the probe works at all.
 */
import { spawnSync } from "node:child_process";
import type { IdentityMatchV1, ProcessLivenessV1 } from "./leases.js";
import { canonicalizeHostPath, isResolvedHostPath } from "./host-path.js";

export type { IdentityMatchV1, ProcessLivenessV1 } from "./leases.js";

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
  const creationDate = asUsableToken(observation.creationDate);
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
  if (!sameCreationDate(recorded.creationDate, sighting.creationDate)) return "MISMATCH";

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
 * `ALIVE`. A found process whose creation date disagrees is the slot after reuse — the holder is
 * gone. Any other disagreement, or a found process that cannot be compared, is `UNKNOWN`.
 */
export function holderLiveness(
  recorded: ExecutorProcessIdentityV1,
  observation: ProcessObservationV1,
): ProcessLivenessV1 {
  if (observation.outcome === "UNAVAILABLE") return "UNKNOWN";
  if (observation.outcome === "NOT_FOUND") return "DEAD_CONFIRMED";

  const verdict = compareProcessIdentity(recorded, observation);
  if (verdict === "MATCH") return "ALIVE";
  if (verdict === "UNVERIFIABLE") return "UNKNOWN";

  // MISMATCH. Same slot, later start: the original process is gone. Any other mismatch is a live
  // occupant we cannot treat as the holder, which is not a death certificate.
  if (
    observation.creationDate !== undefined
    && !sameCreationDate(recorded.creationDate, observation.creationDate)
  ) {
    return "DEAD_CONFIRMED";
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
    if (observed.runNonce !== undefined && observed.runNonce !== null && observed.runNonce !== recorded.runNonce) {
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

  const creationDate = asUsableToken(own(value, "creationDate"));
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

/**
 * CIM query of one PID on this Windows host.
 *
 * Access-denied, a timeout, a parser failure and a process on another account all come back as
 * `UNAVAILABLE`. Absence comes back as `NOT_FOUND`. Those two must not be collapsed.
 */
export function createWindowsProcessProbe(): HostProcessProbe {
  return {
    observe(pid: number): ProcessObservationV1 {
      if (!isUsablePid(pid)) {
        return { outcome: "UNAVAILABLE", reason: "pid is not a positive integer" };
      }

      const script = [
        "$ProgressPreference = 'SilentlyContinue';",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue;`,
        "if (-not $p) { Write-Output '{\"ok\":false,\"reason\":\"not-found\"}'; exit 0 }",
        "$o = [ordered]@{ ok = $true; pid = [int]$p.ProcessId; name = $p.Name; executablePath = $p.ExecutablePath; commandLine = $p.CommandLine; creationDate = $p.CreationDate.ToString('o'); parentPid = [int]$p.ParentProcessId };",
        "$o | ConvertTo-Json -Compress",
      ].join(" ");

      let result: ReturnType<typeof spawnSync>;
      try {
        result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
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

      const stdout = stripBom(String(result.stdout ?? "")).trim();
      const stderr = String(result.stderr ?? "").trim();
      const combined = `${stdout}\n${stderr}`;
      if (/access is denied/i.test(combined)) {
        return { outcome: "UNAVAILABLE", reason: "access-denied" };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout || "{\"ok\":false}");
      } catch {
        return { outcome: "UNAVAILABLE", reason: "probe output was not parseable" };
      }
      if (!isPlainObject(parsed)) {
        return { outcome: "UNAVAILABLE", reason: "probe output was not an object" };
      }

      if (parsed.ok !== true) {
        const why = typeof parsed.reason === "string" ? parsed.reason : "not-found";
        if (why === "not-found") return { outcome: "NOT_FOUND", reason: "no process occupies this pid" };
        return { outcome: "UNAVAILABLE", reason: why };
      }

      const observedPid = parsed.pid;
      if (!isUsablePid(observedPid)) {
        return { outcome: "UNAVAILABLE", reason: "probe did not return a pid" };
      }

      const found: ProcessObservationV1 = {
        outcome: "FOUND",
        reason: "cim",
        pid: observedPid,
        ...(usableOrOmit("creationDate", parsed.creationDate)),
        ...(usableOrOmit("executablePath", parsed.executablePath)),
        ...(usableOrOmit("name", parsed.name)),
        ...(parentPidField(parsed.parentPid)),
        ...nonceFromThisProcess(observedPid, parsed.commandLine),
      };
      return found;
    },
  };
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

function sameCreationDate(recorded: string, observed: string): boolean {
  const a = Date.parse(recorded);
  const b = Date.parse(observed);
  if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return recorded === observed;
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
