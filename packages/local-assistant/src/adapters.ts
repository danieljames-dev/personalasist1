import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AssistantStateV1, CapabilityContextV1, CapabilityRegistryV1, CapabilityV1, ClockV1,
  DeveloperAgentBridgeV1, DeveloperAgentModeV1, DeveloperAgentRegistryV1, DeveloperAgentStatusV1,
  IdGeneratorV1, ImportReportV1, ImportSourceV1, MigrationRecordV1, ModelProviderV1,
  ModelRequestV1, PrivateBackupV1, SettingsV1, StateRepositoryV1,
  VerificationOperationIdV1, VerificationOperationV1, VerificationRunV1, VerificationRunnerV1,
  WorkspaceIdV1,
} from "./contracts.js";
import { DEFAULT_WORKSPACE, PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX, VERIFICATION_OPERATION_IDS, WORKSPACE_IDS } from "./contracts.js";

const scrypt = promisify(scryptCallback);
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

function fail(message: string): never { throw new Error(message); }
function normalizedAbsolute(value: string, label: string): string {
  if (!value || value.includes("\0") || !isAbsolute(value) || resolve(value) !== value) fail(`${label} must be a normalized absolute path.`);
  if (/^(\\\\|\\\\\?\\|\\\\\.\\)/u.test(value)) fail(`${label} cannot use a UNC or device namespace.`);
  return value;
}
function isContained(root: string, selected: string, allowRoot = false): boolean {
  const rel = relative(root, selected);
  return (allowRoot || rel !== "") && !rel.startsWith("..") && !isAbsolute(rel);
}
async function existingParent(path: string): Promise<string> {
  let cursor = path;
  while (true) {
    try { return await realpath(cursor); } catch {
      const parent = dirname(cursor);
      if (parent === cursor) fail("No existing parent is available for the selected path.");
      cursor = parent;
    }
  }
}
async function authorize(rootValue: string, selectedValue: string, allowRoot = false): Promise<{ root: string; selected: string }> {
  const root = normalizedAbsolute(rootValue, "Approved root");
  const selected = normalizedAbsolute(selectedValue, "Selected path");
  if (!isContained(root, selected, allowRoot)) fail("Selected path is outside the approved root.");
  const realRoot = await realpath(root);
  const realParent = await existingParent(selected);
  if (!isContained(realRoot, realParent, true)) fail("Selected path resolves outside the approved root.");
  return { root: realRoot, selected };
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("Canonical values require safe integers."); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  fail("Unsupported canonical value.");
}
export function digestValue(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

export class SystemClockV1 implements ClockV1 { now(): string { return new Date().toISOString(); } }
export class RandomIdGeneratorV1 implements IdGeneratorV1 { next(): string { return randomUUID(); } }
export class DeterministicClockV1 implements ClockV1 {
  private tick = 0;
  constructor(private readonly epoch = Date.parse("2030-01-01T00:00:00.000Z")) {}
  now(): string { return new Date(this.epoch + this.tick++ * 1000).toISOString(); }
}
export class DeterministicIdGeneratorV1 implements IdGeneratorV1 {
  private sequence = 0;
  next(kind: string): string {
    const hex = createHash("sha256").update(`${kind}:${this.sequence++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}

export function createEmptyStateV1(): AssistantStateV1 {
  return {
    schema: "aion.local-assistant-state.v1", revision: 0, onboardingComplete: false,
    settings: {
      providerId: "deterministic", model: "aion-offline-v1", remoteDisclosureAccepted: false,
      memoryContextEnabled: true, schedulerEnabled: true, externalActionsRequireApproval: true,
      importRoots: [], exportRoot: "", credentialEnvironmentVariable: "", developerBridgeId: "",
      activeWorkspace: DEFAULT_WORKSPACE, workspaceLabels: { personal: "Personal", work: "Work" },
      remoteAccess: { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 },
      privacy: { includeMemoryByDefault: true, retainActivityDays: 365 },
    },
    conversations: [], memories: [], tasks: [], routines: [], plans: [], actions: [], approvals: [], activity: [], imports: [], verifications: [], migrations: [], customers: [], salesMetrics: [], devices: [], sessions: [], pairingTokens: [], rateLimits: [],
  };
}

/** Record types that carry owner content and therefore must carry a workspace. */
const WORKSPACE_SCOPED_COLLECTIONS = ["conversations", "memories", "tasks", "routines", "plans", "activity"] as const;

/**
 * The workspace migration.
 *
 * Deterministic, idempotent, and fail-closed. Every pre-workspace record is assigned the
 * documented default of PERSONAL and nothing else about it is touched — identifiers, provenance,
 * history, timestamps and cross-record links are carried through untouched, because the migration
 * only ever adds a missing field. It never creates a WORK record, so migration cannot move owner
 * material across the boundary. A record carrying an unrecognised workspace is an error rather
 * than something to guess at.
 */
export function migrateStateV1(
  state: AssistantStateV1,
  now: string,
  nextId: (kind: string) => string,
): { state: AssistantStateV1; applied: boolean; record: MigrationRecordV1 | null } {
  const draft = structuredClone(state);
  if (!Array.isArray(draft.migrations)) draft.migrations = [];
  const assigned: Record<string, number> = {};
  for (const collection of WORKSPACE_SCOPED_COLLECTIONS) {
    const records = draft[collection] as unknown as Array<{ workspace?: unknown; id?: unknown }>;
    if (!Array.isArray(records)) fail("Assistant state is incomplete.");
    let count = 0;
    for (const record of records) {
      if (record.workspace === undefined || record.workspace === null) { record.workspace = DEFAULT_WORKSPACE; count += 1; continue; }
      if (!WORKSPACE_IDS.includes(record.workspace as WorkspaceIdV1)) fail(`Assistant state contains an unrecognised workspace on a ${collection} record; refusing to guess.`);
    }
    assigned[collection] = count;
  }
  const settings = draft.settings as SettingsV1;
  let settingsAssigned = 0;
  if (settings.activeWorkspace === undefined) { settings.activeWorkspace = DEFAULT_WORKSPACE; settingsAssigned += 1; }
  if (!WORKSPACE_IDS.includes(settings.activeWorkspace)) fail("Assistant settings name an unrecognised active workspace.");
  if (!settings.workspaceLabels || typeof settings.workspaceLabels !== "object") { settings.workspaceLabels = { personal: "Personal", work: "Work" }; settingsAssigned += 1; }
  for (const id of WORKSPACE_IDS) if (typeof settings.workspaceLabels[id] !== "string" || !settings.workspaceLabels[id]) { settings.workspaceLabels[id] = id === "personal" ? "Personal" : "Work"; settingsAssigned += 1; }
  assigned.settings = settingsAssigned;

  // A migration "applies" only when it actually assigned something. State that AION created
  // already workspace-aware needs nothing, so reopening it writes no revision and records no
  // migration — which is what keeps a restart byte-identical.
  const total = Object.values(assigned).reduce((sum, count) => sum + count, 0);
  if (total === 0) return { state: draft, applied: false, record: null };
  const record: MigrationRecordV1 = { id: nextId("migration"), migration: WORKSPACE_MIGRATION, at: now, assigned, defaultWorkspace: DEFAULT_WORKSPACE };
  draft.migrations.push(record);
  return { state: draft, applied: true, record };
}
export const WORKSPACE_MIGRATION = "aion.workspace-separation.v1";
export function validateStateV1(value: unknown): AssistantStateV1 {
  if (!value || typeof value !== "object") fail("Assistant state is malformed.");
  const state = value as Partial<AssistantStateV1>;
  if (state.schema !== "aion.local-assistant-state.v1" || !Number.isSafeInteger(state.revision) || (state.revision ?? -1) < 0) fail("Assistant state version is unsupported.");
  for (const key of ["conversations", "memories", "tasks", "routines", "plans", "actions", "approvals", "activity", "imports"] as const) if (!Array.isArray(state[key])) fail("Assistant state is incomplete.");
  if (!state.settings || typeof state.onboardingComplete !== "boolean") fail("Assistant settings are incomplete.");
  const clone = structuredClone(state as AssistantStateV1);
  // Additive V1 settings default forward: state written before a setting existed keeps working
  // without a migration, and never silently acquires a value the owner did not choose.
  if (typeof clone.settings.developerBridgeId !== "string") clone.settings.developerBridgeId = "";
  if (!Array.isArray(clone.verifications)) clone.verifications = [];
  if (!Array.isArray(clone.migrations)) clone.migrations = [];
  if (!Array.isArray(clone.customers)) clone.customers = [];
  if (!Array.isArray(clone.salesMetrics)) clone.salesMetrics = [];
  for (const key of ["devices", "sessions", "pairingTokens", "rateLimits"] as const) if (!Array.isArray(clone[key])) clone[key] = [] as never;
  if (!clone.settings.remoteAccess || typeof clone.settings.remoteAccess !== "object") clone.settings.remoteAccess = { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 };
  return clone;
}

export class InMemoryStateRepositoryV1 implements StateRepositoryV1 {
  private state: AssistantStateV1 | null = null;
  async load(): Promise<AssistantStateV1 | null> { return this.state ? structuredClone(this.state) : null; }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    const current = this.state?.revision ?? 0;
    if (current !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    this.state = validateStateV1(state);
  }
}

export class FileStateRepositoryV1 implements StateRepositoryV1 {
  readonly statePath: string;
  constructor(readonly root: string) {
    normalizedAbsolute(root, "Assistant data root");
    if (basename(root).toLowerCase() !== "aion" || basename(dirname(root)).toLowerCase() !== "private") fail("Assistant state must use an explicit private/aion root.");
    this.statePath = join(root, "state-v1.json");
  }
  async load(): Promise<AssistantStateV1 | null> {
    try {
      await authorize(this.root, this.statePath);
      const info = await stat(this.statePath);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) fail("Assistant state is invalid or oversized.");
      return validateStateV1(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await authorize(this.root, this.statePath);
    const existing = await this.load();
    if ((existing?.revision ?? 0) !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    const text = `${JSON.stringify(validateStateV1(state), null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) fail("Assistant state exceeds the V1 size limit.");
    const temporary = join(this.root, `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, this.statePath); } finally { await rm(temporary, { force: true }); }
  }
}

/**
 * Offline deterministic test provider. It performs no network or model call. Three scripted owner
 * prefixes exercise the proposal protocol so approval, memory review, and the developer-agent
 * hand-off are usable and testable without a live provider: `propose: <text>`,
 * `remember: <text>`, and `developer: <task>`.
 *
 * A `developer:` turn produces nothing but an ordinary read-only proposal. It carries no authority:
 * AION revalidates it against the registry and opens an approval exactly as it would for any other
 * proposal, and no capability accepts shell text.
 */
export class DeterministicModelProviderV1 implements ModelProviderV1 {
  readonly id = "deterministic";
  readonly location = "local" as const;
  async health(): Promise<{ available: boolean; detail: string }> { return { available: true, detail: "Offline deterministic provider is ready." }; }
  async *stream(request: ModelRequestV1): AsyncIterable<string> {
    if (request.signal?.aborted) throw new Error("Chat request cancelled.");
    const latest = [...request.messages].reverse().find((item) => item.role === "owner")?.content ?? "";
    const context = request.memoryContext.length ? ` I used ${request.memoryContext.length} enabled local memory record(s).` : "";
    const proposeMatch = latest.trim().match(/^propose:\s*(.+)$/isu);
    const rememberMatch = latest.trim().match(/^remember:\s*(.+)$/isu);
    const developerMatch = latest.trim().match(/^developer:\s*(.+)$/isu);
    let response = developerMatch
      ? `Offline response: I have prepared a read-only developer-agent task for your approval. Nothing runs until you approve it in Approvals, and the agent may not modify the repository.${context}`
      : `Offline response: ${latest.trim() || "Ready."}.${context}`;
    if (proposeMatch) response += `\n${PROPOSE_ACTION_PREFIX}${JSON.stringify({ capabilityId: "aion.local.echo.v1", input: { text: proposeMatch[1]!.slice(0, 1000) } })}`;
    if (developerMatch) response += `\n${PROPOSE_ACTION_PREFIX}${JSON.stringify({ capabilityId: "aion.developer.task.v1", input: { instruction: developerMatch[1]!.slice(0, 4000), mode: "read-only" } })}`;
    if (rememberMatch) response += `\n${PROPOSE_MEMORY_PREFIX}${JSON.stringify({ content: rememberMatch[1]!.slice(0, 2000), category: "semantic" })}`;
    for (const token of response.match(/\S+\s*/gu) ?? []) {
      if (request.signal?.aborted) throw new Error("Chat request cancelled.");
      yield token;
    }
  }
}

export class BoundaryModelProviderV1 implements ModelProviderV1 {
  constructor(readonly id: string, readonly location: "local" | "remote", private readonly detail: string) {}
  async health(): Promise<{ available: boolean; detail: string }> { return { available: false, detail: this.detail }; }
  async *stream(): AsyncIterable<string> { throw new Error(this.detail); }
}

export class StaticCapabilityRegistryV1 implements CapabilityRegistryV1 {
  private readonly entries = new Map<string, CapabilityV1>();
  constructor(capabilities: readonly CapabilityV1[]) {
    for (const capability of capabilities) { if (this.entries.has(capability.id)) fail("Duplicate capability identifier."); this.entries.set(capability.id, capability); }
  }
  get(id: string): CapabilityV1 | null { return this.entries.get(id) ?? null; }
  list(): readonly CapabilityV1[] { return [...this.entries.values()]; }
}

export class LocalEchoCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.local.echo.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 5000;
  readonly maxRetries = 1;
  summarize(input: Record<string, unknown>): string { return `Return a bounded local value (${String(input.text ?? "").length} characters).`; }
  validate(input: Record<string, unknown>): void { if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) fail("Echo capability input is invalid."); }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> { if (signal.aborted) fail("Capability cancelled."); return { text: input.text, local: true }; }
}

const DEVELOPER_MODES: readonly DeveloperAgentModeV1[] = ["read-only", "workspace-write"];
/** An absent or unrecognised mode resolves to read-only, so a developer task always fails safe. */
export function developerAgentMode(value: unknown): DeveloperAgentModeV1 { return value === "workspace-write" ? "workspace-write" : "read-only"; }

/**
 * Every developer bridge AION discovered, plus the one Settings currently selects. Selection is
 * owner policy: the registry itself never chooses a different bridge than the one it was told to
 * use, and an unregistered identifier fails closed rather than silently falling back.
 */
export class SelectableDeveloperAgentRegistryV1 implements DeveloperAgentRegistryV1 {
  private readonly bridges: readonly DeveloperAgentBridgeV1[];
  private selectedId: string;
  constructor(bridges: readonly DeveloperAgentBridgeV1[]) {
    if (!bridges.length) fail("At least one developer-agent bridge is required.");
    if (new Set(bridges.map((bridge) => bridge.id)).size !== bridges.length) fail("Duplicate developer-agent bridge identifier.");
    this.bridges = [...bridges];
    this.selectedId = this.bridges[0]!.id;
  }
  list(): readonly DeveloperAgentBridgeV1[] { return this.bridges; }
  get(id: string): DeveloperAgentBridgeV1 | null { return this.bridges.find((bridge) => bridge.id === id) ?? null; }
  selected(): DeveloperAgentBridgeV1 { return this.get(this.selectedId) ?? this.bridges[0]!; }
  select(id: string): void {
    if (!id) { this.selectedId = this.bridges[0]!.id; return; }
    if (!this.get(id)) fail("Developer-agent bridge is not registered.");
    this.selectedId = id;
  }
}

/**
 * The only path from AION to a local developer agent. It is a normal registered capability, so
 * every run is validated, digest-bound, one-shot approved, activity-recorded, and cancellable.
 * The conversational model can at most propose it; it can never invoke or approve it.
 *
 * The requested mode is part of the input, so it is covered by the digest the owner approves: a
 * read-only approval can never be spent on a repository-writing run.
 */
export class DeveloperAgentCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.developer.task.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 600_000;
  readonly maxRetries = 0;
  constructor(private readonly agents: DeveloperAgentRegistryV1, private readonly approvedRepositoryRoot: string) {
    normalizedAbsolute(approvedRepositoryRoot, "Approved repository root");
  }
  summarize(input: Record<string, unknown>): string {
    const mode = developerAgentMode(input.mode);
    const boundary = mode === "read-only"
      ? "The agent may read the approved repository but may not modify it."
      : "The agent may modify files inside the approved repository root.";
    return `Run one ${mode} developer-agent task through ${this.agents.selected().displayName} in the single approved repository root (${String(input.instruction ?? "").length} instruction characters). ${boundary} No other directory is reachable, and the instruction is never treated as a command.`;
  }
  validate(input: Record<string, unknown>): void {
    if (typeof input.instruction !== "string" || !input.instruction.trim() || input.instruction.length > 4000) fail("Developer-agent instruction is invalid.");
    if (input.mode !== undefined && !DEVELOPER_MODES.includes(input.mode as DeveloperAgentModeV1)) fail("Developer-agent mode must be read-only or workspace-write.");
    if (input.repositoryRoot !== undefined && input.repositoryRoot !== this.approvedRepositoryRoot) fail("Developer-agent task is outside the approved repository root.");
  }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> {
    const bridge = this.agents.selected();
    const status = await bridge.status();
    if (!status.available) fail("No supported local developer-agent executable is available.");
    const mode = developerAgentMode(input.mode);
    if (!status.modes.includes(mode)) fail(`The selected developer bridge cannot run a ${mode} task.`);
    const result = await bridge.run({ repositoryRoot: this.approvedRepositoryRoot, instruction: String(input.instruction), mode }, signal);
    return { bridgeId: bridge.id, mode, exitCode: result.exitCode, summary: result.summary.slice(-20_000) };
  }
}

/**
 * The bounded verification capability.
 *
 * This exists so that "run the tests and tell me what failed" never requires giving a
 * conversational developer agent shell or write access. The capability accepts one thing: the
 * identifier of an operation AION already knows. It rejects any command, argument, or shell field
 * outright rather than ignoring it, so an attempt to smuggle one is a visible failure rather than
 * a silent no-op. AION owns the commands; the model owns nothing but the choice among them.
 */
export class VerificationCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.verify.run.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 1_800_000;
  readonly maxRetries = 0;
  /** Fields that would only ever be an attempt to supply a command. Their presence is an error. */
  private static readonly FORBIDDEN = ["command", "commandLine", "args", "argv", "shell", "script", "exec", "run", "cwd", "env", "path"];
  constructor(private readonly runner: VerificationRunnerV1) {}
  summarize(input: Record<string, unknown>): string {
    const operation = this.runner.get(String(input.operationId ?? ""));
    return operation
      ? `Run the allowlisted read-only verification "${operation.label}" (${operation.displayCommand}). AION owns this command; it was chosen from a fixed list and no part of it came from a model.`
      : "Run an unrecognised verification operation. This will be refused.";
  }
  validate(input: Record<string, unknown>): void {
    for (const key of VerificationCapabilityV1.FORBIDDEN) {
      if (key in input) fail(`Verification input must not carry a "${key}" field; operations are chosen by identifier, never supplied as a command.`);
    }
    if (typeof input.operationId !== "string" || !this.runner.get(input.operationId)) fail("Verification operation is not on the allowlist.");
    const extra = Object.keys(input).filter((key) => key !== "operationId");
    if (extra.length) fail(`Verification input accepts only operationId; unexpected field(s): ${extra.join(", ")}.`);
  }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> {
    const operation = this.runner.get(String(input.operationId));
    if (!operation) fail("Verification operation is not on the allowlist.");
    const run = await this.runner.run(operation.id, signal);
    return { ...run };
  }
}

/** Deterministic verification runner for tests and the demo. It starts no process. */
export class SyntheticVerificationRunnerV1 implements VerificationRunnerV1 {
  constructor(private readonly outcomes: Partial<Record<VerificationOperationIdV1, { exitCode: number; stdout: string; stderr?: string }>> = {}) {}
  operations(): readonly VerificationOperationV1[] {
    return VERIFICATION_OPERATION_IDS.map((id) => ({
      id, label: `Synthetic ${id}`, description: "Synthetic bounded verification operation.",
      displayCommand: `synthetic ${id}`, timeoutMs: 5000, readOnly: true as const,
    }));
  }
  get(id: string): VerificationOperationV1 | null { return this.operations().find((operation) => operation.id === id) ?? null; }
  async run(id: VerificationOperationIdV1, signal: AbortSignal): Promise<Omit<VerificationRunV1, "id">> {
    if (signal.aborted) fail("Verification cancelled.");
    const scripted = this.outcomes[id] ?? { exitCode: 0, stdout: `synthetic ${id} completed\n# pass 1\n# fail 0\n` };
    const startedAt = "2030-01-01T00:00:00.000Z";
    const stdout = scripted.stdout; const stderr = scripted.stderr ?? "";
    return {
      operationId: id, displayCommand: `synthetic ${id}`, startedAt, completedAt: startedAt, durationMs: 0,
      exitCode: scripted.exitCode, timedOut: false, outcome: scripted.exitCode === 0 ? "passed" : "failed",
      stdout, stderr, truncated: false,
      resultDigest: digestValue({ operationId: id, exitCode: scripted.exitCode, stdout, stderr }),
    };
  }
}

export class SyntheticDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  readonly id = "synthetic";
  readonly displayName = "Synthetic test bridge";
  async status(): Promise<DeveloperAgentStatusV1> {
    return {
      bridgeId: this.id, displayName: this.displayName, available: true, executable: "synthetic", version: "synthetic-1",
      account: "signed-in", accountDetail: "Synthetic test bridge needs no account.", detail: "Synthetic test bridge is ready.", modes: DEVELOPER_MODES,
    };
  }
  describe(mode: DeveloperAgentModeV1): { executable: string; args: readonly string[] } { return { executable: "synthetic", args: ["--sandbox", mode, "--instruction-on-stdin"] }; }
  async run(task: { repositoryRoot: string; instruction: string; mode: DeveloperAgentModeV1 }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }> {
    normalizedAbsolute(task.repositoryRoot, "Repository root");
    if (!task.instruction.trim() || task.instruction.length > 4000 || signal.aborted) fail("Developer-agent request is invalid or cancelled.");
    if (!DEVELOPER_MODES.includes(task.mode)) fail("Developer-agent mode is invalid.");
    return { exitCode: 0, summary: `Synthetic bounded ${task.mode} developer task completed without modifying any file.` };
  }
}

export class UnavailableDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  constructor(
    private readonly detail = "No supported local developer-agent executable is configured.",
    readonly id = "none",
    readonly displayName = "No developer agent",
  ) {}
  async status(): Promise<DeveloperAgentStatusV1> {
    return {
      bridgeId: this.id, displayName: this.displayName, available: false, executable: null, version: null,
      account: "unknown", accountDetail: "There is no executable to check.", detail: this.detail, modes: [],
    };
  }
  describe(): { executable: string; args: readonly string[] } { return { executable: "", args: [] }; }
  async run(): Promise<never> { throw new Error(this.detail); }
}

function role(value: unknown): "owner" | "assistant" { return value === "assistant" ? "assistant" : "owner"; }
function text(value: unknown): string { return typeof value === "string" ? value.slice(0, 100_000) : ""; }
function chatGptConversations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const mapping = item.mapping && typeof item.mapping === "object" ? Object.values(item.mapping as Record<string, unknown>) : [];
    const messages = mapping.flatMap((node) => {
      const message = (node as Record<string, unknown>).message as Record<string, unknown> | null;
      const author = message?.author as Record<string, unknown> | undefined;
      const content = message?.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? content.parts.filter((part): part is string => typeof part === "string").join("\n") : "";
      return parts ? [{ role: role(author?.role), content: text(parts), at: typeof message?.create_time === "number" ? new Date(message.create_time * 1000).toISOString() : null }] : [];
    });
    return { title: text(item.title) || `Imported conversation ${index + 1}`, messages };
  });
}
function genericConversations(value: unknown, platform: "claude" | "grok") {
  const source = Array.isArray(value) ? value : ((value as Record<string, unknown> | null)?.conversations ?? []);
  if (!Array.isArray(source)) return [];
  return source.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const rawMessages = Array.isArray(item.messages) ? item.messages : Array.isArray(item.chat_messages) ? item.chat_messages : [];
    return { title: text(item.title ?? item.name) || `${platform} conversation ${index + 1}`, messages: rawMessages.flatMap((message) => {
      const entry = message as Record<string, unknown>;
      const body = text(entry.content ?? entry.text);
      return body ? [{ role: role(entry.role ?? entry.sender), content: body, at: typeof (entry.created_at ?? entry.timestamp) === "string" ? String(entry.created_at ?? entry.timestamp) : null }] : [];
    }) };
  });
}

export class LocalArchiveImportSourceV1 implements ImportSourceV1 {
  async dryRun(request: { platform: ImportReportV1["platform"]; selectedRoot: string; selectedPath: string; knownDigests: readonly string[] }) {
    const allowed = await authorize(request.selectedRoot, request.selectedPath, true);
    const selectedInfo = await lstat(allowed.selected);
    if (selectedInfo.isSymbolicLink()) fail("Import selection cannot be a symbolic link.");
    const paths: string[] = [];
    const visit = async (current: string): Promise<void> => {
      if (paths.length >= MAX_IMPORT_FILES) fail("Import inventory exceeds the V1 file limit.");
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("Import inventory contains a symbolic link.");
      if (info.isFile()) { paths.push(current); return; }
      if (!info.isDirectory()) return;
      for (const entry of (await readdir(current)).sort()) await visit(join(current, entry));
    };
    await visit(allowed.selected);
    const items = [];
    const conversations = [];
    for (const path of paths) {
      const info = await stat(path);
      const rel = relative(allowed.root, path).replaceAll("\\", "/");
      if (info.size > MAX_IMPORT_BYTES) { items.push({ sourceRef: `source:${digestValue(rel).slice(0, 16)}`, relativePath: rel, digest: "", bytes: info.size, classification: "unsupported" as const, duplicate: false, conversationCount: 0 }); continue; }
      const bytes = await readFile(path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      let parsedConversations: ReturnType<typeof chatGptConversations> = [];
      let classification: "conversation" | "career" | "unsupported" = request.platform === "career" ? "career" : "unsupported";
      if (request.platform !== "career" && path.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(bytes.toString("utf8"));
          parsedConversations = request.platform === "chatgpt" ? chatGptConversations(parsed) : genericConversations(parsed, request.platform);
          if (parsedConversations.length) classification = "conversation";
        } catch { classification = "unsupported"; }
      }
      conversations.push(...parsedConversations);
      items.push({ sourceRef: `source:${digest.slice(0, 16)}`, relativePath: rel, digest, bytes: info.size, classification, duplicate: request.knownDigests.includes(digest), conversationCount: parsedConversations.length });
    }
    return { platform: request.platform, selectedRootRef: `root:${digestValue(allowed.root).slice(0, 16)}`, items, warnings: items.some((item) => item.classification === "unsupported") ? ["Unsupported files are excluded."] : [], conversations };
  }
}

interface BackupEnvelopeV1 { version: "aion.private-backup.v1"; kdf: "scrypt"; cipher: "aes-256-gcm"; salt: string; nonce: string; tag: string; ciphertext: string; stateDigest: string; }
export class NodePrivateBackupV1 implements PrivateBackupV1 {
  constructor(private readonly approvedDestinationRoot: string) { normalizedAbsolute(approvedDestinationRoot, "Private backup root"); }
  async create(state: AssistantStateV1, destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> {
    if (passphrase.length < 12) fail("Private backup passphrase must contain at least 12 characters.");
    await mkdir(this.approvedDestinationRoot, { recursive: true });
    await authorize(this.approvedDestinationRoot, destination);
    const plaintext = Buffer.from(canonical(validateStateV1(state)), "utf8");
    const salt = randomBytes(16); const nonce = randomBytes(12);
    const key = await scrypt(passphrase, salt, 32) as Buffer;
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from("aion.private-backup.v1", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: BackupEnvelopeV1 = { version: "aion.private-backup.v1", kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64url"), nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"), stateDigest: createHash("sha256").update(plaintext).digest("hex") };
    const serialized = `${JSON.stringify(envelope)}\n`;
    await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const restored = await this.restore(destination, passphrase);
    if (!timingSafeEqual(Buffer.from(digestValue(restored), "hex"), Buffer.from(digestValue(state), "hex"))) fail("Private backup restore verification failed.");
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized) };
  }
  async restore(destination: string, passphrase: string): Promise<AssistantStateV1> {
    await authorize(this.approvedDestinationRoot, destination);
    const raw = await readFile(destination, "utf8");
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES * 2) fail("Private backup is oversized.");
    const envelope = JSON.parse(raw) as BackupEnvelopeV1;
    if (envelope.version !== "aion.private-backup.v1" || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") fail("Private backup version is unsupported.");
    const key = await scrypt(passphrase, Buffer.from(envelope.salt, "base64url"), 32) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"));
    decipher.setAAD(Buffer.from("aion.private-backup.v1", "utf8")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
    const actual = createHash("sha256").update(plaintext).digest("hex");
    if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(envelope.stateDigest, "hex"))) fail("Private backup integrity validation failed.");
    return validateStateV1(JSON.parse(plaintext.toString("utf8")));
  }
}
