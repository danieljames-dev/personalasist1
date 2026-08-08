import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

/**
 * Development projects, and the pipeline that turns one into something the owner can look at.
 *
 * V1 proved that a developer agent can be useful without being dangerous: the instruction travels
 * on standard input, the repository root is fixed, the mode is part of the approval digest, and no
 * capability accepts shell text. This generalises that from a single task into a project that runs
 * from an idea to something previewable, without loosening any of it.
 *
 * Two rules are structural rather than procedural:
 *
 *   1. **No agent authorises itself.** A stage that changes the repository cannot be entered
 *      without a recorded owner approval naming that exact stage. An agent may propose the move;
 *      the move is the owner's.
 *   2. **Nothing here carries a command.** A project references capability identifiers and
 *      pipeline steps AION already owns. There is no field anywhere in this file that a model
 *      could fill with a shell fragment, which is why there is nothing to sanitise.
 *
 * Deployment is deliberately unfinished. A project can be prepared, built, previewed locally, and
 * approved, and then it stops: putting something where other people can reach it is a level-4
 * action that needs a capability this milestone does not create.
 */

export type ProjectStageV1 =
  | "idea" | "specification" | "plan" | "tasks" | "implementation"
  | "verification" | "review" | "preview" | "owner-approved" | "deployed" | "abandoned";

export const PROJECT_STAGES: readonly ProjectStageV1[] = [
  "idea", "specification", "plan", "tasks", "implementation",
  "verification", "review", "preview", "owner-approved", "deployed", "abandoned",
];

/**
 * Which stage may follow which. Abandonment is always available; nothing else skips ahead, so a
 * project cannot arrive at "reviewed" without having been built.
 */
const STAGE_TRANSITIONS: Record<ProjectStageV1, readonly ProjectStageV1[]> = {
  idea: ["specification", "abandoned"],
  specification: ["plan", "idea", "abandoned"],
  plan: ["tasks", "specification", "abandoned"],
  tasks: ["implementation", "plan", "abandoned"],
  implementation: ["verification", "tasks", "abandoned"],
  verification: ["review", "implementation", "abandoned"],
  review: ["preview", "implementation", "abandoned"],
  preview: ["owner-approved", "review", "abandoned"],
  "owner-approved": ["deployed", "preview", "abandoned"],
  deployed: ["abandoned"],
  abandoned: ["idea"],
};

/** Stages that can change the repository, and therefore need an approval naming that stage. */
export const APPROVAL_REQUIRED_STAGES: readonly ProjectStageV1[] = ["implementation", "deployed"];

export interface ProjectApprovalV1 {
  stage: ProjectStageV1;
  at: IsoTimestamp;
  /** Always the owner. The type is stated so a reader does not have to infer it. */
  actor: "owner";
  note: string;
}

/**
 * A proposal from a developer agent. It records what the agent suggested and which mode it would
 * need; it grants nothing. Running it goes through the ordinary capability, approval, and digest
 * machinery, exactly as a one-off task does.
 */
export interface AgentProposalV1 {
  id: OpaqueId;
  /** Which bridge proposed it, so a proposal is attributable. */
  bridgeId: string;
  summary: string;
  /** read-only or workspace-write. Part of what the owner approves, never assumed. */
  mode: "read-only" | "workspace-write";
  /** The AION action this proposal became, once the owner proposed it for real. */
  actionId: OpaqueId | null;
  state: "proposed" | "accepted" | "rejected";
  at: IsoTimestamp;
}

export type PipelineStepV1 = "install" | "build" | "test" | "preview";
export const PIPELINE_STEPS: readonly PipelineStepV1[] = ["install", "build", "test", "preview"];

export interface PipelineRunV1 {
  id: OpaqueId;
  step: PipelineStepV1;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  outcome: "passed" | "failed";
  /** Bounded, privacy-safe output. Local paths are removed before this is stored. */
  output: string;
  /** Where a preview can be opened. Always loopback; never anything anyone else can reach. */
  previewUrl: string | null;
}

/**
 * A prepared deployment. It is a record of intent and nothing more: AION has no capability that
 * performs it, and creating one of these does not bring that capability into existence.
 */
export interface DeploymentProposalV1 {
  id: OpaqueId;
  target: string;
  summary: string;
  /** What the owner would be agreeing to. Written plainly because it cannot be undone. */
  consequences: string;
  state: "prepared" | "owner-approved" | "withdrawn";
  at: IsoTimestamp;
}

export interface ProjectSpecificationV1 {
  problem: string;
  audience: string;
  scope: string[];
  outOfScope: string[];
  acceptance: string[];
  updatedAt: IsoTimestamp;
}

export interface ProjectHistoryEntryV1 { at: IsoTimestamp; from: ProjectStageV1; to: ProjectStageV1; reason: string; actor: "owner" | "aion"; }

export interface DevelopmentProjectV1 {
  id: OpaqueId;
  workspace: string;
  title: string;
  summary: string;
  /** The Product Studio opportunity this exists to serve, when there is one. */
  opportunityId: OpaqueId | null;
  stage: ProjectStageV1;
  specification: ProjectSpecificationV1 | null;
  /** Plan steps as text. Converting them into Tasks goes through the existing Planner. */
  planSteps: string[];
  taskIds: OpaqueId[];
  proposals: AgentProposalV1[];
  /** Verification runs from the allowlisted runner. Evidence, not a claim of success. */
  verificationIds: OpaqueId[];
  reviewNotes: string[];
  runs: PipelineRunV1[];
  approvals: ProjectApprovalV1[];
  deployment: DeploymentProposalV1 | null;
  history: ProjectHistoryEntryV1[];
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function fail(message: string): never { throw new Error(message); }

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}
function list(value: unknown, label: string, max = 60): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} is invalid.`);
  return value.map((entry) => text(entry, label, 2000));
}

export function buildProject(input: Record<string, unknown>, context: { id: OpaqueId; workspace: string; now: IsoTimestamp }): DevelopmentProjectV1 {
  return {
    id: context.id,
    workspace: context.workspace,
    title: text(input.title, "Project title", 200),
    summary: text(input.summary, "Project summary", 4000, false),
    opportunityId: input.opportunityId === undefined || input.opportunityId === null || input.opportunityId === "" ? null : text(input.opportunityId, "Opportunity reference", 200),
    stage: "idea",
    specification: null,
    planSteps: [],
    taskIds: [],
    proposals: [],
    verificationIds: [],
    reviewNotes: [],
    runs: [],
    approvals: [],
    deployment: null,
    history: [{ at: context.now, from: "idea", to: "idea", reason: "Project opened.", actor: "owner" }],
    provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: context.now },
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function buildProjectSpecification(input: Record<string, unknown>, now: IsoTimestamp): ProjectSpecificationV1 {
  return {
    problem: text(input.problem, "Specification problem", 4000),
    audience: text(input.audience, "Specification audience", 2000, false),
    scope: list(input.scope, "Scope item"),
    outOfScope: list(input.outOfScope, "Out-of-scope item"),
    acceptance: list(input.acceptance, "Acceptance criterion"),
    updatedAt: now,
  };
}

export interface StageAdvanceV1 { stage: ProjectStageV1; reason: string; }

/**
 * Moves a project to the next stage, or refuses.
 *
 * Every refusal names the actual obstacle. The two that matter: an approval-requiring stage
 * without an approval naming that stage, and a review or preview reached without the evidence
 * those stages are supposed to rest on. A project that says "verified" when nothing ran would be
 * worse than a project with no stages at all.
 */
export function advanceProject(project: DevelopmentProjectV1, to: unknown, reason: string, now: IsoTimestamp): DevelopmentProjectV1 {
  const target = PROJECT_STAGES.includes(to as ProjectStageV1) ? to as ProjectStageV1 : fail(`A project stage must be one of: ${PROJECT_STAGES.join(", ")}.`);
  const allowed = STAGE_TRANSITIONS[project.stage];
  if (!allowed.includes(target)) fail(`A project at "${project.stage}" can move to ${allowed.join(", ")}, not to "${target}". Stages are not skipped.`);
  const why = text(reason, "Reason", 1000);

  if (APPROVAL_REQUIRED_STAGES.includes(target) && !project.approvals.some((entry) => entry.stage === target)) {
    fail(`Moving to "${target}" changes something outside this record, so it needs an approval naming that stage. No agent raises its own authority.`);
  }
  if (target === "specification" && !project.specification) fail("Write the specification before moving to that stage.");
  if (target === "tasks" && !project.planSteps.length) fail("A plan with at least one step is needed before tasks.");
  if (target === "review" && !project.verificationIds.length && !project.runs.some((run) => run.step === "test")) {
    fail("Review rests on evidence. Run verification or the test step first; AION will not record a review of nothing.");
  }
  if (target === "preview" && !project.runs.some((run) => run.step === "preview" && run.outcome === "passed")) {
    fail("A preview stage needs a preview that actually built. Run the preview step first.");
  }
  if (target === "deployed") {
    fail("AION cannot deploy. Putting something where other people can reach it is an irreversible external action, and this milestone deliberately ships no capability that performs it. Approving a deployment records your intent; carrying it out is still yours to do.");
  }

  const next = structuredClone(project);
  next.history.push({ at: now, from: project.stage, to: target, reason: why, actor: "owner" });
  next.stage = target;
  next.updatedAt = now;
  return next;
}

/** Records the owner's approval for one exact stage. Owner-only by construction: there is no actor parameter. */
export function approveProjectStage(project: DevelopmentProjectV1, stage: unknown, note: string, now: IsoTimestamp): DevelopmentProjectV1 {
  const target = PROJECT_STAGES.includes(stage as ProjectStageV1) ? stage as ProjectStageV1 : fail("That is not a project stage.");
  if (!APPROVAL_REQUIRED_STAGES.includes(target)) fail(`"${target}" does not need an approval. Approvals exist for the stages that change something: ${APPROVAL_REQUIRED_STAGES.join(", ")}.`);
  const next = structuredClone(project);
  next.approvals.push({ stage: target, at: now, actor: "owner", note: text(note, "Approval note", 1000, false) });
  next.updatedAt = now;
  return next;
}

export function buildAgentProposal(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): AgentProposalV1 {
  const mode = input.mode === "workspace-write" ? "workspace-write" : "read-only";
  return {
    id: context.id,
    bridgeId: text(input.bridgeId, "Bridge identifier", 100),
    summary: text(input.summary, "Proposal summary", 4000),
    mode,
    actionId: null,
    state: "proposed",
    at: context.now,
  };
}

/**
 * Prepares a deployment.
 *
 * This writes down what would happen and what it would cost if it were wrong. It does not create
 * the ability to do it. The consequences field is required because a deployment nobody wrote the
 * consequences of is a deployment nobody thought about.
 */
export function buildDeploymentProposal(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): DeploymentProposalV1 {
  return {
    id: context.id,
    target: text(input.target, "Deployment target", 500),
    summary: text(input.summary, "Deployment summary", 4000),
    consequences: text(input.consequences, "Deployment consequences", 4000),
    state: "prepared",
    at: context.now,
  };
}

/**
 * The pipeline port.
 *
 * Steps are chosen from a closed set, exactly as verification operations are: a caller names a
 * step, and AION owns whatever that step means. Nothing accepts a command, so there is nothing for
 * instruction text to be injected into.
 */
export interface BuildPipelinePortV1 {
  readonly id: string;
  /** Whether this pipeline can produce something reachable by anyone else. Always false in V1.2. */
  readonly canPublish: false;
  run(step: PipelineStepV1, project: { id: string; title: string }, signal: AbortSignal): Promise<Omit<PipelineRunV1, "id" | "step">>;
}

/** An honest status line for a project, stating what has and has not actually happened. */
export function projectStanding(project: DevelopmentProjectV1): string {
  const tested = project.runs.filter((run) => run.step === "test");
  const failed = tested.filter((run) => run.outcome === "failed").length;
  const parts = [
    `"${project.title}" is at ${project.stage}.`,
    project.specification ? "" : "No specification has been written.",
    project.planSteps.length ? `${project.planSteps.length} plan step(s).` : "No plan yet.",
    tested.length ? `${tested.length} test run(s), ${failed} failing.` : "Nothing has been tested.",
    project.approvals.length ? `Approved for: ${[...new Set(project.approvals.map((entry) => entry.stage))].join(", ")}.` : "No stage has been approved.",
    project.deployment ? `A deployment to ${project.deployment.target} is ${project.deployment.state}; AION cannot carry it out.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}
