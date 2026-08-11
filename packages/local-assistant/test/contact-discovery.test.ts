import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverContactsInDocument,
  isHighValueContactSourcePath,
  mapFunnelStageToLifecycle,
  mergeContactCandidates,
} from "../src/contact-discovery.js";

test("high-value paths only", () => {
  assert.equal(isHighValueContactSourcePath("D:\\Compassionate Choice - Kristinas Business\\x.md"), true);
  assert.equal(isHighValueContactSourcePath("C:\\AION-HQ\\docs\\architecture.md"), false);
  assert.equal(isHighValueContactSourcePath("C:\\Users\\User\\Desktop\\Claude_Grok_System\\x.json"), false);
});

test("discovers Kristina from business evidence", () => {
  const c = discoverContactsInDocument({
    documentId: "d1",
    filename: "EXTERNAL-DRIVE-README.txt",
    sourceRootPath: "D:\\Compassionate Choice - Kristinas Business",
    extractedText: "Owner: Kristina Diane Leach\nEmail: kris.leach0@gmail.com\nPhone: (863) 812-9362\n",
  });
  assert.ok(c.some((x) => /Kristina/i.test(x.displayName)));
  assert.ok(c.some((x) => x.class === "COLLABORATOR"));
  assert.ok(c.some((x) => /kris\.leach/i.test(x.email)));
});

test("ignores technical docs", () => {
  const c = discoverContactsInDocument({
    documentId: "d2",
    filename: "watchdog_state.json",
    sourceRootPath: "C:\\Users\\User\\Desktop\\Claude_Grok_System",
    extractedText: "phone 1778871139 email test@example.com Owner: Fake Name",
  });
  assert.equal(c.length, 0);
});

test("merge by email", () => {
  const m = mergeContactCandidates([
    {
      displayName: "Kristina Leach",
      class: "COLLABORATOR",
      organisation: "Compassionate Choice LLC",
      email: "kris.leach0@gmail.com",
      phone: "",
      role: "Owner",
      workspaceHint: "compassionate-choice",
      confidence: 80,
      evidence: ["a"],
      sourcePath: "x",
      sourceDocumentId: "1",
    },
    {
      displayName: "Kristina Leach",
      class: "COLLABORATOR",
      organisation: "Compassionate Choice LLC",
      email: "kris.leach0@gmail.com",
      phone: "863-812-9362",
      role: "Founder",
      workspaceHint: "compassionate-choice",
      confidence: 90,
      evidence: ["b"],
      sourcePath: "y",
      sourceDocumentId: "2",
    },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0]!.phone.includes("863"), true);
  assert.equal(m[0]!.confidence, 90);
});

test("funnel stage mapping", () => {
  assert.equal(mapFunnelStageToLifecycle("NEW_LEAD"), "prospect");
  assert.equal(mapFunnelStageToLifecycle("SOLD"), "sold");
  assert.equal(mapFunnelStageToLifecycle("TEST_DRIVE"), "appointment-shown");
});
