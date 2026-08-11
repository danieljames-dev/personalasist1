/**
 * Deterministic import-review compression.
 * Auto-resolve only when classification is safe without inventing Owner answers.
 */
import type { ImportReviewItemV1, ImportReviewStatusV1 } from "./import-classify.js";

export type ReviewCompressBucketV1 =
  | "TECHNICAL_NOISE"
  | "SYNTHETIC_TEST"
  | "TRAINING_ARCHIVE"
  | "TRADING_NOISE"
  | "CAREER_EVIDENCE"
  | "BUSINESS_EVIDENCE"
  | "REAL_OWNER_REVIEW"
  | "GROUP_CONFIRMABLE";

export interface ReviewCompressDecisionV1 {
  id: string;
  bucket: ReviewCompressBucketV1;
  action: "auto_reject" | "auto_accept" | "keep_review";
  groupKey: string;
  reason: string;
}

export function classifyReviewItemPath(item: {
  sourcePath?: string;
  relativePath?: string;
  reason?: string;
  candidates?: Array<{ kind?: string; confidence?: number }>;
}): ReviewCompressDecisionV1 {
  const path = `${item.sourcePath ?? ""} ${item.relativePath ?? ""}`;
  const reason = String(item.reason ?? "");
  const kinds = (item.candidates ?? []).map((c) => String(c.kind ?? "")).join(" ");
  const conf = Math.max(0, ...(item.candidates ?? []).map((c) => Number(c.confidence) || 0));
  const id = ""; // filled by caller

  // Synthetic / temp smoke
  if (/\\Temp\\|\/Temp\/|aion-smoke|owner-first-sources|\\intake\\|e2e|synthetic|fixture/i.test(path)) {
    return {
      id,
      bucket: "SYNTHETIC_TEST",
      action: "auto_reject",
      groupKey: "synthetic_test_imports",
      reason: "Synthetic/test/temp import path — not Owner operational review.",
    };
  }

  // AION repository technical documentation
  if (/AION-HQ[\\/]docs|\\AION-HQ\\docs|packages\\local-assistant|\\\\docs\\\\architecture|\\\\docs\\\\security/i.test(path)) {
    return {
      id,
      bucket: "TECHNICAL_NOISE",
      action: "auto_reject",
      groupKey: "aion_technical_docs",
      reason: "AION technical/project documentation — not Owner life CRM review.",
    };
  }

  // Claude/Grok audit archives
  if (/Claude_Grok_System|audit_archive/i.test(path)) {
    return {
      id,
      bucket: "TECHNICAL_NOISE",
      action: "auto_reject",
      groupKey: "claude_grok_audit_archive",
      reason: "Development audit archive — technical noise for Owner operational views.",
    };
  }

  // AI Assistant Training dumps
  if (/AI Assistant Training/i.test(path)) {
    return {
      id,
      bucket: "TRAINING_ARCHIVE",
      action: "auto_reject",
      groupKey: "ai_assistant_training_archive",
      reason: "Training/export archive — keep as source docs, not open review items.",
    };
  }

  // Trading checklist bulk (low CRM value)
  if (/E8 Daily Trading|trading checklist|NinjaTrader/i.test(path)) {
    return {
      id,
      bucket: "TRADING_NOISE",
      action: "auto_reject",
      groupKey: "trading_personal_noise",
      reason: "Trading checklist/personal noise — not CRM customer review.",
    };
  }

  // Career kit — deterministic accept as career evidence
  if (/Remote Job Kit|resume|cover.?letter|maritime|Daniel_Coffman/i.test(path)) {
    return {
      id,
      bucket: "CAREER_EVIDENCE",
      action: "auto_accept",
      groupKey: "career_remote_job_kit",
      reason: "Career/resume/work-history path — auto-accept as career evidence (imported_document trust).",
    };
  }

  // Compassionate Choice business
  if (/Compassionate Choice|kristina/i.test(path)) {
    return {
      id,
      bucket: "BUSINESS_EVIDENCE",
      action: "auto_accept",
      groupKey: "compassionate_choice_business",
      reason: "Compassionate Choice business path — auto-accept as business evidence.",
    };
  }

  // Very low confidence research-document only
  if (conf > 0 && conf < 40 && /research-document/i.test(kinds) && /Low confidence/i.test(reason)) {
    return {
      id,
      bucket: "TECHNICAL_NOISE",
      action: "auto_reject",
      groupKey: "low_conf_research_docs",
      reason: "Low-confidence research-document with no strong Owner entity signal.",
    };
  }

  return {
    id,
    bucket: "REAL_OWNER_REVIEW",
    action: "keep_review",
    groupKey: "remaining_owner_review",
    reason: "Needs Owner or grouped confirmation.",
  };
}

export function compressImportReviewQueue(
  items: readonly ImportReviewItemV1[],
  now: string,
): {
  updated: ImportReviewItemV1[];
  stats: {
    before: number;
    afterOpen: number;
    autoRejected: number;
    autoAccepted: number;
    kept: number;
    groups: Array<{ groupKey: string; bucket: string; count: number; action: string; samplePaths: string[] }>;
  };
} {
  const open = items.filter((i) => i.status === "needs-review");
  const closed = items.filter((i) => i.status !== "needs-review");
  const groupMap = new Map<string, { bucket: string; action: string; count: number; samplePaths: string[] }>();
  let autoRejected = 0;
  let autoAccepted = 0;
  let kept = 0;
  const nextOpen: ImportReviewItemV1[] = [];

  for (const item of open) {
    const d = classifyReviewItemPath(item);
    d.id = item.id;
    const g = groupMap.get(d.groupKey) ?? {
      bucket: d.bucket,
      action: d.action,
      count: 0,
      samplePaths: [],
    };
    g.count += 1;
    if (g.samplePaths.length < 3) {
      g.samplePaths.push(String(item.relativePath || item.sourcePath || "").slice(0, 120));
    }
    groupMap.set(d.groupKey, g);

    if (d.action === "auto_reject") {
      autoRejected += 1;
      nextOpen.push({
        ...item,
        status: "rejected" as ImportReviewStatusV1,
        reason: `${item.reason} · AUTO:${d.reason}`,
        updatedAt: now,
        resolvedAt: now,
      });
    } else if (d.action === "auto_accept") {
      autoAccepted += 1;
      nextOpen.push({
        ...item,
        status: "accepted" as ImportReviewStatusV1,
        reason: `${item.reason} · AUTO:${d.reason}`,
        updatedAt: now,
        resolvedAt: now,
      });
    } else {
      kept += 1;
      nextOpen.push(item);
    }
  }

  const stillOpen = nextOpen.filter((i) => i.status === "needs-review");
  const justResolved = nextOpen.filter((i) => i.status !== "needs-review");
  // Open first, then newly resolved, then previously closed — hard cap
  const updated = [...stillOpen, ...justResolved, ...closed].slice(0, 800);

  return {
    updated,
    stats: {
      before: open.length,
      afterOpen: stillOpen.length,
      autoRejected,
      autoAccepted,
      kept,
      groups: [...groupMap.entries()]
        .map(([groupKey, v]) => ({
          groupKey,
          bucket: v.bucket,
          count: v.count,
          action: v.action,
          samplePaths: v.samplePaths,
        }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
