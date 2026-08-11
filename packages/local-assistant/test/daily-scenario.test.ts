/**
 * Realistic multi-context Owner day — end-to-end isolation + executive flow.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AionAssistantV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mayUseAcrossContexts } from "../src/executive-context.js";
import { classifyCaptureText } from "../src/universal-capture.js";
import { extractCommitmentCandidates } from "../src/commitments.js";
import {
  detectFactConflicts,
  explainBelief,
  isStaleFact,
  attentionHorizon,
  opportunityShouldSurface,
} from "../src/source-trust.js";
import { buildTemporalFact } from "../src/executive-context.js";
import { synthesizeValidVin } from "../src/vehicle-inventory.js";
import { inferImportWorkspace } from "../src/import-workspace-map.js";

async function fixture(clock?: DeterministicClockV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-daily-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: clock ?? new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents,
  });
  return { service, root };
}

test("DAILY_SCENARIO: multi-context day with isolation", async () => {
  const { service } = await fixture();
  // Brand workspace
  await service.createWorkspace({
    label: "Brand A",
    kind: "business",
    purpose: "Owner brand",
    brand: { name: "Brand A", positioning: "test", audience: "fans", channels: ["instagram"] },
  });

  await service.switchContext("Personal");
  await service.universalCapture("Remember I need to renew insurance Friday.", { apply: true });

  await service.switchContext("Lakeland Toyota");
  const cap = await service.universalCapture(
    "I just talked to Mike. He likes the Limited Tacoma under 50000. Follow up tomorrow. I told Mike I would call tomorrow.",
    { apply: true },
  );
  assert.ok(cap.applied.length > 0 || cap.classification.kind === "vehicle_interest");

  const vin = synthesizeValidVin("DAY1");
  await service.ensureLakelandToyotaContext({ setCurrent: true, ownerWorksHere: true });
  await service.refreshDealershipInventory({ useFixture: true, fixtureVins: [vin] });
  await service.startInventoryWalk();
  await service.recordWalkObservation({ vin, entryMethod: "manual" });

  await service.switchContext("Brand A");
  await service.universalCapture("Brand A idea: comparison video for the new offer.", { apply: true });
  const snap0 = await service.snapshot();
  const brandId = snap0.workspaces.find((w) => /brand a/i.test(w.label || w.brand?.name || ""))?.id;
  if (brandId) await service.upsertBrandDna(brandId, { purpose: "Help owners grow", voice: "clear", goals: "leads" });

  await service.switchContext("Personal");
  const personalSnap = await service.snapshot();
  assert.equal(
    personalSnap.relationships.filter((r) => r.workspace === "personal" && /mike/i.test(r.displayName)).length,
    0,
    "Mike is dealership CRM, not personal",
  );
  assert.ok(
    personalSnap.relationships.some((r) => r.workspace === "work" && /mike/i.test(r.displayName)) ||
      (await service.snapshot()).relationships.some((r) => r.workspace === "work"),
  );

  assert.equal(
    mayUseAcrossContexts({
      sourceWorkspace: "work",
      activeWorkspace: brandId || "brand-a",
      visibility: "WORKSPACE_ONLY",
    }).allowed,
    false,
  );

  const eod = await service.endOfDayWrap();
  assert.match(eod.reply, /END OF DAY|MUST DO|AION|WHAT DO I NEED/i);

  const board = await service.attentionBoard();
  assert.ok(board.briefingLines.some((l) => /WHAT DO I NEED TO DO|OWNER MUST|AION/i.test(l)));

  const maint = await service.runDailyMaintenance();
  assert.ok(typeof maint.staleFacts === "number");

  const weekly = await service.weeklyCeoReview();
  assert.match(weekly.reply, /WEEKLY CEO|COMMITMENTS|VALUE/i);

  const ledger = (await service.snapshot()).executive?.valueLedger ?? [];
  assert.ok(ledger.some((e) => e.estimateKind === "estimated"));
});

test("CROSS_CONTEXT: adversarial broad prompts stay scoped", async () => {
  const { service } = await fixture();
  await service.switchContext("Lakeland Toyota");
  await service.universalCapture("I talked to Sarah about a Highlander.", { apply: true });
  await service.switchContext("Personal");
  const reply = await service.assistantPrompt("Search all my data for customers.");
  assert.match(reply.reply, /Scope limited|active context|will not pull/i);
  assert.doesNotMatch(reply.reply, /Sarah/i);
});

test("COMMITMENT extraction from capture language", () => {
  const c = extractCommitmentCandidates(
    "I told John I would call tomorrow about the Camry.",
    "2030-06-10T12:00:00.000Z",
  );
  assert.ok(c.length >= 1);
  assert.equal(c[0]!.committedBy, "Owner");
  assert.equal(c[0]!.committedTo, "John");
});

test("SOURCE TRUST explain and conflict supersession", () => {
  const now = "2030-06-10T12:00:00.000Z";
  const older = buildTemporalFact(
    {
      title: "Mike budget",
      content: "under 45k",
      category: "preference",
      sourceRef: "import:old-note",
    },
    { id: "f1", now: "2030-01-01T00:00:00.000Z", workspace: "work" },
  );
  const newer = buildTemporalFact(
    {
      title: "Mike budget",
      content: "can go to 50k",
      category: "preference",
      sourceRef: "owner.knowledge",
    },
    { id: "f2", now, workspace: "work" },
  );
  const conflicts = detectFactConflicts([older, newer], now);
  assert.ok(conflicts.some((c) => c.resolution === "supersede_older"));
  assert.match(
    explainBelief({ statement: "on lot", sourceRef: "inventory.walk", sourceType: "owner" }),
    /physical_observation|trust/i,
  );
});

test("TEMPORAL staleness: inventory volatile vs stable name", () => {
  const now = "2030-06-10T00:00:00.000Z";
  const inv = buildTemporalFact(
    { title: "stock", content: "available", category: "inventory", sourceRef: "listing" },
    { id: "i1", now: "2030-01-01T00:00:00.000Z", workspace: "work" },
  );
  inv.lastConfirmedAt = "2030-01-01T00:00:00.000Z";
  assert.equal(isStaleFact(inv, now), true);
  const name = buildTemporalFact(
    { title: "legal name", content: "Owner", category: "profile", sourceRef: "owner" },
    { id: "n1", now: "2020-01-01T00:00:00.000Z", workspace: "personal" },
  );
  name.lastConfirmedAt = "2028-01-01T00:00:00.000Z";
  assert.equal(isStaleFact(name, now), false);
});

test("ATTENTION BUDGET horizons and opportunity noise filter", () => {
  assert.equal(
    attentionHorizon({
      urgency: 95,
      value: 80,
      confidence: 90,
      interruptionCost: 20,
      dueAt: "2030-06-09T00:00:00.000Z",
      nowIso: "2030-06-10T00:00:00.000Z",
    }),
    "NOW",
  );
  assert.equal(
    opportunityShouldSurface({ value: 20, urgency: 20, confidence: 30, interruptionCost: 80, score: 40 }),
    false,
  );
});

test("IDENTITY multi-Mike requires confirm", () => {
  const c = classifyCaptureText("Talked to Mike about Tacoma", "2030-06-10T00:00:00.000Z", {
    existingPeople: [
      { id: "1", displayName: "Mike A", workspace: "work" },
      { id: "2", displayName: "Mike B", workspace: "work" },
    ],
  });
  assert.equal(c.needsConfirm, true);
  assert.ok(c.ambiguousPersonIds.length >= 2);
});

test("IMPORT realism mixed folders", () => {
  assert.equal(inferImportWorkspace({ path: "C:\\Career\\Resume.pdf" }).role, "CAREER");
  assert.equal(inferImportWorkspace({ path: "C:\\Lakeland\\vins\\notes.txt" }).role, "DEALERSHIP");
  assert.equal(
    inferImportWorkspace({
      path: "C:\\Brands\\Brand A\\assets\\x.png",
      brandWorkspaceIds: [{ id: "brand-a", label: "Brand A" }],
    }).workspaceId,
    "brand-a",
  );
  assert.equal(inferImportWorkspace({ path: "C:\\Personal\\shopping.txt" }).role, "PERSONAL");
});
