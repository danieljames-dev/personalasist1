import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReviewItemPath,
  compressImportReviewQueue,
} from "../src/import-review-compress.js";
import type { ImportReviewItemV1 } from "../src/import-classify.js";

function item(partial: Partial<ImportReviewItemV1> & { id: string; sourcePath: string }): ImportReviewItemV1 {
  return {
    documentId: null,
    relativePath: partial.relativePath || "x.md",
    candidates: partial.candidates || [{ kind: "research-document", label: "r", excerpt: "", confidence: 30, evidence: [], knowledgeCategory: null }],
    reason: partial.reason || "Low confidence (30%)",
    errors: [],
    status: "needs-review",
    provenance: { sourceType: "import", sourceRef: "import:x", recordedAt: "2030-01-01T00:00:00.000Z" },
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    resolvedAt: null,
    ...partial,
  } as ImportReviewItemV1;
}

test("classify: AION docs technical noise auto-reject", () => {
  const d = classifyReviewItemPath({
    sourcePath: "C:\\AION-HQ\\docs\\architecture\\aion-v1.md",
  });
  assert.equal(d.action, "auto_reject");
  assert.equal(d.bucket, "TECHNICAL_NOISE");
});

test("classify: career path auto-accept", () => {
  const d = classifyReviewItemPath({
    sourcePath: "C:\\Users\\User\\Desktop\\Remote Job Kit - Daniel Coffman\\resume.md",
  });
  assert.equal(d.action, "auto_accept");
  assert.equal(d.bucket, "CAREER_EVIDENCE");
});

test("classify: compassionate business auto-accept", () => {
  const d = classifyReviewItemPath({
    sourcePath: "D:\\Compassionate Choice - Kristinas Business\\BUSINESS_STRUCTURE.md",
  });
  assert.equal(d.action, "auto_accept");
});

test("compress: reduces open queue deterministically", () => {
  const now = "2030-06-01T00:00:00.000Z";
  const items = [
    item({ id: "1", sourcePath: "C:\\AION-HQ\\docs\\x.md" }),
    item({ id: "2", sourcePath: "C:\\Users\\User\\Desktop\\Remote Job Kit - Daniel Coffman\\r.md" }),
    item({ id: "3", sourcePath: "C:\\Users\\User\\Desktop\\mystery\\notes.md", reason: "Ambiguous high-confidence" }),
    item({ id: "4", sourcePath: "C:\\Temp\\aion-smoke-bulk\\x.txt" }),
  ];
  const { stats, updated } = compressImportReviewQueue(items, now);
  assert.equal(stats.before, 4);
  assert.ok(stats.autoRejected >= 2);
  assert.ok(stats.autoAccepted >= 1);
  assert.equal(stats.afterOpen, updated.filter((i) => i.status === "needs-review").length);
  assert.ok(stats.afterOpen <= 2);
});
