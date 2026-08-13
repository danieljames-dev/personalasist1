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
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export const HANDOFF_SCHEMA_V1 = "aion.director.handoff.v1" as const;

export type HandoffStatusV1 = "PASS" | "FAIL" | "BLOCKED";

export type ExecutorCapacityV1 =
  | "AVAILABLE"
  | "CAPACITY_LOW"
  | "CAPACITY_EXHAUSTED"
  | "RESET_AT_KNOWN_TIME"
  | "UNAVAILABLE";

export interface HandoffTestsV1 {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ExecutorHandoffV1 {
  schemaVersion: typeof HANDOFF_SCHEMA_V1;
  executor: string;
  missionId: OpaqueId;
  runId: OpaqueId;
  branch: string;
  headBefore: string;
  headAfter: string;
  status: HandoffStatusV1;
  tests: HandoffTestsV1[];
  /** A claim. Corroborated against process and checkout identity, never believed alone. */
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

const SHA = /^[0-9a-f]{40}$/i;

/**
 * Parse strictly, and say precisely what was wrong.
 *
 * Returning a list rather than the first failure matters for the retry policy: one malformed field
 * is worth a second attempt with a corrected instruction, whereas a reply that is wrong in six ways
 * is a run that should be blocked rather than nudged.
 */
export function parseHandoff(raw: string | unknown): HandoffParseV1 {
  const problems: string[] = [];
  let value: Record<string, unknown>;

  if (typeof raw === "string") {
    const text = raw.trim();
    // Small models wrap JSON in prose or fences; that is a formatting quirk, not a failed run.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1]! : text;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return { ok: false, handoff: null, problems: ["no JSON object found"] };
    try {
      value = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    } catch (error) {
      return { ok: false, handoff: null, problems: [`unparseable JSON: ${(error as Error).message}`] };
    }
  } else if (raw && typeof raw === "object") {
    value = raw as Record<string, unknown>;
  } else {
    return { ok: false, handoff: null, problems: ["handoff is neither text nor an object"] };
  }

  const str = (key: string): string => (typeof value[key] === "string" ? (value[key] as string) : "");
  const need = (key: string): string => {
    const found = str(key);
    if (!found) problems.push(`${key} is missing`);
    return found;
  };

  if (value.schemaVersion !== HANDOFF_SCHEMA_V1) {
    problems.push(`schemaVersion must be ${HANDOFF_SCHEMA_V1}`);
  }

  const headBefore = need("headBefore");
  const headAfter = need("headAfter");
  for (const [label, sha] of [["headBefore", headBefore], ["headAfter", headAfter]] as const) {
    if (sha && !SHA.test(sha)) problems.push(`${label} is not a full 40-character SHA`);
  }

  const status = str("status");
  if (!["PASS", "FAIL", "BLOCKED"].includes(status)) problems.push("status must be PASS, FAIL or BLOCKED");

  const capacity = str("capacityStatus") || "AVAILABLE";
  const capacities: ExecutorCapacityV1[] = [
    "AVAILABLE", "CAPACITY_LOW", "CAPACITY_EXHAUSTED", "RESET_AT_KNOWN_TIME", "UNAVAILABLE",
  ];
  if (!capacities.includes(capacity as ExecutorCapacityV1)) problems.push("capacityStatus is not a known value");

  const spend = typeof value.spendUsd === "number" ? value.spendUsd : Number.NaN;
  if (!Number.isFinite(spend)) problems.push("spendUsd must be a number");

  const tests: HandoffTestsV1[] = Array.isArray(value.tests)
    ? (value.tests as Record<string, unknown>[]).map((t) => ({
      suite: String(t.suite ?? "unnamed"),
      total: Number(t.total ?? 0),
      passed: Number(t.passed ?? 0),
      failed: Number(t.failed ?? 0),
      skipped: Number(t.skipped ?? 0),
    }))
    : [];

  need("executor");
  need("missionId");
  need("runId");
  need("branch");

  if (problems.length > 0) return { ok: false, handoff: null, problems };

  return {
    ok: true,
    problems: [],
    handoff: {
      schemaVersion: HANDOFF_SCHEMA_V1,
      executor: str("executor"),
      missionId: str("missionId"),
      runId: str("runId"),
      branch: str("branch"),
      headBefore,
      headAfter,
      status: status as HandoffStatusV1,
      tests,
      productionMutated: value.productionMutated === true,
      spendUsd: spend,
      requiresOwner: value.requiresOwner === true,
      nextRecommendedGate: typeof value.nextRecommendedGate === "string" ? value.nextRecommendedGate : null,
      artifacts: Array.isArray(value.artifacts) ? (value.artifacts as unknown[]).map(String) : [],
      startedAt: str("startedAt"),
      finishedAt: str("finishedAt"),
      capacityStatus: capacity as ExecutorCapacityV1,
      summary: str("summary").slice(0, 4_000),
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

  return found;
}

/** True when the handoff and the observations agree well enough to act on. */
export function handoffIsTrustworthy(contradictions: readonly HandoffContradictionV1[]): boolean {
  return contradictions.length === 0;
}
