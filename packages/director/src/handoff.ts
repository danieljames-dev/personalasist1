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
 * report cannot nominate a file outside the run it belongs to.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

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
  /** Absolute directory every artifact path must resolve inside. */
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

  const driveMatch = /^([A-Za-z]):(\/?)/.exec(rest);
  if (driveMatch) {
    drive = driveMatch[1]!.toLowerCase();
    absolute = driveMatch[2] === "/";
    rest = rest.slice(driveMatch[0].length);
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

  return { drive, absolute, segments, escaped };
}

/**
 * True when `candidate` names something strictly inside `root`.
 *
 * Segments compare case-insensitively because the target filesystem is Windows, where
 * `C:\AION\runs` and `c:\aion\RUNS` are one directory and rejecting the second would fail honest
 * handoffs without preventing any traversal.
 */
export function artifactPathWithinRoot(root: string, candidate: string): boolean {
  if (root.trim() === "" || candidate.trim() === "") return false;
  // A NUL truncates the name the operating system actually opens, so the path that was validated
  // and the path that is opened are different paths.
  if (root.includes("\0") || candidate.includes("\0")) return false;

  const rootPath = normalizePath(root);
  // A relative root cannot decide containment: it means something different from every directory.
  if (!rootPath.absolute || rootPath.escaped || rootPath.segments.length === 0) return false;

  const candidatePath = normalizePath(candidate);
  if (candidatePath.escaped) return false;

  let resolved: string[];
  if (candidatePath.absolute) {
    if (candidatePath.drive !== rootPath.drive) return false;
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

/** A ".." segment is never a legitimate way to name a run artifact, root known or not. */
function hasTraversalSegment(candidate: string): boolean {
  return candidate.split(/[\\/]+/).includes("..");
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

  const artifactRoot = typeof options.artifactRoot === "string" && options.artifactRoot.trim() !== ""
    ? options.artifactRoot
    : null;
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
        if (candidate.includes("\0")) {
          problems.push(`artifacts[${index}] contains a NUL byte`);
          return;
        }
        if (artifactRoot === null) {
          // Containment cannot be decided without a root, but traversal can still be refused, so a
          // caller that forgot to pass one is not thereby opting into "../../.ssh/id_rsa".
          if (hasTraversalSegment(candidate)) problems.push(`artifacts[${index}] contains a .. segment`);
          else artifacts.push(candidate);
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
  productionActuallyMutated?: boolean | null;
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

  if (input.productionActuallyMutated === true && input.handoff.productionMutated === false) {
    found.push({
      field: "productionMutated",
      claimed: "false",
      observed: "true",
      detail: "production changed during a run that reported leaving it alone",
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

/** True when the handoff and the observations agree well enough to act on. */
export function handoffIsTrustworthy(contradictions: readonly HandoffContradictionV1[]): boolean {
  return contradictions.length === 0;
}
