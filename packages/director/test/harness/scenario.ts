/**
 * Scenarios, perturbations, and a checker that decides from what happened rather than what was said.
 *
 * The premise of this harness is uncomfortable and worth stating plainly: on the last two milestones
 * every suite was green while a real authority-substitution defect and a real ungated OAuth call were
 * live. Both were found by someone going and looking, not by the tests. The tests were green because
 * they asked the system what it had done and believed the answer.
 *
 * So the unit here is not a test. It is:
 *
 *     a scenario   — a valid dispatch, plus one stated difference from valid
 *     an invariant — something that must hold about the *observed* effects
 *     a checker    — which reads the observation and never the return value
 *
 * A scenario is expected to be *deterministic*: the same scenario and perturbation produce the same
 * observation, so a discovery can be replayed exactly rather than described approximately.
 */

import { createRealBoundedExecutorAdapter, memoryEffectJournal } from "../../src/mva-dispatch.js";
import type { JobEnvelopeV1 } from "../../src/provider-bridge.js";
import type { EffectGateDepsV1 } from "../../src/pre-action-effect-contract.js";
import type { OwnerRoadmapAuthorityEnvelopeV1 } from "../../src/roadmap-authority-envelope.js";
import {
  HARNESS_ARTIFACT_ROOT_V1,
  HARNESS_SHA_V1,
  harnessFixture,
  harnessObserver,
  type HarnessFixtureInputV1,
  type HarnessFixtureV1,
  type HarnessObservationV1,
} from "./fixture.js";

/* -------------------------------------------------------------------------- */
/* Invariants                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What must be true of the observation, whatever the code returned.
 *
 * `NO_EFFECT` is the important one. "Refused" is a claim; "wrote nothing" is a fact, and the gap
 * between them is exactly where the V0.3 authority-substitution defect lived.
 */
export type HarnessInvariantV1 =
  | { readonly kind: "NO_EFFECT" }
  | { readonly kind: "EFFECT_PERFORMED"; readonly writes: number }
  | { readonly kind: "DECISION_RECORDED" }
  | { readonly kind: "REASON_CODE"; readonly code: string }
  | { readonly kind: "NO_THROW" }
  | { readonly kind: "AUDIT_EXCLUDES"; readonly text: string };

export interface HarnessScenarioV1 {
  readonly id: string;
  /** Why this scenario exists, in terms of the behaviour it would catch. */
  readonly asks: string;
  readonly fixture?: HarnessFixtureInputV1;
  /** Applied to the job envelope after the fixture builds it. This is the stated difference. */
  readonly perturbEnvelope?: (envelope: JobEnvelopeV1) => JobEnvelopeV1;
  /** Applied to the gate. Used for authority state changes between preparation and dispatch. */
  readonly perturbGate?: (gate: EffectGateDepsV1, fixture: HarnessFixtureV1) => EffectGateDepsV1;
  /** Overrides the pinned authorization the control plane supplies. */
  readonly pinnedOverride?: string;
  readonly expect: readonly HarnessInvariantV1[];
}

/* -------------------------------------------------------------------------- */
/* Deterministic perturbations                                                */
/* -------------------------------------------------------------------------- */

/**
 * The named ways a valid dispatch can be made invalid.
 *
 * Named rather than ad hoc so a campaign can enumerate them, and so a discovery names the thing that
 * caused it. Each is a pure function: same input, same output, every run.
 */
export const PERTURBATIONS_V1 = {
  none: (envelope: JobEnvelopeV1) => envelope,
  citeOtherAuthority: (envelope: JobEnvelopeV1) => ({ ...envelope, ownerAuthorizationId: "HARNESS-OTHER-AUTHORITY-V1" }),
  citeUnknownAuthority: (envelope: JobEnvelopeV1) => ({ ...envelope, ownerAuthorizationId: "AUTHORITY-NOBODY-GRANTED" }),
  citeEmptyAuthority: (envelope: JobEnvelopeV1) => ({ ...envelope, ownerAuthorizationId: "" }),
  claimOtherMilestone: (envelope: JobEnvelopeV1) => ({ ...envelope, milestoneId: "SOME-OTHER-MILESTONE" }),
  escalateSensitivity: (envelope: JobEnvelopeV1) => ({ ...envelope, sensitiveDataClass: "RESTRICTED" as const }),
  dropWritePermission: (envelope: JobEnvelopeV1) => ({ ...envelope, writePermission: false }),
  escapeArtifactRoot: (envelope: JobEnvelopeV1) => ({ ...envelope, expectedArtifact: "..\\..\\escaped.md" }),
  emptyIdempotencyKey: (envelope: JobEnvelopeV1) => ({ ...envelope, idempotencyKey: "" }),
  reserializeThroughDisk: (envelope: JobEnvelopeV1) => JSON.parse(JSON.stringify(envelope)) as JobEnvelopeV1,
} as const;

export type PerturbationNameV1 = keyof typeof PERTURBATIONS_V1;

/**
 * Which perturbations the authorisation path is actually supposed to notice.
 *
 * This split exists because the harness found it. The first campaign asserted that *every*
 * perturbation must produce no effect, and `claimOtherMilestone` wrote anyway. That turned out not to
 * be a defect: after V0.4 the effect request takes its parent milestone from the control-plane pin,
 * and the artifact's own MILESTONE line comes from a module constant, so a job rewriting
 * `envelope.milestoneId` changes nothing an authorisation decision reads.
 *
 * The wrong response would have been to "fix" the system until the invariant passed. The right one is
 * to record what is and is not an authority input — and to pin it, so that if `milestoneId` ever
 * becomes one again, the campaign notices.
 */
export const AUTHORITY_RELEVANT_PERTURBATIONS_V1: readonly PerturbationNameV1[] = [
  "citeOtherAuthority",
  "citeUnknownAuthority",
  "citeEmptyAuthority",
  "escalateSensitivity",
  "escapeArtifactRoot",
];

/**
 * Perturbations the authorisation path is expected to ignore, with the reason it may.
 *
 * Listed rather than omitted: "we do not check this" is a claim worth writing down and re-testing,
 * because the next reader's instinct will be that it should be checked.
 */
export const NON_AUTHORITY_PERTURBATIONS_V1: readonly { readonly name: PerturbationNameV1; readonly because: string }[] = [
  {
    name: "claimOtherMilestone",
    because: "the effect request takes its parent milestone from the control-plane pin, and the artifact's MILESTONE line from a module constant, so the envelope's copy reaches no authorisation decision",
  },
  {
    name: "dropWritePermission",
    because: "writePermission was an input to the removed job-derived authority projection; authority now comes from the Owner record, and this field is no longer consulted",
  },
];

/** Authority-state faults, applied to the gate rather than the job. */
export const AUTHORITY_FAULTS_V1 = {
  none: (gate: EffectGateDepsV1) => gate,
  revokedAtDispatch: (gate: EffectGateDepsV1): EffectGateDepsV1 => ({
    ...gate,
    envelopeFor: (id: string) => {
      const found = gate.envelopeFor(id);
      return found === null ? null : ({ ...found, state: "REVOKED" } as OwnerRoadmapAuthorityEnvelopeV1);
    },
  }),
  expiredAtDispatch: (gate: EffectGateDepsV1): EffectGateDepsV1 => ({
    ...gate,
    envelopeFor: (id: string) => {
      const found = gate.envelopeFor(id);
      return found === null ? null : ({ ...found, expiresAtUtc: "2020-01-01T00:00:00Z" } as OwnerRoadmapAuthorityEnvelopeV1);
    },
  }),
  authorityVanishes: (gate: EffectGateDepsV1): EffectGateDepsV1 => ({ ...gate, envelopeFor: () => null }),
  targetUnknown: (gate: EffectGateDepsV1): EffectGateDepsV1 => ({ ...gate, resolveTarget: () => null }),
  narrowedWriteDomain: (gate: EffectGateDepsV1): EffectGateDepsV1 => ({
    ...gate,
    envelopeFor: (id: string) => {
      const found = gate.envelopeFor(id);
      return found === null ? null : ({ ...found, allowedWriteDomains: ["somewhere-else"] } as OwnerRoadmapAuthorityEnvelopeV1);
    },
  }),
} as const;

export type AuthorityFaultNameV1 = keyof typeof AUTHORITY_FAULTS_V1;

/* -------------------------------------------------------------------------- */
/* The runner                                                                 */
/* -------------------------------------------------------------------------- */

export interface HarnessRunV1 {
  readonly scenarioId: string;
  readonly observation: HarnessObservationV1;
}

/**
 * Drive one scenario through the real adapter and the real effect gate.
 *
 * No mocking of the gate, the registry or the projection. The only injected things are the file io
 * and the decision sink, because those are what has to be *observed* — and an adapter that cannot be
 * observed cannot be checked.
 */
export function runScenario(scenario: HarnessScenarioV1): HarnessRunV1 {
  const fixture = harnessFixture(scenario.fixture);
  const observer = harnessObserver();
  const gate = scenario.perturbGate ? scenario.perturbGate(fixture.gate, fixture) : fixture.gate;
  const envelope = scenario.perturbEnvelope ? scenario.perturbEnvelope(fixture.jobEnvelope) : fixture.jobEnvelope;

  const adapter = createRealBoundedExecutorAdapter("local", {
    artifactRoot: HARNESS_ARTIFACT_ROOT_V1,
    writeFile: observer.writeFile,
    readFile: observer.readFile,
    startingSha: HARNESS_SHA_V1,
    effectGate: gate,
    actorId: "aion.harness.discovery",
    authorityEnvelopeId: fixture.authorityEnvelopeId,
    parentMilestoneId: fixture.parentMilestoneId,
    pinnedOwnerAuthorizationId: scenario.pinnedOverride ?? fixture.pinnedOwnerAuthorizationId,
    journal: memoryEffectJournal(),
    recordDecision: observer.recordDecision,
  });

  try {
    const result = adapter.execute(envelope);
    observer.setOutcome(String(result.class), null);
  } catch (error) {
    // A throw is an observation too. Swallowing it would let a crash read as a refusal.
    observer.setOutcome(null, error instanceof Error ? error.message : String(error));
  }

  return { scenarioId: scenario.id, observation: observer.observation() };
}

/* -------------------------------------------------------------------------- */
/* Independent checking                                                       */
/* -------------------------------------------------------------------------- */

export interface HarnessViolationV1 {
  readonly invariant: string;
  readonly detail: string;
}

export interface HarnessCheckV1 {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly violations: readonly HarnessViolationV1[];
  readonly observation: HarnessObservationV1;
}

/**
 * Decide from the observation alone.
 *
 * This function never sees the scenario's intent, the adapter, or the returned status — only what was
 * written, what was recorded, and whether anything threw. That separation is the point: a checker
 * that can consult the thing it is checking is a checker that agrees with it.
 */
export function checkObservation(
  scenarioId: string,
  observation: HarnessObservationV1,
  invariants: readonly HarnessInvariantV1[],
): HarnessCheckV1 {
  const violations: HarnessViolationV1[] = [];

  for (const invariant of invariants) {
    switch (invariant.kind) {
      case "NO_EFFECT":
        if (observation.writes.length !== 0) {
          violations.push({
            invariant: "NO_EFFECT",
            detail: `${observation.writes.length} write(s) occurred: ${observation.writes.map((w) => w.path).join(", ")}`,
          });
        }
        break;
      case "EFFECT_PERFORMED":
        if (observation.writes.length !== invariant.writes) {
          violations.push({
            invariant: "EFFECT_PERFORMED",
            detail: `expected ${invariant.writes} write(s), observed ${observation.writes.length}`,
          });
        }
        break;
      case "DECISION_RECORDED":
        if (observation.decisions.length === 0) {
          violations.push({ invariant: "DECISION_RECORDED", detail: "no decision was recorded; the refusal left no trace" });
        }
        break;
      case "REASON_CODE":
        if (!observation.reasonCodes.includes(invariant.code)) {
          violations.push({
            invariant: "REASON_CODE",
            detail: `expected ${invariant.code}, observed [${observation.reasonCodes.join(", ") || "none"}]`,
          });
        }
        break;
      case "NO_THROW":
        if (observation.threw !== null) {
          violations.push({ invariant: "NO_THROW", detail: `threw: ${observation.threw}` });
        }
        break;
      case "AUDIT_EXCLUDES":
        for (const line of observation.decisions) {
          if (line.includes(invariant.text)) {
            violations.push({ invariant: "AUDIT_EXCLUDES", detail: `audit record contains "${invariant.text}"` });
            break;
          }
        }
        break;
    }
  }

  return { scenarioId, passed: violations.length === 0, violations, observation };
}

/** Run and check in one step. Kept separate above so the checker can be tested on its own. */
export function evaluateScenario(scenario: HarnessScenarioV1): HarnessCheckV1 {
  const run = runScenario(scenario);
  return checkObservation(scenario.id, run.observation, scenario.expect);
}
