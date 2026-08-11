/**
 * Aggregate executive OS state (context + temporal + graph + radar + value + captures).
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import {
  emptyExecutiveContext,
  type ExecutiveContextStateV1,
  type GraphEdgeV1,
  type TemporalFactV1,
} from "./executive-context.js";
import type { OpportunitySignalV1, ValueLedgerEntryV1 } from "./opportunity-radar.js";
import type { CaptureResultV1 } from "./universal-capture.js";
import type { WorkspaceCorrectionV1 } from "./import-workspace-map.js";
import type { CommitmentV1 } from "./commitments.js";
import type {
  AutonomyJobV1,
  ExecutiveCycleResultV1,
  ExecutiveSnapshotSigV1,
  ResourceBudgetV1,
} from "./executive-cycle.js";
import { DEFAULT_RESOURCE_BUDGET } from "./executive-cycle.js";
import type { AttentionBudgetConfigV1, AttentionBudgetStateV1 } from "./attention-budget.js";
import { DEFAULT_ATTENTION_BUDGET, emptyAttentionBudgetState } from "./attention-budget.js";
import type { EntityMergeProposalV1, EntityUnmergeRecordV1 } from "./entity-resolution.js";

export type CorrectionKindV1 =
  | "person"
  | "workspace"
  | "fact"
  | "relationship"
  | "category";

/** Local correction pattern — never auto-apply from a single hit. */
export interface CorrectionPatternV1 {
  id: OpaqueId | string;
  kind: CorrectionKindV1;
  fromValue: string;
  toValue: string;
  workspace: string;
  hits: number;
  autoApplyEligible: boolean;
  at: IsoTimestamp;
  notes: string;
}

export interface IdentityResolutionV1 {
  /** Lowercase first name or alias key */
  key: string;
  workspace: string;
  resolvedRelationshipId: string;
  displayName: string;
  at: string;
}

export interface CaptureFrictionStatsV1 {
  total: number;
  withConfirm: number;
  autoApplied: number;
  failed: number;
  lastLatencyMs: number | null;
  /** Owner corrected person/workspace/fact after capture. */
  corrections: number;
  /** Ambiguous person false-match attempts (Owner rejected guess path). */
  falseMatches: number;
  briefingDismissed: number;
  opportunitiesActed: number;
}

export interface BrandDnaV1 {
  workspaceId: string;
  purpose: string;
  audience: string;
  productsServices: string;
  offers: string;
  voice: string;
  tone: string;
  claims: string[];
  forbiddenClaims: string[];
  visualDirection: string;
  platforms: string[];
  competitors: string[];
  goals: string;
  kpis: string;
  pastCampaigns: string;
  winningContent: string;
  weakContent: string;
  collaboratorsNote: string;
  assetsNote: string;
  provenanceSourceRef: string;
  updatedAt: IsoTimestamp;
}

export interface ExecutiveStateV1 {
  context: ExecutiveContextStateV1;
  temporalFacts: TemporalFactV1[];
  graphEdges: GraphEdgeV1[];
  opportunities: OpportunitySignalV1[];
  valueLedger: ValueLedgerEntryV1[];
  captures: CaptureResultV1[];
  brandDna: BrandDnaV1[];
  /** Owner corrections for import workspace mapping (durable guidance). */
  importWorkspaceCorrections: WorkspaceCorrectionV1[];
  commitments: CommitmentV1[];
  identityResolutions: IdentityResolutionV1[];
  captureFriction: CaptureFrictionStatsV1;
  autonomyJobs: AutonomyJobV1[];
  lastSnapshotSig: ExecutiveSnapshotSigV1 | null;
  lastCycleResult: ExecutiveCycleResultV1 | null;
  cycleHistory: ExecutiveCycleResultV1[];
  resourceBudget: ResourceBudgetV1;
  /** Global Owner delivery budget shared by all proactive emitters. */
  attentionBudgetConfig: AttentionBudgetConfigV1;
  attentionBudgetState: AttentionBudgetStateV1;
  /** Merge proposals only — never auto-applied. */
  entityMergeProposals: EntityMergeProposalV1[];
  entityUnmerges: EntityUnmergeRecordV1[];
  /** Local correction patterns — never auto-apply from a single hit. */
  correctionPatterns: CorrectionPatternV1[];
  lastBriefingAt: IsoTimestamp | null;
  lastDailyMaintenanceAt: IsoTimestamp | null;
  lastEndOfDayAt: IsoTimestamp | null;
  lastWeeklyReviewAt: IsoTimestamp | null;
  lastMorningCycleAt: IsoTimestamp | null;
}

export function emptyExecutiveState(now: IsoTimestamp = "1970-01-01T00:00:00.000Z"): ExecutiveStateV1 {
  return {
    context: emptyExecutiveContext(now),
    temporalFacts: [],
    graphEdges: [],
    opportunities: [],
    valueLedger: [],
    captures: [],
    brandDna: [],
    importWorkspaceCorrections: [],
    commitments: [],
    identityResolutions: [],
    captureFriction: {
      total: 0,
      withConfirm: 0,
      autoApplied: 0,
      failed: 0,
      lastLatencyMs: null,
      corrections: 0,
      falseMatches: 0,
      briefingDismissed: 0,
      opportunitiesActed: 0,
    },
    autonomyJobs: [],
    lastSnapshotSig: null,
    lastCycleResult: null,
    cycleHistory: [],
    resourceBudget: { ...DEFAULT_RESOURCE_BUDGET },
    attentionBudgetConfig: { ...DEFAULT_ATTENTION_BUDGET },
    attentionBudgetState: emptyAttentionBudgetState(now),
    entityMergeProposals: [],
    entityUnmerges: [],
    correctionPatterns: [],
    lastBriefingAt: null,
    lastDailyMaintenanceAt: null,
    lastEndOfDayAt: null,
    lastWeeklyReviewAt: null,
    lastMorningCycleAt: null,
  };
}

export function emptyBrandDna(workspaceId: string, now: IsoTimestamp): BrandDnaV1 {
  return {
    workspaceId,
    purpose: "",
    audience: "",
    productsServices: "",
    offers: "",
    voice: "",
    tone: "",
    claims: [],
    forbiddenClaims: [],
    visualDirection: "",
    platforms: [],
    competitors: [],
    goals: "",
    kpis: "",
    pastCampaigns: "",
    winningContent: "",
    weakContent: "",
    collaboratorsNote: "",
    assetsNote: "",
    provenanceSourceRef: "owner.brand-dna",
    updatedAt: now,
  };
}
