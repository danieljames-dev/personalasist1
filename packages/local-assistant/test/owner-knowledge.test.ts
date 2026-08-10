import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOwnerProfileSummary,
  buildBrandCollaborator,
  buildOwnerKnowledgeFact,
  correctOwnerKnowledgeFact,
  emptyOwnerKnowledge,
} from "../src/owner-knowledge.js";

const now = "2030-01-01T00:00:00.000Z";

test("empty owner knowledge is structured not a blob", () => {
  const k = emptyOwnerKnowledge();
  assert.equal(k.profile.displayName, "");
  assert.deepEqual(k.facts, []);
});

test("build owner knowledge fact with provenance", () => {
  const f = buildOwnerKnowledgeFact(
    {
      category: "skill",
      title: "Negotiation",
      content: "10 years B2B sales negotiation",
      confidence: 90,
      sourceRef: "resume.pdf",
    },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now },
  );
  assert.equal(f.category, "skill");
  assert.equal(f.confidence, 90);
  assert.equal(f.provenance.sourceType, "owner");
  assert.match(f.provenance.sourceRef, /resume/);
});

test("correction preserves history", () => {
  const f = buildOwnerKnowledgeFact(
    { category: "employment", title: "Role", content: "Sales rep" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", now },
  );
  const c = correctOwnerKnowledgeFact(f, "Senior sales rep", "Title corrected", "2030-01-02T00:00:00.000Z");
  assert.equal(c.content, "Senior sales rep");
  assert.equal(c.corrections.length, 1);
  assert.equal(c.corrections[0]!.previousContent, "Sales rep");
});

test("profile summary update", () => {
  const p = applyOwnerProfileSummary(emptyOwnerKnowledge().profile, { displayName: "Daniel", summary: "Owner" }, now);
  assert.equal(p.displayName, "Daniel");
  assert.equal(p.updatedAt, now);
});

test("collaborator never invents brand responsibility", () => {
  const c = buildBrandCollaborator(
    { name: "Caleb", role: "collaborator" },
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", now },
  );
  assert.equal(c.name, "Caleb");
  assert.equal(c.brandResponsibility, "");
  assert.equal(c.brandWorkspaceId, null);
});
