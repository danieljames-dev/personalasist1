/**
 * One valid lineage, built once, so scenarios stop re-deriving it and stop drifting apart.
 *
 * Every suite that exercises the effect gate has so far built its own envelope, its own job and its
 * own gate dependencies. Four rounds of repair later there were four slightly different versions of
 * "a valid request", and a scenario that passed in one shape said nothing about the others. This is
 * the single shape, assembled the way the control plane assembles it: Owner records first, projected
 * into effect authority by the trusted projection, then a job that cites the pinned authorization.
 *
 * Nothing here mints authority. `effectAuthoritiesFromOwnerRecords` is the same function the app
 * calls, given the same kind of record, so a scenario that passes here is passing against the real
 * projection rather than against a convenient fake.
 */

import {
  DIRECTOR_CAPABILITY_REGISTRY_V1,
  type EffectGateDepsV1,
} from "../../src/pre-action-effect-contract.js";
import {
  effectAuthoritiesFromOwnerRecords,
  effectAuthorityEnvelopeId,
} from "../../src/job-frozen-authority.js";
import { buildJobEnvelope, type JobRequestV1 } from "../../src/mva-dispatch.js";
import type { JobEnvelopeV1 } from "../../src/provider-bridge.js";
import type { OwnerRoadmapAuthorityEnvelopeV1 } from "../../src/roadmap-authority-envelope.js";

export const HARNESS_NOW_V1 = "2026-08-20T00:00:00Z";
export const HARNESS_SHA_V1 = "cca7b19d1d3e8a6224fbdfe6d887a4443c5d1d5a";
export const HARNESS_ARTIFACT_ROOT_V1 = "C:\\harness\\.aion-local\\mva-dispatch\\artifacts";
export const HARNESS_OWNER_V1 = "owner";

/** The minimal shape of a durable Owner authority record, as the projection reads it. */
export interface HarnessOwnerRecordV1 {
  readonly ownerAuthorizationId: string;
  readonly milestoneId: string;
  readonly allowedWriteDomains: readonly string[];
  readonly allowedProviders: readonly string[];
  readonly state: string;
  readonly createdAtUtc: string;
}

export function ownerRecord(overrides: Partial<HarnessOwnerRecordV1> = {}): HarnessOwnerRecordV1 {
  return {
    ownerAuthorizationId: "HARNESS-AUTHORITY-V1",
    milestoneId: "HARNESS-MILESTONE-V1",
    allowedWriteDomains: [".aion-local"],
    allowedProviders: ["local"],
    state: "ACTIVE",
    createdAtUtc: HARNESS_NOW_V1,
    ...overrides,
  };
}

/**
 * What a write is recorded against.
 *
 * The trusted side answers this, not the request — a scenario that wants to test a data class or a
 * write domain changes the target record, never the request's opinion of it.
 */
export interface HarnessTargetV1 {
  readonly targetType: string;
  readonly targetId: string;
  readonly sensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  readonly writeDomain: string;
}

export interface HarnessFixtureV1 {
  readonly records: readonly HarnessOwnerRecordV1[];
  readonly authorities: ReadonlyMap<string, OwnerRoadmapAuthorityEnvelopeV1>;
  readonly pinnedOwnerAuthorizationId: string;
  readonly authorityEnvelopeId: string;
  readonly parentMilestoneId: string;
  readonly gate: EffectGateDepsV1;
  readonly jobEnvelope: JobEnvelopeV1;
}

export interface HarnessFixtureInputV1 {
  readonly records?: readonly HarnessOwnerRecordV1[];
  /** Which record the control plane pins for this dispatch. Defaults to the first. */
  readonly pinned?: string;
  readonly now?: string;
  /** Trusted target facts. Defaults to an internal artifact under the harness artifact root. */
  readonly resolveTarget?: (targetType: string, targetId: string) => HarnessTargetV1 | null;
  readonly ownerId?: string;
  readonly jobRequest?: Partial<JobRequestV1>;
}

function defaultResolveTarget(targetType: string, targetId: string): HarnessTargetV1 | null {
  if (targetType !== "JobArtifact") return null;
  if (!targetId.startsWith(HARNESS_ARTIFACT_ROOT_V1)) return null;
  return { targetType, targetId, sensitivity: "INTERNAL", writeDomain: ".aion-local" };
}

export function harnessJobRequest(overrides: Partial<JobRequestV1> = {}): JobRequestV1 {
  return {
    jobId: "harness-job",
    objective: "write the bounded artifact",
    jobClass: "REPOSITORY_REVERSIBLE",
    repository: "C:\\harness",
    worktree: "C:\\harness",
    allowedPaths: ["packages/"],
    expectedArtifact: "result.md",
    startingSha: HARNESS_SHA_V1,
    sensitiveDataClass: "INTERNAL",
    ...overrides,
  };
}

/**
 * Assemble a complete, valid dispatch context.
 *
 * The default is deliberately the *passing* case. A scenario states its difference from this, which
 * is what makes a failure readable: the perturbation is the whole diff.
 */
export function harnessFixture(input: HarnessFixtureInputV1 = {}): HarnessFixtureV1 {
  const records = input.records ?? [ownerRecord()];
  const now = input.now ?? HARNESS_NOW_V1;
  const authorities = effectAuthoritiesFromOwnerRecords(records);
  const pinned = input.pinned ?? records[0]?.ownerAuthorizationId ?? "";
  const projected = authorities.get(effectAuthorityEnvelopeId(pinned));
  const resolveTarget = input.resolveTarget ?? defaultResolveTarget;

  const gate: EffectGateDepsV1 = {
    registry: DIRECTOR_CAPABILITY_REGISTRY_V1,
    resolveTarget,
    envelopeFor: (id: string) => authorities.get(id) ?? null,
    ownerId: input.ownerId ?? HARNESS_OWNER_V1,
    now,
  };

  const built = buildJobEnvelope(harnessJobRequest(input.jobRequest), now);
  // The job cites the pinned authorization, which is what the control plane would have given it.
  const jobEnvelope: JobEnvelopeV1 = { ...built, ownerAuthorizationId: pinned };

  return {
    records,
    authorities,
    pinnedOwnerAuthorizationId: pinned,
    authorityEnvelopeId: projected?.envelopeId ?? "",
    parentMilestoneId: projected?.approvedParentMilestoneIds[0] ?? "",
    gate,
    jobEnvelope,
  };
}

/* -------------------------------------------------------------------------- */
/* Observation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What actually happened, recorded as it happens.
 *
 * The reason this exists rather than a returned status: both defects V0.3 and V0.4 repaired were
 * invisible to suites that trusted a returned string. A refusal that returns `POLICY_DENIED` while
 * writing two files is a failure, and only an observation of the writes can say so.
 */
export interface HarnessWriteV1 {
  readonly path: string;
  readonly bytes: number;
}

export interface HarnessObservationV1 {
  readonly writes: readonly HarnessWriteV1[];
  readonly decisions: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly outcomeClass: string | null;
  readonly threw: string | null;
}

export interface HarnessObserverV1 {
  readonly writeFile: (path: string, contents: string) => void;
  readonly readFile: (path: string) => string;
  readonly recordDecision: (line: string) => void;
  readonly observation: () => HarnessObservationV1;
  readonly setOutcome: (outcomeClass: string | null, threw: string | null) => void;
}

export function harnessObserver(): HarnessObserverV1 {
  const writes: HarnessWriteV1[] = [];
  const decisions: string[] = [];
  const files = new Map<string, string>();
  let outcomeClass: string | null = null;
  let threw: string | null = null;

  return {
    writeFile: (path, contents) => {
      writes.push({ path, bytes: contents.length });
      files.set(path, contents);
    },
    readFile: (path) => files.get(path) ?? "",
    recordDecision: (line) => { decisions.push(line); },
    setOutcome: (nextOutcome, nextThrew) => { outcomeClass = nextOutcome; threw = nextThrew; },
    observation: () => ({
      writes: [...writes],
      decisions: [...decisions],
      reasonCodes: decisions.map((line) => {
        try {
          const parsed = JSON.parse(line) as { reasonCode?: unknown };
          return typeof parsed.reasonCode === "string" ? parsed.reasonCode : "";
        } catch {
          return "";
        }
      }).filter((code) => code !== ""),
      outcomeClass,
      threw,
    }),
  };
}
