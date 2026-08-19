/**
 * The seam between "the Owner typed a sentence" and "AION has governed work".
 *
 * This module classifies, records and hands off. It does not edit files, choose a provider, approve a
 * gate, mutate authority, or reach past `RoadmapPortV1` — a chat box that could do any of those would
 * be a command shell with a friendly prompt, and every guarantee in the roadmap would be one typo
 * away from being bypassed.
 *
 * ## What it may do
 *
 * Persist an `OwnerGoalIntentV1`, and add at most one `PLANNED` milestone through the port. Adding a
 * milestone grants nothing: whether it can run is still decided by `resolveMilestoneAuthority` at
 * selection time, against Owner-written records this process cannot write.
 *
 * ## Idempotency
 *
 * A goal's id is a hash of its normalized text, and the milestone id is derived from the goal id. The
 * same sentence typed twice therefore lands on the same record and the same milestone — across a
 * second browser tab, a page refresh and a server restart alike, with no deduplication pass to skip.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  OWNER_GOAL_STORE_RELATIVE_PATH,
  PLANNABLE_CLASSES_V1,
  buildOwnerGoalIntent,
  deriveEnvelopeFromOwnerAuthority,
  planFromGoal,
} from "../../packages/director/dist/index.js";

/** Verification steps a goal-created milestone declares. Only steps the runner can actually check. */
const GOAL_MILESTONE_PLAN = Object.freeze([
  { kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "dispatch artifact validated", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "executor matches selected provider", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "no external effect", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "zero spend", required: true },
  { kind: "DETERMINISTIC_CHECK", name: "writer released", required: true },
]);

/** The verbs the app server may route here. A closed list, checked before dispatch. */
export const GOAL_VERBS_V1 = Object.freeze(["goal.submit", "goal.recent"]);

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function goalPath(root, goalId) {
  return join(root, "goals", `${goalId}.json`);
}

/**
 * Read every durable Owner authority record.
 *
 * A record that cannot be parsed is skipped rather than throwing. The consequence of skipping is
 * strictly less authority, which is the safe direction.
 */
function readAuthorities(repositoryRoot) {
  const directory = join(repositoryRoot, ".aion-local", "owner-authority");
  let names = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(readFileSync(join(directory, name), "utf8")));
    } catch {
      // A damaged authority record grants nothing.
    }
  }
  return records;
}

/**
 * The envelope a goal-created milestone should claim, and the objective it claims lineage to.
 *
 * Chosen from the Owner's own records rather than configured here: the most recently created ACTIVE
 * envelope whose write domains cover the domains a goal milestone declares. Returning `null` is
 * normal and means the milestone gates — which is correct when no approved objective covers it.
 */
export function selectEnvelopeForGoal(authorities, writeDomains, now) {
  const candidates = [];
  for (const record of authorities) {
    const envelope = deriveEnvelopeFromOwnerAuthority(record, now);
    if (envelope === null || envelope.state !== "ACTIVE") continue;
    if (writeDomains.some((domain) => !envelope.allowedWriteDomains.includes(domain))) continue;
    candidates.push(envelope);
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => String(right.createdAtUtc).localeCompare(String(left.createdAtUtc)));
  return candidates[0] ?? null;
}

/**
 * Build the goal-intake surface.
 *
 * `port` is supplied by the caller rather than constructed here, so this module has exactly one way
 * to touch the roadmap and tests can prove it uses no other.
 */
export function createGoalIntake(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("goal intake needs a repositoryRoot");
  }
  const port = options.port;
  if (port === undefined || port === null || typeof port.getMilestones !== "function") {
    throw new Error("goal intake needs a roadmap port");
  }
  const storeRoot = options.goalStoreRoot ?? join(repositoryRoot, ...OWNER_GOAL_STORE_RELATIVE_PATH.split("/"));
  const now = options.now ?? nowUtc;
  const writeDomains = options.writeDomains ?? ["apps", "packages/director", "docs", "scripts"];
  const allowedProviders = options.allowedProviders ?? ["local"];

  function loadGoal(goalId) {
    try {
      return JSON.parse(readFileSync(goalPath(storeRoot, goalId), "utf8"));
    } catch {
      return null;
    }
  }

  function saveGoal(intent) {
    const path = goalPath(storeRoot, intent.goalId);
    mkdirSync(join(storeRoot, "goals"), { recursive: true });
    // Written once. A goal is what the Owner said at a moment; rewriting it on a repeat would let the
    // record drift from the words that caused the work.
    if (!existsSync(path)) {
      writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
    }
    return loadGoal(intent.goalId) ?? intent;
  }

  return {
    /**
     * Take one piece of Owner text and answer what AION did with it.
     *
     * Returns a shape the panel can render directly. Objectives appear because the Owner wrote them;
     * nothing else internal does.
     */
    submit(text) {
      const at = now();
      const milestones = port.getMilestones();
      const intent = buildOwnerGoalIntent({ text, now: at, milestones });

      const stored = saveGoal(intent);
      const actionable = PLANNABLE_CLASSES_V1.includes(stored.classification);

      if (!actionable) {
        return {
          goalId: stored.goalId,
          classification: stored.classification,
          reason: stored.classificationReason,
          actionable: false,
          created: false,
          milestoneId: null,
          authority: null,
          canBeginAutomatically: false,
          ownerDecisionRequired: false,
          message: stored.classification === "OWNER_DECISION"
            ? "That is an Owner decision. Authorization happens at the computer running AION, not here."
            : "Answered as a question. Nothing was added to the roadmap.",
        };
      }

      const envelope = selectEnvelopeForGoal(readAuthorities(repositoryRoot), writeDomains, at);
      const plan = planFromGoal({
        intent: stored,
        milestones,
        envelopeId: envelope?.envelopeId ?? null,
        parentObjective: envelope?.approvedObjectives?.[0] ?? null,
        writeDomains,
        allowedProviders,
        verificationSteps: GOAL_MILESTONE_PLAN,
        now: at,
      });

      if (plan.kind === "MATCHED_EXISTING") {
        return {
          goalId: stored.goalId,
          classification: stored.classification,
          reason: plan.reason,
          actionable: true,
          created: false,
          milestoneId: plan.matchedMilestoneId,
          authority: null,
          canBeginAutomatically: false,
          ownerDecisionRequired: false,
          message: "Already on the roadmap. Nothing was duplicated.",
        };
      }

      if (plan.kind !== "CREATE_MILESTONE" || plan.milestone === null) {
        return {
          goalId: stored.goalId,
          classification: stored.classification,
          reason: plan.reason,
          actionable: true,
          created: false,
          milestoneId: null,
          authority: null,
          canBeginAutomatically: false,
          ownerDecisionRequired: false,
          message: plan.reason,
        };
      }

      const added = port.addMilestone({
        milestoneId: plan.milestone.milestoneId,
        title: plan.milestone.title,
        objective: plan.milestone.objective,
        priority: plan.milestone.priority,
        dependencies: plan.milestone.dependencies,
        ownerAuthorizationId: plan.milestone.ownerAuthorizationId,
        authorityClass: "MILESTONE_AUTHORIZED",
        externalEffectClass: "REPOSITORY_REVERSIBLE",
        riskClasses: [],
        allowedProviders: plan.milestone.allowedProviders,
        reviewPolicy: "NONE",
        verificationSteps: plan.milestone.verificationSteps,
        authorityEnvelopeId: plan.milestone.authorityEnvelopeId,
        derivedFromObjective: plan.milestone.derivedFromObjective,
        writeDomains: plan.milestone.writeDomains,
        provenance: plan.milestone.provenance,
      });

      // Authority is read back from the roadmap's own evaluation rather than predicted here. Two
      // opinions about coverage is one too many, and the port's is the one that decides.
      const gates = port.getPendingOwnerGates();
      const gated = gates.some((gate) => gate.milestoneId === plan.milestone.milestoneId);
      const covered = added.milestone !== null && plan.milestone.authorityEnvelopeId !== null && !gated;

      return {
        goalId: stored.goalId,
        classification: stored.classification,
        reason: plan.reason,
        actionable: true,
        created: added.created,
        milestoneId: plan.milestone.milestoneId,
        authority: covered ? "COVERED_BY_OWNER_ENVELOPE" : "OWNER_DECISION_REQUIRED",
        canBeginAutomatically: covered,
        ownerDecisionRequired: !covered,
        message: added.created
          ? covered
            ? "Added to the roadmap. AION can continue automatically."
            : "Added to the roadmap. Owner decision required before it can run."
          : added.reason,
      };
    },

    /** The most recent Owner goals, newest first, for the panel's "what did I ask for" line. */
    recent(limit = 5) {
      let names = [];
      try {
        names = readdirSync(join(storeRoot, "goals"));
      } catch {
        return { goals: [] };
      }
      const goals = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const goal = loadGoal(name.replace(/\.json$/, ""));
        if (goal === null) continue;
        goals.push({
          goalId: goal.goalId,
          text: goal.originalText,
          classification: goal.classification,
          createdAt: goal.createdAt,
        });
      }
      goals.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
      return { goals: goals.slice(0, limit) };
    },
  };
}
