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
  MVA_JOB_STORE_RELATIVE_PATH,
  MVA_OWNER_AUTHORIZATION_ID,
  PROVIDER_IDS_V1,
  ROADMAP_STORE_RELATIVE_PATH,
  DIRECTOR_CAPABILITY_REGISTRY_V1,
  createFileJobStore,
  createFileRoadmapStore,
  createRoadmapPort,
  deriveEnvelopeFromOwnerAuthority,
  effectAuthoritiesFromOwnerRecords,
  authorityIsWithin,
  effectAuthorityEnvelopeId,
} from "../../packages/director/dist/index.js";
import {
  AUTONOMY_STORE_RELATIVE_PATH,
  pauseAutonomy,
  resumeAutonomy,
  runtimeStatus,
  startAutonomy,
} from "@aion/director";
import { createGoalIntake } from "./goal-intake.mjs";
import { createProviderRegistry } from "./provider-registry.mjs";
import { createVerificationRunner } from "./verification-runner.mjs";

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

/**
 * Every provider any ACTIVE Owner authority record permits.
 *
 * A union rather than an intersection, because the records describe separate milestones and a
 * provider allowed by one of them is inside the Owner's envelope for that work. It bounds what the
 * process may register, never what it can actually run — that stays with the registry, which has an
 * executor for exactly one provider.
 */
/** The principal every dispatch in this process acts for. */
const AION_OWNER_ID_V1 = "owner";

/**
 * Authority for the artifact writes a dispatch performs.
 *
 * The bounded executor routes those writes through the pre-action effect gate, so something has to
 * say what authorises them. That something is the Owner's own durable authority records — the same
 * ones that decide which providers may run — projected into envelopes by the Director. Nothing here
 * invents authority: a repository with no authority record produces a gate that resolves nothing, and
 * the writes are refused.
 *
 * The target resolver is deliberately narrow. It answers only for artifacts beneath the dispatch
 * artifact root, and it fixes their data class and write domain from trusted local knowledge rather
 * than from anything the job says about itself.
 */
function effectGateFrom(authorities, artifactRoot, nowUtc, milestoneAuthorizationOf) {
  /*
   * Authority is projected from the Owner's durable records, before anything dispatches.
   *
   * V0.2 let the executing job publish the record that then authorised it. An independent review
   * called that self-asserted authority, and it was right: the lineage closed on itself, because the
   * approved parent was the job's own milestone id. Nothing about a job reaches this function now.
   * The map is built from `.aion-local/owner-authority` when the port is constructed, so execution
   * resolves a reference it cannot write to, and a restart rebuilds the same map from the same files.
   *
   * Two sources, strongest first: a roadmap authority envelope where the Owner granted one, and
   * otherwise the narrowed artifact-write projection of an Owner record. The projection only ever
   * describes a subset of what the record already allowed.
   */
  const envelopes = new Map();
  for (const record of authorities) {
    const roadmap = deriveEnvelopeFromOwnerAuthority(record);
    if (roadmap !== null) envelopes.set(roadmap.envelopeId, roadmap);
  }
  const projections = effectAuthoritiesFromOwnerRecords(authorities);
  for (const [id, projected] of projections) {
    if (envelopes.has(id)) continue;
    /*
     * A projection may only ever describe a subset of the roadmap envelope for the same
     * authorization. It is built to narrow, and this checks that it did rather than trusting it --
     * child authority must stay inside parent authority, and "must" is worth an assertion at the one
     * place where a wider one could enter the map.
     */
    const parent = [...envelopes.values()].find(
      (candidate) => candidate.ownerAuthorizationId === projected.ownerAuthorizationId,
    );
    const staysWithinParent = parent === undefined ? true : authorityIsWithin(projected, parent);
    if (!staysWithinParent) continue;
    envelopes.set(id, projected);
  }

  const gate = {
    registry: DIRECTOR_CAPABILITY_REGISTRY_V1,
    /*
     * Artifacts live under `.aion-local`, and that is what this reports — the domain the Owner record
     * actually names. Reporting a domain the record does not list would be the target resolver
     * arranging its own approval.
     */
    resolveTarget: (targetType, targetId) =>
      targetType === "JobArtifact" && typeof targetId === "string" && targetId.startsWith(artifactRoot)
        ? { targetType, targetId, sensitivity: "INTERNAL", writeDomain: ".aion-local" }
        : null,
    envelopeFor: (id) => envelopes.get(id) ?? null,
    ownerId: AION_OWNER_ID_V1,
    now: nowUtc,
  };
  return {
    effectGate: gate,
    /*
     * Empty when no Owner record supports an artifact write. That is not a gap to paper over: with no
     * authority, the bounded executor's writes are refused, which is the correct outcome rather than
     * an inconvenience.
     */
    /*
     * Authority is resolved per milestone, from the Owner records on disk.
     *
     * V0.4 pinned one authorization for every dispatch. Campaign 01 measured what that cost: seven
     * over-grants and fourteen writes, plus the mirror -- milestones refused writes their own record
     * allowed. Both had the same cause, and it was not the gate. The gate enforced the record it was
     * handed; the wrong record was handed to it.
     *
     * A milestone with no Owner record resolves to nothing, and nothing is a refusal rather than a
     * fallback. Nothing here is read from a job, a payload or a provider.
     */
    authorityForMilestone: (milestoneId) => {
      if (typeof milestoneId !== "string" || milestoneId === "") return null;
      // Trusted chain, each step from durable state: roadmap milestone -> the authorization the Owner
      // gave *that* milestone -> the record on disk -> its narrowed artifact-write projection.
      const authorizationId = milestoneAuthorizationOf(milestoneId);
      if (authorizationId === null) return null;
      const envelope = envelopes.get(effectAuthorityEnvelopeId(authorizationId))
        ?? [...envelopes.values()].find((row) => row.ownerAuthorizationId === authorizationId);
      if (envelope === undefined) return null;
      return {
        ownerAuthorizationId: envelope.ownerAuthorizationId,
        envelopeId: envelope.envelopeId,
        parentMilestoneId: envelope.approvedParentMilestoneIds[0] ?? "",
      };
    },
  };
}

/**
 * Which Owner authorization a roadmap milestone runs under, from the roadmap store.
 *
 * Read here rather than taken from the job, because this is the link Campaign 01 showed missing: the
 * milestone knows its authorization, and dropping that on the way to dispatch is what let one record
 * govern every milestone's writes. A milestone with no authorization returns null, which refuses.
 */
function createMilestoneAuthorizationLookup(storeRoot) {
  return (milestoneId) => {
    let milestone = null;
    try {
      milestone = createFileRoadmapStore(storeRoot).loadMilestone(milestoneId);
    } catch {
      return null;
    }
    if (milestone === null) return null;
    const id = milestone.ownerAuthorizationId;
    return typeof id === "string" && id !== "" ? id : null;
  };
}

function allowedProvidersFrom(authorities) {
  const allowed = new Set();
  for (const record of authorities) {
    if (record === null || typeof record !== "object" || record.state !== "ACTIVE") continue;
    if (!Array.isArray(record.allowedProviders)) continue;
    for (const id of record.allowedProviders) {
      if (PROVIDER_IDS_V1.includes(id)) allowed.add(id);
    }
  }
  return [...allowed];
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
  return { ...buildRoadmapSurface(options).control };
}

/**
 * One place that builds a port, shared by the roadmap control and goal intake.
 *
 * Two constructions would be two chances to disagree about which store, which adapters and which
 * authority records are in play — and the whole point of the port is that there is one answer.
 */
function buildRoadmapSurface(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("roadmap control needs a repositoryRoot");
  }
  const storeRoot = options.storeRoot ?? join(repositoryRoot, ...ROADMAP_STORE_RELATIVE_PATH.split("/"));
  const jobStoreRoot = options.jobStoreRoot ?? join(repositoryRoot, ...MVA_JOB_STORE_RELATIVE_PATH.split("/"));
  const artifactRoot = options.artifactRoot ?? join(jobStoreRoot, "artifacts");
  const now = options.now ?? nowUtc;

  /**
   * Which providers this process can execute with, resolved fresh each time rather than cached.
   *
   * Authority is durable state that the Owner can change at a console while the server runs; a
   * registry frozen at boot would keep executing under an envelope that no longer exists.
   */
  const milestoneAuthorizationOf = createMilestoneAuthorizationLookup(storeRoot);

  function registry(head, authorities) {
    const nowUtc = now();
    return createProviderRegistry({
      artifactRoot,
      startingSha: head,
      now: nowUtc,
      allowedProviders: allowedProvidersFrom(authorities),
      ...effectGateFrom(authorities, artifactRoot, nowUtc, milestoneAuthorizationOf),
    });
  }

  function port() {
    const head = headSha(repositoryRoot);
    const authorities = readAuthorities(repositoryRoot);
    const base = {
      storeRoot,
      authorities,
      now,
      /*
       * Evidence comes from durable state the run left behind — the job record, the artifact, git —
       * never from the fact that nothing threw. `createVerificationRunner` produces no row at all for
       * a step it cannot check, and `evaluateVerification` fails the milestone on that silence.
       */
      verify:
        options.verify ??
        createVerificationRunner({
          repositoryRoot,
          jobStoreRoot,
          registeredProviders: registry(head, authorities).registered,
        }),
      baselineSha: options.baselineSha ?? head,
      currentHead: head,
      currentDirectiveId: currentDirectiveId(repositoryRoot),
    };
    if (options.dispatch !== undefined) return createRoadmapPort({ ...base, dispatch: options.dispatch });
    const providers = registry(head, authorities);
    return createRoadmapPort({
      ...base,
      dispatchTarget: { repository: repositoryRoot, worktree: repositoryRoot, startingSha: head },
      /*
       * Without these, `submitJob` would fall back to an in-memory job store, a frozen clock and
       * self-provisioned adapters for every provider id — including ones this process cannot run.
       * A durable store is what makes a restart able to tell finished work from work that never
       * started, and explicit adapters are what stop an artifact claiming a provider that never ran.
       */
      dispatchDeps: {
        adapters: providers.adapters,
        health: providers.health,
        store: createFileJobStore(jobStoreRoot),
        artifactRoot: providers.artifactRoot,
        now: now(),
      },
    });
  }

  /** What the panel is allowed to say about providers: registered, and deliberately not. */
  function providerReport() {
    const providers = registry(headSha(repositoryRoot), readAuthorities(repositoryRoot));
    return {
      registered: [...providers.registered],
      unregistered: Object.entries(providers.unregistered).map(([providerId, reason]) => ({ providerId, reason })),
    };
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
      // Stated on every read, because "which provider is working" is one of the six questions the
      // panel exists to answer and the truthful answer today is "one, and here is what is not wired".
      providers: providerReport(),
      waitingOnOwner: gates.length > 0,
      generatedAt: now(),
    };
  }

  const control = {
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

  return { control, port };
}

/**
 * Goal intake over the same port the Roadmap panel uses.
 *
 * A separate factory rather than extra methods on the roadmap control, so the control's surface —
 * which tests pin key by key — stays exactly the reads and three verbs it was reviewed as. Goal
 * intake is a different question with a different blast radius and deserves its own object.
 */
export function createGoalControl(options = {}) {
  const surface = buildRoadmapSurface(options);
  return createGoalIntake({
    repositoryRoot: options.repositoryRoot,
    port: surface.port(),
    ...(options.goalStoreRoot !== undefined ? { goalStoreRoot: options.goalStoreRoot } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.writeDomains !== undefined ? { writeDomains: options.writeDomains } : {}),
    ...(options.allowedProviders !== undefined ? { allowedProviders: options.allowedProviders } : {}),
  });
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

/**
 * Autonomy control: start, pause, resume, status.
 *
 * A separate factory rather than extra methods on the roadmap control, for the reason
 * `createGoalControl` gives above: the roadmap control's surface is pinned key by key by its tests,
 * and this is a different question with a different blast radius.
 *
 * **The client cannot describe the work.** No verb here takes an objective, a business, a provider,
 * an authority id, a step, or a piece of evidence. `start` takes nothing at all: what runs comes
 * from durable server-side state that the Owner's directives put there. A browser can ask AION to
 * begin, to stop, and what it is doing — and that is the whole surface, because anything richer is a
 * way to describe work into existence from outside the trust boundary.
 *
 * Runs are bounded here as well as in the kernel. A verb that starts an unbounded loop is a verb
 * that hands a request handler an unbounded loop.
 */
const AUTONOMY_MAX_STEPS_PER_CALL_V1 = 8;

export function createAutonomyControl(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("autonomy control needs a repositoryRoot");
  }
  const storeRoot = options.storeRoot
    ?? join(repositoryRoot, ...AUTONOMY_STORE_RELATIVE_PATH.split("/"));
  const artifactRoot = options.artifactRoot ?? join(storeRoot, "discovery");
  const now = options.now ?? nowUtc;

  /** Everything the runtime needs, assembled here and never accepted from a caller. */
  const deps = () => ({
    storeRoot,
    artifactRoot,
    now,
    currentSha: headSha(repositoryRoot),
    provenance: "Owner portfolio direction, recorded in docs/aion/CURRENT_STATE.md",
    maxSteps: AUTONOMY_MAX_STEPS_PER_CALL_V1,
  });

  return {
    status() {
      return runtimeStatus(deps());
    },
    start() {
      const result = startAutonomy(deps());
      // The run itself is not returned wholesale: it carries step detail the panel has no need for.
      return {
        started: result.started,
        reason: result.reason,
        registered: result.registration?.created.length ?? 0,
        recovered: result.registration?.recovered.length ?? 0,
        completed: result.run?.completed ?? [],
        blocked: result.run?.blocked ?? [],
        parked: result.parked,
        stopReason: result.run?.stopReason ?? "PAUSED",
      };
    },
    pause(reason = "") {
      const state = pauseAutonomy(deps(), String(reason ?? ""));
      return { paused: state.paused, pausedReason: state.pausedReason };
    },
    resume() {
      const state = resumeAutonomy(deps());
      return { paused: state.paused };
    },
  };
}

/** The autonomy verbs the app server may route. A closed list, like the roadmap one above. */
export const AUTONOMY_VERBS_V1 = Object.freeze([
  "autonomy.status",
  "autonomy.start",
  "autonomy.pause",
  "autonomy.resume",
]);
