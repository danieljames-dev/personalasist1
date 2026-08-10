import type { BrainSettingsV1 } from "./brain.js";
import type { EvaluationRunV1 } from "./evaluation.js";
import type { GpuProvisioningProposalV1, GpuSessionV1 } from "./gpu.js";
import type { InferenceUsageV1 } from "./usage.js";
import type { LessonV1 } from "./learning.js";
import type { DevelopmentProjectV1 } from "./projects.js";
import type { OpportunityV1 } from "./product-studio.js";
import type { ResearchJobV1 } from "./research.js";
import type { WorkspaceV1 } from "./workspaces.js";

export type OpaqueId = string;
export type IsoTimestamp = string;

export interface ClockV1 { now(): IsoTimestamp; }
export interface IdGeneratorV1 { next(kind: string): OpaqueId; }

/**
 * Workspace separation. Work material stays in WORK unless the owner explicitly moves it, and
 * nothing is ever copied between workspaces implicitly — not memory context, not search results,
 * and not relationship information. Every record that can hold owner content carries its workspace.
 *
 * A workspace is an opaque identifier resolved against the registry in `state.workspaces`, not a
 * closed union: V1.2 lets the owner create business and brand workspaces alongside the two AION
 * always provides. Isolation is unchanged and is enforced the same way for all of them — an
 * unresolvable workspace is an error, never a fall back to a default that belongs to someone else.
 */
export type WorkspaceIdV1 = string;
/** The two AION always provides. They can be relabelled but never removed. */
export const WORKSPACE_IDS: readonly WorkspaceIdV1[] = ["personal", "work"];
/** The documented default every pre-workspace record migrates to. */
export const DEFAULT_WORKSPACE: WorkspaceIdV1 = "personal";

/** One recorded, deterministic state migration. Kept so a migration is auditable, not implicit. */
export interface MigrationRecordV1 {
  id: OpaqueId;
  migration: string;
  at: IsoTimestamp;
  /** Per record type, how many records the migration assigned. Zero means nothing needed it. */
  assigned: Record<string, number>;
  defaultWorkspace: WorkspaceIdV1;
}

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
  workspace: WorkspaceIdV1;
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
  workspace: WorkspaceIdV1;
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
  workspace: WorkspaceIdV1;
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
  workspace: WorkspaceIdV1;
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
  workspace: WorkspaceIdV1;
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
  workspace: WorkspaceIdV1;
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

/**
 * Where a piece of information came from and, by implication, who it belongs to. Customer records
 * created while doing a job are not the owner's personal property, and AION says so rather than
 * blurring the two. The imported class exists so a future authorised employer-system import has a
 * place to land; nothing produces it in this milestone.
 */
export type DataOriginV1 = "owner-created" | "employer-work" | "imported-employer-system";
export const DATA_ORIGINS: readonly DataOriginV1[] = ["owner-created", "employer-work", "imported-employer-system"];

/**
 * What kind of relationship this is.
 *
 * The type is declared, never inferred. AION does not decide that a new contact is a sales
 * prospect, and it does not decide that a prospect has become a customer — the owner says so, and
 * the change lands on the timeline like everything else.
 */
export type RelationshipTypeV1 =
  | "prospect" | "customer" | "contact" | "lead"
  | "partner" | "vendor" | "support-contact" | "other";
export const RELATIONSHIP_TYPES: readonly RelationshipTypeV1[] = [
  "prospect", "customer", "contact", "lead", "partner", "vendor", "support-contact", "other",
];

/**
 * A durable relationship lifecycle. States are not a workflow the record passes through and
 * forgets: every transition is appended to the timeline, so a relationship can go prospect →
 * contact → appointment → visit → follow-up → sale → later follow-up without losing anything
 * earlier. The last three states are the neutral ones a non-sales relationship uses.
 */
export type RelationshipLifecycleV1 =
  | "prospect" | "contacted" | "engaged" | "appointment-set" | "appointment-shown"
  | "negotiating" | "sold" | "lost" | "follow-up" | "inactive"
  | "active" | "dormant" | "closed";
export const RELATIONSHIP_LIFECYCLES: readonly RelationshipLifecycleV1[] = [
  "prospect", "contacted", "engaged", "appointment-set", "appointment-shown",
  "negotiating", "sold", "lost", "follow-up", "inactive",
  "active", "dormant", "closed",
];
/** @deprecated Sales-era name. Use {@link RelationshipLifecycleV1}. */
export type CustomerLifecycleV1 = RelationshipLifecycleV1;
/** @deprecated Sales-era name. Use {@link RELATIONSHIP_LIFECYCLES}. */
export const CUSTOMER_LIFECYCLES = RELATIONSHIP_LIFECYCLES;

export type ContactChannelV1 = "phone" | "text" | "email" | "in-person" | "other";
export const CONTACT_CHANNELS: readonly ContactChannelV1[] = ["phone", "text", "email", "in-person", "other"];

export interface ContactMethodV1 { channel: ContactChannelV1; label: string; value: string; }

/**
 * What this person or organisation is interested in. Descriptive only: a trade-in is described,
 * never valued, and no interest is ever derived from a financial record.
 */
export type InterestKindV1 = "vehicle" | "trade" | "product" | "service" | "topic" | "need" | "other";
export const INTEREST_KINDS: readonly InterestKindV1[] = ["vehicle", "trade", "product", "service", "topic", "need", "other"];
export interface RelationshipInterestV1 { kind: InterestKindV1; description: string; notedAt: IsoTimestamp; }
/** @deprecated Sales-era name. Use {@link RelationshipInterestV1}. */
export type CustomerInterestV1 = RelationshipInterestV1;

export interface RelationshipInteractionV1 {
  id: OpaqueId;
  at: IsoTimestamp;
  kind: "note" | "call" | "text" | "email" | "visit" | "appointment" | "follow-up" | "lifecycle" | "outcome" | "meeting" | "message";
  summary: string;
  detail: string;
  /** Set when this interaction is the one that moved the relationship to a new state. */
  lifecycleAfter: RelationshipLifecycleV1 | null;
  actor: "owner" | "aion";
}
/** @deprecated Sales-era name. Use {@link RelationshipInteractionV1}. */
export type CustomerInteractionV1 = RelationshipInteractionV1;

export interface RelationshipAppointmentV1 {
  id: OpaqueId;
  at: IsoTimestamp;
  kind: "appointment" | "callback" | "delivery" | "meeting" | "demo";
  location: string;
  status: "scheduled" | "confirmed" | "shown" | "no-show" | "rescheduled" | "cancelled";
  notes: string;
  createdAt: IsoTimestamp;
}
/** @deprecated Sales-era name. Use {@link RelationshipAppointmentV1}. */
export type CustomerAppointmentV1 = RelationshipAppointmentV1;

export interface RelationshipFollowUpV1 {
  id: OpaqueId;
  dueAt: IsoTimestamp;
  channel: ContactChannelV1;
  reason: string;
  status: "open" | "done" | "skipped";
  outcome: string;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}
/** @deprecated Sales-era name. Use {@link RelationshipFollowUpV1}. */
export type CustomerFollowUpV1 = RelationshipFollowUpV1;

/**
 * A durable, workspace-scoped relationship record.
 *
 * Deliberately not automotive-specific and no longer Work-only: a vehicle interest is one kind of
 * `interests` entry, and no field, state, or rule depends on a dealership, a manufacturer, or a
 * particular employer. A prospect on a sales floor, a supplier for a side business, and a
 * professional contact are the same shape with a different declared type, living in different
 * workspaces that cannot see each other.
 */
export interface RelationshipV1 {
  id: OpaqueId;
  /** Stable opaque reference that survives renames and is safe to quote in an audit trail. */
  reference: string;
  workspace: WorkspaceIdV1;
  relationshipType: RelationshipTypeV1;
  displayName: string;
  /** Owner-supplied. AION never looks a company up or fills this in from anywhere. */
  organisation: string;
  role: string;
  lifecycle: RelationshipLifecycleV1;
  origin: DataOriginV1;
  contactMethods: ContactMethodV1[];
  communicationPreference: ContactChannelV1 | "unknown";
  source: string;
  notes: string;
  interests: RelationshipInterestV1[];
  objections: string[];
  preferences: string[];
  appointments: RelationshipAppointmentV1[];
  followUps: RelationshipFollowUpV1[];
  nextAction: string;
  nextActionAt: IsoTimestamp | null;
  lastContactAt: IsoTimestamp | null;
  /** Append-only relationship timeline. Nothing here is ever rewritten or removed. */
  interactions: RelationshipInteractionV1[];
  taskIds: OpaqueId[];
  routineIds: OpaqueId[];
  planIds: OpaqueId[];
  /** Product Studio opportunities this relationship is evidence for or a participant in. */
  opportunityIds: OpaqueId[];
  outcome: { state: "open" | "sold" | "lost"; at: IsoTimestamp | null; detail: string };
  archived: boolean;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
/** @deprecated Sales-era name. A customer is a relationship whose type is `customer`. */
export type CustomerV1 = RelationshipV1;

/**
 * R7 durable CRM document / image intake record.
 * Original bytes are stored under an intake root; this object is the durable index.
 */
export interface CrmDocumentV1 {
  id: OpaqueId;
  workspace: WorkspaceIdV1;
  /** Related company/contact relationship id, or null if not yet associated. */
  relationshipId: OpaqueId | null;
  filename: string;
  /** Absolute path under private intake when available; never a network path. */
  storedPath: string;
  mimeType: string;
  byteLength: number;
  kind: "document" | "image" | "spreadsheet" | "other";
  summary: string;
  extractedText: string;
  tags: string[];
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** R7 email draft — drafting only; never auto-sent in R7. */
export interface EmailDraftV1 {
  id: OpaqueId;
  workspace: WorkspaceIdV1;
  relationshipId: OpaqueId | null;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
  status: "draft" | "reviewed" | "archived";
  basedOn: string;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/**
 * Owner-entered daily activity counts. These are the owner's own record of their day, not any
 * dealership system's numbers, and AION labels them that way wherever they are shown.
 */
export interface SalesMetricsEntryV1 {
  id: OpaqueId;
  workspace: WorkspaceIdV1;
  /** Calendar day, YYYY-MM-DD. One entry per day; re-entering a day updates it. */
  date: string;
  counts: SalesCountsV1;
  note: string;
  origin: DataOriginV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
export interface SalesCountsV1 {
  newLeads: number; calls: number; contacts: number; appointmentsSet: number;
  appointmentsShown: number; sales: number; followUpsCompleted: number;
}
export const SALES_COUNT_KEYS: readonly (keyof SalesCountsV1)[] = [
  "newLeads", "calls", "contacts", "appointmentsSet", "appointmentsShown", "sales", "followUpsCompleted",
];

/** A closed query shape. There is no free-text filter expression for a model to inject into. */
export interface RelationshipQueryV1 {
  kind:
    | "follow-up-due" | "not-contacted-since" | "appointments-on" | "interested-in"
    | "awaiting-callback" | "in-stage" | "of-type" | "all";
  /** An ISO date (YYYY-MM-DD) for date-based queries. */
  onDate?: string;
  /** Whole days for recency queries. */
  days?: number;
  /** Descriptive text for interest matching. Matched literally, never evaluated. */
  text?: string;
  stage?: RelationshipLifecycleV1;
  /** Narrows any query to one declared relationship type. */
  relationshipType?: RelationshipTypeV1;
  includeArchived?: boolean;
}
/** @deprecated Sales-era name. Use {@link RelationshipQueryV1}. */
export type CustomerQueryV1 = RelationshipQueryV1;

/**
 * Phone access.
 *
 * Reaching AION over a private network is not authentication. A VPN says which machines can open
 * a socket; it says nothing about who is holding the phone. So every non-loopback request must
 * additionally carry a session issued by an explicit pairing the owner performed at the console.
 *
 * Nothing here stores a secret. A pairing code and a session token exist only in the response
 * that hands them out; AION keeps their SHA-256 digests, so a stolen state file yields no access.
 */
export interface PairedDeviceV1 {
  id: OpaqueId;
  label: string;
  createdAt: IsoTimestamp;
  lastSeenAt: IsoTimestamp | null;
  revokedAt: IsoTimestamp | null;
}

export interface DeviceSessionV1 {
  id: OpaqueId;
  deviceId: OpaqueId;
  /** SHA-256 of the bearer token. The token itself is never stored, logged, or re-displayed. */
  tokenHash: string;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  lastSeenAt: IsoTimestamp | null;
  revokedAt: IsoTimestamp | null;
}

export interface PairingTokenV1 {
  id: OpaqueId;
  /** SHA-256 of the one-time code. */
  codeHash: string;
  label: string;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  consumedAt: IsoTimestamp | null;
}

/** A failed-attempt counter per endpoint, so pairing and session use cannot be brute-forced. */
export interface RateLimitBucketV1 { key: string; windowStartedAt: IsoTimestamp; attempts: number; blockedUntil: IsoTimestamp | null; }

export interface RemoteAccessSettingsV1 {
  /** Off by default. AION binds loopback only until the owner deliberately turns this on. */
  enabled: boolean;
  /** The interface AION may additionally bind. Never a wildcard, never a public address. */
  bindAddress: string;
  /** How long a paired device stays signed in before it must pair again. */
  sessionDays: number;
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
  /** The workspace new records are created in and the UI is showing. */
  activeWorkspace: WorkspaceIdV1;
  /** Private phone access. Disabled by default; loopback needs none of it. */
  remoteAccess: RemoteAccessSettingsV1;
  /** Owner-supplied display names, e.g. a workplace label. Never inferred, never invented. */
  workspaceLabels: Record<WorkspaceIdV1, string>;
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
  /** Every migration that has run against this state, in order. Never rewritten. */
  migrations: MigrationRecordV1[];
  /**
   * The workspace registry. Personal and Work are always present; business and brand workspaces
   * are added by the owner. Every workspace-scoped record resolves its workspace against this list.
   */
  workspaces: WorkspaceV1[];
  /** Durable relationship records across every workspace. Isolation is by `workspace`. */
  relationships: RelationshipV1[];
  /** Product Studio opportunities. Each carries its own typed claims rather than loose prose. */
  opportunities: OpportunityV1[];
  /** Governed research jobs, newest first. Bounded on every write. */
  researchJobs: ResearchJobV1[];
  /** Which endpoints AION may reason on, and the policy governing when each may be used. */
  brain: BrainSettingsV1;
  /** Evidence from the synthetic model evaluation harness, newest first. Bounded on every write. */
  evaluations: EvaluationRunV1[];
  /** What AION has learned, outside any model, so replacing the model loses none of it. */
  lessons: LessonV1[];
  /** Development projects, from an idea through to something the owner can look at. */
  projects: DevelopmentProjectV1[];
  /** Bounded rented-GPU provisioning proposals. Newest first; nothing here has been paid for. */
  gpuProposals: GpuProvisioningProposalV1[];
  /** Rented GPU sessions. Their stop deadlines live here, not in a timer that dies with AION. */
  gpuSessions: GpuSessionV1[];
  /** Measured inference usage, newest first. Evidence for the later rent-versus-buy decision. */
  usage: InferenceUsageV1[];
  /** Owner-entered daily activity counts, newest first. */
  salesMetrics: SalesMetricsEntryV1[];
  /**
   * R7 CRM document intake — original files live under private intake; this records
   * metadata, summaries, and optional extracted text. Newest first; bounded on write.
   */
  crmDocuments: CrmDocumentV1[];
  /** R7 email drafts (never auto-sent). Newest first; bounded on write. */
  emailDrafts: EmailDraftV1[];
  /** Phones the owner paired. Revoking one never touches owner data. */
  devices: PairedDeviceV1[];
  /** Sessions issued to paired devices. Only digests are stored. */
  sessions: DeviceSessionV1[];
  /** Outstanding one-time pairing codes, as digests. */
  pairingTokens: PairingTokenV1[];
  /** Failed-attempt counters for pairing and session use. */
  rateLimits: RateLimitBucketV1[];
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

/** Re-export marker: writer authority is defined in writer-authority.ts and enforced at mutation boundaries. */
