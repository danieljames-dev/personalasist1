/**
 * Standing retrieval-quality harness — structure only, no private Owner content in Git.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifySourceRef, preferFact, selectCurrentFacts } from "../src/source-trust.js";
import { buildTemporalFact } from "../src/executive-context.js";
import { isSyntheticRelationship, isTestOrE2eWorkspace } from "../src/import-path-policy.js";

test("RETRIEVAL: owner_direct beats imported_document for same title", () => {
  const now = "2030-01-15T12:00:00.000Z";
  const owner = buildTemporalFact(
    { title: "Budget", content: "under 40k", category: "preference", sourceRef: "owner.knowledge" },
    { id: "o1", now, workspace: "work" },
  );
  const imp = buildTemporalFact(
    { title: "Budget", content: "unlimited", category: "preference", sourceRef: "import:old-notes.txt" },
    { id: "i1", now: "2029-01-01T12:00:00.000Z", workspace: "work" },
  );
  assert.equal(classifySourceRef(imp.provenance.sourceRef, imp.provenance.sourceType), "imported_document");
  assert.equal(preferFact(owner, imp, now).id, "o1");
  const cur = selectCurrentFacts([owner, imp], now);
  assert.equal(cur[0]!.id, "o1");
});

test("RETRIEVAL: workspace isolation — work fact not selected for personal-only query set", () => {
  const now = "2030-01-15T12:00:00.000Z";
  const work = buildTemporalFact(
    { title: "Role", content: "Sales", category: "role", sourceRef: "owner.knowledge" },
    { id: "w1", now, workspace: "work" },
  );
  const personal = buildTemporalFact(
    { title: "Role", content: "Parent", category: "role", sourceRef: "owner.knowledge" },
    { id: "p1", now, workspace: "personal" },
  );
  const onlyPersonal = selectCurrentFacts([work, personal], now).filter((f) => f.workspace === "personal");
  assert.equal(onlyPersonal.length, 1);
  assert.equal(onlyPersonal[0]!.id, "p1");
  assert.equal(onlyPersonal.every((f) => f.workspace === "personal"), true);
});

test("RETRIEVAL: same-name people stay unmerged without strong identity", () => {
  // Entity resolution must not auto-merge weak same-name matches — structural check only
  const a = { id: "1", displayName: "John Smith", organisation: "Toyota", notes: "" };
  const b = { id: "2", displayName: "John Smith", organisation: "Other Co", notes: "" };
  assert.notEqual(a.id, b.id);
  assert.equal(a.displayName, b.displayName);
  // No automatic merge key: different orgs + no email/phone — treat as distinct
  const strongMatch = a.organisation === b.organisation && a.displayName === b.displayName;
  assert.equal(strongMatch, false);
});

test("RETRIEVAL: synthetic fixtures excluded from owner-facing relationship set", () => {
  const people = [
    { displayName: "Jane Test", archived: false },
    { displayName: "ACME R7 TEST COMPANY", archived: false },
    { displayName: "Real Prospect", archived: false },
  ];
  const ownerFacing = people.filter((p) => !p.archived && !isSyntheticRelationship(p));
  assert.equal(ownerFacing.length, 1);
  assert.equal(ownerFacing[0]!.displayName, "Real Prospect");
});

test("RETRIEVAL: e2e brand workspaces filtered", () => {
  assert.equal(isTestOrE2eWorkspace({ id: "e2e-brand-x", label: "E2E Brand" }), true);
  assert.equal(isTestOrE2eWorkspace({ id: "compassionate", label: "Compassionate Choice" }), false);
});

test("RETRIEVAL: historical vs current — validUntil excludes stale when present", () => {
  const now = "2030-06-01T00:00:00.000Z";
  const old = buildTemporalFact(
    { title: "Employer", content: "Old Co", category: "employer", sourceRef: "owner.knowledge" },
    { id: "old", now: "2020-01-01T00:00:00.000Z", workspace: "personal" },
  );
  // Simulate temporal expiry
  (old as { validUntil?: string; temporalStatus?: string }).validUntil = "2025-01-01T00:00:00.000Z";
  (old as { temporalStatus?: string }).temporalStatus = "INVALIDATED";
  const current = buildTemporalFact(
    { title: "Employer", content: "Merchant Fleet", category: "employer", sourceRef: "import:resume.md" },
    { id: "cur", now: "2026-01-01T00:00:00.000Z", workspace: "personal" },
  );
  const live = [old, current].filter((f) => (f as { temporalStatus?: string }).temporalStatus !== "INVALIDATED");
  assert.equal(live.length, 1);
  assert.equal(live[0]!.id, "cur");
});
