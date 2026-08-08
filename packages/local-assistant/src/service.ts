import type {
  ActivityV1, AgentActionV1, ApprovalV1, AssistantStateV1, CapabilityRegistryV1, ChatMessageV1,
  ChatTurnV1, ClockV1, ConversationV1, DeveloperAgentModeV1, DeveloperAgentRegistryV1,
  DeveloperAgentStatusV1, IdGeneratorV1, ImportReportV1,
  ImportSourceV1, MemoryV1, ModelProviderV1, PlanV1, PrivateBackupV1, RoutineV1, SettingsV1,
  ContactChannelV1, CustomerAppointmentV1, CustomerInteractionV1, CustomerQueryV1, CustomerV1,
  IsoTimestamp, RelationshipQueryV1, RelationshipV1, SalesCountsV1, SalesMetricsEntryV1,
  MigrationRecordV1, StateRepositoryV1, TaskStateV1, TaskV1, VerificationRunV1, WorkspaceIdV1,
} from "./contracts.js";
import { DEFAULT_WORKSPACE, PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX, SALES_COUNT_KEYS } from "./contracts.js";
import { createEmptyStateV1, digestValue, migrateStateV1 } from "./adapters.js";
import { applyCustomerEdit, buildAppointment, buildCustomer, buildFollowUp, buildInteraction, lastInteraction, queryCustomers } from "./sales.js";
import { buildRelationship, queryRelationships } from "./relationships.js";
import type { WorkspaceV1 } from "./workspaces.js";
import { applyWorkspaceEdit, assertSameWorkspace, buildBrandProduct, buildWorkspace, requireWorkspace } from "./workspaces.js";
import { buildClaim, promoteClaim, supersedeClaim } from "./knowledge.js";
import type { BrainEndpointV1, BrainHealthV1, BrainSettingsV1, RouterModeV1, RoutingDecisionV1, RoutingRequestV1 } from "./brain.js";
import {
  BRAIN_BOUNDARY, OFFLINE_ENDPOINT_ID, ROUTER_MODES, buildEndpoint, endpointForProvider,
  independenceReport, routeRequest, routeSelectedProvider,
} from "./brain.js";
import type { EvaluationCaseResultV1, EvaluationCaseV1, EvaluationRunV1 } from "./evaluation.js";
import { EVALUATION_SUITE, compareEvaluations, summariseEvaluation } from "./evaluation.js";
import type { OpportunityV1 } from "./product-studio.js";
import {
  applyOpportunityEdit, buildCompetitorNote, buildExperiment, buildOpportunity, buildSpecification,
  completeExperiment, opportunityAssessment,
} from "./product-studio.js";
import type { ResearchJobV1, ResearchProviderV1, UrlVerdictV1 } from "./research.js";
import { applyResearchResult, buildResearchJob, evaluateResearchUrl, researchSummary } from "./research.js";
import type { LessonScopeV1, LessonStandingV1, LessonV1 } from "./learning.js";
import {
  ADAPTATION_BOUNDARY, applicableLessons, assertLessonClaimClass, buildLesson, learningSummary,
  lessonStanding, recordLessonOutcome,
} from "./learning.js";
import type { BuildPipelinePortV1, DevelopmentProjectV1, PipelineRunV1, PipelineStepV1 } from "./projects.js";
import {
  PIPELINE_STEPS, advanceProject, approveProjectStage, buildAgentProposal, buildDeploymentProposal,
  buildProject, buildProjectSpecification, projectStanding,
} from "./projects.js";
import type { RoutingResultV1 } from "./command-router.js";
import { assertNoExecutableText, routeCommand } from "./command-router.js";
import { PAIRING_TTL_MINUTES, authenticate, checkRateLimit, clearRateLimit, issuePairingToken, pruneAccess, recordFailure, redeemPairingCode, revokeAllDevices, revokeDevice, validateBindAddress } from "./access.js";
import { SALES_ROUTINE_TEMPLATES, appointmentPreparation, callPreparation, discoveryQuestions, endOfDayRecap, followUpDraft, followUpQueue, morningPlan, nextActionSuggestion, objectionPrompts, rolePlay } from "./sales-coach.js";
import type { CoachOutputV1, SalesRoutineTemplateV1 } from "./sales-coach.js";

type AssistantPorts = {
  repository: StateRepositoryV1;
  clock: ClockV1;
  ids: IdGeneratorV1;
  providers: readonly ModelProviderV1[];
  capabilities: CapabilityRegistryV1;
  importer: ImportSourceV1;
  backup: PrivateBackupV1;
  developerAgents: DeveloperAgentRegistryV1;
  /** Optional. Absent means AION has no way to research anything, which is the default. */
  research?: ResearchProviderV1;
  /** Optional. Absent means AION cannot build or preview anything, which is also the default. */
  pipeline?: BuildPipelinePortV1;
};
const TASK_TRANSITIONS: Record<TaskStateV1, readonly TaskStateV1[]> = {
  proposed: ["ready", "cancelled"], ready: ["in-progress", "blocked", "completed", "cancelled"],
  "in-progress": ["blocked", "completed", "cancelled"], blocked: ["ready", "in-progress", "cancelled"],
  completed: ["ready"], cancelled: ["ready"],
};
function required(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.normalize("NFC") || value.length > max) throw new Error(`${label} is invalid.`);
  return value.trim();
}
function iso(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = required(value, label, 64); if (new Date(text).toISOString() !== text) throw new Error(`${label} must be a canonical timestamp.`); return text;
}
function unique(values: unknown, label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array.`);
  const result = values.map((value) => required(value, label, 100));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result.sort();
}
function find<T extends { id: string }>(items: readonly T[], id: string, label: string): T {
  const item = items.find((entry) => entry.id === id); if (!item) throw new Error(`${label} was not found.`); return item;
}
const MEMORY_CATEGORIES: readonly MemoryV1["category"][] = ["semantic", "procedural", "episodic", "strategic"];

/**
 * Deterministic conflict grouping key: the text before the first colon, or the first four words
 * when there is no colon. Memories that share a category and subject but state different things
 * are both preserved and both flagged, rather than one silently replacing the other.
 */
function subjectKey(content: string): string {
  const normalized = content.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
  const colon = normalized.indexOf(":");
  return (colon > 0 ? normalized.slice(0, colon) : normalized.split(" ").slice(0, 4).join(" ")).trim();
}
const CAREER_COMMANDS: readonly string[] = ["init", "ingest", "profile", "job:import", "match", "draft", "export", "demo"];
const VERIFICATION_CAPABILITY_ID = "aion.verify.run.v1";

/**
 * Picks the part of a verification transcript worth analysing. A full suite run is far larger than
 * a bounded instruction, and the useful signal is the failures plus the trailing summary, so both
 * are kept in order and the bulk of the passing output is dropped.
 */
function salientEvidence(run: VerificationRunV1, budget = 2600): string {
  const lines = `${run.stdout}\n${run.stderr}`.split(/\r?\n/u);
  const interesting = /^(?:not ok|#\s*(?:tests|pass|fail|skipped)|.*(?:error|Error|AssertionError|FAIL|failed|✗)\b)/u;
  const failures = lines.filter((line) => interesting.test(line));
  const tail = lines.slice(-40);
  const selected = [...new Set([...failures, ...tail])].filter((line) => line.trim());
  const text = selected.join("\n");
  return text.length > budget ? text.slice(-budget) : text || "(the operation produced no output)";
}

/**
 * Splits provider text into the message the owner sees and the proposals AION must revalidate.
 * Proposal lines are never stored in the message body and never carry execution authority.
 */
function splitProviderProposals(response: string): { body: string; actions: Array<{ capabilityId: unknown; input: unknown }>; memories: Array<{ content: unknown; category: unknown }>; malformed: number } {
  const kept: string[] = []; const actions = []; const memories = []; let malformed = 0;
  for (const line of response.split(/\r?\n/u)) {
    const isAction = line.startsWith(PROPOSE_ACTION_PREFIX);
    const isMemory = line.startsWith(PROPOSE_MEMORY_PREFIX);
    if (!isAction && !isMemory) { kept.push(line); continue; }
    const payload = line.slice((isAction ? PROPOSE_ACTION_PREFIX : PROPOSE_MEMORY_PREFIX).length).trim();
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { malformed += 1; continue; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { malformed += 1; continue; }
    const record = parsed as Record<string, unknown>;
    if (isAction) actions.push({ capabilityId: record.capabilityId, input: record.input });
    else memories.push({ content: record.content, category: record.category });
  }
  return { body: kept.join("\n").trim(), actions, memories, malformed };
}

export class AionAssistantV1 {
  private state = createEmptyStateV1();
  private ready: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  constructor(private readonly ports: AssistantPorts) {
    if (!ports.providers.length) throw new Error("At least one model provider is required.");
    this.ready = this.initialize();
  }
  private async initialize(): Promise<void> {
    const loaded = await this.ports.repository.load();
    this.state = loaded ?? createEmptyStateV1();
    if (loaded) {
      // Migrations run once, on load, before anything can read the state. A migration that
      // changes nothing is not written, so opening AION repeatedly does not churn revisions.
      const migrated = migrateStateV1(this.state, this.ports.clock.now(), (kind) => this.ports.ids.next(kind));
      if (migrated.applied) {
        const expected = this.state.revision;
        const next = { ...migrated.state, revision: expected + 1 };
        for (const record of migrated.records) this.#recordMigration(next, record);
        await this.ports.repository.save(expected, next);
        this.state = next;
      }
    }
    // Restore the owner's bridge choice. A bridge that is no longer installed must not block
    // startup: AION keeps its default and reports the real availability in Settings.
    try { this.ports.developerAgents.select(this.state.settings.developerBridgeId); } catch { this.ports.developerAgents.select(""); }
  }
  #recordMigration(state: AssistantStateV1, record: MigrationRecordV1 | null): void {
    if (!record) return;
    const moved = Object.entries(record.assigned).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`).join(", ");
    this.activity(state, "settings", "state.migrate", `Applied ${record.migration}: ${moved || "no records needed assignment"}. Everything without a workspace became ${record.defaultWorkspace}; nothing moved between workspaces.`, null);
  }
  /** The workspace new records join and the one the UI is showing. */
  private get workspace(): WorkspaceIdV1 { return this.state.settings.activeWorkspace ?? DEFAULT_WORKSPACE; }
  async snapshot(): Promise<AssistantStateV1> { await this.ready; return structuredClone(this.state); }
  private activity(state: AssistantStateV1, category: ActivityV1["category"], action: string, summary: string, subjectRef: string | null, outcome: ActivityV1["outcome"] = "success"): void {
    state.activity.unshift({ id: this.ports.ids.next("activity"), workspace: state.settings.activeWorkspace ?? DEFAULT_WORKSPACE, at: this.ports.clock.now(), category, action, summary, subjectRef, outcome });
    if (state.activity.length > 10_000) state.activity.length = 10_000;
  }
  /**
   * Applies the owner's retention and expiry policy on every write, so no separate sweeper can
   * drift from the persisted state. An approval that has passed its expiry can never be decided.
   */
  private prune(state: AssistantStateV1): void {
    const now = Date.parse(this.ports.clock.now());
    for (const approval of state.approvals) {
      if (approval.state !== "pending" || Date.parse(approval.expiresAt) > now) continue;
      approval.state = "expired"; approval.decidedAt = new Date(now).toISOString();
      const action = state.actions.find((item) => item.id === approval.actionId);
      if (action && (action.state === "awaiting-approval" || action.state === "approved")) { action.state = "cancelled"; action.updatedAt = approval.decidedAt; }
    }
    const groups = new Map<string, MemoryV1[]>();
    for (const memory of state.memories) {
      if (!memory.enabled) { memory.conflict = "none"; continue; }
      // Grouped inside a workspace: the same subject in Personal and Work is two separate
      // facts, not a conflict, and flagging them together would reveal a work record exists.
      const key = `${memory.workspace}\u0000${memory.category}\u0000${subjectKey(memory.content)}`;
      groups.set(key, [...(groups.get(key) ?? []), memory]);
    }
    for (const group of groups.values()) {
      const distinct = new Set(group.map((memory) => memory.content.trim().toLocaleLowerCase().replace(/\s+/gu, " ")));
      for (const memory of group) memory.conflict = distinct.size > 1 ? "conflicting" : "none";
    }
    pruneAccess(state, new Date(now).toISOString());
    const horizon = now - state.settings.privacy.retainActivityDays * 86_400_000;
    state.activity = state.activity.filter((entry) => Date.parse(entry.at) >= horizon);
    if (state.activity.length > 10_000) state.activity.length = 10_000;
  }
  private async mutate<T>(operation: (state: AssistantStateV1) => T | Promise<T>): Promise<T> {
    await this.ready; let result!: T; let failure: unknown;
    this.writeQueue = this.writeQueue.then(async () => {
      const expected = this.state.revision; const draft = structuredClone(this.state);
      try { result = await operation(draft); this.prune(draft); draft.revision = expected + 1; await this.ports.repository.save(expected, draft); this.state = draft; }
      catch (error) { failure = error; }
    });
    await this.writeQueue; if (failure) throw failure; return result;
  }
  async completeOnboarding(): Promise<void> { await this.mutate((state) => { state.onboardingComplete = true; this.activity(state, "settings", "onboarding.complete", "Local-first onboarding completed.", null); }); }
  async updateSettings(input: Partial<SettingsV1>): Promise<SettingsV1> {
    const saved = await this.mutate((state) => {
      const next = { ...state.settings, ...input, privacy: { ...state.settings.privacy, ...(input.privacy ?? {}) } };
      if (!this.ports.providers.some((provider) => provider.id === next.providerId)) throw new Error("Selected provider is not registered.");
      required(next.model, "Model identifier", 200);
      if (next.providerId !== "deterministic" && next.providerId.startsWith("remote") && !next.remoteDisclosureAccepted) throw new Error("Remote-provider disclosure must be accepted before selection.");
      if (next.credentialEnvironmentVariable && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(next.credentialEnvironmentVariable)) throw new Error("Credential environment-variable name is invalid.");
      if (typeof next.developerBridgeId !== "string") throw new Error("Developer-agent bridge selection is invalid.");
      const target = requireWorkspace(state.workspaces, next.activeWorkspace);
      if (target.archived) throw new Error("That workspace is archived. Reactivate it before switching to it.");
      next.remoteAccess = { ...state.settings.remoteAccess, ...(input.remoteAccess ?? {}) };
      next.remoteAccess.bindAddress = validateBindAddress(next.remoteAccess.bindAddress);
      if (typeof next.remoteAccess.enabled !== "boolean") throw new Error("Private phone access must be on or off.");
      if (!Number.isSafeInteger(next.remoteAccess.sessionDays) || next.remoteAccess.sessionDays < 1 || next.remoteAccess.sessionDays > 365) throw new Error("Session length must be between 1 and 365 days.");
      // Turning private access off ends every phone session immediately rather than merely
      // refusing new ones: a materially weakened access decision must fail closed at once.
      if (state.settings.remoteAccess.enabled && !next.remoteAccess.enabled) {
        const ended = revokeAllDevices(state, this.ports.clock.now());
        this.activity(state, "settings", "device.revoked.all", `Private phone access was turned off, ending ${ended.sessions} session(s). Owner data is untouched.`, null);
      }
      // Labels follow the registry: every workspace that exists has one, and a label for a
      // workspace that does not exist is refused rather than stored as an orphan.
      next.workspaceLabels = { ...state.settings.workspaceLabels, ...(input.workspaceLabels ?? {}) };
      for (const key of Object.keys(next.workspaceLabels)) requireWorkspace(state.workspaces, key);
      for (const workspace of state.workspaces) next.workspaceLabels[workspace.id] = required(next.workspaceLabels[workspace.id] ?? workspace.label, "Workspace label", 80);
      // A relabelled workspace keeps the registry and the label map saying the same thing.
      state.workspaces = state.workspaces.map((entry) => next.workspaceLabels[entry.id] === entry.label ? entry : { ...entry, label: next.workspaceLabels[entry.id]!, updatedAt: this.ports.clock.now() });
      if (next.developerBridgeId && !this.ports.developerAgents.get(next.developerBridgeId)) throw new Error("Selected developer-agent bridge is not registered.");
      next.importRoots = unique(next.importRoots, "Import roots").map((root) => required(root, "Import root", 500));
      if (next.exportRoot) required(next.exportRoot, "Export root", 500);
      if (!Number.isSafeInteger(next.privacy.retainActivityDays) || next.privacy.retainActivityDays < 1 || next.privacy.retainActivityDays > 3650) throw new Error("Activity retention is invalid.");
      state.settings = next; this.activity(state, "settings", "settings.update", "Local settings updated; no credential value stored.", null); return structuredClone(next);
    });
    this.ports.developerAgents.select(saved.developerBridgeId);
    return saved;
  }
  async providerHealth(): Promise<Array<{ id: string; location: "local" | "remote"; available: boolean; detail: string }>> {
    const results = []; for (const provider of this.ports.providers) results.push({ id: provider.id, location: provider.location, ...await provider.health() }); return results;
  }
  /** The selected bridge only, without probing any account: this runs on every ordinary state read. */
  async developerBridgeStatus(): Promise<DeveloperAgentStatusV1> { return this.ports.developerAgents.selected().status(); }
  /**
   * Every discovered bridge. `includeAccount` is an explicit owner request: it asks each installed
   * CLI whether an account is signed in, which is a local check and never a paid model call.
   */
  async developerBridgeInventory(includeAccount = false): Promise<Array<DeveloperAgentStatusV1 & { selected: boolean; commands: Array<{ mode: DeveloperAgentModeV1; executable: string; args: readonly string[] }> }>> {
    const results: Array<DeveloperAgentStatusV1 & { selected: boolean; commands: Array<{ mode: DeveloperAgentModeV1; executable: string; args: readonly string[] }> }> = [];
    const selectedId = this.ports.developerAgents.selected().id;
    for (const bridge of this.ports.developerAgents.list()) {
      const status = await bridge.status({ includeAccount });
      results.push({ ...status, selected: bridge.id === selectedId, commands: status.modes.map((mode) => ({ mode, ...bridge.describe(mode) })) });
    }
    if (includeAccount) {
      const signedIn = results.filter((entry) => entry.available && entry.account === "signed-in").length;
      await this.mutate((state) => { this.activity(state, "agent", "developer.health", `Developer-agent health checked locally: ${results.filter((entry) => entry.available).length} installed, ${signedIn} signed in. No account value was stored and no paid call was made.`, null); });
    }
    return results;
  }
  /** The complete registry the Agent Controller will honour. Nothing outside this list is callable. */
  capabilities(): Array<{ id: string; privacy: string; approval: string; timeoutMs: number; maxRetries: number }> {
    return this.ports.capabilities.list().map(({ id, privacy, approval, timeoutMs, maxRetries }) => ({ id, privacy, approval, timeoutMs, maxRetries }));
  }

  async createConversation(title = "New conversation"): Promise<ConversationV1> {
    return this.mutate((state) => {
      const at = this.ports.clock.now(); const conversation: ConversationV1 = { id: this.ports.ids.next("conversation"), workspace: state.settings.activeWorkspace, title: required(title, "Conversation title", 200), state: "active", memoryContextEnabled: state.settings.memoryContextEnabled, createdAt: at, updatedAt: at, messages: [] };
      state.conversations.unshift(conversation); this.activity(state, "chat", "conversation.create", "Conversation created.", conversation.id); return structuredClone(conversation);
    });
  }
  async updateConversation(id: string, change: { title?: string; state?: "active" | "archived"; memoryContextEnabled?: boolean }): Promise<void> {
    await this.mutate((state) => { const item = find(state.conversations, id, "Conversation"); if (change.title !== undefined) item.title = required(change.title, "Conversation title", 200); if (change.state !== undefined) item.state = change.state; if (change.memoryContextEnabled !== undefined) item.memoryContextEnabled = change.memoryContextEnabled; item.updatedAt = this.ports.clock.now(); this.activity(state, "chat", "conversation.update", "Conversation settings updated.", id); });
  }
  async deleteConversation(id: string): Promise<void> { await this.mutate((state) => { find(state.conversations, id, "Conversation"); state.conversations = state.conversations.filter((item) => item.id !== id); this.activity(state, "chat", "conversation.delete", "Conversation deleted.", id); }); }
  /**
   * Streams one provider turn. Chunks are yielded to the caller as they arrive; the assistant
   * message and any revalidated proposals are persisted once the turn completes.
   */
  async *streamMessage(conversationId: string, content: string): AsyncGenerator<string, ChatTurnV1, void> {
    const body = required(content, "Message", 100_000);
    await this.mutate((state) => { const conversation = find(state.conversations, conversationId, "Conversation"); const message: ChatMessageV1 = { id: this.ports.ids.next("message"), role: "owner", content: body, createdAt: this.ports.clock.now(), providerId: null }; conversation.messages.push(message); conversation.updatedAt = message.createdAt; this.activity(state, "chat", "message.owner", "Owner message stored locally.", conversationId); });
    const snap = await this.snapshot(); const conversation = find(snap.conversations, conversationId, "Conversation"); const provider = this.ports.providers.find((item) => item.id === snap.settings.providerId); if (!provider) throw new Error("Configured provider is unavailable.");
    if (provider.location === "remote" && !snap.settings.remoteDisclosureAccepted) throw new Error("Remote-provider disclosure is not accepted.");
    /*
     * Brain policy governs this turn, not just the Brain screen.
     *
     * The owner already chose a provider in Settings and that choice is respected, but offline
     * mode and Local Only are not preferences the chat path gets to ignore. Routing the explicit
     * choice through the same function the Brain screen uses is what stops a second, quieter
     * policy growing here.
     */
    const decision = this.#routeChat(snap, conversation, provider);
    if (!decision.allowed) throw new Error(decision.reason);
    if (decision.requiresDisclosure && decision.disclosure && !snap.settings.remoteDisclosureAccepted) {
      throw new Error(`${decision.disclosure.statement} Accept the remote-provider disclosure in Settings before this can run.`);
    }
    if (this.controllers.has(`chat:${conversationId}`)) throw new Error("This conversation already has a request in flight.");
    const controller = new AbortController(); this.controllers.set(`chat:${conversationId}`, controller); let response = "";
    try {
      // Memory context is scoped to the conversation's own workspace. Work material never reaches
      // a personal conversation, and personal material never reaches a work one.
      const memories = conversation.memoryContextEnabled ? snap.memories.filter((item) => item.enabled && item.workspace === conversation.workspace).slice(0, 20).map(({ id, content: memoryContent, category }) => ({ id, content: memoryContent, category })) : [];
      for await (const chunk of provider.stream({ conversationId, messages: conversation.messages, memoryContext: memories, model: snap.settings.model, signal: controller.signal })) {
        if (controller.signal.aborted) throw new Error("Chat request cancelled.");
        response += chunk; if (response.length > 100_000) throw new Error("Provider response exceeds the V1 size limit.");
        yield chunk;
      }
      const split = splitProviderProposals(response);
      const message = await this.mutate((state) => { const current = find(state.conversations, conversationId, "Conversation"); const stored: ChatMessageV1 = { id: this.ports.ids.next("message"), role: "assistant", content: required(split.body, "Provider response", 100_000), createdAt: this.ports.clock.now(), providerId: provider.id }; current.messages.push(stored); current.updatedAt = stored.createdAt; this.activity(state, "chat", "message.assistant", `${provider.location} provider response stored (${provider.id}).`, conversationId); if (split.malformed) this.activity(state, "failure", "proposal.discard", `${split.malformed} malformed provider proposal(s) discarded.`, conversationId, "failed"); return structuredClone(stored); });
      const proposedActions: AgentActionV1[] = []; const proposedMemories: MemoryV1[] = [];
      for (const proposal of split.actions) {
        try { proposedActions.push((await this.proposeAction(required(proposal.capabilityId, "Proposed capability", 200), proposal.input && typeof proposal.input === "object" && !Array.isArray(proposal.input) ? proposal.input as Record<string, unknown> : {}, { origin: "provider-proposal", conversationId })).action); }
        catch { await this.mutate((state) => { this.activity(state, "failure", "proposal.reject", "A provider action proposal failed validation and was rejected.", conversationId, "denied"); }); }
      }
      for (const proposal of split.memories) {
        try { proposedMemories.push(await this.createMemory({ content: required(proposal.content, "Proposed memory", 20_000), category: MEMORY_CATEGORIES.includes(proposal.category as MemoryV1["category"]) ? proposal.category as MemoryV1["category"] : "semantic", confirmation: "unconfirmed", sourceRef: `conversation:${conversationId}` })); }
        catch { await this.mutate((state) => { this.activity(state, "failure", "proposal.reject", "A provider memory proposal failed validation and was rejected.", conversationId, "denied"); }); }
      }
      return { message, proposedActions, proposedMemories };
    } catch (error) {
      await this.mutate((state) => { this.activity(state, "failure", "chat.failed", "Chat request failed or was cancelled; private content omitted.", conversationId, "failed"); }); throw error;
    } finally { this.controllers.delete(`chat:${conversationId}`); }
  }
  /**
   * The routing decision for one chat turn.
   *
   * A provider configured before the endpoint registry existed is represented as an endpoint from
   * what AION actually knows about it — its declared location — rather than being exempted from
   * policy for having been configured earlier.
   */
  #routeChat(state: AssistantStateV1, conversation: ConversationV1, provider: ModelProviderV1): RoutingDecisionV1 {
    const workspace = requireWorkspace(state.workspaces, conversation.workspace);
    const endpoint = state.brain.endpoints.find((entry) => entry.id === provider.id)
      ?? endpointForProvider(provider, state.settings.model, this.ports.clock.now());
    const memoryIncluded = conversation.memoryContextEnabled && state.memories.some((item) => item.enabled && item.workspace === conversation.workspace);
    return routeSelectedProvider(state.brain, endpoint, {
      workspace: workspace.id,
      workspaceLabel: workspace.label,
      needs: ["conversation"],
      includesMemory: memoryIncluded,
      includesWorkOrCustomerInformation: workspace.kind === "work",
      contextClasses: ["this conversation", ...(memoryIncluded ? ["enabled Memory records for this workspace"] : [])],
    });
  }
  /**
   * What would leave the machine if this conversation were continued right now. The Command Center
   * shows this before the owner types, so a disclosure is never something they meet mid-sentence.
   */
  async chatDisclosure(conversationId: string): Promise<RoutingDecisionV1> {
    const state = await this.snapshot();
    const conversation = find(state.conversations, conversationId, "Conversation");
    const provider = this.ports.providers.find((item) => item.id === state.settings.providerId);
    if (!provider) throw new Error("Configured provider is unavailable.");
    return this.#routeChat(state, conversation, provider);
  }
  async sendMessage(conversationId: string, content: string): Promise<ChatTurnV1> {
    const turn = this.streamMessage(conversationId, content);
    for (;;) { const step = await turn.next(); if (step.done) return step.value; }
  }
  cancelChat(conversationId: string): boolean { const controller = this.controllers.get(`chat:${conversationId}`); if (!controller) return false; controller.abort(); return true; }

  async createMemory(input: { content: string; category: MemoryV1["category"]; confirmation?: MemoryV1["confirmation"]; sourceRef?: string }): Promise<MemoryV1> {
    return this.mutate((state) => { const at = this.ports.clock.now(); const memory: MemoryV1 = { id: this.ports.ids.next("memory"), workspace: state.settings.activeWorkspace, content: required(input.content, "Memory", 20_000), category: input.category, confirmation: input.confirmation ?? "owner-confirmed", conflict: "none", enabled: true, createdAt: at, updatedAt: at, sourceTimestamp: at, provenance: { sourceType: input.confirmation === "unconfirmed" ? "provider-proposal" : "owner", sourceRef: required(input.sourceRef ?? "owner-entry", "Memory source", 500), recordedAt: at }, corrections: [] }; state.memories.unshift(memory); this.activity(state, "memory", "memory.create", `Memory ${memory.confirmation} created.`, memory.id); return structuredClone(memory); });
  }
  /** Search never crosses the workspace boundary; pass an explicit workspace to look elsewhere. */
  async searchMemories(query: string, workspace?: WorkspaceIdV1): Promise<MemoryV1[]> { const needle = required(query, "Memory query", 500).toLocaleLowerCase(); const state = await this.snapshot(); const scope = requireWorkspace(state.workspaces, workspace ?? state.settings.activeWorkspace).id; return state.memories.filter((item) => item.enabled && item.workspace === scope && `${item.category} ${item.content}`.toLocaleLowerCase().includes(needle)); }
  async correctMemory(id: string, content: string, reason: string): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); const next = required(content, "Memory correction", 20_000); const at = this.ports.clock.now(); item.corrections.push({ at, previousContent: item.content, correctedContent: next, reason: required(reason, "Correction reason", 500) }); item.content = next; item.confirmation = "owner-confirmed"; item.updatedAt = at; this.activity(state, "memory", "memory.correct", "Memory corrected with prior content preserved in history.", id); }); }
  async setMemoryEnabled(id: string, enabled: boolean): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); item.enabled = enabled; item.updatedAt = this.ports.clock.now(); this.activity(state, "memory", enabled ? "memory.enable" : "memory.disable", `Memory ${enabled ? "enabled" : "disabled"}.`, id); }); }
  async forgetMemory(id: string): Promise<void> { await this.mutate((state) => { find(state.memories, id, "Memory"); state.memories = state.memories.filter((item) => item.id !== id); this.activity(state, "memory", "memory.forget", "Memory content and correction history deleted.", id); }); }
  async acceptMemory(id: string): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); if (item.confirmation === "owner-confirmed") throw new Error("Memory is already owner-confirmed."); item.confirmation = "owner-confirmed"; item.updatedAt = this.ports.clock.now(); this.activity(state, "memory", "memory.accept", "Owner confirmed a previously unconfirmed memory.", id); }); }
  async exportMemories(): Promise<string> { const state = await this.snapshot(); return JSON.stringify({ version: "aion.memory-export.v1", exportedAt: this.ports.clock.now(), memories: state.memories }, null, 2); }
  /** Complete local export of everything AION holds, for owner portability and inspection. */
  async exportState(): Promise<string> { const state = await this.snapshot(); await this.mutate((draft) => { this.activity(draft, "export", "state.export", "Complete local state exported in plaintext at owner request.", null); }); return JSON.stringify({ version: "aion.local-export.v1", exportedAt: this.ports.clock.now(), state }, null, 2); }
  /**
   * Records that the owner ran one allow-listed Career command. Only the command name and outcome
   * are stored; no Career content, path, or document body enters ordinary activity history.
   */
  async recordCareerActivity(command: string, outcome: ActivityV1["outcome"], detail: string): Promise<void> {
    if (!CAREER_COMMANDS.includes(command)) throw new Error("Career command is not allow-listed.");
    await this.mutate((state) => { this.activity(state, "career", `career.${command}`, `Career ${command} ${outcome} via the accepted Career engine. ${required(detail, "Career detail", 300)}`, null, outcome); });
  }

  async createTask(input: { title: string; description?: string; priority?: TaskV1["priority"]; dueAt?: string | null; tags?: string[]; planId?: string | null; routineId?: string | null; provenance?: TaskV1["provenance"] }): Promise<TaskV1> {
    return this.mutate((state) => { const at = this.ports.clock.now(); const task: TaskV1 = { id: this.ports.ids.next("task"), workspace: state.settings.activeWorkspace, title: required(input.title, "Task title", 500), description: input.description ? required(input.description, "Task description", 10_000) : "", priority: input.priority ?? "normal", state: "ready", dueAt: iso(input.dueAt, "Task due date"), tags: unique(input.tags ?? [], "Task tags"), planId: input.planId ?? null, routineId: input.routineId ?? null, createdAt: at, completedAt: null, provenance: input.provenance ?? { sourceType: "owner", sourceRef: "owner-entry", recordedAt: at }, history: [{ at, actor: "owner", change: "created:ready" }] }; state.tasks.unshift(task); this.activity(state, "task", "task.create", "Task created.", task.id); return structuredClone(task); });
  }
  async updateTask(id: string, change: { title?: string; description?: string; priority?: TaskV1["priority"]; dueAt?: string | null; tags?: string[] }): Promise<void> { await this.mutate((state) => { const task = find(state.tasks, id, "Task"); if (change.title !== undefined) task.title = required(change.title, "Task title", 500); if (change.description !== undefined) task.description = change.description ? required(change.description, "Task description", 10_000) : ""; if (change.priority !== undefined) task.priority = change.priority; if (change.dueAt !== undefined) task.dueAt = iso(change.dueAt, "Task due date"); if (change.tags !== undefined) task.tags = unique(change.tags, "Task tags"); task.history.push({ at: this.ports.clock.now(), actor: "owner", change: "edited" }); this.activity(state, "task", "task.update", "Task updated.", id); }); }
  async transitionTask(id: string, next: TaskStateV1, reason = "owner transition"): Promise<void> { await this.mutate((state) => { const task = find(state.tasks, id, "Task"); if (!TASK_TRANSITIONS[task.state].includes(next)) throw new Error(`Task transition ${task.state} -> ${next} is invalid.`); const at = this.ports.clock.now(); task.state = next; task.completedAt = next === "completed" ? at : null; task.history.push({ at, actor: "owner", change: `${next}:${required(reason, "Task transition reason", 500)}` }); this.activity(state, "task", `task.${next}`, `Task moved to ${next}.`, id); }); }

  async createRoutine(input: { name: string; instructions: string; intervalMinutes: number; capabilityIds?: string[]; approvalPolicy?: RoutineV1["approvalPolicy"] }): Promise<RoutineV1> {
    return this.mutate((state) => { if (!Number.isSafeInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 525_600) throw new Error("Routine interval is invalid."); const at = this.ports.clock.now(); const capabilityIds = unique(input.capabilityIds ?? [], "Routine capabilities"); for (const id of capabilityIds) if (!this.ports.capabilities.get(id)) throw new Error("Routine requires an unknown capability."); const routine: RoutineV1 = { id: this.ports.ids.next("routine"), workspace: state.settings.activeWorkspace, name: required(input.name, "Routine name", 500), instructions: required(input.instructions, "Routine instructions", 10_000), enabled: true, intervalMinutes: input.intervalMinutes, nextRunAt: new Date(Date.parse(at) + input.intervalMinutes * 60_000).toISOString(), lastRunAt: null, capabilityIds, approvalPolicy: input.approvalPolicy ?? "capability-default", createdAt: at, history: [{ at, actor: "owner", change: "created:enabled" }] }; state.routines.unshift(routine); this.activity(state, "routine", "routine.create", "Routine created and scheduled while AION is running.", routine.id); return structuredClone(routine); });
  }
  async updateRoutine(id: string, change: { enabled?: boolean; intervalMinutes?: number }): Promise<void> { await this.mutate((state) => { const routine = find(state.routines, id, "Routine"); if (change.intervalMinutes !== undefined) { if (!Number.isSafeInteger(change.intervalMinutes) || change.intervalMinutes < 1 || change.intervalMinutes > 525_600) throw new Error("Routine interval is invalid."); routine.intervalMinutes = change.intervalMinutes; } if (change.enabled !== undefined) routine.enabled = change.enabled; const at = this.ports.clock.now(); routine.nextRunAt = routine.enabled ? new Date(Date.parse(at) + routine.intervalMinutes * 60_000).toISOString() : null; routine.history.push({ at, actor: "owner", change: `updated:${routine.enabled ? "enabled" : "disabled"}` }); this.activity(state, "routine", "routine.update", "Routine schedule updated.", id); }); }
  async runRoutine(id: string, reason: "manual" | "scheduled" = "manual"): Promise<void> { await this.mutate((state) => { const routine = find(state.routines, id, "Routine"); if (reason === "scheduled" && !routine.enabled) return; const at = this.ports.clock.now(); routine.lastRunAt = at; routine.nextRunAt = routine.enabled ? new Date(Date.parse(at) + routine.intervalMinutes * 60_000).toISOString() : null; routine.history.push({ at, actor: "aion", change: `run:${reason}` }); this.activity(state, "routine", "routine.run", `Routine ran locally (${reason}); ${routine.capabilityIds.length} capability proposal(s).`, id); }); }
  async tick(): Promise<number> { const state = await this.snapshot(); if (!state.settings.schedulerEnabled) return 0; const now = Date.parse(this.ports.clock.now()); const due = state.routines.filter((item) => item.enabled && item.nextRunAt && Date.parse(item.nextRunAt) <= now); for (const routine of due) await this.runRoutine(routine.id, "scheduled"); return due.length; }

  async createPlan(goal: string, steps: Array<{ title: string; description?: string; dependencies?: number[]; requiredCapabilities?: string[]; approvalRequired?: boolean; expectedOutput?: string }>): Promise<PlanV1> {
    return this.mutate((state) => { if (!steps.length || steps.length > 100) throw new Error("Plan requires 1-100 steps."); const planId = this.ports.ids.next("plan"); const stepIds = steps.map(() => this.ports.ids.next("plan-step")); const plan: PlanV1 = { id: planId, workspace: state.settings.activeWorkspace, goal: required(goal, "Plan goal", 2000), status: "proposed", createdAt: this.ports.clock.now(), provenance: { sourceType: "owner", sourceRef: "owner-plan", recordedAt: this.ports.clock.now() }, steps: steps.map((step, index) => { const dependencies = (step.dependencies ?? []).map((dependency) => { if (!Number.isSafeInteger(dependency) || dependency < 0 || dependency >= index) throw new Error("Plan dependencies must point to earlier steps."); return stepIds[dependency]!; }); const capabilities = unique(step.requiredCapabilities ?? [], "Plan capabilities"); for (const capability of capabilities) if (!this.ports.capabilities.get(capability)) throw new Error("Plan requires an unknown capability."); return { id: stepIds[index]!, order: index + 1, title: required(step.title, "Plan step title", 500), description: step.description ? required(step.description, "Plan step description", 5000) : "", dependencies, requiredCapabilities: capabilities, approvalRequired: step.approvalRequired ?? capabilities.some((id) => this.ports.capabilities.get(id)?.approval !== "never"), expectedOutput: required(step.expectedOutput ?? "Completed step", "Expected output", 1000), status: "proposed", blockedReason: null, taskId: null }; }) }; state.plans.unshift(plan); this.activity(state, "plan", "plan.create", "Reviewable plan proposal created; no execution authority granted.", plan.id, "pending"); return structuredClone(plan); });
  }
  async acceptPlan(id: string): Promise<void> { await this.mutate((state) => { const plan = find(state.plans, id, "Plan"); if (plan.status !== "proposed") throw new Error("Only proposed plans can be accepted."); plan.status = "accepted"; for (const step of plan.steps) step.status = "accepted"; this.activity(state, "plan", "plan.accept", "Plan accepted for reviewable task conversion.", id); }); }
  async convertPlanToTasks(id: string): Promise<TaskV1[]> { const snap = await this.snapshot(); const plan = find(snap.plans, id, "Plan"); if (plan.status !== "accepted") throw new Error("Plan must be accepted before task conversion."); const created: TaskV1[] = []; for (const step of plan.steps.filter((item) => !item.taskId)) created.push(await this.createTask({ title: step.title, description: step.description, planId: id, provenance: { sourceType: "plan", sourceRef: id, recordedAt: this.ports.clock.now() } })); await this.mutate((state) => { const current = find(state.plans, id, "Plan"); for (const [index, step] of current.steps.filter((item) => !item.taskId).entries()) { step.taskId = created[index]?.id ?? null; step.status = "converted"; } this.activity(state, "plan", "plan.convert", `${created.length} plan step(s) converted to Tasks.`, id); }); return created; }

  /**
   * Validates a proposal and, when policy requires it, opens exactly one approval bound to the
   * exact capability and input digest. Proposing never executes anything, and a provider-origin
   * proposal is treated identically to an owner one: it earns no extra authority.
   */
  async proposeAction(capabilityId: string, input: Record<string, unknown>, origin: { origin?: AgentActionV1["origin"]; conversationId?: string | null } = {}): Promise<{ action: AgentActionV1; approval: ApprovalV1 | null }> {
    return this.mutate((state) => { const capability = this.ports.capabilities.get(capabilityId); if (!capability) throw new Error("Capability is not registered."); capability.validate(input); const at = this.ports.clock.now(); const digest = digestValue({ capabilityId, input }); const needsApproval = capability.approval !== "never" || state.settings.externalActionsRequireApproval; const action: AgentActionV1 = { id: this.ports.ids.next("action"), capabilityId, conversationId: origin.conversationId ?? null, origin: origin.origin ?? "owner", input: structuredClone(input), inputDigest: digest, privacy: capability.privacy, state: needsApproval ? "awaiting-approval" : "validated", createdAt: at, updatedAt: at, retryCount: 0, maxRetries: capability.maxRetries, result: null, error: null }; state.actions.unshift(action); let approval: ApprovalV1 | null = null; if (needsApproval) { approval = { id: this.ports.ids.next("approval"), actionId: action.id, capabilityId, summary: capability.summarize(input), inputDigest: digest, state: "pending", requestedAt: at, expiresAt: new Date(Date.parse(at) + 60 * 60_000).toISOString(), decidedAt: null, result: null }; state.approvals.unshift(approval); } this.activity(state, "agent", "action.propose", `${action.origin} proposal validated for ${capabilityId}.`, action.id, needsApproval ? "pending" : "success"); return { action: structuredClone(action), approval: approval ? structuredClone(approval) : null }; });
  }
  async decideApproval(id: string, approve: boolean): Promise<void> { await this.mutate((state) => { const approval = find(state.approvals, id, "Approval"); if (approval.state !== "pending") throw new Error("Approval is no longer pending."); const action = find(state.actions, approval.actionId, "Agent action"); const at = this.ports.clock.now(); if (Date.parse(approval.expiresAt) <= Date.parse(at)) { approval.state = "expired"; action.state = "cancelled"; } else { approval.state = approve ? "approved" : "denied"; action.state = approve ? "approved" : "cancelled"; } approval.decidedAt = at; this.activity(state, "approval", approve ? "approval.approve" : "approval.deny", approve ? "Exact action approved once." : "Action denied.", approval.id, approve ? "success" : "denied"); }); }
  async executeAction(id: string): Promise<Record<string, unknown>> {
    const state = await this.snapshot(); const action = find(state.actions, id, "Agent action"); const capability = this.ports.capabilities.get(action.capabilityId); if (!capability) throw new Error("Capability is no longer registered."); const approval = state.approvals.find((item) => item.actionId === id);
    if (approval) { if (approval.state !== "approved" || approval.inputDigest !== action.inputDigest || digestValue({ capabilityId: action.capabilityId, input: action.input }) !== action.inputDigest) throw new Error("Exact one-shot approval is unavailable."); }
    else if (action.state !== "validated") throw new Error("Action is not executable.");
    const controller = new AbortController(); this.controllers.set(`action:${id}`, controller);
    await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = "running"; current.updatedAt = this.ports.clock.now(); if (approval) find(draft.approvals, approval.id, "Approval").state = "consumed"; this.activity(draft, "agent", "action.run", "Bounded capability execution started.", id, "pending"); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Capability timeout.")); }, capability.timeoutMs); });
      const result = await Promise.race([capability.execute(action.input, { clock: this.ports.clock, ids: this.ports.ids }, controller.signal), timeout]);
      await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = "succeeded"; current.updatedAt = this.ports.clock.now(); current.result = structuredClone(result); this.activity(draft, "agent", "action.succeed", "Bounded capability succeeded.", id); });
      // Evidence can only originate from a capability that actually ran. There is deliberately no
      // path for a caller to submit a verification record directly, so a result cannot be forged.
      if (action.capabilityId === VERIFICATION_CAPABILITY_ID) await this.#recordVerification(result as unknown as Omit<VerificationRunV1, "id">);
      return result;
    } catch (error) { await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = controller.signal.aborted ? "cancelled" : "failed"; current.updatedAt = this.ports.clock.now(); current.error = "Capability execution failed; private details omitted."; this.activity(draft, "failure", "action.fail", current.error, id, "failed"); }); throw error; }
    finally { if (timer) clearTimeout(timer); this.controllers.delete(`action:${id}`); }
  }
  cancelAction(id: string): boolean { const controller = this.controllers.get(`action:${id}`); if (!controller) return false; controller.abort(); return true; }

  async dryRunImport(platform: ImportReportV1["platform"], selectedRoot: string, selectedPath: string): Promise<ImportReportV1> {
    const state = await this.snapshot(); const known = state.imports.flatMap((report) => report.items.map((item) => item.digest).filter(Boolean)); const result = await this.ports.importer.dryRun({ platform, selectedRoot, selectedPath, knownDigests: known });
    return this.mutate((draft) => { const report: ImportReportV1 = { id: this.ports.ids.next("import"), platform, state: "dry-run", selectedRootRef: result.selectedRootRef, createdAt: this.ports.clock.now(), items: result.items, importedConversationIds: [], warnings: result.warnings }; draft.imports.unshift(report); this.activity(draft, "import", "import.dry-run", `Dry run inventoried ${report.items.length} file(s); no source changed.`, report.id); return structuredClone(report); });
  }
  async importConversations(reportId: string, selectedRoot: string, selectedPath: string): Promise<ImportReportV1> {
    const snap = await this.snapshot(); const prior = find(snap.imports, reportId, "Import report"); if (prior.state !== "dry-run" || prior.platform === "career") throw new Error("A conversation dry run is required."); const result = await this.ports.importer.dryRun({ platform: prior.platform, selectedRoot, selectedPath, knownDigests: snap.imports.filter((item) => item.id !== reportId).flatMap((item) => item.items.map((entry) => entry.digest).filter(Boolean)) }); if (digestValue(result.items) !== digestValue(prior.items)) throw new Error("Import source changed after dry run; run a new dry run.");
    return this.mutate((state) => { const report = find(state.imports, reportId, "Import report"); for (const imported of result.conversations) { const at = this.ports.clock.now(); const conversation: ConversationV1 = { id: this.ports.ids.next("conversation"), workspace: state.settings.activeWorkspace, title: required(imported.title, "Imported conversation title", 500), state: "archived", memoryContextEnabled: false, createdAt: at, updatedAt: at, messages: imported.messages.map((message) => ({ id: this.ports.ids.next("message"), role: message.role, content: required(message.content, "Imported message", 100_000), createdAt: message.at && !Number.isNaN(Date.parse(message.at)) ? new Date(message.at).toISOString() : at, providerId: `import:${prior.platform}` })) }; state.conversations.push(conversation); report.importedConversationIds.push(conversation.id); } report.state = "imported"; this.activity(state, "import", "import.complete", `${report.importedConversationIds.length} conversation(s) imported with provenance.`, report.id); return structuredClone(report); });
  }
  async cancelImport(reportId: string): Promise<void> { await this.mutate((state) => { const report = find(state.imports, reportId, "Import report"); if (report.state !== "dry-run") throw new Error("Only a dry run can be cancelled."); report.state = "cancelled"; this.activity(state, "import", "import.cancel", "Import cancelled before source mutation.", report.id); }); }
  /**
   * Persists the evidence from one allowlisted verification run. Called only by `executeAction`
   * after the capability itself produced the result, so recorded evidence always corresponds to a
   * command AION actually ran under an approval.
   */
  async #recordVerification(run: Omit<VerificationRunV1, "id">): Promise<VerificationRunV1> {
    return this.mutate((state) => {
      const record: VerificationRunV1 = { id: this.ports.ids.next("verification"), ...structuredClone(run) };
      state.verifications.unshift(record);
      if (state.verifications.length > 50) state.verifications.length = 50;
      this.activity(state, "agent", "verify.run", `Allowlisted verification ${record.operationId} ${record.outcome} (exit ${record.exitCode}) in ${record.durationMs} ms.`, record.id, record.outcome === "passed" ? "success" : "failed");
      return structuredClone(record);
    });
  }
  /**
   * Turns verification evidence into a read-only developer-agent proposal.
   *
   * The agent is given the evidence AION already captured, not permission to gather it. This is
   * the whole reason the verification capability exists: analysing a failing suite needs the
   * output, not a shell. The instruction is data on standard input and is still bounded, still
   * digest-bound, and still requires its own approval.
   */
  async proposeVerificationAnalysis(verificationId: string, question = "Explain what is failing and why."): Promise<{ action: AgentActionV1; approval: ApprovalV1 | null }> {
    const state = await this.snapshot();
    const run = find(state.verifications, verificationId, "Verification run");
    const instruction = [
      `Analyse the following verification evidence that AION captured by running an allowlisted, read-only command itself. You have no shell and no write access, and you do not need them.`,
      `Operation: ${run.operationId} (${run.displayCommand})`,
      `Outcome: ${run.outcome}; exit code ${run.exitCode}${run.timedOut ? "; timed out" : ""}; duration ${run.durationMs} ms.`,
      `Question: ${required(question, "Analysis question", 500)}`,
      run.truncated ? "The evidence below is truncated to its most recent output." : "",
      "--- evidence ---",
      salientEvidence(run),
    ].filter(Boolean).join("\n").slice(0, 4000);
    return this.proposeAction("aion.developer.task.v1", { instruction, mode: "read-only" }, { origin: "owner" });
  }
  // --- Workspaces -------------------------------------------------------------------------------
  /**
   * Creates a business or brand workspace.
   *
   * A new workspace starts genuinely empty. Nothing is copied into it from Personal, from Work, or
   * from another business, because a workspace that inherited someone else's records would defeat
   * the only property that makes workspaces worth having.
   */
  async createWorkspace(input: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const at = this.ports.clock.now();
      const workspace = buildWorkspace(input, { now: at, existing: state.workspaces });
      state.workspaces = [...state.workspaces, workspace];
      state.settings.workspaceLabels = { ...state.settings.workspaceLabels, [workspace.id]: workspace.label };
      this.activity(state, "settings", "workspace.create", `Created the ${workspace.kind} workspace "${workspace.label}". It starts empty; no record was copied into it from any other workspace.`, workspace.id);
      return structuredClone(workspace);
    });
  }
  async updateWorkspace(id: string, change: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const existing = requireWorkspace(state.workspaces, id);
      const updated = applyWorkspaceEdit(existing, change, this.ports.clock.now());
      state.workspaces = state.workspaces.map((entry) => entry.id === id ? updated : entry);
      state.settings.workspaceLabels = { ...state.settings.workspaceLabels, [updated.id]: updated.label };
      this.activity(state, "settings", "workspace.update", `Workspace "${updated.label}" updated.`, updated.id);
      return structuredClone(updated);
    });
  }
  /**
   * Archives a workspace. Its records stay exactly where they are: archiving hides a workspace
   * from the switcher, it does not move, merge, or delete anything inside it.
   */
  async setWorkspaceArchived(id: string, archived: boolean): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, id);
      if (workspace.builtIn) throw new Error("Personal and Work are always available and cannot be archived.");
      if (archived && state.settings.activeWorkspace === id) throw new Error("Switch to another workspace before archiving this one.");
      const updated = { ...workspace, archived, updatedAt: this.ports.clock.now() };
      state.workspaces = state.workspaces.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "settings", archived ? "workspace.archive" : "workspace.reactivate", `Workspace "${updated.label}" ${archived ? "archived" : "reactivated"}. Every record inside it is untouched.`, id);
      return structuredClone(updated);
    });
  }
  async addBrandProduct(workspaceId: string, input: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, workspaceId);
      if (workspace.kind !== "business" || !workspace.brand) throw new Error("Only a business or brand workspace holds products.");
      const product = buildBrandProduct(input, { id: this.ports.ids.next("product"), now: this.ports.clock.now() });
      if (workspace.brand.products.length >= 200) throw new Error("A brand may hold at most 200 products.");
      const updated: WorkspaceV1 = { ...workspace, updatedAt: this.ports.clock.now(), brand: { ...workspace.brand, products: [...workspace.brand.products, product] } };
      state.workspaces = state.workspaces.map((entry) => entry.id === workspaceId ? updated : entry);
      this.activity(state, "settings", "workspace.product", `Product "${product.name}" recorded for "${updated.label}".`, workspaceId);
      return structuredClone(updated);
    });
  }
  /** Every workspace, so the switcher can show them. Contains no record from inside any of them. */
  async workspaces(): Promise<WorkspaceV1[]> { return (await this.snapshot()).workspaces.map((entry) => structuredClone(entry)); }

  // --- Relationship Core --------------------------------------------------------------------
  /**
   * Relationship records belong to the workspace they were created in.
   *
   * Sales proved the shape in WORK, and the Sales-facing operations below still require WORK for
   * exactly the reason they always did: storing employer and customer material should be a
   * deliberate act rather than something that happens while thinking about personal life. The
   * general operations accept any workspace the owner is actually in, and neither path can read or
   * write a record belonging to a different one.
   */
  #requireWorkWorkspace(state: AssistantStateV1): void {
    if (state.settings.activeWorkspace !== "work") throw new Error("Customer records belong to the Work workspace. Switch to Work before creating or changing one.");
  }
  /** Scopes every relationship read to the active workspace. There is no cross-workspace read. */
  #scopedRelationships(state: AssistantStateV1): RelationshipV1[] {
    return state.relationships.filter((entry) => entry.workspace === state.settings.activeWorkspace);
  }
  #findRelationship(state: AssistantStateV1, id: string): RelationshipV1 {
    const found = find(state.relationships, id, "Relationship");
    assertSameWorkspace(found, state.settings.activeWorkspace, "relationship");
    return found;
  }
  /**
   * Creates a relationship in the active workspace, of the type the owner declared.
   *
   * This is the general entry point: a supplier for a side business, a professional contact, or a
   * support case are all this call with a different `relationshipType`. Nothing about it is
   * specific to selling, and it never copies a record from another workspace.
   */
  async createRelationship(input: Record<string, unknown> = {}): Promise<RelationshipV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const at = this.ports.clock.now();
      const id = this.ports.ids.next("relationship");
      // A relationship recorded while doing a job belongs to the employer unless the owner says
      // otherwise. Everywhere else the owner created it, so it is theirs.
      const relationship = buildRelationship(input, {
        id, reference: `relationship:${digestValue({ id }).slice(0, 16)}`, now: at, workspace: workspace.id,
        defaultOrigin: workspace.kind === "work" ? "employer-work" : "owner-created",
      });
      relationship.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: `Relationship opened as ${relationship.lifecycle}.`, detail: "", lifecycleAfter: relationship.lifecycle, actor: "owner" });
      state.relationships.unshift(relationship);
      this.activity(state, "task", "relationship.create", `${relationship.relationshipType} relationship recorded in "${workspace.label}" (${relationship.origin}). No identity, credit, or banking material is stored.`, relationship.id);
      return structuredClone(relationship);
    });
  }
  /** Relationship search inside the active workspace only. */
  async findRelationships(query: RelationshipQueryV1): Promise<RelationshipV1[]> {
    const state = await this.snapshot();
    return queryRelationships(this.#scopedRelationships(state), query, this.ports.clock.now());
  }
  async createCustomer(input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const at = this.ports.clock.now();
      const id = this.ports.ids.next("customer");
      const customer = buildCustomer(input, { id, reference: `customer:${digestValue({ id }).slice(0, 16)}`, now: at, workspace: "work", relationshipType: "customer", defaultOrigin: "employer-work" });
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: `Relationship opened as ${customer.lifecycle}.`, detail: "", lifecycleAfter: customer.lifecycle, actor: "owner" });
      state.relationships.unshift(customer);
      this.activity(state, "task", "customer.create", `Work relationship record created (${customer.origin}). No identity, credit, or banking material is stored.`, customer.id);
      return structuredClone(customer);
    });
  }
  async updateCustomer(id: string, change: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const existing = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const updated = applyCustomerEdit(existing, change, at);
      // History is never rewritten by an edit: the timeline and links are carried across intact.
      updated.interactions = existing.interactions;
      updated.appointments = existing.appointments;
      updated.followUps = existing.followUps;
      updated.taskIds = existing.taskIds; updated.routineIds = existing.routineIds; updated.planIds = existing.planIds;
      updated.outcome = existing.outcome; updated.lifecycle = existing.lifecycle; updated.archived = existing.archived;
      updated.lastContactAt = existing.lastContactAt; updated.createdAt = existing.createdAt; updated.provenance = existing.provenance;
      state.relationships = state.relationships.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "task", "customer.update", "Work relationship record edited; the timeline was preserved.", id);
      return structuredClone(updated);
    });
  }
  /** Appends to the timeline. An interaction is never edited or removed once recorded. */
  async recordCustomerInteraction(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const interaction = buildInteraction(input, { id: this.ports.ids.next("interaction"), now: at });
      customer.interactions.push(interaction);
      if (["call", "text", "email", "visit", "appointment"].includes(interaction.kind)) customer.lastContactAt = interaction.at;
      if (interaction.lifecycleAfter) customer.lifecycle = interaction.lifecycleAfter;
      customer.updatedAt = at;
      this.activity(state, "task", "customer.interaction", `Relationship timeline appended (${interaction.kind}).`, id);
      return structuredClone(customer);
    });
  }
  /** Moves the relationship on and records why, keeping every earlier state in the timeline. */
  async setCustomerLifecycle(id: string, lifecycle: string, summary = "Owner updated the relationship state."): Promise<CustomerV1> {
    return this.recordCustomerInteraction(id, { kind: "lifecycle", summary, lifecycleAfter: lifecycle });
  }
  async addCustomerAppointment(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const appointment = buildAppointment(input, { id: this.ports.ids.next("appointment"), now: at });
      customer.appointments.push(appointment);
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "appointment", summary: `${appointment.kind} scheduled for ${appointment.at}.`, detail: appointment.notes, lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.appointment", `${appointment.kind} recorded for a work relationship.`, id);
      return structuredClone(customer);
    });
  }
  async setCustomerAppointmentStatus(id: string, appointmentId: string, status: string): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const appointment = find(customer.appointments, appointmentId, "Appointment");
      const allowed = ["scheduled", "confirmed", "shown", "no-show", "rescheduled", "cancelled"];
      if (!allowed.includes(status)) throw new Error(`Appointment status must be one of: ${allowed.join(", ")}.`);
      const at = this.ports.clock.now();
      appointment.status = status as CustomerAppointmentV1["status"];
      if (status === "shown") customer.lastContactAt = at;
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "appointment", summary: `Appointment marked ${status}.`, detail: "", lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.appointment.status", `Appointment marked ${status}.`, id);
      return structuredClone(customer);
    });
  }
  async addCustomerFollowUp(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const followUp = buildFollowUp(input, { id: this.ports.ids.next("follow-up"), now: at });
      customer.followUps.push(followUp);
      customer.nextAction = customer.nextAction || followUp.reason;
      customer.nextActionAt = customer.nextActionAt ?? followUp.dueAt;
      customer.updatedAt = at;
      this.activity(state, "task", "customer.follow-up", "Follow-up scheduled for a work relationship.", id);
      return structuredClone(customer);
    });
  }
  async completeCustomerFollowUp(id: string, followUpId: string, outcome = "", status: "done" | "skipped" = "done"): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const followUp = find(customer.followUps, followUpId, "Follow-up");
      if (followUp.status !== "open") throw new Error("Follow-up is no longer open.");
      const at = this.ports.clock.now();
      followUp.status = status; followUp.completedAt = at; followUp.outcome = outcome.slice(0, 2000);
      if (status === "done") customer.lastContactAt = at;
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "follow-up", summary: `Follow-up ${status}.`, detail: followUp.outcome, lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.follow-up.close", `Follow-up ${status}.`, id);
      return structuredClone(customer);
    });
  }
  async setCustomerOutcome(id: string, outcome: "open" | "sold" | "lost", detail = ""): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      if (!["open", "sold", "lost"].includes(outcome)) throw new Error("Outcome must be open, sold, or lost.");
      const at = this.ports.clock.now();
      customer.outcome = { state: outcome, at: outcome === "open" ? null : at, detail: detail.slice(0, 2000) };
      if (outcome !== "open") customer.lifecycle = outcome === "sold" ? "sold" : "lost";
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "outcome", summary: `Outcome recorded: ${outcome}.`, detail: customer.outcome.detail, lifecycleAfter: customer.lifecycle, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.outcome", `Relationship outcome recorded: ${outcome}.`, id);
      return structuredClone(customer);
    });
  }
  /** Archiving hides a relationship from day-to-day views. It never deletes the timeline. */
  async setCustomerArchived(id: string, archived: boolean): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      customer.archived = archived; customer.updatedAt = at;
      if (archived && customer.lifecycle !== "sold" && customer.lifecycle !== "lost") customer.lifecycle = "inactive";
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: archived ? "Relationship archived; history retained." : "Relationship reactivated.", detail: "", lifecycleAfter: customer.lifecycle, actor: "owner" });
      this.activity(state, "task", archived ? "customer.archive" : "customer.reactivate", archived ? "Work relationship archived; nothing was deleted." : "Work relationship reactivated.", id);
      return structuredClone(customer);
    });
  }
  async linkCustomerTask(id: string, taskId: string): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const task = find(state.tasks, taskId, "Task");
      if (task.workspace !== "work") throw new Error("Only a Work task can be linked to a work relationship.");
      if (!customer.taskIds.includes(taskId)) customer.taskIds.push(taskId);
      customer.updatedAt = this.ports.clock.now();
      this.activity(state, "task", "customer.link.task", "Task linked to a work relationship.", id);
      return structuredClone(customer);
    });
  }
  /** Sales relationship search. Work-scoped by construction, as it has always been. */
  async findCustomers(query: CustomerQueryV1): Promise<CustomerV1[]> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Relationship search is only available in the Work workspace.");
    return queryCustomers(this.#scopedRelationships(state), query, this.ports.clock.now());
  }
  async customerTimeline(id: string): Promise<{ customer: CustomerV1; last: CustomerInteractionV1 | null; nextAction: { action: string; at: IsoTimestamp | null } }> {
    const state = await this.snapshot();
    const customer = this.#findRelationship(state, id);
    return { customer, last: lastInteraction(customer), nextAction: { action: customer.nextAction, at: customer.nextActionAt } };
  }

  // --- Product Studio ---------------------------------------------------------------------------
  /**
   * Product Studio operations are workspace-scoped like everything else, and every one of them
   * refuses to invent market evidence. AION can hold a hypothesis and score how well supported an
   * opportunity is; it cannot tell the owner what customers want, and does not pretend to.
   */
  #findOpportunity(state: AssistantStateV1, id: string): OpportunityV1 {
    const found = find(state.opportunities, id, "Opportunity");
    assertSameWorkspace(found, state.settings.activeWorkspace, "opportunity");
    return found;
  }
  #replaceOpportunity(state: AssistantStateV1, updated: OpportunityV1): OpportunityV1 {
    state.opportunities = state.opportunities.map((entry) => entry.id === updated.id ? updated : entry);
    return structuredClone(updated);
  }
  async createOpportunity(input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      if (state.opportunities.length >= 500) throw new Error("AION holds at most 500 opportunities.");
      const opportunity = buildOpportunity(input, { id: this.ports.ids.next("opportunity"), workspace: workspace.id, now: this.ports.clock.now() });
      state.opportunities.unshift(opportunity);
      this.activity(state, "plan", "opportunity.create", `Opportunity "${opportunity.title}" opened in "${workspace.label}". It scores zero until something is actually established about it.`, opportunity.id);
      return structuredClone(opportunity);
    });
  }
  async updateOpportunity(id: string, change: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const updated = applyOpportunityEdit(this.#findOpportunity(state, id), change, this.ports.clock.now());
      this.activity(state, "plan", "opportunity.update", `Opportunity "${updated.title}" updated.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /**
   * Records something known, assumed, or guessed about an opportunity.
   *
   * The class is required and is enforced by `knowledge.ts`: a model cannot record a fact, and a
   * class that only means something with a citation cannot be recorded without one.
   */
  async addOpportunityClaim(id: string, input: Record<string, unknown> = {}, actor: "owner" | "provider-proposal" | "research" = "owner"): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      if (opportunity.claims.length >= 500) throw new Error("An opportunity holds at most 500 claims.");
      const claim = buildClaim(input, {
        id: this.ports.ids.next("claim"), workspace: opportunity.workspace, now: this.ports.clock.now(),
        actor, sourceRef: actor === "owner" ? "owner-entry" : `${actor}:${id}`,
      });
      const updated = { ...structuredClone(opportunity), claims: [...opportunity.claims, claim], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim", `Recorded a ${claim.class} on "${opportunity.title}". Its class is stored, so a guess cannot later be quoted as a finding.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /** Owner-only. Promotion is the moment a belief changes, and it is recorded as such. */
  async promoteOpportunityClaim(id: string, claimId: string, to: string, reason: string): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const claim = find(opportunity.claims, claimId, "Claim");
      const promoted = promoteClaim(claim, to, reason, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), claims: opportunity.claims.map((entry) => entry.id === claimId ? promoted : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim.promote", `You promoted a ${claim.class} to a ${promoted.class} on "${opportunity.title}". The previous class stays in its history.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async supersedeOpportunityClaim(id: string, claimId: string, replacementId: string | null = null): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const claim = find(opportunity.claims, claimId, "Claim");
      const superseded = supersedeClaim(claim, replacementId, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), claims: opportunity.claims.map((entry) => entry.id === claimId ? superseded : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim.supersede", "A claim is no longer believed. It is kept, disabled, and pointed at whatever replaced it.", id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async addCompetitorNote(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const note = buildCompetitorNote(input, { id: this.ports.ids.next("competitor"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(opportunity), competitors: [...opportunity.competitors, note], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.competitor", `Competitor note recorded (${note.sourceRef}). AION did not look this up.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async addExperiment(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const experiment = buildExperiment(input, { id: this.ports.ids.next("experiment"), now: this.ports.clock.now() });
      if (experiment.hypothesisId) find(opportunity.claims, experiment.hypothesisId, "Hypothesis");
      const updated = { ...structuredClone(opportunity), experiments: [...opportunity.experiments, experiment], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.experiment", `Experiment "${experiment.title}" proposed with its success criteria written down first.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async completeExperiment(id: string, experimentId: string, status: string, result = ""): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const experiment = find(opportunity.experiments, experimentId, "Experiment");
      const completed = completeExperiment(experiment, status, result, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), experiments: opportunity.experiments.map((entry) => entry.id === experimentId ? completed : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.experiment.result", `Experiment "${experiment.title}" recorded as ${completed.status}. A refuted result counts the same as a supported one.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async setOpportunitySpecification(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const updated = { ...structuredClone(opportunity), specification: buildSpecification(input, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.specify", `Specification written for "${opportunity.title}".`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /** The honest read: the score, the arithmetic behind it, and what is still only assumed. */
  async assessOpportunity(id: string): Promise<ReturnType<typeof opportunityAssessment> & { opportunity: OpportunityV1 }> {
    const state = await this.snapshot();
    const opportunity = this.#findOpportunity(state, id);
    return { ...opportunityAssessment(opportunity), opportunity };
  }
  async opportunities(): Promise<OpportunityV1[]> {
    const state = await this.snapshot();
    return state.opportunities.filter((entry) => entry.workspace === state.settings.activeWorkspace).map((entry) => structuredClone(entry));
  }

  // --- The brain: endpoints, routing policy, and evidence ---------------------------------------
  /**
   * Adds an inference endpoint the owner controls, or a third-party one they have decided to use.
   *
   * AION never discovers an endpoint and adds it silently. Detection reports what is listening at
   * a documented loopback address; turning that into a configured endpoint is an owner act.
   */
  async addBrainEndpoint(input: Record<string, unknown> = {}): Promise<BrainEndpointV1> {
    return this.mutate((state) => {
      const endpoint = buildEndpoint(input, { id: this.ports.ids.next("endpoint"), now: this.ports.clock.now(), existing: state.brain.endpoints });
      state.brain.endpoints = [...state.brain.endpoints, endpoint];
      this.activity(state, "provider", "brain.endpoint.add", `Endpoint "${endpoint.label}" added: ${endpoint.runtime} at ${endpoint.location === "local-machine" ? "this computer" : endpoint.location === "owner-controlled-host" ? `a host you control (${endpoint.hostLabel || "unlabelled"})` : "a third-party service"}, model ${endpoint.model}.${endpoint.credentialEnvironmentVariable ? ` A credential is read from ${endpoint.credentialEnvironmentVariable}; its value is never stored.` : ""}`, endpoint.id);
      return structuredClone(endpoint);
    });
  }
  async removeBrainEndpoint(id: string): Promise<void> {
    await this.mutate((state) => {
      if (id === OFFLINE_ENDPOINT_ID) throw new Error("The offline provider is AION's floor and cannot be removed. It is what keeps AION usable with every credential deleted.");
      const endpoint = find(state.brain.endpoints, id, "Endpoint");
      state.brain.endpoints = state.brain.endpoints.filter((entry) => entry.id !== id);
      if (state.brain.primaryEndpointId === id) state.brain.primaryEndpointId = OFFLINE_ENDPOINT_ID;
      if (state.brain.manualEndpointId === id) state.brain.manualEndpointId = "";
      this.activity(state, "provider", "brain.endpoint.remove", `Endpoint "${endpoint.label}" removed. Nothing AION knows was affected: a model is a reasoning provider, not where your information lives.`, id);
    });
  }
  /**
   * Changes routing policy. The two rules that make the policy worth having are enforced on the
   * way in: an endpoint that does not exist cannot be made primary, and turning on remote
   * proprietary fallback is recorded as the deliberate decision it is.
   */
  async updateBrainSettings(change: Record<string, unknown> = {}): Promise<BrainSettingsV1> {
    return this.mutate((state) => {
      const next: BrainSettingsV1 = structuredClone(state.brain);
      if (change.mode !== undefined) {
        if (!ROUTER_MODES.includes(change.mode as RouterModeV1)) throw new Error(`Routing mode must be one of: ${ROUTER_MODES.join(", ")}.`);
        next.mode = change.mode as RouterModeV1;
      }
      for (const key of ["primaryEndpointId", "manualEndpointId"] as const) {
        if (change[key] === undefined) continue;
        const id = String(change[key] ?? "");
        if (id) find(next.endpoints, id, "Endpoint");
        next[key] = id;
      }
      if (change.offlineMode !== undefined) next.offlineMode = change.offlineMode === true;
      if (change.remoteFallbackEnabled !== undefined) next.remoteFallbackEnabled = change.remoteFallbackEnabled === true;
      if (next.mode === "manual" && !next.manualEndpointId) throw new Error("Manual mode needs an endpoint. AION will not choose one for you.");
      state.brain = next;
      this.activity(state, "provider", "brain.settings", `Brain policy: ${next.mode}${next.offlineMode ? ", offline mode on — no inference leaves this computer" : ""}. Remote proprietary fallback is ${next.remoteFallbackEnabled ? "ON, so AION may propose a third-party endpoint when nothing you control can do the work" : "off, so AION will not propose a third-party endpoint on its own"}.`, null);
      return structuredClone(next);
    });
  }
  /** Records what a probe found. Health is evidence, so it is stored rather than recomputed. */
  async recordEndpointHealth(id: string, health: BrainHealthV1): Promise<BrainEndpointV1> {
    return this.mutate((state) => {
      const endpoint = find(state.brain.endpoints, id, "Endpoint");
      endpoint.lastHealth = structuredClone(health);
      this.activity(state, "provider", "brain.health", `Endpoint "${endpoint.label}" is ${health.available ? "reachable" : "not reachable"}: ${health.detail}${health.installedModels.length ? ` Models reported: ${health.installedModels.slice(0, 10).join(", ")}.` : ""}`, id, health.available ? "success" : "failed");
      return structuredClone(endpoint);
    });
  }
  async brainSettings(): Promise<BrainSettingsV1> { return structuredClone((await this.snapshot()).brain); }
  /** Where a piece of work would run, and what would leave the machine if it did. */
  async routeBrain(request: Omit<RoutingRequestV1, "workspaceLabel">): Promise<RoutingDecisionV1> {
    const state = await this.snapshot();
    const workspace = requireWorkspace(state.workspaces, request.workspace || state.settings.activeWorkspace);
    return routeRequest(state.brain, { ...request, workspace: workspace.id, workspaceLabel: workspace.label });
  }
  /** The acceptance criterion answered against the real configuration, not against an intention. */
  async independence(): Promise<ReturnType<typeof independenceReport>> { return independenceReport((await this.snapshot()).brain); }

  /**
   * Records one evaluation run.
   *
   * The harness is deterministic and its fixtures are synthetic, so a run is reproducible and safe
   * to send to a third-party endpoint. Results are evidence about a configuration on a day, and the
   * summary says exactly that rather than implying something about the model in general.
   */
  async recordEvaluation(endpointId: string, results: readonly EvaluationCaseResultV1[], startedAt: string): Promise<EvaluationRunV1> {
    return this.mutate((state) => {
      const endpoint = find(state.brain.endpoints, endpointId, "Endpoint");
      const run = summariseEvaluation(results, {
        id: this.ports.ids.next("evaluation"), endpointId, endpointLabel: endpoint.label, model: endpoint.model,
        startedAt, completedAt: this.ports.clock.now(),
      });
      state.evaluations.unshift(run);
      if (state.evaluations.length > 50) state.evaluations.length = 50;
      this.activity(state, "provider", "brain.evaluate", run.summary, run.id, run.passed === run.total ? "success" : "failed");
      return structuredClone(run);
    });
  }
  async evaluations(): Promise<EvaluationRunV1[]> { return (await this.snapshot()).evaluations.map((entry) => structuredClone(entry)); }
  /** The most recent run per endpoint, ranked on the evidence rather than on vendor claims. */
  async modelComparison(): Promise<ReturnType<typeof compareEvaluations>> {
    const state = await this.snapshot();
    const latest = new Map<string, EvaluationRunV1>();
    for (const run of state.evaluations) if (!latest.has(run.endpointId)) latest.set(run.endpointId, run);
    return compareEvaluations([...latest.values()]);
  }
  evaluationSuite(): readonly EvaluationCaseV1[] { return EVALUATION_SUITE; }
  /** What AION owns and what a model does not. Stated as data so the UI cannot drift from it. */
  brainBoundary(): typeof BRAIN_BOUNDARY { return BRAIN_BOUNDARY; }

  // --- Learning ---------------------------------------------------------------------------------
  /**
   * Records a lesson.
   *
   * The claim rules apply unchanged: a model proposing a lesson produces a hypothesis or an
   * inference, never a learned strategy, and only the owner promotes it. That is the difference
   * between AION learning and AION being talked into believing something.
   */
  async recordLesson(input: Record<string, unknown> = {}, actor: "owner" | "provider-proposal" | "routine" = "owner"): Promise<LessonV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const claim = buildClaim(
        { class: input.class ?? (actor === "owner" ? "learned-strategy" : "hypothesis"), statement: input.statement, confidence: input.confidence, supportedBy: input.supportedBy },
        { id: this.ports.ids.next("claim"), workspace: workspace.id, now: this.ports.clock.now(), actor, sourceRef: actor === "owner" ? "owner-entry" : `${actor}:lesson` },
      );
      assertLessonClaimClass(claim);
      const lesson = buildLesson(input, { id: this.ports.ids.next("lesson"), claim, now: this.ports.clock.now() });
      state.lessons.unshift(lesson);
      if (state.lessons.length > 2000) state.lessons.length = 2000;
      this.activity(state, "memory", "lesson.record", `Recorded a ${claim.class} lesson in "${workspace.label}". Its class travels with it, so a suggestion is never quoted as settled practice.`, lesson.id);
      return structuredClone(lesson);
    });
  }
  /** Owner-only promotion, using the same path and the same history as any other claim. */
  async promoteLesson(id: string, to: string, reason: string): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const promoted = { ...structuredClone(lesson), claim: promoteClaim(lesson.claim, to, reason, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      state.lessons = state.lessons.map((entry) => entry.id === id ? promoted : entry);
      this.activity(state, "memory", "lesson.promote", `You promoted a lesson from ${lesson.claim.class} to ${promoted.claim.class}.`, id);
      return structuredClone(promoted);
    });
  }
  /** Records what happened when a lesson was followed. "Did not work" counts the same as "worked". */
  async recordLessonOutcome(id: string, input: Record<string, unknown> = {}): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const updated = recordLessonOutcome(lesson, input, this.ports.clock.now());
      state.lessons = state.lessons.map((entry) => entry.id === id ? updated : entry);
      const standing = lessonStanding(updated);
      this.activity(state, "memory", "lesson.outcome", `Outcome recorded. ${standing.summary}`, id, standing.stillRecommended ? "success" : "denied");
      return structuredClone(updated);
    });
  }
  async setLessonEnabled(id: string, enabled: boolean): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const updated = { ...structuredClone(lesson), enabled, updatedAt: this.ports.clock.now() };
      state.lessons = state.lessons.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "memory", enabled ? "lesson.enable" : "lesson.disable", enabled ? "Lesson re-enabled." : "Lesson turned off. It is kept so the history is intact.", id);
      return structuredClone(updated);
    });
  }
  /** The lessons AION would actually offer here, ordered by track record rather than by age. */
  async lessons(scope: { kind?: LessonScopeV1; subjectRef?: string } = {}): Promise<Array<LessonV1 & { standing: LessonStandingV1 }>> {
    const state = await this.snapshot();
    return applicableLessons(state.lessons, { workspace: state.settings.activeWorkspace, ...scope });
  }
  async learningSummary(): Promise<ReturnType<typeof learningSummary>> {
    const state = await this.snapshot();
    return learningSummary(state.lessons.filter((entry) => entry.workspace === state.settings.activeWorkspace));
  }
  /** The declared, unimplemented adaptation boundary. Stated as data so a change has to argue with it. */
  adaptationBoundary(): typeof ADAPTATION_BOUNDARY { return ADAPTATION_BOUNDARY; }

  // --- Development projects ----------------------------------------------------------------------
  #findProject(state: AssistantStateV1, id: string): DevelopmentProjectV1 {
    const found = find(state.projects, id, "Project");
    assertSameWorkspace(found, state.settings.activeWorkspace, "project");
    return found;
  }
  #replaceProject(state: AssistantStateV1, updated: DevelopmentProjectV1): DevelopmentProjectV1 {
    state.projects = state.projects.map((entry) => entry.id === updated.id ? updated : entry);
    return structuredClone(updated);
  }
  async createProject(input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      if (state.projects.length >= 200) throw new Error("AION holds at most 200 projects.");
      if (input.opportunityId) assertSameWorkspace(find(state.opportunities, String(input.opportunityId), "Opportunity"), workspace.id, "opportunity");
      const project = buildProject(input, { id: this.ports.ids.next("project"), workspace: workspace.id, now: this.ports.clock.now() });
      state.projects.unshift(project);
      this.activity(state, "plan", "project.create", `Project "${project.title}" opened in "${workspace.label}" at the idea stage.`, project.id);
      return structuredClone(project);
    });
  }
  async setProjectSpecification(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = { ...structuredClone(project), specification: buildProjectSpecification(input, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.specify", `Specification written for "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  async setProjectPlan(id: string, steps: readonly string[]): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const cleaned = (steps ?? []).map((step) => required(step, "Plan step", 2000));
      if (!cleaned.length || cleaned.length > 100) throw new Error("A project plan needs between 1 and 100 steps.");
      const updated = { ...structuredClone(project), planSteps: cleaned, updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.plan", `${cleaned.length} plan step(s) recorded for "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /**
   * Records a developer-agent proposal against a project. It grants nothing: running it still goes
   * through the ordinary capability, digest, and one-shot approval machinery.
   */
  async recordAgentProposal(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const proposal = buildAgentProposal({ bridgeId: this.ports.developerAgents.selected().id, ...input }, { id: this.ports.ids.next("proposal"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(project), proposals: [...project.proposals, proposal], updatedAt: this.ports.clock.now() };
      this.activity(state, "agent", "project.proposal", `${proposal.bridgeId} proposed a ${proposal.mode} change to "${project.title}". It grants nothing; running it still needs its own approval.`, id, "pending");
      return this.#replaceProject(state, updated);
    });
  }
  /** Attaches evidence from an allowlisted verification run that actually happened. */
  async attachProjectVerification(id: string, verificationId: string): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      find(state.verifications, verificationId, "Verification run");
      const updated = { ...structuredClone(project), verificationIds: project.verificationIds.includes(verificationId) ? project.verificationIds : [...project.verificationIds, verificationId], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.verification", `Verification evidence attached to "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /** Runs one pipeline step, chosen from a closed set. Nothing here accepts a command. */
  async runProjectStep(id: string, step: string): Promise<DevelopmentProjectV1> {
    const pipeline = this.ports.pipeline;
    if (!pipeline) throw new Error("No build pipeline is configured, so AION cannot build or preview anything.");
    if (!PIPELINE_STEPS.includes(step as PipelineStepV1)) throw new Error(`A pipeline step must be one of: ${PIPELINE_STEPS.join(", ")}.`);
    const snapshot = await this.snapshot();
    const project = this.#findProject(snapshot, id);
    const controller = new AbortController();
    this.controllers.set(`pipeline:${id}`, controller);
    try {
      const run = await pipeline.run(step as PipelineStepV1, { id: project.id, title: project.title }, controller.signal);
      return await this.mutate((state) => {
        const current = this.#findProject(state, id);
        const record: PipelineRunV1 = { id: this.ports.ids.next("pipeline-run"), step: step as PipelineStepV1, ...run };
        const updated = { ...structuredClone(current), runs: [...current.runs, record].slice(-100), updatedAt: this.ports.clock.now() };
        this.activity(state, "plan", "project.pipeline", `Pipeline step "${step}" ${record.outcome} for "${current.title}".${record.previewUrl ? ` Preview at ${record.previewUrl}, reachable from this computer only.` : ""}`, id, record.outcome === "passed" ? "success" : "failed");
        return this.#replaceProject(state, updated);
      });
    } finally { this.controllers.delete(`pipeline:${id}`); }
  }
  /** Owner-only, and for one exact stage. There is no actor parameter because there is no choice. */
  async approveProjectStage(id: string, stage: string, note = ""): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = approveProjectStage(project, stage, note, this.ports.clock.now());
      this.activity(state, "approval", "project.approve", `You approved the "${stage}" stage of "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  async advanceProject(id: string, stage: string, reason: string): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = advanceProject(project, stage, reason, this.ports.clock.now());
      this.activity(state, "plan", "project.stage", `"${project.title}" moved from ${project.stage} to ${updated.stage}.`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /**
   * Prepares a deployment. This writes down what would happen; it does not create the ability to
   * do it, and `advanceProject` still refuses the deployed stage.
   */
  async prepareDeployment(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const deployment = buildDeploymentProposal(input, { id: this.ports.ids.next("deployment"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(project), deployment, updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.deployment", `A deployment to ${deployment.target} was written down for "${project.title}". AION cannot carry it out: no capability in this milestone performs a deployment.`, id, "pending");
      return this.#replaceProject(state, updated);
    });
  }
  async projects(): Promise<Array<DevelopmentProjectV1 & { standing: string }>> {
    const state = await this.snapshot();
    return state.projects
      .filter((entry) => entry.workspace === state.settings.activeWorkspace)
      .map((entry) => ({ ...structuredClone(entry), standing: projectStanding(entry) }));
  }

  // --- The command router ------------------------------------------------------------------------
  /**
   * Turns one ordinary sentence into typed proposals.
   *
   * Nothing is executed and nothing is created. The result is what AION believes was meant, in a
   * form the owner can check before any of it happens — and the safety assertion runs on the way
   * out, so a payload that somehow carried shell-shaped text never reaches a caller.
   */
  async route(sentence: string): Promise<RoutingResultV1> {
    const state = await this.snapshot();
    const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
    const result = routeCommand(required(sentence, "Message", 4000), {
      workspaceLabel: workspace.label,
      workspaces: state.workspaces.filter((entry) => !entry.archived).map(({ id, label }) => ({ id, label })),
    });
    assertNoExecutableText(result);
    return result;
  }

  // --- Governed research ------------------------------------------------------------------------
  /**
   * Proposes a research job. Proposing runs nothing: the job records the question, the scope, the
   * limits and the sources the owner supplied, and then waits for an approval like any other
   * consequential action.
   */
  async proposeResearchJob(input: Record<string, unknown> = {}): Promise<ResearchJobV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const job = buildResearchJob(input, { id: this.ports.ids.next("research"), workspace: workspace.id, now: this.ports.clock.now() });
      state.researchJobs.unshift(job);
      if (state.researchJobs.length > 200) state.researchJobs.length = 200;
      const provider = this.ports.research;
      this.activity(state, "agent", "research.propose", `Research job proposed in "${workspace.label}": ${job.scope} scope, at most ${job.limits.maxSources} source(s), at most ${job.limits.maxCostCents} cent(s). ${provider ? `Provider ${provider.id}${provider.reachesNetwork ? " reaches the network" : " performs no network request"}.` : "No research provider is configured, so this cannot run."}`, job.id, "pending");
      return structuredClone(job);
    });
  }
  /**
   * Runs an approved job.
   *
   * The state machine is the governance: a job can only run from `approved`, an approval is the
   * owner's act, and a job that has already produced a result cannot be re-run into a different
   * one. Every finding is checked against the sources the provider actually returned before it is
   * stored, so a citation always points at something.
   */
  async approveResearchJob(id: string): Promise<ResearchJobV1> {
    return this.mutate((state) => {
      const job = find(state.researchJobs, id, "Research job");
      assertSameWorkspace(job, state.settings.activeWorkspace, "research job");
      if (job.state !== "proposed") throw new Error("Only a proposed research job can be approved.");
      job.state = "approved";
      this.activity(state, "approval", "research.approve", `Research job approved: "${job.question}".`, id);
      return structuredClone(job);
    });
  }
  async runResearchJob(id: string): Promise<ResearchJobV1> {
    const snapshot = await this.snapshot();
    const pending = find(snapshot.researchJobs, id, "Research job");
    if (pending.state !== "approved") throw new Error("A research job must be approved before it runs.");
    // A job that cannot run because nothing is configured is refused, recorded, and left approved
    // rather than marked failed. Nothing about it was wrong, and it should run unchanged once the
    // owner configures a provider — forcing them to propose it again would be pure ceremony.
    const provider = this.ports.research;
    const health = provider ? await provider.health() : { available: false, detail: "No research provider is configured. AION ships without one and will not reach the internet until you configure an owner-controlled provider." };
    if (!health.available) {
      await this.mutate((state) => { this.activity(state, "agent", "research.unavailable", `Research job "${pending.question}" could not run: ${health.detail} The job stays approved and will run unchanged once a provider is configured.`, id, "denied"); });
      throw new Error(health.detail);
    }

    const controller = new AbortController();
    this.controllers.set(`research:${id}`, controller);
    const timer = setTimeout(() => controller.abort(), pending.limits.maxDurationMs);
    try {
      await this.mutate((state) => { find(state.researchJobs, id, "Research job").state = "running"; });
      const raw = await provider!.run({ question: pending.question, scope: pending.scope, limits: pending.limits, seedReferences: pending.seedReferences, signal: controller.signal });
      return await this.mutate((state) => {
        const job = find(state.researchJobs, id, "Research job");
        const { job: completed, dropped } = applyResearchResult(job, raw, { now: this.ports.clock.now(), nextId: (kind) => this.ports.ids.next(kind), digest: digestValue });
        state.researchJobs = state.researchJobs.map((entry) => entry.id === id ? completed : entry);
        this.activity(state, "agent", "research.complete", `${researchSummary(completed)}${dropped ? ` ${dropped} uncited finding(s) were discarded.` : ""} Provider ${provider!.id}; ${completed.costCents} cent(s) spent.`, id);
        return structuredClone(completed);
      });
    } catch (error) {
      await this.mutate((state) => {
        const job = find(state.researchJobs, id, "Research job");
        job.state = "failed";
        job.failureReason = "The research job failed or was cancelled; private details are omitted.";
        job.completedAt = this.ports.clock.now();
        this.activity(state, "failure", "research.fail", job.failureReason, id, "failed");
      });
      throw error;
    } finally { clearTimeout(timer); this.controllers.delete(`research:${id}`); }
  }
  cancelResearchJob(id: string): boolean { const controller = this.controllers.get(`research:${id}`); if (!controller) return false; controller.abort(); return true; }
  /**
   * Carries a research finding into an opportunity as a typed claim.
   *
   * This is the only path from research into Product Studio, and it deliberately cannot produce a
   * fact: a finding arrives as the class the provider gave it, cites the job it came from, and
   * waits for the owner to promote it if they check it.
   */
  async adoptResearchFinding(jobId: string, findingId: string, opportunityId: string): Promise<OpportunityV1> {
    const snapshot = await this.snapshot();
    const job = find(snapshot.researchJobs, jobId, "Research job");
    if (job.state !== "complete") throw new Error("Only a completed research job has findings to adopt.");
    const finding = find(job.findings, findingId, "Finding");
    const sources = finding.sourceIds.map((sourceId) => find(job.sources, sourceId, "Source").reference);
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, opportunityId);
      assertSameWorkspace(job, opportunity.workspace, "research job");
      const claim = buildClaim(
        { class: finding.class, statement: finding.statement, confidence: finding.confidence, supportedBy: [`research:${jobId}`, ...sources] },
        { id: this.ports.ids.next("claim"), workspace: opportunity.workspace, now: this.ports.clock.now(), actor: "research", sourceRef: `research:${jobId}` },
      );
      const updated = {
        ...structuredClone(opportunity),
        claims: [...opportunity.claims, claim],
        researchJobIds: opportunity.researchJobIds.includes(jobId) ? opportunity.researchJobIds : [...opportunity.researchJobIds, jobId],
        updatedAt: this.ports.clock.now(),
      };
      this.activity(state, "plan", "opportunity.research", `A research ${claim.class} was carried into "${opportunity.title}" with its sources. It is not a fact until you say so.`, opportunityId);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async researchJobs(): Promise<ResearchJobV1[]> {
    const state = await this.snapshot();
    return state.researchJobs.filter((entry) => entry.workspace === state.settings.activeWorkspace).map((entry) => structuredClone(entry));
  }
  /** What a research provider would be allowed to fetch, decided before anything is requested. */
  checkResearchUrl(candidate: string): UrlVerdictV1 { return evaluateResearchUrl(candidate); }

  // --- Sales coaching, routine templates, and owner-entered metrics ---------------------------
  /**
   * Deterministic coaching over what the owner recorded. No model is called, so this works
   * offline and identically every time. A draft is only ever a draft: AION sends nothing.
   */
  async coach(kind: string, input: { customerId?: string; channel?: string; objection?: string; scenario?: string; onDate?: string } = {}): Promise<CoachOutputV1> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales coaching is only available in the Work workspace.");
    const now = this.ports.clock.now();
    const onDate = input.onDate ?? now.slice(0, 10);
    const scoped = this.#scopedRelationships(state);
    const customer = () => this.#findRelationship(state, required(input.customerId, "Customer", 200));
    switch (kind) {
      case "call-preparation": return callPreparation(customer());
      case "appointment-preparation": return appointmentPreparation(customer());
      case "follow-up-draft": return followUpDraft(customer(), (input.channel ?? "text") as ContactChannelV1);
      case "objection-prompts": return objectionPrompts(required(input.objection, "Objection", 500));
      case "discovery-questions": return discoveryQuestions(customer());
      case "next-action": return nextActionSuggestion(customer());
      case "follow-up-queue": return followUpQueue(scoped, onDate, now);
      case "morning-plan": return morningPlan(scoped, onDate, now);
      case "end-of-day-recap": return endOfDayRecap(scoped, onDate);
      case "role-play": return rolePlay(customer(), required(input.scenario, "Scenario", 500));
      default: throw new Error("Coaching kind is not recognised.");
    }
  }
  /** Templates the owner may choose to create. Nothing here schedules or enables itself. */
  salesRoutineTemplates(): readonly SalesRoutineTemplateV1[] { return SALES_ROUTINE_TEMPLATES; }
  async createRoutineFromTemplate(templateId: string): Promise<RoutineV1> {
    const template = SALES_ROUTINE_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) throw new Error("Sales routine template is not recognised.");
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales routines belong to the Work workspace.");
    return this.createRoutine({ name: template.name, instructions: template.instructions, intervalMinutes: template.intervalMinutes });
  }
  /** Records the owner's own count for one day. Re-entering a day replaces that day's numbers. */
  async recordSalesMetrics(date: string, counts: Record<string, unknown> = {}, note = ""): Promise<SalesMetricsEntryV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) throw new Error("Metrics date must be an explicit YYYY-MM-DD day.");
      const unexpected = Object.keys(counts).filter((key) => !(SALES_COUNT_KEYS as readonly string[]).includes(key));
      if (unexpected.length) throw new Error(`Metrics accept only ${SALES_COUNT_KEYS.join(", ")}; unexpected field(s): ${unexpected.join(", ")}.`);
      const tallied = {} as SalesCountsV1;
      for (const key of SALES_COUNT_KEYS) {
        const value = counts[key] ?? 0;
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) throw new Error(`Metric ${key} must be a whole number between 0 and 10000.`);
        tallied[key] = value as number;
      }
      const at = this.ports.clock.now();
      const existing = state.salesMetrics.find((entry) => entry.date === date);
      const record: SalesMetricsEntryV1 = existing
        ? { ...existing, counts: tallied, note: note.slice(0, 2000), updatedAt: at }
        : { id: this.ports.ids.next("metrics"), workspace: "work", date, counts: tallied, note: note.slice(0, 2000), origin: "owner-created", createdAt: at, updatedAt: at };
      state.salesMetrics = [record, ...state.salesMetrics.filter((entry) => entry.date !== date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1000);
      this.activity(state, "task", "sales.metrics", `Owner-entered activity recorded for ${date}. These are your own counts, not a dealership system's.`, record.id);
      return structuredClone(record);
    });
  }
  /** Daily and range summaries over owner-entered counts only. Nothing is inferred or imported. */
  async salesSummary(fromDate: string, toDate: string): Promise<{ from: string; to: string; days: number; entered: number; totals: SalesCountsV1; daily: SalesMetricsEntryV1[]; source: string }> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales metrics are only available in the Work workspace.");
    for (const [label, value] of [["from", fromDate], ["to", toDate]] as const) if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`Summary ${label} date must be YYYY-MM-DD.`);
    if (toDate < fromDate) throw new Error("Summary range is inverted.");
    const daily = state.salesMetrics.filter((entry) => entry.date >= fromDate && entry.date <= toDate).sort((a, b) => a.date.localeCompare(b.date));
    const totals = {} as SalesCountsV1;
    for (const key of SALES_COUNT_KEYS) totals[key] = daily.reduce((sum, entry) => sum + entry.counts[key], 0);
    const days = Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000) + 1;
    return { from: fromDate, to: toDate, days, entered: daily.length, totals, daily, source: "Owner-entered counts recorded in AION. Not a dealership CRM figure." };
  }

  // --- Phone access: pairing, sessions, revocation ---------------------------------------------
  /**
   * Issues a one-time pairing code. This is the only moment the code exists outside the owner's
   * screen: AION stores its digest, and no later call can reveal it.
   */
  async createPairingCode(label: string): Promise<{ code: string; expiresAt: string; label: string }> {
    return this.mutate((state) => {
      if (!state.settings.remoteAccess.enabled) throw new Error("Turn on private phone access in Settings before pairing a device.");
      const { token, code } = issuePairingToken(state, label, this.ports.ids.next("pairing"), this.ports.clock.now());
      this.activity(state, "settings", "device.pair.code", `A one-time pairing code was issued for "${token.label}". It expires in ${PAIRING_TTL_MINUTES} minutes and can be used once. The code itself is not stored.`, token.id);
      return { code, expiresAt: token.expiresAt, label: token.label };
    });
  }
  /** Redeems a code for a session token. Rate-limited, single-use, and returned exactly once. */
  async pairDevice(code: string, rateKey = "pair"): Promise<{ token: string; deviceId: string; expiresAt: string; label: string }> {
    /*
     * The failed-attempt counter has to survive a rejected attempt, so this deliberately does not
     * throw from inside the write. A throw would abandon the draft and discard the very increment
     * that makes rate limiting work, leaving pairing open to unlimited guessing.
     */
    const outcome = await this.mutate((state) => {
      const now = this.ports.clock.now();
      if (!state.settings.remoteAccess.enabled) return { ok: false as const, message: "Private phone access is turned off." };
      const limit = checkRateLimit(state, rateKey, now);
      if (!limit.allowed) {
        this.activity(state, "failure", "device.pair.throttled", "Pairing attempts are temporarily blocked after repeated failures.", null, "denied");
        return { ok: false as const, message: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` };
      }
      try {
        const result = redeemPairingCode(state, code, { deviceId: this.ports.ids.next("device"), sessionId: this.ports.ids.next("session") }, now, state.settings.remoteAccess.sessionDays);
        clearRateLimit(state, rateKey);
        this.activity(state, "settings", "device.paired", `Device "${result.device.label}" paired. Its session expires ${result.session.expiresAt} and can be revoked at any time.`, result.device.id);
        return { ok: true as const, value: { token: result.token, deviceId: result.device.id, expiresAt: result.session.expiresAt, label: result.device.label } };
      } catch (error) {
        recordFailure(state, rateKey, now);
        this.activity(state, "failure", "device.pair.rejected", "A pairing attempt was rejected. No code or token is recorded.", null, "denied");
        return { ok: false as const, message: error instanceof Error ? error.message : "Pairing failed." };
      }
    });
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.value;
  }
  /** Resolves a bearer token. Never records the token, and fails closed on anything unusual. */
  async authenticateDevice(token: string): Promise<{ deviceId: string; label: string; expiresAt: string } | null> {
    const state = await this.snapshot();
    const found = authenticate(state, token, this.ports.clock.now());
    if (!found) return null;
    return { deviceId: found.device.id, label: found.device.label, expiresAt: found.session.expiresAt };
  }
  async touchDevice(deviceId: string): Promise<void> {
    await this.mutate((state) => {
      const device = state.devices.find((entry) => entry.id === deviceId);
      if (device) device.lastSeenAt = this.ports.clock.now();
      for (const session of state.sessions) if (session.deviceId === deviceId && !session.revokedAt) session.lastSeenAt = this.ports.clock.now();
    });
  }
  /** Revoking a phone ends its access and touches no owner record whatsoever. */
  async revokeDevice(deviceId: string): Promise<{ sessionsEnded: number }> {
    return this.mutate((state) => {
      const ended = revokeDevice(state, deviceId, this.ports.clock.now());
      this.activity(state, "settings", "device.revoked", `A paired device was revoked and ${ended} session(s) ended. No conversation, memory, task, relationship, or Career record was changed.`, deviceId);
      return { sessionsEnded: ended };
    });
  }
  async revokeAllDevices(): Promise<{ devices: number; sessions: number }> {
    return this.mutate((state) => {
      const result = revokeAllDevices(state, this.ports.clock.now());
      this.activity(state, "settings", "device.revoked.all", `Signed out every device: ${result.devices} device(s), ${result.sessions} session(s), and any outstanding pairing code. Owner data is untouched.`, null);
      return result;
    });
  }
  /** What Settings shows. Digests and tokens are never included. */
  async deviceInventory(): Promise<Array<{ id: string; label: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null; activeSessions: number; expiresAt: string | null }>> {
    const state = await this.snapshot();
    const now = Date.parse(this.ports.clock.now());
    return state.devices.map((device) => {
      const live = state.sessions.filter((entry) => entry.deviceId === device.id && !entry.revokedAt && Date.parse(entry.expiresAt) > now);
      return { id: device.id, label: device.label, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt, activeSessions: live.length, expiresAt: live[0]?.expiresAt ?? null };
    });
  }

  async createPrivateBackup(destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> { const state = await this.snapshot(); const result = await this.ports.backup.create(state, destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.create", `Encrypted private backup verified (${result.bytes} bytes).`, `backup:${result.digest.slice(0, 16)}`); }); return result; }
  async verifyPrivateBackup(destination: string, passphrase: string): Promise<AssistantStateV1> { const state = await this.ports.backup.restore(destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.verify", "Encrypted private backup integrity and restore validated.", null); }); return state; }
}
