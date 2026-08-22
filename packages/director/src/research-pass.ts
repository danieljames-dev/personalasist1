/**
 * The research pass: what the Director does before it ranks anything.
 *
 * The autonomy kernel dispatches steps **synchronously** — `dispatch` returns a `StepAttemptV1`, not
 * a promise — and that is a deliberate property, not an oversight. A synchronous kernel is one whose
 * step ordering, lease handling and restart behaviour can be reasoned about without interleaving, and
 * every guarantee the Autonomy Kernel milestones established rests on it. Network retrieval cannot
 * happen inside it.
 *
 * So research is a **pass that runs before the kernel**, not a step inside it. The shape is:
 *
 *     research (async, bounded, writes to the research store)
 *       -> startAutonomy (sync kernel: ranks against what the store now holds)
 *
 * The Owner is not prompted between those, which is what "several bounded steps without a fresh Owner
 * prompt" actually requires. And separating retrieval from ranking buys something beyond expedience:
 * a restart ranks against everything gathered so far without fetching anything again, and the ranking
 * step stays deterministic and replayable.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import { assessRevenueReadiness } from "./business-readiness.js";
import { createFileBusinessEvidenceStore } from "./business-evidence-store.js";
import { createFileAutonomyStore } from "./autonomy-store.js";
import { currentGeography, hasCandidateModels } from "./revenue-discovery.js";
import { revenueResearchTasks } from "./revenue-research.js";
import { createFileResearchStoreV1 } from "./research-store.js";
import { RESEARCH_SEED_SOURCES_V1 } from "./research-seeds.js";
import { runResearchMissionV1, type ResearchMissionReportV1 } from "./research-mission.js";
import type { GovernedResearchPortV1 } from "./public-research-port.js";
import type { RuntimeDepsV1 } from "./autonomy-runtime.js";

/**
 * Whether a research pass actually reached the network for this workspace.
 *
 * Not "did a mission run". A pass whose every call was refused by the effect gate still writes its
 * report, and reading that file as proof the market was asked is the asked-versus-unable substitution
 * for exactly the case that matters most: a wired but unauthorized envelope, or one revoked
 * mid-pass. Those must report a capability blocker, not "the market has no data".
 *
 * So the report is read rather than merely counted. A mission that was refused by the gate and
 * retrieved nothing did not ask; anything else did, whatever it came back with.
 */
export function researchWasAttemptedV1(artifactRoot: string, workspaceId: string): boolean {
  const path = join(artifactRoot, `${workspaceId}-research.json`);
  if (!existsSync(path)) return false;
  let report: Partial<ResearchMissionReportV1>;
  try {
    report = JSON.parse(readFileSync(path, "utf8")) as Partial<ResearchMissionReportV1>;
  } catch {
    /* An unreadable report is not evidence that anything was asked. */
    return false;
  }

  /*
   * Something has to have actually left the machine.
   *
   * The first version asked whether a report existed; the second added "and it is not the
   * gate-refused shape". Both were the same rule with a special case bolted on, and a mission that
   * stopped on its time budget before making a single call — `queriesRun: 0`, `fetchesRun: 0`, no
   * refusals at all — still counted as having asked the market.
   *
   * The counters are the honest test, because both are incremented before the call rather than after
   * it succeeds. Zero of each means nothing was attempted, whatever else the report says.
   */
  const attempts = (report.queriesRun ?? 0) + (report.fetchesRun ?? 0);
  if (attempts === 0) return false;

  /*
   * And an attempt that never got past a boundary is not an ask either.
   *
   * Both refusal vocabularies count: `research effect refused` comes from the pre-action gate and
   * `outward effect refused` from the activation boundary, and a pass stopped by one of them reached
   * exactly as far as a pass stopped by the other.
   */
  const boundaryRefusals = (report.refusals ?? []).filter((refusal) =>
    /research effect refused|outward effect refused/u.test(refusal)).length;
  const everyAttemptRefused = boundaryRefusals >= attempts;
  const retrievedNothing = (report.recordIds?.length ?? 0) === 0;
  if (everyAttemptRefused && retrievedNothing) return false;

  return true;
}

export interface ResearchPassReportV1 {
  readonly ran: boolean;
  readonly reason: string;
  readonly missions: readonly { businessId: string; report: ResearchMissionReportV1 }[];
  /**
   * Refusals that came from the effect gate rather than from the network.
   *
   * Worth separating because they mean opposite things. A provider that timed out is a bad afternoon;
   * the gate refusing means AION tried to do something it is not authorized to do, and that is a
   * governance event which should never be buried in a list of transport errors.
   */
  readonly authorityRefusals: readonly string[];
}

/**
 * Run one bounded research mission per business that is ready for revenue work.
 *
 * Returns rather than throws when there is nothing to do, because "no port was wired" and "no
 * business is ready" are both ordinary states of the world, and a pass that threw on them would make
 * the unauthorized case indistinguishable from a fault.
 */
export async function runResearchPassV1(
  deps: RuntimeDepsV1,
  port: GovernedResearchPortV1 | null | undefined,
): Promise<ResearchPassReportV1> {
  if (port == null) {
    return {
      ran: false,
      reason: "no research port is wired into this runtime, so nothing was retrieved",
      missions: [],
      authorityRefusals: [],
    };
  }

  const store = createFileAutonomyStore(deps.storeRoot);
  const evidenceStore = createFileBusinessEvidenceStore(join(deps.storeRoot, "business-evidence"));
  const researchStore = createFileResearchStoreV1(join(deps.storeRoot, "research"));
  const missions: { businessId: string; report: ResearchMissionReportV1 }[] = [];
  const authorityRefusals: string[] = [];

  for (const business of store.businesses()) {
    const readiness = assessRevenueReadiness(
      business.businessId,
      evidenceStore.evidence(business.businessId),
      evidenceStore.questions(business.businessId),
    );
    /*
     * Same gate as the revenue step, for the same reason.
     *
     * Researching a business AION has no revenue models for would spend the fetch budget on questions
     * nobody can use the answers to, and `revenueResearchTasks` returns nothing for such a workspace
     * anyway — so this is the difference between an empty mission and no mission.
     */
    if (readiness.readiness !== "READY_FOR_REVENUE_DISCOVERY") continue;
    if (!hasCandidateModels(business.businessId)) continue;

    const geography = currentGeography(evidenceStore.evidence(business.businessId));
    const tasks = revenueResearchTasks(business.businessId, deps.now())
      .filter((task) => task.requiresPublicWeb);
    if (tasks.length === 0) continue;

    const started = Date.now();
    const report = await runResearchMissionV1({
      workspaceId: business.businessId,
      geography,
      questions: tasks.map((task) => ({
        researchTaskId: task.taskId,
        question: task.question,
        query: task.question,
        seeds: RESEARCH_SEED_SOURCES_V1[task.evidenceKind] ?? [],
      })),
      port,
      store: researchStore,
      now: deps.now,
      elapsedMs: () => Date.now() - started,
    });
    writeAtomic(
      join(deps.artifactRoot, `${business.businessId}-research.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    missions.push({ businessId: business.businessId, report });
    /* Already classified at the point the error existed; re-deriving it from text never worked. */
    authorityRefusals.push(...report.gateRefusals);
  }

  return {
    ran: missions.length > 0,
    reason: missions.length > 0
      ? `${missions.length} bounded research mission(s) ran`
      : "no business is both ready for revenue work and has models to research for",
    missions,
    authorityRefusals,
  };
}
