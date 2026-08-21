/**
 * Where the autonomy kernel's state lives.
 *
 * On disk, because the property being built is that AION survives a restart without redoing work.
 * State that lives only in memory makes every restart a fresh start, and a fresh start is exactly
 * how the same effect happens twice.
 *
 * Same shape and the same atomic write as `roadmap-store.ts`, deliberately: one more store that
 * behaves differently is one more thing to reason about during a recovery.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import {
  AUTONOMY_STEP_SCHEMA_V1,
  STANDING_OBJECTIVE_SCHEMA_V1,
  type AutonomyStepV1,
  type StandingObjectiveV1,
} from "./autonomy-contracts.js";
import { BUSINESS_WORKSPACE_SCHEMA_V1, type BusinessWorkspaceV1 } from "./business-workspace.js";

export class AutonomyIntegrityError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`autonomy store integrity: ${path}: ${detail}`);
    this.name = "AutonomyIntegrityError";
  }
}

/** One completed unit of work, and the evidence it actually happened. */
export const AUTONOMY_OUTCOME_SCHEMA_V1 = "aion.director.autonomyOutcome.v1" as const;

export interface AutonomyOutcomeV1 {
  readonly schema: typeof AUTONOMY_OUTCOME_SCHEMA_V1;
  readonly stepId: string;
  readonly objectiveId: string;
  readonly businessId: string;
  readonly effectFingerprint: string;
  readonly verdict: "COMPLETED" | "FAILED" | "GATED" | "BLOCKED";
  readonly evidence: readonly string[];
  readonly detail: string;
  readonly at: string;
}

/**
 * One row of provider telemetry per step attempt.
 *
 * Enough for a later router to prefer what actually works, and no more. It carries the *ids and
 * classes* — which business, which task type, which provider, what happened — and not the payload.
 * A telemetry table that accumulates content becomes a second copy of everything, in the one place
 * nobody thinks to look when asking where the data went.
 */
export const PROVIDER_TELEMETRY_SCHEMA_V1 = "aion.director.providerTelemetry.v1" as const;

export interface ProviderTelemetryRowV1 {
  readonly schema: typeof PROVIDER_TELEMETRY_SCHEMA_V1;
  readonly stepId: string;
  readonly objectiveId: string;
  readonly businessId: string;
  readonly taskType: string;
  readonly provider: string;
  readonly verifiedSuccess: boolean;
  readonly failureClass: string;
  readonly attempts: number;
  readonly latencyMs: number | null;
  readonly tokens: number | null;
  readonly costUsd: number;
  readonly at: string;
}

export interface AutonomyStoreV1 {
  readonly saveBusiness: (business: BusinessWorkspaceV1) => void;
  readonly businesses: () => readonly BusinessWorkspaceV1[];
  readonly saveObjective: (objective: StandingObjectiveV1) => void;
  readonly objectives: () => readonly StandingObjectiveV1[];
  readonly saveStep: (step: AutonomyStepV1) => void;
  readonly steps: () => readonly AutonomyStepV1[];
  readonly appendOutcome: (outcome: Omit<AutonomyOutcomeV1, "schema">) => AutonomyOutcomeV1;
  readonly outcomes: () => readonly AutonomyOutcomeV1[];
  readonly appendTelemetry: (row: Omit<ProviderTelemetryRowV1, "schema">) => ProviderTelemetryRowV1;
  readonly telemetry: () => readonly ProviderTelemetryRowV1[];
}

/** Ids reach the filesystem, so they may not reach anywhere else. */
function segment(value: string, field: string): string {
  if (!/^[A-Za-z0-9._:-]+$/u.test(value)) throw new Error(`${field} is not a safe path segment: ${value}`);
  return value.split(":").join("__");
}

function readJsonDir<T>(dir: string, schema: string, label: string): T[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new AutonomyIntegrityError(path, `${label} is not valid JSON`);
    }
    if ((parsed as { schema?: string }).schema !== schema) {
      throw new AutonomyIntegrityError(path, `${label} has the wrong schema`);
    }
    return parsed as T;
  });
}

function readJsonl<T>(path: string, schema: string, label: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const rows: T[] = [];
  raw.split(/\r?\n/u).filter((line) => line.trim() !== "").forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AutonomyIntegrityError(path, `${label} ${index + 1} is not valid JSON`);
    }
    if ((parsed as { schema?: string }).schema !== schema) {
      throw new AutonomyIntegrityError(path, `${label} ${index + 1} has the wrong schema`);
    }
    rows.push(parsed as T);
  });
  return rows;
}

export function createFileAutonomyStore(root: string): AutonomyStoreV1 {
  const businessesDir = join(root, "businesses");
  const objectivesDir = join(root, "objectives");
  const stepsDir = join(root, "steps");
  const outcomesPath = join(root, "outcomes.jsonl");
  const telemetryPath = join(root, "telemetry.jsonl");

  /* Append is read-then-rewrite rather than an append handle: the store is small, one process owns
   * it, and a torn append is a corrupt ledger. Same trade the roadmap event ledger makes. */
  function append<T extends { schema: string }>(path: string, row: T, existing: readonly unknown[]): T {
    const lines = [...existing, row].map((entry) => JSON.stringify(entry)).join("\n");
    writeAtomic(path, `${lines}\n`);
    return row;
  }

  return {
    saveBusiness(business) {
      writeAtomic(
        join(businessesDir, `${segment(business.businessId, "businessId")}.json`),
        `${JSON.stringify(business, null, 2)}\n`,
      );
    },
    businesses() {
      return readJsonDir<BusinessWorkspaceV1>(businessesDir, BUSINESS_WORKSPACE_SCHEMA_V1, "business");
    },
    saveObjective(objective) {
      writeAtomic(
        join(objectivesDir, `${segment(objective.objectiveId, "objectiveId")}.json`),
        `${JSON.stringify(objective, null, 2)}\n`,
      );
    },
    objectives() {
      return readJsonDir<StandingObjectiveV1>(objectivesDir, STANDING_OBJECTIVE_SCHEMA_V1, "objective");
    },
    saveStep(step) {
      writeAtomic(
        join(stepsDir, `${segment(step.stepId, "stepId")}.json`),
        `${JSON.stringify(step, null, 2)}\n`,
      );
    },
    steps() {
      return readJsonDir<AutonomyStepV1>(stepsDir, AUTONOMY_STEP_SCHEMA_V1, "step");
    },
    appendOutcome(outcome) {
      const row: AutonomyOutcomeV1 = { schema: AUTONOMY_OUTCOME_SCHEMA_V1, ...outcome };
      return append(outcomesPath, row, this.outcomes());
    },
    outcomes() {
      return readJsonl<AutonomyOutcomeV1>(outcomesPath, AUTONOMY_OUTCOME_SCHEMA_V1, "outcome");
    },
    appendTelemetry(rowInput) {
      const row: ProviderTelemetryRowV1 = { schema: PROVIDER_TELEMETRY_SCHEMA_V1, ...rowInput };
      return append(telemetryPath, row, this.telemetry());
    },
    telemetry() {
      return readJsonl<ProviderTelemetryRowV1>(telemetryPath, PROVIDER_TELEMETRY_SCHEMA_V1, "telemetry row");
    },
  };
}
