export type OpaqueId = string;
export type IsoTimestamp = string;

export interface ClockV1 { now(): IsoTimestamp; }
export interface IdGeneratorV1 { next(kind: string): OpaqueId; }

export interface ProvenanceV1 {
  sourceType: "owner" | "provider-proposal" | "routine" | "plan" | "import" | "system";
  sourceRef: string;
  recordedAt: IsoTimestamp;
}

export interface HistoryEntryV1 {
  at: IsoTimestamp;
  actor: "owner" | "aion";
  change: string;
}

export interface ChatMessageV1 {
  id: OpaqueId;
  role: "owner" | "assistant";
  content: string;
  createdAt: IsoTimestamp;
  providerId: string | null;
}

export interface ConversationV1 {
  id: OpaqueId;
  title: string;
  state: "active" | "archived";
  memoryContextEnabled: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  messages: ChatMessageV1[];
}

export interface ModelRequestV1 {
  conversationId: OpaqueId;
  messages: readonly ChatMessageV1[];
  memoryContext: readonly Pick<MemoryV1, "id" | "content" | "category">[];
  model: string;
  signal?: AbortSignal;
}

export interface ModelProviderV1 {
  readonly id: string;
  readonly location: "local" | "remote";
  health(): Promise<{ available: boolean; detail: string }>;
  stream(request: ModelRequestV1): AsyncIterable<string>;
}

/**
 * Provider proposal protocol. A provider may end its response with one or more of these
 * single-line records. They are proposals only: AION strips them from the stored message,
 * revalidates them against the registry, and never lets provider text execute or approve
 * anything. Unknown, malformed, or unregistered proposals are discarded with an activity note.
 */
export const PROPOSE_ACTION_PREFIX = "AION-PROPOSE-ACTION ";
export const PROPOSE_MEMORY_PREFIX = "AION-PROPOSE-MEMORY ";

export interface MemoryCorrectionV1 {
  at: IsoTimestamp;
  previousContent: string;
  correctedContent: string;
  reason: string;
}

export interface MemoryV1 {
  id: OpaqueId;
  content: string;
  category: "semantic" | "procedural" | "episodic" | "strategic";
  confirmation: "owner-confirmed" | "unconfirmed";
  conflict: "none" | "conflicting";
  enabled: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  sourceTimestamp: IsoTimestamp;
  provenance: ProvenanceV1;
  corrections: MemoryCorrectionV1[];
}

export type TaskStateV1 = "proposed" | "ready" | "in-progress" | "blocked" | "completed" | "cancelled";
export interface TaskV1 {
  id: OpaqueId;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
  state: TaskStateV1;
  dueAt: IsoTimestamp | null;
  tags: string[];
  planId: OpaqueId | null;
  routineId: OpaqueId | null;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
  provenance: ProvenanceV1;
  history: HistoryEntryV1[];
}

export interface RoutineV1 {
  id: OpaqueId;
  name: string;
  instructions: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: IsoTimestamp | null;
  lastRunAt: IsoTimestamp | null;
  capabilityIds: string[];
  approvalPolicy: "always" | "capability-default";
  createdAt: IsoTimestamp;
  history: HistoryEntryV1[];
}

export interface PlanStepV1 {
  id: OpaqueId;
  order: number;
  title: string;
  description: string;
  dependencies: OpaqueId[];
  requiredCapabilities: string[];
  approvalRequired: boolean;
  expectedOutput: string;
  status: "proposed" | "accepted" | "converted" | "blocked";
  blockedReason: string | null;
  taskId: OpaqueId | null;
}

export interface PlanV1 {
  id: OpaqueId;
  goal: string;
  status: "proposed" | "accepted" | "completed" | "cancelled";
  createdAt: IsoTimestamp;
  provenance: ProvenanceV1;
  steps: PlanStepV1[];
}

export type AgentActionStateV1 = "proposed" | "validated" | "awaiting-approval" | "approved" | "running" | "succeeded" | "failed" | "cancelled";
export interface AgentActionV1 {
  id: OpaqueId;
  capabilityId: string;
  conversationId: OpaqueId | null;
  origin: "owner" | "provider-proposal" | "routine";
  input: Record<string, unknown>;
  inputDigest: string;
  privacy: "public" | "private" | "sensitive";
  state: AgentActionStateV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  retryCount: number;
  maxRetries: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

/** One completed chat turn: the stored assistant message plus anything the provider proposed. */
export interface ChatTurnV1 {
  message: ChatMessageV1;
  proposedActions: AgentActionV1[];
  proposedMemories: MemoryV1[];
}

export interface ApprovalV1 {
  id: OpaqueId;
  actionId: OpaqueId;
  capabilityId: string;
  summary: string;
  inputDigest: string;
  state: "pending" | "approved" | "denied" | "expired" | "consumed";
  requestedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  decidedAt: IsoTimestamp | null;
  result: string | null;
}

export interface ActivityV1 {
  id: OpaqueId;
  at: IsoTimestamp;
  category: "chat" | "memory" | "task" | "routine" | "plan" | "approval" | "agent" | "career" | "import" | "export" | "provider" | "settings" | "failure";
  action: string;
  summary: string;
  subjectRef: string | null;
  outcome: "success" | "pending" | "denied" | "failed";
}

export interface ImportItemV1 {
  sourceRef: string;
  relativePath: string;
  digest: string;
  bytes: number;
  classification: "conversation" | "career" | "unsupported";
  duplicate: boolean;
  conversationCount: number;
}

export interface ImportReportV1 {
  id: OpaqueId;
  platform: "chatgpt" | "claude" | "grok" | "career";
  state: "dry-run" | "imported" | "cancelled" | "failed";
  selectedRootRef: string;
  createdAt: IsoTimestamp;
  items: ImportItemV1[];
  importedConversationIds: OpaqueId[];
  warnings: string[];
}

export interface SettingsV1 {
  providerId: string;
  model: string;
  remoteDisclosureAccepted: boolean;
  memoryContextEnabled: boolean;
  schedulerEnabled: boolean;
  externalActionsRequireApproval: boolean;
  importRoots: string[];
  exportRoot: string;
  credentialEnvironmentVariable: string;
  /** Which registered developer-agent bridge the owner selected. Empty means AION's default. */
  developerBridgeId: string;
  privacy: { includeMemoryByDefault: boolean; retainActivityDays: number };
}

export interface AssistantStateV1 {
  schema: "aion.local-assistant-state.v1";
  revision: number;
  onboardingComplete: boolean;
  settings: SettingsV1;
  conversations: ConversationV1[];
  memories: MemoryV1[];
  tasks: TaskV1[];
  routines: RoutineV1[];
  plans: PlanV1[];
  actions: AgentActionV1[];
  approvals: ApprovalV1[];
  activity: ActivityV1[];
  imports: ImportReportV1[];
  /** Evidence from allowlisted verification runs, newest first. Bounded on every write. */
  verifications: VerificationRunV1[];
}

export interface StateRepositoryV1 {
  load(): Promise<AssistantStateV1 | null>;
  save(expectedRevision: number, state: AssistantStateV1): Promise<void>;
}

export interface CapabilityContextV1 {
  clock: ClockV1;
  ids: IdGeneratorV1;
}
export interface CapabilityV1 {
  readonly id: string;
  readonly privacy: "public" | "private" | "sensitive";
  readonly approval: "never" | "always" | "external";
  readonly timeoutMs: number;
  readonly maxRetries: number;
  summarize(input: Record<string, unknown>): string;
  validate(input: Record<string, unknown>): void;
  execute(input: Record<string, unknown>, context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>>;
}
export interface CapabilityRegistryV1 { get(id: string): CapabilityV1 | null; list(): readonly CapabilityV1[]; }

/**
 * A developer-agent task is either read-only or repository-writing. The mode is part of the
 * capability input, so it is covered by the canonical digest the owner approves: an approval for a
 * read-only task can never authorise a writing one. Absent means read-only, so it fails closed.
 */
export type DeveloperAgentModeV1 = "read-only" | "workspace-write";

/**
 * Executable availability and account health are deliberately separate. A CLI that answers its
 * version probe proves only that the program exists; whether the owner is signed in — and whether
 * any credit remains — is a different question. AION never determines remaining quota, because
 * that would require a paid call.
 */
export interface DeveloperAgentStatusV1 {
  bridgeId: string;
  displayName: string;
  available: boolean;
  /** Executable *name* only. A full local path never reaches the browser, activity, or a backup. */
  executable: string | null;
  version: string | null;
  account: "not-checked" | "signed-in" | "signed-out" | "unknown";
  accountDetail: string;
  detail: string;
  modes: readonly DeveloperAgentModeV1[];
}

export interface DeveloperAgentBridgeV1 {
  readonly id: string;
  readonly displayName: string;
  /** `includeAccount` is opt-in so AION never probes an account on an ordinary state read. */
  status(options?: { includeAccount?: boolean }): Promise<DeveloperAgentStatusV1>;
  /**
   * The exact command AION would run for a task in this mode, with the local repository path
   * redacted. The instruction is deliberately absent from the vector: it travels on standard
   * input, so no part of it can be read as an argument. The owner can see this before approving.
   */
  describe(mode: DeveloperAgentModeV1): { executable: string; args: readonly string[] };
  run(task: { repositoryRoot: string; instruction: string; mode: DeveloperAgentModeV1 }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }>;
}

/** The complete set of developer bridges AION found, and the one Settings currently selects. */
export interface DeveloperAgentRegistryV1 {
  list(): readonly DeveloperAgentBridgeV1[];
  get(id: string): DeveloperAgentBridgeV1 | null;
  selected(): DeveloperAgentBridgeV1;
  /** An empty id restores AION's default preference. An unregistered id must fail closed. */
  select(id: string): void;
}

/**
 * The complete set of verification operations AION will ever run, as a closed union.
 *
 * This is the whole point of the type: a caller — including a model — selects an operation by
 * identifier. There is no command string, no argument list, and no shell anywhere in the input, so
 * there is nothing for instruction text to be injected into. AION owns the actual commands.
 */
export type VerificationOperationIdV1 =
  | "git.status"
  | "git.diff.check"
  | "npm.verify"
  | "npm.aion.demo"
  | "npm.career.demo"
  | "npm.audit";

export const VERIFICATION_OPERATION_IDS: readonly VerificationOperationIdV1[] = [
  "git.status", "git.diff.check", "npm.verify", "npm.aion.demo", "npm.career.demo", "npm.audit",
];

export interface VerificationOperationV1 {
  readonly id: VerificationOperationIdV1;
  readonly label: string;
  readonly description: string;
  /** Display only, so the owner can read what will run. Never parsed and never reassembled. */
  readonly displayCommand: string;
  readonly timeoutMs: number;
  /** Whether the operation only reads. Every allowlisted operation must be non-mutating. */
  readonly readOnly: true;
}

export interface VerificationRunV1 {
  id: OpaqueId;
  operationId: VerificationOperationIdV1;
  displayCommand: string;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  durationMs: number;
  exitCode: number;
  timedOut: boolean;
  outcome: "passed" | "failed";
  stdout: string;
  stderr: string;
  truncated: boolean;
  resultDigest: string;
}

export interface VerificationRunnerV1 {
  operations(): readonly VerificationOperationV1[];
  get(id: string): VerificationOperationV1 | null;
  run(id: VerificationOperationIdV1, signal: AbortSignal): Promise<Omit<VerificationRunV1, "id">>;
}

export interface ImportSourceV1 {
  dryRun(request: { platform: ImportReportV1["platform"]; selectedRoot: string; selectedPath: string; knownDigests: readonly string[] }): Promise<Omit<ImportReportV1, "id" | "createdAt" | "state" | "importedConversationIds"> & { conversations: Array<{ title: string; messages: Array<{ role: "owner" | "assistant"; content: string; at: string | null }> }> }>;
}

export interface PrivateBackupV1 {
  create(state: AssistantStateV1, destination: string, passphrase: string): Promise<{ digest: string; bytes: number }>;
  restore(destination: string, passphrase: string): Promise<AssistantStateV1>;
}
