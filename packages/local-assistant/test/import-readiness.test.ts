import assert from "node:assert/strict";
import test from "node:test";
import { buildImportReadinessReport } from "../src/import-readiness.js";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";
import {
  imageUnderstandingStatus,
  extractImageMetadataOnly,
  extractImageWithLocalVision,
} from "../src/connectors/image-understanding.js";

test("import readiness READY when all capabilities present", () => {
  const r = buildImportReadinessReport({
    hasRecursiveWalk: true,
    hasRootContainment: true,
    hasSymlinkProtection: true,
    hasContentHashDedupe: true,
    hasResume: true,
    hasProvenance: true,
    hasErrorContinuation: true,
    hasEntityClassification: true,
    hasReviewQueue: true,
    hasImportDashboard: true,
    approvedImportRoots: 1,
    documentsWithHash: 3,
    reviewOpen: 0,
    queueSources: 0,
  });
  assert.equal(r.code, "REAL_BULK_INGESTION_READY");
  assert.equal(r.ready, true);
  assert.ok(r.firstSources.length >= 3);
  assert.ok(r.firstSources.some((s) => s.id === "owner-resume-folder"));
});

test("import readiness not ready when recursive walk missing", () => {
  const r = buildImportReadinessReport({
    hasRecursiveWalk: false,
    hasRootContainment: true,
    hasSymlinkProtection: true,
    hasContentHashDedupe: true,
    hasResume: true,
    hasProvenance: true,
    hasErrorContinuation: true,
    hasEntityClassification: true,
    hasReviewQueue: true,
    hasImportDashboard: true,
    approvedImportRoots: 0,
    documentsWithHash: 0,
    reviewOpen: 0,
    queueSources: 0,
  });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.some((b) => /recursive/i.test(b)));
  assert.ok(r.ownerActions.some((a) => /import root/i.test(a)));
});

test("assistant routes import readiness and connector status", () => {
  assert.equal(routeCrmAssistantIntent("What should I import first?").intent, "IMPORT_STATUS");
  assert.equal(routeCrmAssistantIntent("Is bulk ingestion ready?").intent, "IMPORT_STATUS");
  assert.equal(routeCrmAssistantIntent("Gmail status please").intent, "CONNECTOR_STATUS");
  assert.equal(routeCrmAssistantIntent("vision model status").intent, "CONNECTOR_STATUS");
});

test("image status requires provider unless env set", () => {
  const s = imageUnderstandingStatus({});
  assert.equal(s.code, "IMAGE_EXTRACTION_PROVIDER_REQUIRED");
  const ready = imageUnderstandingStatus({
    AION_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    AION_VISION_MODEL: "moondream",
  });
  assert.equal(ready.code, "READY");
  assert.equal(ready.visionModel, "moondream");
});

test("vision call falls back without inventing OCR when fetch fails", async () => {
  const result = await extractImageWithLocalVision({
    filename: "x.png",
    mimeType: "image/png",
    byteLength: 4,
    bytes: Buffer.from([1, 2, 3, 4]),
    env: {
      AION_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      AION_VISION_MODEL: "moondream",
    },
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.ok(result.code === "VISION_CALL_FAILED" || result.code === "LOCAL_FALLBACK_METADATA_ONLY");
  assert.equal(result.extractedText, "");
  // Must not fabricate OCR body text; failure path keeps extractedText empty.
  assert.ok(!/\b555-01\d{2}\b/.test(result.description));
  assert.ok(result.facts.length === 0);
});

test("metadata only never fabricates OCR", () => {
  const m = extractImageMetadataOnly({ filename: "a.jpg", mimeType: "image/jpeg", byteLength: 10 });
  assert.equal(m.extractedText, "");
  assert.equal(m.code, "LOCAL_FALLBACK_METADATA_ONLY");
});
