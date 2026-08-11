import assert from "node:assert/strict";
import test from "node:test";
import {
  isTestOrE2eWorkspace,
  isSyntheticRelationship,
  isSyntheticOwnerFacingText,
  isTechnicalNoiseKnowledgeFact,
  ownerOperationalWorkspaces,
  validateImportRootCandidate,
} from "../src/import-path-policy.js";

test("rejects whole drives and all-projects-API", () => {
  assert.equal(validateImportRootCandidate("C:\\").ok, false);
  assert.equal(validateImportRootCandidate("D:\\").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Users\\nearm\\all-projects-API").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Users\\nearm\\all-projects-API\\nested").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Windows\\System32\\foo").ok, false);
});

test("accepts normal document folders", () => {
  // Path may not exist on disk — validation is policy-only for shape
  const v = validateImportRootCandidate("C:\\Users\\User\\Documents\\Career");
  assert.equal(v.ok, true);
  assert.match(v.normalized, /Career/i);
});

test("rejects credential and OS trees", () => {
  assert.equal(validateImportRootCandidate("C:\\Users\\User\\.ssh\\keys").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Windows\\System32\\drivers").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Program Files\\Something").ok, false);
});

test("e2e workspaces filtered from owner operational list", () => {
  const list = ownerOperationalWorkspaces([
    { id: "personal", label: "Personal", archived: false },
    { id: "work", label: "Work", archived: false },
    { id: "e2e-brand-x", label: "E2E Brand x", archived: false },
    { id: "real-brand", label: "My Brand", archived: false },
  ]);
  assert.equal(list.some((w) => w.id === "e2e-brand-x"), false);
  assert.equal(list.some((w) => w.id === "real-brand"), true);
  assert.equal(isTestOrE2eWorkspace({ id: "e2e-brand-x", label: "E2E Brand" }), true);
});

test("synthetic people and technical noise knowledge filtered", () => {
  assert.equal(isSyntheticRelationship({ displayName: "Jane Test" }), true);
  assert.equal(isSyntheticRelationship({ displayName: "ACME R7 TEST COMPANY" }), true);
  assert.equal(isSyntheticRelationship({ displayName: "CSV E2E Contact" }), true);
  assert.equal(isSyntheticRelationship({ displayName: "Daniel Coffman" }), false);
  assert.equal(isSyntheticOwnerFacingText("Match for Mike: 2025 Toyota", "e2e fixture"), true);
  assert.equal(
    isTechnicalNoiseKnowledgeFact({
      category: "employment",
      title: "owner: MANIFEST.csv",
      content: 'path,name,ext,size_kb,modified,folder\n"C:\\Users\\nearm\\Documents',
    }),
    true,
  );
  assert.equal(
    isTechnicalNoiseKnowledgeFact({
      category: "employment",
      title: "Career summary — maritime + Army",
      content: "U.S. Army airborne combat engineer and merchant fleet Able Seaman",
    }),
    false,
  );
});
