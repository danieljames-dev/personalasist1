/**
 * Real Owner-data import readiness gate.
 *
 * AION must not claim whole-drive archives are safe until recursive bulk ingestion,
 * containment, dedupe, review, and dashboard are present. This report is the explicit gate.
 */

export type BulkCapabilityStateV1 = "ready" | "partial" | "missing";

export interface BulkCapabilityItemV1 {
  id: string;
  label: string;
  state: BulkCapabilityStateV1;
  detail: string;
}

export interface FirstImportSourceV1 {
  id: string;
  title: string;
  why: string;
  how: string;
  risk: "low" | "medium";
  requiresOwnerPath: boolean;
}

export interface ImportReadinessReportV1 {
  code: "REAL_BULK_INGESTION_READY" | "REAL_BULK_INGESTION_PARTIAL" | "REAL_BULK_INGESTION_NOT_READY";
  ready: boolean;
  /** Product gate: bulk pipeline + Knowledge Add Source UX are usable for normal Owner import. */
  realOwnerImportReady: boolean;
  summary: string;
  capabilities: BulkCapabilityItemV1[];
  firstSources: FirstImportSourceV1[];
  blockers: string[];
  ownerActions: string[];
  highestValueSourceTypes: string[];
  stats: {
    approvedImportRoots: number;
    documentsWithHash: number;
    reviewOpen: number;
    queueSources: number;
  };
}

export interface ImportReadinessInputV1 {
  hasRecursiveWalk: boolean;
  hasRootContainment: boolean;
  hasSymlinkProtection: boolean;
  hasContentHashDedupe: boolean;
  hasResume: boolean;
  hasProvenance: boolean;
  hasErrorContinuation: boolean;
  hasEntityClassification: boolean;
  hasReviewQueue: boolean;
  hasImportDashboard: boolean;
  approvedImportRoots: number;
  documentsWithHash: number;
  reviewOpen: number;
  queueSources: number;
}

const REQUIRED_IDS = [
  "recursive-walk",
  "root-containment",
  "content-hash-dedupe",
  "error-continuation",
  "review-queue",
  "import-dashboard",
] as const;

export function buildImportReadinessReport(input: ImportReadinessInputV1): ImportReadinessReportV1 {
  const capabilities: BulkCapabilityItemV1[] = [
    {
      id: "recursive-walk",
      label: "Bounded recursive folder traversal",
      state: input.hasRecursiveWalk ? "ready" : "missing",
      detail: input.hasRecursiveWalk
        ? "Owner-approved folder roots are walked recursively with depth/file/size caps."
        : "Recursive walk not available.",
    },
    {
      id: "root-containment",
      label: "Approved-root containment",
      state: input.hasRootContainment ? "ready" : "missing",
      detail: "Imports refuse paths outside Settings import roots or private AION data.",
    },
    {
      id: "symlink-protection",
      label: "Symlink/junction escape protection",
      state: input.hasSymlinkProtection ? "ready" : "missing",
      detail: "Links that leave the approved root are skipped, not followed blindly.",
    },
    {
      id: "content-hash-dedupe",
      label: "Content-hash skip and dedupe",
      state: input.hasContentHashDedupe ? "ready" : "missing",
      detail: "SHA-256 content hashing skips unchanged and duplicate files.",
    },
    {
      id: "resume",
      label: "Resumable / idempotent re-import",
      state: input.hasResume ? "ready" : "partial",
      detail: "Known hashes and provenance enable safe re-runs without double-ingest.",
    },
    {
      id: "provenance",
      label: "Relative path / mtime provenance",
      state: input.hasProvenance ? "ready" : "partial",
      detail: "Documents retain sourceRelativePath, sourceModifiedAt, sourceRootPath when bulk-imported.",
    },
    {
      id: "error-continuation",
      label: "Per-file error continuation",
      state: input.hasErrorContinuation ? "ready" : "missing",
      detail: "One bad file does not abort the entire import.",
    },
    {
      id: "entity-classification",
      label: "Entity classification",
      state: input.hasEntityClassification ? "ready" : "partial",
      detail: "High-confidence extracts auto-associate; uncertain items queue for review. No invented facts.",
    },
    {
      id: "review-queue",
      label: "Ambiguity / review queue",
      state: input.hasReviewQueue ? "ready" : "missing",
      detail: "Owner can accept/reject uncertain classifications.",
    },
    {
      id: "import-dashboard",
      label: "Import status dashboard",
      state: input.hasImportDashboard ? "ready" : "missing",
      detail: "Queued / Processing / Completed / Needs Review / Failed with counts.",
    },
  ];

  const blockers = capabilities
    .filter((c) => REQUIRED_IDS.includes(c.id as (typeof REQUIRED_IDS)[number]) && c.state === "missing")
    .map((c) => c.label);

  const ready = blockers.length === 0;
  const partial = !ready && capabilities.some((c) => c.state === "ready");

  const firstSources: FirstImportSourceV1[] = [
    {
      id: "owner-resume-folder",
      title: "Resume / CV folder (small, nested OK)",
      why: "High value for Owner knowledge (employment, skills) with clear classification signals.",
      how: "Add the parent folder under Settings → Approved import roots, then Knowledge → Import folder (recursive) or queue a folder source.",
      risk: "low",
      requiresOwnerPath: true,
    },
    {
      id: "brand-info-json",
      title: "Brand / business notes (JSON, MD, TXT)",
      why: "Feeds brand registry without inventing positioning or collaborators.",
      how: "Owner-selected brand folder under an approved root; review queue catches ambiguous items.",
      risk: "low",
      requiresOwnerPath: true,
    },
    {
      id: "customer-notes-sales",
      title: "Sales notes / customer folders (TXT, MD, CSV contacts)",
      why: "CRM relationships and opportunities from Owner-written notes only.",
      how: "Import nested sales/customer folders recursively, or paste CSV contacts. Duplicates are hash-skipped.",
      risk: "low",
      requiresOwnerPath: true,
    },
    {
      id: "phone-photo-intake",
      title: "Phone photo intake (same LAN)",
      why: "Captures quotes, whiteboards, receipts into private intake with phone-intake tags.",
      how: "Enable private phone access, pair once, open the live phone URL, upload. Vision OCR is optional.",
      risk: "low",
      requiresOwnerPath: false,
    },
    {
      id: "gmail-after-oauth",
      title: "Gmail threads (after Owner OAuth only)",
      why: "Commitments and CRM association from real mail — never password scrape.",
      how: "Settings → Connectors → Gmail client id + consent; store refresh token in env. Fixtures work until then.",
      risk: "medium",
      requiresOwnerPath: false,
    },
  ];

  const ownerActions: string[] = [];
  if (input.approvedImportRoots === 0) {
    ownerActions.push(
      "Add at least one approved import root in Settings (the parent of folders you will import — not a whole drive).",
    );
  }
  ownerActions.push(
    "Pick one first source below (resume folder or brand notes recommended). AION will not scan drives unprompted.",
  );
  if (input.reviewOpen > 0) {
    ownerActions.push(`Resolve ${input.reviewOpen} open import review item(s) under Knowledge → Import dashboard.`);
  }

  const code = ready
    ? "REAL_BULK_INGESTION_READY"
    : partial
      ? "REAL_BULK_INGESTION_PARTIAL"
      : "REAL_BULK_INGESTION_NOT_READY";

  const summary = ready
    ? "Recursive bulk ingestion is ready for Owner-selected folder roots. Not a whole-drive scan. Use first sources below."
    : partial
      ? `Bulk ingestion is partial; missing: ${blockers.join(", ") || "unknown"}.`
      : "Bulk ingestion is not ready for real Owner archives.";

  const highestValueSourceTypes = [
    "Resume / career folder (employment, skills, experience)",
    "Brand / business notes (positioning, products, collaborators)",
    "Sales / customer notes or contacts CSV (CRM relationships)",
  ];

  return {
    code,
    ready,
    // Ready when pipeline gates pass — Owner may still need to pick their first folder.
    realOwnerImportReady: ready,
    summary,
    capabilities,
    firstSources,
    blockers,
    ownerActions,
    highestValueSourceTypes,
    stats: {
      approvedImportRoots: input.approvedImportRoots,
      documentsWithHash: input.documentsWithHash,
      reviewOpen: input.reviewOpen,
      queueSources: input.queueSources,
    },
  };
}
