/**
 * What an executor hands back, and why none of it is taken on trust.
 *
 * A run ends with a structured report: branch, SHAs, test counts, whether production was touched,
 * what it spent. That report is the executor's account of itself. It is useful — it says what to
 * check and where — but it is testimony, and the Director's job is to be the thing that checks.
 *
 * So parsing is strict and verification is separate. A handoff that will not parse is a failed run,
 * not a run whose result must be guessed at from prose. And a handoff that parses perfectly still
 * proves nothing until Git and the test artifacts agree with it.
 *
 * ## The claims that matter most are the ones an executor is least able to prove
 *
 * `productionMutated: false` and `spendUsd: 0` are exactly the fields a confused or compromised
 * executor would report incorrectly, and exactly the fields whose consequences are worst. They are
 * therefore treated as claims requiring corroboration, and the corroboration lives outside this
 * file — in Git truth, in process inspection, in the fact that no payment path exists at all.
 *
 * ## One frozen contract, and no silent defaults for safety assertions
 *
 * This is the single definition of `aion.director.handoff.v1`; durable records are written against
 * it, so every ambiguity resolved loosely here becomes a file on disk that means two things. Two
 * rules follow. Records discriminate on `schema`, spelled the same way as every other v1 record in
 * this package, with the older `schemaVersion` accepted as an alias and required to agree when both
 * appear. And a missing safety assertion is a validation failure rather than a default: an absent
 * `productionMutated` read as `false` converts "the executor never said" into "the executor said
 * no", which is the exact substitution that lets an unreported production write pass review.
 *
 * ## Paths in a report are attacker-shaped input
 *
 * `artifacts` is a list of filenames chosen by the executor and later opened, copied or served by
 * something else. A caller that knows the run's artifact directory passes it as `artifactRoot`, and
 * every path is resolved against it with both separators and `..` segments accounted for, so a
 * report cannot *name* a file outside the run it belongs to.
 *
 * ## What containment here does not cover, and who must close it
 *
 * The check is pure string work — no filesystem is consulted — so it proves textual containment, not
 * filesystem containment. A junction or symlink planted inside the run directory defeats it: with
 * `runs\r1` as the root, an executor that creates `runs\r1\logs -> ..\..\secrets` (which needs no
 * elevation, and which is inside the authority an executor already has over its own run directory)
 * gets `logs\id_rsa` accepted, and whatever opens it reads a file outside the run. This module cannot
 * close that without importing `node:fs`, which would put filesystem code in the parse layer.
 *
 * The obligation therefore sits with the consumer, exactly as it does in `host-path.ts`: callers that
 * can resolve, must resolve before trusting the answer. Re-check after resolution —
 * `artifactPathWithinRoot(realpathSync.native(root), realpathSync.native(join(root, artifact)))` —
 * before opening, copying or serving anything this parser returned. Accepting a path here means the
 * text names somewhere inside the run; it does not mean the bytes are there.
 *
 * Both ways of having no usable root fail closed. A root that was supplied but is empty or
 * whitespace-only is a validation error rather than a quiet fallback to "no root", because the
 * caller that built it by joining a run directory that turned out missing believes containment is
 * being enforced. And with no root at all, an absolute artifact path is refused: declining to say
 * where artifacts live is not a statement that every location on the machine is a run artifact.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
// One device predicate for the package, not a second copy. The copy that used to live here took the
// stem at the first "." only, so `NUL` was refused and `NUL:` was accepted — and `NUL:` opens the null
// device in any real directory. Two predicates for one Windows rule will always drift apart; this is
// the pure leaf both path layers already depend on, so there is no new coupling and no cycle.
import { asUsableToken, CONTROL_BYTES as CONTROL_BYTES_IN_PATH } from "./control-bytes.js";
import { canonicalizeHostPath, namesReservedDeviceSegment, isResolvedHostPath } from "./host-path.js";

export const HANDOFF_SCHEMA_V1 = "aion.director.handoff.v1" as const;

/**
 * The largest report text the Director will attempt to read.
 *
 * A handoff is a small record — a summary capped at a few thousand characters and a bounded list of
 * paths — so a quarter-megabyte is far above anything legitimate. The bound exists because the
 * cheapest way to hurt this parser is volume: a runaway executor that pastes a full build log into
 * its reply would otherwise be trimmed, scanned by the fence regex and handed to `JSON.parse`
 * before anything noticed the size.
 */
export const HANDOFF_MAX_BYTES = 262_144;

/** Bounds on the artifact list, which is also reachable when a caller passes a pre-parsed object. */
export const HANDOFF_MAX_ARTIFACTS = 256;
export const HANDOFF_MAX_ARTIFACT_PATH_LENGTH = 1_024;

/** Free text for people. Truncated rather than refused, because prose length is not a safety claim. */
export const HANDOFF_MAX_SUMMARY_LENGTH = 4_000;

export type HandoffStatusV1 = "PASS" | "FAIL" | "BLOCKED";

export type ExecutorCapacityV1 =
  | "AVAILABLE"
  | "CAPACITY_LOW"
  | "CAPACITY_EXHAUSTED"
  | "RESET_AT_KNOWN_TIME"
  | "UNAVAILABLE";

const HANDOFF_STATUSES: readonly HandoffStatusV1[] = ["PASS", "FAIL", "BLOCKED"];

const EXECUTOR_CAPACITIES: readonly ExecutorCapacityV1[] = [
  "AVAILABLE", "CAPACITY_LOW", "CAPACITY_EXHAUSTED", "RESET_AT_KNOWN_TIME", "UNAVAILABLE",
];

export interface HandoffTestsV1 {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ExecutorHandoffV1 {
  /** The discriminator, spelled as in every other v1 record here. */
  schema: typeof HANDOFF_SCHEMA_V1;
  /** @deprecated Mirror of `schema`, kept populated so readers written against the old name still work. */
  schemaVersion: typeof HANDOFF_SCHEMA_V1;
  executor: string;
  missionId: OpaqueId;
  runId: OpaqueId;
  branch: string;
  headBefore: string;
  headAfter: string;
  status: HandoffStatusV1;
  tests: HandoffTestsV1[];
  /** A claim, and a required one. Corroborated against process and checkout identity, never believed alone. */
  productionMutated: boolean;
  /** A claim. The envelope permits nothing above zero, so anything else is a contradiction. */
  spendUsd: number;
  requiresOwner: boolean;
  nextRecommendedGate: string | null;
  artifacts: string[];
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp;
  capacityStatus: ExecutorCapacityV1;
  /**
   * The Director-minted run nonce, echoed from `AION_RUN_NONCE`.
   * A report that cannot prove it is this invocation's is not this invocation's.
   */
  runNonce: string;
  /** Free text from the executor. Read by people; never parsed for control. */
  summary: string;
}

export interface HandoffParseV1 {
  ok: boolean;
  handoff: ExecutorHandoffV1 | null;
  problems: string[];
}

/**
 * What the caller already knows, and is therefore entitled to insist on.
 *
 * All optional so existing call sites keep compiling, but each one supplied turns an assumption
 * into a check. `expectedMissionId` and `expectedRunId` in particular bind the report to the run it
 * claims to be for: without them a handoff from a stale or unrelated run is indistinguishable from
 * the one that was awaited, and its SHAs would be verified against the wrong repository state.
 */
export interface HandoffParseOptionsV1 {
  expectedMissionId?: string;
  expectedRunId?: string;
  /**
   * Absolute directory every artifact path must resolve inside.
   *
   * Omit it to say nothing; supplying an empty, whitespace-only or relative value is a validation
   * error, since a root that was offered and cannot be enforced must not read as no root at all.
   */
  artifactRoot?: string;
  /** Override for HANDOFF_MAX_BYTES. Applies to text input; an already-parsed object has no text size. */
  maxBytes?: number;
}

const SHA = /^[0-9a-f]{40}$/i;

interface NormalizedPathV1 {
  /** Lowercased drive letter when the path named one, else null. */
  drive: string | null;
  absolute: boolean;
  /** Segments with "." and resolvable ".." removed. */
  segments: string[];
  /** True when a ".." climbed above the path's own starting point. */
  escaped: boolean;
  /**
   * True for a UNC path (`\\server\share\x`), which names a host this process does not control.
   *
   * Carried separately because flattening it into `absolute` made a remote location compare equal to
   * a local one: see the drive/UNC comparison in `artifactPathWithinRoot`.
   */
  unc: boolean;
}

/**
 * Resolve a path the way a filesystem will, not the way a string comparison would.
 *
 * Both separators are treated as separators regardless of host platform: the Director runs on
 * Windows, but a check that only understood `/` would let `..\\..\\` through on the machine where
 * it matters, and a check that only ran correctly on Windows could not be tested anywhere else.
 */
function normalizePath(input: string): NormalizedPathV1 {
  let rest = input.replace(/\\/g, "/");
  let drive: string | null = null;
  let absolute = false;
  let unc = false;

  const driveMatch = /^([A-Za-z]):(\/?)/.exec(rest);
  if (driveMatch) {
    drive = driveMatch[1]!.toLowerCase();
    absolute = driveMatch[2] === "/";
    rest = rest.slice(driveMatch[0].length);
  } else if (rest.startsWith("//")) {
    // A UNC path names a share on another host. Reduced to the same shape as a slash-rooted local
    // path it compared equal to one, and the leading `//` collapsed silently because the segment
    // loop skips empty parts: root `/AION/runs/r1` accepted `\\AION\runs\r1\payload.exe`, a remote
    // SMB location reported as inside a local run directory, and the mirror case accepted a local
    // `\aion-nas\runs\r1\x` under a `\\aion-nas\runs\r1` root.
    absolute = true;
    unc = true;
    rest = rest.slice(2);
  } else if (rest.startsWith("/")) {
    absolute = true;
    rest = rest.slice(1);
  }

  const segments: string[] = [];
  let escaped = false;
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      // Nothing left to pop means this ".." leaves the starting point, which for a run-relative
      // artifact path means it leaves the run's directory.
      if (segments.length === 0) escaped = true;
      else segments.pop();
      continue;
    }
    segments.push(part);
  }

  return { drive, absolute, segments, escaped, unc };
}

/**
 * A root anchors containment only when it names one directory on its own.
 *
 * A relative root ("runs/r1"), a root that climbed above itself, or a root that resolves to no
 * segments at all means a different directory depending on whose working directory is current, so
 * artifacts would be compared against a location this process cannot name.
 */
function rootAnchorsContainment(root: NormalizedPathV1): boolean {
  // Positively anchored: a drive letter, or a UNC share. `absolute` alone was not enough, because a
  // driveless root like `\AION\runs\r1` sets it while being anchored to the *current drive* — process
  // state, so the Director validated `logs\x` against `C:\AION\runs\r1` while a consumer whose current
  // drive was D: opened `D:\AION\runs\r1\logs\x`, a tree outside the run. It also broke the honest
  // case: the run's own absolute artifact paths were rejected under a root naming that run. The
  // sibling module refuses the same spelling for the same reason; two files in one package must not
  // rule oppositely on `\x`.
  if (!(root.drive !== null || root.unc)) return false;
  return root.absolute && !root.escaped && root.segments.length > 0;
}

/**
 * True when `candidate` names something strictly inside `root`.
 *
 * Segments compare case-insensitively because the target filesystem is Windows, where
 * `C:\AION\runs` and `c:\aion\RUNS` are one directory and rejecting the second would fail honest
 * handoffs without preventing any traversal.
 */
export function artifactPathWithinRoot(root: string, candidate: string): boolean {
  // Exported, so it is reachable with whatever a caller happens to hold — including the `null` that
  // JSON.parse yields for an absent field. Throwing here would turn a containment *refusal* into an
  // exception that skips the caller's `if (!allowed)` branch entirely, which fails open at the one
  // call site that matters.
  if (typeof root !== "string" || typeof candidate !== "string") return false;
  if (root.trim() === "" || candidate.trim() === "") return false;
  // A NUL truncates the name the operating system actually opens, so the path that was validated
  // and the path that is opened are different paths.
  // Every control byte, not only NUL: NUL truncates the name Win32 opens, and the rest make a path
  // that renders one way in a log and another way on disk. Either way the string that was checked is
  // not the string that gets opened, which is the only thing containment can be about.
  if (CONTROL_BYTES_IN_PATH.test(root) || CONTROL_BYTES_IN_PATH.test(candidate)) return false;

  // Host-path identity first: `\\?\C:\...` is one directory, not an ADS.
  // Device and stream checks run on that identity, not the raw prefix.
  const rootKey = isResolvedHostPath(root) ? canonicalizeHostPath(root) : root;
  const candidateKey = isResolvedHostPath(candidate) ? canonicalizeHostPath(candidate) : candidate;
  if (namesAlternateDataStream(candidateKey) || namesReservedDevice(candidateKey)) return false;
  if (!isResolvedHostPath(root) || namesReservedDevice(rootKey) || namesAlternateDataStream(rootKey)) return false;

  const rootPath = normalizePath(rootKey);
  if (!rootAnchorsContainment(rootPath)) return false;

  const candidatePath = normalizePath(candidateKey);
  if (candidatePath.escaped) return false;

  let resolved: string[];
  if (candidatePath.absolute) {
    if (candidatePath.drive !== rootPath.drive) return false;
    // A share on another host is not the local directory that spells the same segments.
    if (candidatePath.unc !== rootPath.unc) return false;
    resolved = candidatePath.segments;
  } else {
    // "C:logs" is drive-relative: it resolves against a per-drive working directory nobody here
    // controls, so it names an unpredictable location rather than a place under the root.
    if (candidatePath.drive !== null) return false;
    resolved = [...rootPath.segments, ...candidatePath.segments];
  }

  // Strictly inside: a path equal to the root names the directory, not an artifact in it.
  if (resolved.length <= rootPath.segments.length) return false;
  for (let index = 0; index < rootPath.segments.length; index += 1) {
    if (resolved[index]!.toLowerCase() !== rootPath.segments[index]!.toLowerCase()) return false;
  }
  return true;
}

/**
 * Whether any segment names a Win32 reserved device rather than a file.
 *
 * `logs/CON`, `CON.txt`, `NUL`, `NUL:` and `NUL::$DATA` name devices, not files, whatever directory
 * precedes them. The predicate itself lives in `host-path.ts` so this module and the lease/lock layer
 * cannot drift apart about what Windows does — the local copy this replaces cut the stem at `.` only,
 * which refused `NUL` and accepted `NUL:`.
 */
function namesReservedDevice(candidate: string): boolean {
  return candidate.split(/[\\/]+/).some(namesReservedDeviceSegment);
}

/** Whether any segment past an optional leading drive letter carries a `:`, i.e. a stream suffix. */
function namesAlternateDataStream(candidate: string): boolean {
  const segments = candidate.split(/[\\/]+/);
  return segments.some((segment, index) => {
    // The drive colon is legitimate and may be followed by a drive-relative remainder ("C:logs").
    // Only colons past that prefix name a stream; the drive-relative shape is refused elsewhere, by
    // the rule that actually understands it, and must not be reported as an ADS instead.
    if (index === 0) return segment.replace(/^[A-Za-z]:/, "").includes(":");
    return segment.includes(":");
  });
}

/** A ".." segment is never a legitimate way to name a run artifact, root known or not. */
function hasTraversalSegment(candidate: string): boolean {
  return candidate.split(/[\\/]+/).includes("..");
}

/**
 * True when a path names a filesystem location by itself instead of a place inside some root.
 *
 * With no root established there is nothing such a path can be checked against, so it is refused
 * rather than kept: "C:\\Windows\\System32\\config\\SAM", "/etc/shadow" and "\\\\server\\share\\x"
 * all pass a traversal scan unchanged, and a traversal scan was the only check they used to face.
 * Drive-relative names ("C:logs\\x") count as absolute here because they resolve against a per-drive
 * working directory this process does not control, which is not a run-relative location either.
 */
function namesAbsoluteLocation(candidate: string): boolean {
  const path = normalizePath(candidate);
  return path.absolute || path.drive !== null;
}

/** What `options.artifactRoot` established, decided once rather than re-derived per artifact. */
interface ArtifactRootDecisionV1 {
  /** The trimmed root to enforce, or null when none was established. */
  root: string | null;
  /** Set when a root was supplied but cannot be used; a supplied-and-unusable root is an error. */
  problem: string | null;
}

/**
 * Separate "no root was supplied" from "a root was supplied and is unusable".
 *
 * Collapsing the second into the first is how containment silently became traversal-only checking:
 * an `artifactRoot` of "" or "   " — the shape produced by joining an undefined run directory, or by
 * reading a blank config value — left the caller believing paths were confined to a run while every
 * non-traversing path was accepted. Unusable roots therefore fail the parse, and the artifact loop
 * falls back to the strictest rules rather than the weakest.
 */
function decideArtifactRoot(supplied: unknown): ArtifactRootDecisionV1 {
  // `undefined` is the only way to say "I have nothing to add". `null` used to mean the same thing and
  // must not: it is what `JSON.parse` yields for an absent value and what a config read returns when a
  // key is missing, so it is the shape a caller arrives with while believing containment is enforced —
  // the same failure as `""`, one type further along. Every other non-string already errored.
  if (supplied === undefined) return { root: null, problem: null };
  if (supplied === null) {
    return {
      root: null,
      problem: "artifactRoot was supplied as null; that is a missing value, not a decision to skip containment",
    };
  }
  if (typeof supplied !== "string") {
    return { root: null, problem: `artifactRoot must be a string, not ${typeof supplied}` };
  }
  const trimmed = supplied.trim();
  if (trimmed === "") {
    return {
      root: null,
      problem: "artifactRoot was supplied but is empty; an empty root confines nothing and is not the same as supplying no root",
    };
  }
  // A NUL truncates the name the operating system actually opens, so containment would be decided
  // against a longer root than the one anything later opens.
  if (trimmed.includes("\0")) {
    return { root: null, problem: "artifactRoot contains a NUL byte" };
  }
  // Acceptance is *delegated* to the host-path module rather than re-derived here. The previous
  // version re-derived it and the two drifted immediately: this file's own comment claimed "two files
  // in one package must not rule oppositely on `\x`", and while the driveless spelling was fixed, a
  // share-less UNC (`\\aion-nas`), the device namespace (`\\?\NUL`, `\\?\GLOBALROOT\...`) and a root
  // ending in a reserved device (`C:\AION\runs\NUL`) all still passed here while `host-path.ts`
  // called every one of them INVALID. `\\aion-nas` then reported `\\aion-nas\c$\Windows\...\SAM` as
  // contained, and a `...\NUL` root makes every artifact write vanish while reporting success.
  //
  // A second predicate for one question is the same defect as a second device-name predicate was.
  // `rootAnchorsContainment` below still runs, because containment is computed in this module's own
  // normalised form and the root must satisfy that shape too — but it can no longer be the *only*
  // thing standing between a caller and an unusable root.
  if (!isResolvedHostPath(trimmed) || namesReservedDevice(trimmed)) {
    return { root: null, problem: `artifactRoot ${trimmed} does not name one directory on this host` };
  }
  // Host-path already accepted this spelling (including `\\?\C:\...`).
  // Containment uses that module's identity, not a second parser.
  if (!rootAnchorsContainment(normalizePath(canonicalizeHostPath(trimmed)))) {
    return { root: null, problem: `artifactRoot ${trimmed} is not an absolute directory path` };
  }
  return { root: trimmed, problem: null };
}

/**
 * Parse strictly, and say precisely what was wrong.
 *
 * Returning a list rather than the first failure matters for the retry policy: one malformed field
 * is worth a second attempt with a corrected instruction, whereas a reply that is wrong in six ways
 * is a run that should be blocked rather than nudged.
 */
export function parseHandoff(raw: string | unknown, options: HandoffParseOptionsV1 = {}): HandoffParseV1 {
  const problems: string[] = [];
  let value: Record<string, unknown>;

  if (typeof raw === "string") {
    const limit = typeof options.maxBytes === "number" && Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes
      : HANDOFF_MAX_BYTES;
    // Measured before trimming, fence-matching or parsing: the whole point of the bound is that an
    // oversized reply never reaches the regex scan or JSON.parse in the first place.
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > limit) {
      return {
        ok: false,
        handoff: null,
        problems: [`handoff text is ${bytes} bytes, over the ${limit}-byte limit`],
      };
    }

    const text = raw.trim();
    // Small models wrap JSON in prose or fences; that is a formatting quirk, not a failed run.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1]! : text;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, handoff: null, problems: ["no JSON object found"] };
    let decoded: unknown;
    try {
      decoded = JSON.parse(body.slice(start, end + 1)) as unknown;
    } catch (error) {
      return { ok: false, handoff: null, problems: [`unparseable JSON: ${(error as Error).message}`] };
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { ok: false, handoff: null, problems: ["handoff JSON is not an object"] };
    }
    value = decoded as Record<string, unknown>;
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    value = raw as Record<string, unknown>;
  } else {
    return { ok: false, handoff: null, problems: ["handoff is neither text nor a JSON object"] };
  }

  const requireString = (key: string): string => {
    const found = value[key];
    if (found === undefined || found === null) {
      problems.push(`${key} is missing`);
      return "";
    }
    if (typeof found !== "string") {
      problems.push(`${key} must be a string, not ${typeof found}`);
      return "";
    }
    const trimmed = found.trim();
    if (trimmed === "") problems.push(`${key} must not be empty`);
    return trimmed;
  };

  const requireTimestamp = (key: string): IsoTimestamp => {
    const found = requireString(key);
    // An unparseable instant makes run duration and ordering unknowable, and both are used to
    // decide whether a run hung or a lease went stale.
    if (found !== "" && !Number.isFinite(Date.parse(found))) problems.push(`${key} is not an ISO-8601 instant`);
    return found;
  };

  /**
   * Required booleans are safety assertions, and an assertion nobody made is not a "no".
   * Defaulting an absent `productionMutated` to false is how an unreported production write gets
   * recorded as a run that left production alone.
   */
  const requireAssertion = (key: string): boolean => {
    const found = value[key];
    if (typeof found === "boolean") return found;
    problems.push(found === undefined || found === null
      ? `${key} is missing; a safety assertion that was never made cannot be read as false`
      : `${key} must be a boolean, not ${typeof found}`);
    return false;
  };

  // Every other v1 record in this package discriminates on `schema`; this one shipped as
  // `schemaVersion`. Both are read so an executor prompted with either spelling still parses, but
  // disagreeing values are refused: a record carrying two schema ids has no single known meaning.
  const declaredSchema = value.schema;
  const declaredSchemaVersion = value.schemaVersion;
  if (
    declaredSchema !== undefined && declaredSchema !== null
    && declaredSchemaVersion !== undefined && declaredSchemaVersion !== null
    && declaredSchema !== declaredSchemaVersion
  ) {
    problems.push("schema and schemaVersion disagree");
  }
  const declared = declaredSchema ?? declaredSchemaVersion;
  if (declared === undefined || declared === null) {
    problems.push(`schema is missing; expected ${HANDOFF_SCHEMA_V1}`);
  } else if (declared !== HANDOFF_SCHEMA_V1) {
    problems.push(`schema must be ${HANDOFF_SCHEMA_V1}`);
  }

  const executor = requireString("executor");
  const missionId = requireString("missionId");
  const runId = requireString("runId");
  const branch = requireString("branch");

  // A handoff is bound to the run it claims to be for. A report from a different run would
  // otherwise have its SHAs checked against a repository state it was never produced from.
  if (options.expectedMissionId !== undefined && missionId !== "" && missionId !== options.expectedMissionId) {
    problems.push(`missionId ${missionId} is not the expected ${options.expectedMissionId}`);
  }
  if (options.expectedRunId !== undefined && runId !== "" && runId !== options.expectedRunId) {
    problems.push(`runId ${runId} is not the expected ${options.expectedRunId}`);
  }

  const headBefore = requireString("headBefore");
  const headAfter = requireString("headAfter");
  for (const [label, sha] of [["headBefore", headBefore], ["headAfter", headAfter]] as const) {
    if (sha !== "" && !SHA.test(sha)) problems.push(`${label} is not a full 40-character SHA`);
  }

  const status = requireString("status");
  if (status !== "" && !HANDOFF_STATUSES.includes(status as HandoffStatusV1)) {
    problems.push("status must be PASS, FAIL or BLOCKED");
  }

  // No default. An executor that has run out of quota and omits this would otherwise be recorded as
  // AVAILABLE and handed the next work item, which is how a mission stalls on repeated dispatch.
  const capacity = requireString("capacityStatus");
  if (capacity !== "" && !EXECUTOR_CAPACITIES.includes(capacity as ExecutorCapacityV1)) {
    problems.push("capacityStatus is not a known value");
  }

  const productionMutated = requireAssertion("productionMutated");
  const requiresOwner = requireAssertion("requiresOwner");

  const rawSpend = value.spendUsd;
  let spendUsd = Number.NaN;
  if (rawSpend === undefined || rawSpend === null) {
    problems.push("spendUsd is missing; a zero-spend claim that was never made is not a zero-spend claim");
  } else if (typeof rawSpend !== "number" || !Number.isFinite(rawSpend)) {
    // NaN and Infinity survive every later comparison silently: `NaN > 0` is false, so an
    // unmeasured spend would read as being inside the zero-spend envelope.
    problems.push("spendUsd must be a finite number");
  } else if (rawSpend < 0) {
    // A negative spend is not a refund the Director knows how to reason about; it is a number that
    // makes any total containing it smaller than the truth.
    problems.push("spendUsd must not be negative");
  } else {
    spendUsd = rawSpend;
  }

  const tests: HandoffTestsV1[] = [];
  const rawTests = value.tests;
  if (rawTests !== undefined && rawTests !== null) {
    if (!Array.isArray(rawTests)) {
      problems.push("tests must be an array");
    } else {
      rawTests.forEach((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          problems.push(`tests[${index}] is not an object`);
          return;
        }
        const record = entry as Record<string, unknown>;
        const suite = typeof record.suite === "string" && record.suite.trim() !== "" ? record.suite.trim() : "";
        if (suite === "") problems.push(`tests[${index}].suite is missing`);
        const counts: Record<string, number> = {};
        for (const field of ["total", "passed", "failed", "skipped"] as const) {
          const count = record[field];
          // Coercing garbage with Number() produced NaN counts that compared false against every
          // threshold, so a suite with unreadable results looked like a suite with no failures.
          if (typeof count !== "number" || !Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
            problems.push(`tests[${index}].${field} must be a non-negative integer`);
            counts[field] = 0;
            continue;
          }
          counts[field] = count;
        }
        tests.push({
          suite: suite === "" ? "unnamed" : suite,
          total: counts.total!,
          passed: counts.passed!,
          failed: counts.failed!,
          skipped: counts.skipped!,
        });
      });
    }
  }

  // Decided before the list is walked so an unusable root is reported once, as itself, rather than
  // as N copies of "resolves outside the permitted artifact root" that blame the executor's paths
  // for the caller's option.
  const rootDecision = decideArtifactRoot(options.artifactRoot);
  if (rootDecision.problem !== null) problems.push(rootDecision.problem);
  const artifactRoot = rootDecision.root;
  const artifacts: string[] = [];
  const rawArtifacts = value.artifacts;
  if (rawArtifacts !== undefined && rawArtifacts !== null) {
    if (!Array.isArray(rawArtifacts)) {
      problems.push("artifacts must be an array of paths");
    } else if (rawArtifacts.length > HANDOFF_MAX_ARTIFACTS) {
      problems.push(`artifacts lists ${rawArtifacts.length} paths, over the ${HANDOFF_MAX_ARTIFACTS} limit`);
    } else {
      rawArtifacts.forEach((entry, index) => {
        if (typeof entry !== "string" || entry.trim() === "") {
          problems.push(`artifacts[${index}] is not a path`);
          return;
        }
        const candidate = entry.trim();
        if (candidate.length > HANDOFF_MAX_ARTIFACT_PATH_LENGTH) {
          problems.push(`artifacts[${index}] is longer than ${HANDOFF_MAX_ARTIFACT_PATH_LENGTH} characters`);
          return;
        }
        // Every control byte, not only NUL. NUL is the one that truncates the name Win32 opens, but
        // a CR or an ESC in a path reaches a log line, a terminal and a JSON record, and a name that
        // renders differently everywhere it is displayed is not a name anyone can verify.
        if (CONTROL_BYTES_IN_PATH.test(candidate)) {
          problems.push(`artifacts[${index}] contains a control byte`);
          return;
        }
        // Checked before containment, because containment cannot see it: "logs/CON" is textually
        // inside the run root and passes every test above, but Win32 resolves a reserved device name
        // in any directory to the device itself, so what is opened is the console, the null sink or a
        // serial port rather than a file in the run. That is the header's promise — a report cannot
        // nominate something outside the run it belongs to — failing on a path with no ".." in it.
        // An NTFS alternate data stream rides on a name that otherwise looks ordinary:
        // `x.txt::$DATA` is the file's own default stream and `x.txt:hidden` is a second payload the
        // same directory listing never shows. Neither is the artifact the report claims to be naming,
        // and a collector that copies one produces something other than what was reviewed. The drive
        // colon is the only legitimate colon in a path, and it is the first segment or nothing.
        if (namesAlternateDataStream(candidate)) {
          problems.push(`artifacts[${index}] names an alternate data stream rather than a file`);
          return;
        }
        if (namesReservedDevice(candidate)) {
          problems.push(`artifacts[${index}] names a reserved Windows device rather than a file`);
          return;
        }
        if (artifactRoot === null) {
          // No root means nothing to resolve against, so only a path that is already relative and
          // traversal-free survives. An absolute path is refused rather than waved through: a caller
          // that forgot to pass a root is not thereby opting into "/etc/shadow" or "../../.ssh/id_rsa",
          // and the path will be joined to a run directory by whatever opens it later.
          if (namesAbsoluteLocation(candidate)) {
            problems.push(`artifacts[${index}] is an absolute path and no artifact root was established`);
          } else if (hasTraversalSegment(candidate)) {
            problems.push(`artifacts[${index}] contains a .. segment`);
          } else if (normalizePath(candidate).segments.length === 0) {
            // "." and "./" resolve to the artifact directory itself, which is a directory rather
            // than a file in it, and would be copied or served whole by anything that trusted it.
            problems.push(`artifacts[${index}] names a directory rather than a file`);
          } else {
            artifacts.push(candidate);
          }
          return;
        }
        if (!artifactPathWithinRoot(artifactRoot, candidate)) {
          problems.push(`artifacts[${index}] resolves outside the permitted artifact root`);
          return;
        }
        artifacts.push(candidate);
      });
    }
  }

  const startedAt = requireTimestamp("startedAt");
  const finishedAt = requireTimestamp("finishedAt");

  const rawNonce = value.runNonce;
  // Same token leaf as `normaliseRunNonce` (it is `asUsableToken`).
  const runNonce = asUsableToken(rawNonce);
  if (rawNonce === undefined || rawNonce === null) {
    problems.push("runNonce is missing; a report that cannot prove it is this invocation's is not this invocation's");
  } else if (runNonce === null) {
    problems.push("runNonce is empty or contains control bytes");
  }

  const nextRecommendedGate = typeof value.nextRecommendedGate === "string" && value.nextRecommendedGate.trim() !== ""
    ? value.nextRecommendedGate.trim()
    : null;
  const summary = typeof value.summary === "string" ? value.summary.slice(0, HANDOFF_MAX_SUMMARY_LENGTH) : "";

  if (problems.length > 0) return { ok: false, handoff: null, problems };

  return {
    ok: true,
    problems: [],
    handoff: {
      schema: HANDOFF_SCHEMA_V1,
      schemaVersion: HANDOFF_SCHEMA_V1,
      executor,
      missionId,
      runId,
      branch,
      headBefore,
      headAfter,
      status: status as HandoffStatusV1,
      tests,
      productionMutated,
      spendUsd,
      requiresOwner,
      nextRecommendedGate,
      artifacts,
      startedAt,
      finishedAt,
      capacityStatus: capacity as ExecutorCapacityV1,
      runNonce: runNonce as string,
      summary,
    },
  };
}

export interface HandoffContradictionV1 {
  field: string;
  claimed: string;
  observed: string;
  detail: string;
}

/**
 * Compare what the executor said against what was actually observed.
 *
 * Only the fields where a wrong answer has real consequences. A mismatched test count is worth
 * knowing; a claim of no production mutation while production moved is worth stopping for, and a
 * claim of spend above zero contradicts the envelope the run was launched under.
 *
 * A few checks need no observation at all, because the report disagrees with itself. Those are kept
 * here rather than in the parser: the record is well-formed and worth storing, it just cannot be
 * acted on.
 */
export function findHandoffContradictions(input: {
  handoff: ExecutorHandoffV1;
  observedHeadAfter?: string | null;
  observedBranch?: string | null;
  /** Authorisation flag, not a production-filesystem observation. */
  authorisedProductionMutated?: boolean | null | undefined;
  /**
   * @deprecated Use {@link authorisedProductionMutated}. Kept so callers
   * written against the earlier spelling keep compiling.
   */
  authorisedProductionMutation?: boolean | null | undefined;
}): HandoffContradictionV1[] {
  const found: HandoffContradictionV1[] = [];

  if (input.observedHeadAfter && input.handoff.headAfter !== input.observedHeadAfter) {
    found.push({
      field: "headAfter",
      claimed: input.handoff.headAfter,
      observed: input.observedHeadAfter,
      detail: "the repository does not show the SHA the executor reported producing",
    });
  }

  if (input.observedBranch && input.handoff.branch !== input.observedBranch) {
    found.push({
      field: "branch",
      claimed: input.handoff.branch,
      observed: input.observedBranch,
      detail: "the run happened on a different branch than it reported",
    });
  }

  const authorised = input.authorisedProductionMutated !== undefined
    ? input.authorisedProductionMutated
    : input.authorisedProductionMutation;
  const productionDisagrees = input.handoff.productionMutated === true
    ? authorised !== true
    : authorised === true;
  if (productionDisagrees) {
    found.push({
      field: "productionMutated",
      claimed: String(input.handoff.productionMutated),
      observed: String(authorised),
      detail: authorised === true
        ? "the handoff claims production was left alone; mutation was authorised and the claims disagree"
        : "handoff claims production was mutated; that was not authorised",
    });
  }

  if (input.handoff.spendUsd > 0) {
    found.push({
      field: "spendUsd",
      claimed: String(input.handoff.spendUsd),
      observed: "0 permitted",
      detail: "the run was launched under a zero-spend envelope, so any spend is a contradiction",
    });
  }

  const failedSuites = input.handoff.tests.filter((suite) => suite.failed > 0);
  if (input.handoff.status === "PASS" && failedSuites.length > 0) {
    found.push({
      field: "status",
      claimed: "PASS",
      observed: failedSuites.map((suite) => `${suite.suite}: ${suite.failed} failed`).join(", "),
      detail: "the report claims a passing run while its own test counts record failures",
    });
  }

  const started = Date.parse(input.handoff.startedAt);
  const finished = Date.parse(input.handoff.finishedAt);
  if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) {
    found.push({
      field: "finishedAt",
      claimed: input.handoff.finishedAt,
      observed: `started ${input.handoff.startedAt}`,
      detail: "the run reports finishing before it began, so its timings cannot be used for staleness",
    });
  }

  return found;
}
