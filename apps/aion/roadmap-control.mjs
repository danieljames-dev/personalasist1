/**
 * The app's window onto the roadmap: reads, three verbs, and nothing that manufactures authority.
 *
 * This module is deliberately thin. It builds `RoadmapPortV1` over the durable store and translates
 * its answers into small JSON shapes the browser can render. It does not read roadmap files, does not
 * decide readiness, does not pick a provider, and does not transition a milestone — every one of
 * those questions belongs to the orchestrator, and answering them a second time here is how a UI
 * and a backend start disagreeing about what is true.
 *
 * ## What is deliberately absent
 *
 * There is no `approveGate`, no `grantAuthority`, no `forceComplete`, no `bypassReview`. The app
 * observes authority; it never creates it. A browser control that could satisfy an Owner gate would
 * make every gate in the system decorative, and the whole point of the gate queue is that the
 * decision happens outside the thing asking for it. The authorization command is shown as *text* —
 * the Owner runs it at a console, and no request from a phone can substitute for that.
 *
 * ## Response minimization
 *
 * Every projection below is an explicit field list, never a spread of the underlying record. Roadmap
 * milestones carry provenance, objectives and verification plans; takeover packets carry repository
 * paths. None of that needs to reach a browser to answer "what is AION doing", so none of it does.
 * The one exception is the gate's `exactScope`, which exists precisely so the Owner can see what
 * they are being asked to approve.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROADMAP_STORE_RELATIVE_PATH,
  createRoadmapPort,
} from "../../packages/director/dist/index.js";

/** Milestones a person would call "finished recently", newest-looking first. */
const RECENT_LIMIT = 5;

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Read every durable Owner authority record.
 *
 * A record that cannot be parsed is skipped rather than throwing: the roadmap must still be readable
 * when one authority file is damaged, and the consequence of skipping is strictly less authority,
 * which is the safe direction.
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
      // A damaged authority record grants nothing. Silence here fails closed.
    }
  }
  return records;
}

/** The directive the roadmap is currently operating under, by id only. */
function currentDirectiveId(repositoryRoot) {
  try {
    const text = readFileSync(join(repositoryRoot, ".aion-local", "directives", "CURRENT.md"), "utf8");
    return /^Directive-ID:\s*(.+?)\s*$/m.exec(text)?.[1] ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

/**
 * The exact Owner authorization command for a gate, as read-only text.
 *
 * Assembled from the durable directive rather than invented, and only when the gate's related
 * directive is the one currently pending — otherwise the Owner would be shown a phrase for something
 * that is no longer in front of them.
 */
function authorizationHintFor(repositoryRoot, gate) {
  try {
    const text = readFileSync(join(repositoryRoot, ".aion-local", "directives", "CURRENT.md"), "utf8");
    const id = /^Directive-ID:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
    const status = /^Status:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
    const phrase = /^Required-Authorization-Phrase:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
    if (id === null || phrase === null || status !== "PENDING_OWNER_AUTHORIZATION") return null;
    if (gate.relatedDirectiveId !== null && gate.relatedDirectiveId !== id) return null;
    return {
      directiveId: id,
      command: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/authorize-current-directive.ps1",
      phrase,
      note: "Run this at the computer running AION. It cannot be run from this page.",
    };
  } catch {
    return null;
  }
}

function headSha(repositoryRoot) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

/** Milestone shape the browser sees. Objectives, provenance and plans stay on the host. */
function projectMilestone(milestone) {
  return {
    milestoneId: milestone.milestoneId,
    title: milestone.title,
    status: milestone.status,
    priority: milestone.priority,
    dependencies: milestone.dependencies,
    blockedReason: milestone.blockedReason,
  };
}

function projectGate(gate, hint) {
  return {
    gateId: gate.gateId,
    milestoneId: gate.milestoneId,
    reason: gate.reason,
    authorityRequested: gate.authorityRequested,
    exactScope: gate.exactScope,
    status: gate.status,
    createdAt: gate.createdAt,
    authorization: hint,
  };
}

/**
 * Build the app-facing roadmap control surface.
 *
 * `dispatch` is injectable so tests can prove the Continue path executes work without a provider
 * process. Production passes a `dispatchTarget` instead, and the port builds the real MVA-backed
 * dispatcher from it.
 */
export function createRoadmapControl(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("roadmap control needs a repositoryRoot");
  }
  const storeRoot = options.storeRoot ?? join(repositoryRoot, ...ROADMAP_STORE_RELATIVE_PATH.split("/"));
  const now = options.now ?? nowUtc;

  function port() {
    const head = headSha(repositoryRoot);
    const base = {
      storeRoot,
      authorities: readAuthorities(repositoryRoot),
      now,
      /*
       * Verification evidence is produced by whoever ran the milestone, not by the browser. Until a
       * worker records real evidence the honest answer is that none exists, and `evaluateVerification`
       * then fails the milestone closed rather than completing it on silence.
       */
      verify: options.verify ?? (() => []),
      baselineSha: options.baselineSha ?? head,
      currentHead: head,
      currentDirectiveId: currentDirectiveId(repositoryRoot),
    };
    if (options.dispatch !== undefined) return createRoadmapPort({ ...base, dispatch: options.dispatch });
    return createRoadmapPort({
      ...base,
      dispatchTarget: { repository: repositoryRoot, worktree: repositoryRoot, startingSha: head },
    });
  }

  /** Everything the panel needs in one call, so the page is one round trip. */
  function status() {
    const p = port();
    const roadmap = p.getRoadmap();
    const summary = p.getRoadmapStatus();
    const milestones = p.getReadyMilestones().map(projectMilestone);
    const gates = p.getPendingOwnerGates().map((gate) => projectGate(gate, authorizationHintFor(repositoryRoot, gate)));
    const workers = p.getActiveWorkers().map((worker) => ({
      milestoneId: worker.milestoneId,
      status: worker.status,
      // The packet knows the provider restriction, not who actually picked it up. Saying UNKNOWN is
      // better than implying a worker we cannot see.
      provider: worker.packet?.providerRestrictions?.length === 1 ? worker.packet.providerRestrictions[0] : "UNKNOWN",
    }));
    const current = p.getCurrentMilestone();
    return {
      exists: summary.exists,
      state: summary.state,
      paused: summary.state === "PAUSED",
      version: summary.version,
      fingerprint: summary.fingerprint,
      goals: roadmap?.ownerGoalSet ?? [],
      total: summary.total,
      byStatus: summary.byStatus,
      readyCount: summary.readyCount,
      openGates: summary.openGates,
      current: current === null ? null : projectMilestone(current),
      ready: milestones,
      gates,
      workers,
      waitingOnOwner: gates.length > 0,
      generatedAt: now(),
    };
  }

  return {
    status,
    current() {
      const milestone = port().getCurrentMilestone();
      return { current: milestone === null ? null : projectMilestone(milestone) };
    },
    ready() {
      return { ready: port().getReadyMilestones().map(projectMilestone) };
    },
    gates() {
      return {
        gates: port()
          .getPendingOwnerGates()
          .map((gate) => projectGate(gate, authorizationHintFor(repositoryRoot, gate))),
      };
    },
    workers() {
      return {
        workers: port().getActiveWorkers().map((worker) => ({
          milestoneId: worker.milestoneId,
          status: worker.status,
          provider: worker.packet?.providerRestrictions?.length === 1 ? worker.packet.providerRestrictions[0] : "UNKNOWN",
        })),
      };
    },
    /**
     * The Owner's one important button.
     *
     * It says "continue toward my goals" and names no model. Which milestone runs, whether authority
     * covers it, which provider executes it and whether review is required are all decided behind
     * this call.
     */
    continueRoadmap() {
      const result = port().continueRoadmap();
      return {
        steps: result.steps,
        completed: result.completed,
        gated: result.gated,
        blocked: result.blocked,
        failed: result.failed,
        stopReason: result.stopReason,
        detail: result.detail,
        ownerPrompts: result.ownerPrompts,
        status: status(),
      };
    },
    pause() {
      const roadmap = port().pauseRoadmap();
      return { state: roadmap?.state ?? "NONE", status: status() };
    },
    resume() {
      const roadmap = port().resumeRoadmap();
      return { state: roadmap?.state ?? "NONE", status: status() };
    },
    /** Recent terminal work and anything stuck, for the "what just happened" line in the panel. */
    recent() {
      const all = port().getMilestones();
      return {
        completed: all.filter((m) => m.status === "COMPLETED").slice(0, RECENT_LIMIT).map(projectMilestone),
        stuck: all
          .filter((m) => m.status === "BLOCKED" || m.status === "FAILED" || m.status === "RECOVERY_REQUIRED")
          .map(projectMilestone),
      };
    },
  };
}

/** The verbs the app server is allowed to route here. A closed list, checked before dispatch. */
export const ROADMAP_VERBS_V1 = Object.freeze([
  "roadmap.status",
  "roadmap.current",
  "roadmap.ready",
  "roadmap.gates",
  "roadmap.workers",
  "roadmap.continue",
  "roadmap.pause",
  "roadmap.resume",
]);
