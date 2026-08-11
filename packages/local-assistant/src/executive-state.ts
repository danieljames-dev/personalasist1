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
  lastEndOfDayAt: IsoTimestamp | null;
  lastWeeklyReviewAt: IsoTimestamp | null;
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
    lastEndOfDayAt: null,
    lastWeeklyReviewAt: null,
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
