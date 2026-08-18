/**
 * Safe defaults per source type, so enrolling a resume is one path and one label, not a schema quiz.
 *
 * The Owner should have to answer two questions — *where is it* and *what is it* — and get a
 * correct, conservative registry row. Every other field on `ContextSourceV1` exists because the
 * engine needs it, not because a person should be choosing it under time pressure. Making someone
 * pick `maxDepth` is how they end up picking `999`.
 *
 * ## Least disclosure is the default, deliberately
 *
 * Every career and personal source defaults to `eligibleProviders: ["local"]`. That is stricter than
 * Provider Bridge V1 would allow — Claude is eligible for `CONFIDENTIAL` — and it is the right
 * starting point, because the cost of the two mistakes is not symmetric. A default that is too tight
 * produces a job that says "I could not see your work history"; a default that is too loose has
 * already sent it. Widening is one explicit flag on one source; un-sending is not a thing.
 *
 * These defaults are shown to the Owner before the row is written, so "conservative" never means
 * "surprising".
 */

import type { ProviderIdV1, SensitivityClassV1 } from "@aion/director";

import type { SourceTypeV1, SyncModeV1 } from "./contracts.js";

export interface SourceDefaultsV1 {
  readonly sensitivityClass: SensitivityClassV1;
  readonly eligibleProviders: readonly ProviderIdV1[];
  readonly syncMode: SyncModeV1;
  readonly recursiveAllowed: boolean;
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly deniedScope: readonly string[];
  readonly priority: number;
  /** One line the CLI prints, so the Owner sees the shape of what they are approving. */
  readonly rationale: string;
}

/**
 * Directories that are never career context and are always large.
 *
 * Excluded by default on any repository-shaped source: they are build output and dependencies, and
 * walking them burns the file ceiling on content that could not produce a fact anyway.
 */
const REPOSITORY_NOISE: readonly string[] = [
  "node_modules",
  "dist",
  "dist-test",
  "build",
  "out",
  "coverage",
  ".venv",
  "vendor",
];

const DEFAULTS: Readonly<Record<SourceTypeV1, SourceDefaultsV1>> = {
  RESUME_CV: {
    sensitivityClass: "CONFIDENTIAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: false,
    maxDepth: 1,
    maxFiles: 25,
    maxBytes: 4 * 1024 * 1024,
    deniedScope: [],
    priority: 300,
    rationale: "A resume is personal career material: confidential, local-only, one folder deep, no recursion.",
  },
  WORK_HISTORY: {
    sensitivityClass: "CONFIDENTIAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: false,
    maxDepth: 1,
    maxFiles: 25,
    maxBytes: 4 * 1024 * 1024,
    deniedScope: [],
    priority: 350,
    rationale: "Structured work history is personal career material: confidential, local-only, no recursion.",
  },
  OWNER_ENTERED_CURRENT_JOB: {
    sensitivityClass: "CONFIDENTIAL",
    eligibleProviders: ["local"],
    syncMode: "MANUAL",
    recursiveAllowed: false,
    maxDepth: 1,
    maxFiles: 1,
    maxBytes: 256 * 1024,
    deniedScope: [],
    // The highest priority of any source: the Owner saying it outranks a document implying it.
    priority: 900,
    rationale: "What the Owner states about their current job directly. Highest priority, confidential, local-only.",
  },
  APPROVED_GIT_REPOSITORY: {
    sensitivityClass: "INTERNAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: true,
    maxDepth: 4,
    maxFiles: 400,
    maxBytes: 8 * 1024 * 1024,
    // `.git` is excluded from the content walk; repository identity is read separately and
    // deliberately, rather than by treating object files as career evidence.
    deniedScope: [".git", ...REPOSITORY_NOISE],
    priority: 200,
    rationale: "A named repository: internal, local-only, bounded depth, build output and .git excluded from the walk.",
  },
  APPROVED_PROJECT_ARTIFACT: {
    sensitivityClass: "INTERNAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: true,
    maxDepth: 3,
    maxFiles: 200,
    maxBytes: 8 * 1024 * 1024,
    deniedScope: [...REPOSITORY_NOISE],
    priority: 200,
    rationale: "Project or work artifacts: internal, local-only, bounded depth.",
  },
  APPROVED_LOCAL_FOLDER: {
    sensitivityClass: "CONFIDENTIAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: true,
    maxDepth: 3,
    maxFiles: 200,
    maxBytes: 8 * 1024 * 1024,
    deniedScope: [...REPOSITORY_NOISE],
    priority: 250,
    rationale: "An approved personal folder: confidential by default because its contents are unknown in advance.",
  },
  APPROVED_LOCAL_FILE: {
    sensitivityClass: "CONFIDENTIAL",
    eligibleProviders: ["local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: false,
    maxDepth: 1,
    maxFiles: 1,
    maxBytes: 4 * 1024 * 1024,
    deniedScope: [],
    priority: 250,
    rationale: "A single approved file: confidential by default, no recursion, nothing else read.",
  },
  AION_REPOSITORY: {
    sensitivityClass: "INTERNAL",
    eligibleProviders: ["codex", "grok", "claude", "local"],
    syncMode: "ON_DEMAND",
    recursiveAllowed: true,
    maxDepth: 4,
    maxFiles: 400,
    maxBytes: 8 * 1024 * 1024,
    deniedScope: [".git", ...REPOSITORY_NOISE],
    priority: 100,
    rationale: "AION's own project context: internal, and readable by every provider that already works on it.",
  },
};

export function defaultsForSourceType(sourceType: SourceTypeV1): SourceDefaultsV1 {
  return DEFAULTS[sourceType];
}

/** The source types whose defaults carry real personal material, for the CLI to warn about. */
export function isPersonalSourceType(sourceType: SourceTypeV1): boolean {
  return defaultsForSourceType(sourceType).sensitivityClass === "CONFIDENTIAL";
}
