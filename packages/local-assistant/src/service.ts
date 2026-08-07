import type {
  ActivityV1, AgentActionV1, ApprovalV1, AssistantStateV1, CapabilityRegistryV1, ChatMessageV1,
  ChatTurnV1, ClockV1, ConversationV1, DeveloperAgentModeV1, DeveloperAgentRegistryV1,
  DeveloperAgentStatusV1, IdGeneratorV1, ImportReportV1,
  ImportSourceV1, MemoryV1, ModelProviderV1, PlanV1, PrivateBackupV1, RoutineV1, SettingsV1,
  CustomerAppointmentV1, CustomerInteractionV1, CustomerQueryV1, CustomerV1, IsoTimestamp,
  MigrationRecordV1, StateRepositoryV1, TaskStateV1, TaskV1, VerificationRunV1, WorkspaceIdV1,
} from "./contracts.js";
import { DEFAULT_WORKSPACE, PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX, WORKSPACE_IDS } from "./contracts.js";
import { createEmptyStateV1, digestValue, migrateStateV1 } from "./adapters.js";
import { applyCustomerEdit, buildAppointment, buildCustomer, buildFollowUp, buildInteraction, lastInteraction, queryCustomers } from "./sales.js";

type AssistantPorts = {
  repository: StateRepositoryV1;
  clock: ClockV1;
  ids: IdGeneratorV1;
  providers: readonly ModelProviderV1[];
  capabilities: CapabilityRegistryV1;
  importer: ImportSourceV1;
  backup: PrivateBackupV1;
  developerAgents: DeveloperAgentRegistryV1;
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
  const interesting = /^(?:not ok|#\s*(?:tests|pass|fail|skipped)|.*(?:error|Error|AssertionError|FAIL|failed|âœ—)\b)/u;
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
        this.#recordMigration(next, migrated.record);
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
      if (!WORKSPACE_IDS.includes(next.activeWorkspace)) throw new Error("Workspace is not recognised.");
      next.workspaceLabels = { ...state.settings.workspaceLabels, ...(input.workspaceLabels ?? {}) };
      for (const id of WORKSPACE_IDS) next.workspaceLabels[id] = required(next.workspaceLabels[id], "Workspace label", 80);
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
  async sendMessage(conversationId: string, content: string): Promise<ChatTurnV1> {
    const turn = this.streamMessage(conversationId, content);
    for (;;) { const step = await turn.next(); if (step.done) return step.value; }
  }
  cancelChat(conversationId: string): boolean { const controller = this.controllers.get(`chat:${conversationId}`); if (!controller) return false; controller.abort(); return true; }

  async createMemory(input: { content: string; category: MemoryV1["category"]; confirmation?: MemoryV1["confirmation"]; sourceRef?: string }): Promise<MemoryV1> {
    return this.mutate((state) => { const at = this.ports.clock.now(); const memory: MemoryV1 = { id: this.ports.ids.next("memory"), workspace: state.settings.activeWorkspace, content: required(input.content, "Memory", 20_000), category: input.category, confirmation: input.confirmation ?? "owner-confirmed", conflict: "none", enabled: true, createdAt: at, updatedAt: at, sourceTimestamp: at, provenance: { sourceType: input.confirmation === "unconfirmed" ? "provider-proposal" : "owner", sourceRef: required(input.sourceRef ?? "owner-entry", "Memory source", 500), recordedAt: at }, corrections: [] }; state.memories.unshift(memory); this.activity(state, "memory", "memory.create", `Memory ${memory.confirmation} created.`, memory.id); return structuredClone(memory); });
  }
  /** Search never crosses the workspace boundary; pass an explicit workspace to look elsewhere. */
  async searchMemories(query: string, workspace?: WorkspaceIdV1): Promise<MemoryV1[]> { const needle = required(query, "Memory query", 500).toLocaleLowerCase(); const state = await this.snapshot(); const scope = workspace ?? state.settings.activeWorkspace; if (!WORKSPACE_IDS.includes(scope)) throw new Error("Workspace is not recognised."); return state.memories.filter((item) => item.enabled && item.workspace === scope && `${item.category} ${item.content}`.toLocaleLowerCase().includes(needle)); }
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
  // --- Work-scoped relationship records -------------------------------------------------------
  /**
   * Relationship records live in WORK and nowhere else. Requiring the owner to be in the work
   * workspace is the point: it makes storing employer and customer material a deliberate act
   * rather than something that can happen while thinking about personal life.
   */
  #requireWorkWorkspace(state: AssistantStateV1): void {
    if (state.settings.activeWorkspace !== "work") throw new Error("Customer records belong to the Work workspace. Switch to Work before creating or changing one.");
  }
  async createCustomer(input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const at = this.ports.clock.now();
      const id = this.ports.ids.next("customer");
      const customer = buildCustomer(input, { id, reference: `customer:${digestValue({ id }).slice(0, 16)}`, now: at, workspace: "work" });
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: `Relationship opened as ${customer.lifecycle}.`, detail: "", lifecycleAfter: customer.lifecycle, actor: "owner" });
      state.customers.unshift(customer);
      this.activity(state, "task", "customer.create", `Work relationship record created (${customer.origin}). No identity, credit, or banking material is stored.`, customer.id);
      return structuredClone(customer);
    });
  }
  async updateCustomer(id: string, change: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const existing = find(state.customers, id, "Customer");
      const at = this.ports.clock.now();
      const updated = applyCustomerEdit(existing, change, at);
      // History is never rewritten by an edit: the timeline and links are carried across intact.
      updated.interactions = existing.interactions;
      updated.appointments = existing.appointments;
      updated.followUps = existing.followUps;
      updated.taskIds = existing.taskIds; updated.routineIds = existing.routineIds; updated.planIds = existing.planIds;
      updated.outcome = existing.outcome; updated.lifecycle = existing.lifecycle; updated.archived = existing.archived;
      updated.lastContactAt = existing.lastContactAt; updated.createdAt = existing.createdAt; updated.provenance = existing.provenance;
      state.customers = state.customers.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "task", "customer.update", "Work relationship record edited; the timeline was preserved.", id);
      return structuredClone(updated);
    });
  }
  /** Appends to the timeline. An interaction is never edited or removed once recorded. */
  async recordCustomerInteraction(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
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
      const customer = find(state.customers, id, "Customer");
      const task = find(state.tasks, taskId, "Task");
      if (task.workspace !== "work") throw new Error("Only a Work task can be linked to a work relationship.");
      if (!customer.taskIds.includes(taskId)) customer.taskIds.push(taskId);
      customer.updatedAt = this.ports.clock.now();
      this.activity(state, "task", "customer.link.task", "Task linked to a work relationship.", id);
      return structuredClone(customer);
    });
  }
  /** Relationship search. Work-scoped by construction: it reads only the customers collection. */
  async findCustomers(query: CustomerQueryV1): Promise<CustomerV1[]> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Relationship search is only available in the Work workspace.");
    return queryCustomers(state.customers, query, this.ports.clock.now());
  }
  async customerTimeline(id: string): Promise<{ customer: CustomerV1; last: CustomerInteractionV1 | null; nextAction: { action: string; at: IsoTimestamp | null } }> {
    const state = await this.snapshot();
    const customer = find(state.customers, id, "Customer");
    return { customer, last: lastInteraction(customer), nextAction: { action: customer.nextAction, at: customer.nextActionAt } };
  }

  async createPrivateBackup(destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> { const state = await this.snapshot(); const result = await this.ports.backup.create(state, destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.create", `Encrypted private backup verified (${result.bytes} bytes).`, `backup:${result.digest.slice(0, 16)}`); }); return result; }
  async verifyPrivateBackup(destination: string, passphrase: string): Promise<AssistantStateV1> { const state = await this.ports.backup.restore(destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.verify", "Encrypted private backup integrity and restore validated.", null); }); return state; }
}
