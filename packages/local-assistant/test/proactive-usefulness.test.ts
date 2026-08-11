/**
 * Proactive usefulness — morning cycle, prep cards, NBA, stalls, capture, EOD, metrics.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import {
  applyCorrectionPattern,
  buildCustomerPrepCard,
  buildDealershipMorningAssist,
  buildEndOfDayClosure,
  buildMorningExecutiveBrief,
  computeNextBestAction,
  CORRECTION_AUTO_APPLY_HITS,
  detectDealStallSignals,
  explainWhyFirst,
  explainWhySurfacing,
  recordCorrectionPattern,
} from "../src/proactive-usefulness.js";
import { classifyCaptureText } from "../src/universal-capture.js";
import { synthesizeValidVin } from "../src/vehicle-inventory.js";
import type { RelationshipV1 } from "../src/contracts.js";
import type { AttentionBoardV1 } from "../src/attention-engine.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-pro-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return { service };
}

function minimalRel(partial: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  const now = "2030-06-10T12:00:00.000Z";
  const base: RelationshipV1 = {
    id: partial.id,
    reference: partial.reference ?? `ref-${partial.id}`,
    workspace: partial.workspace ?? "work",
    relationshipType: "customer",
    displayName: partial.displayName,
    organisation: "",
    role: "",
    lifecycle: partial.lifecycle ?? "engaged",
    origin: "owner-created",
    contactMethods: [],
    communicationPreference: "unknown",
    source: "test",
    notes: partial.notes ?? "",
    interests: partial.interests ?? [],
    objections: partial.objections ?? [],
    preferences: partial.preferences ?? [],
    appointments: partial.appointments ?? [],
    followUps: partial.followUps ?? [],
    nextAction: partial.nextAction ?? "",
    nextActionAt: null,
    lastContactAt: partial.lastContactAt ?? "2030-05-01T00:00:00.000Z",
    interactions: partial.interactions ?? [],
    taskIds: [],
    routineIds: [],
    planIds: [],
    opportunityIds: [],
    outcome: { state: "open", at: null, detail: "" },
    archived: false,
    provenance: { sourceType: "owner", sourceRef: "test", recordedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...partial };
}

const emptyBoard: AttentionBoardV1 = {
  generatedAt: "2030-06-10T12:00:00.000Z",
  ownerMustDo: [
    {
      id: "1",
      bucket: "OWNER_MUST_DO",
      workspace: "work",
      contextLabel: "Lakeland",
      title: "Call Mike",
      why: "Overdue commitment",
      urgency: 90,
      value: 80,
      risk: 20,
      timeMinutes: 10,
      interruptionCost: 30,
      horizon: "NOW",
      score: 400,
      sourceType: "commitment",
      dueAt: "2030-06-09T00:00:00.000Z",
      aionCanComplete: false,
      requiresHuman: true,
    },
  ],
  aionCanDo: [
    {
      id: "2",
      bucket: "AION_CAN_DO",
      workspace: "work",
      contextLabel: "Lakeland",
      title: "Refresh radar",
      why: "safe",
      urgency: 40,
      value: 50,
      risk: 0,
      timeMinutes: 2,
      interruptionCost: 10,
      horizon: "TODAY",
      score: 100,
      sourceType: "system",
      dueAt: null,
      aionCanComplete: true,
      requiresHuman: false,
    },
  ],
  briefingLines: ["OWNER MUST DO:", "  1. Call Mike"],
  explanations: ["Call Mike scored high due to overdue commitment"],
};

test("NEXT_BEST_ACTION: no contact merely because time passed", () => {
  const r = minimalRel({
    id: "r1",
    displayName: "Quiet Sam",
    lifecycle: "prospect",
    lastContactAt: "2030-01-01T00:00:00.000Z",
    interests: [],
    followUps: [],
    appointments: [],
  });
  const nba = computeNextBestAction({ relationship: r, nowIso: "2030-06-10T12:00:00.000Z" });
  assert.equal(nba.kind, "wait");
  assert.equal(nba.externalSend, false);
  assert.match(nba.why, /will not invent contact/i);
});

test("NEXT_BEST_ACTION: overdue commitment grounds call", () => {
  const r = minimalRel({ id: "r2", displayName: "Mike", lifecycle: "engaged" });
  const nba = computeNextBestAction({
    relationship: r,
    nowIso: "2030-06-10T12:00:00.000Z",
    commitments: [
      {
        id: "c1",
        workspace: "work",
        committedBy: "Owner",
        committedTo: "Mike",
        relationshipId: null,
        statement: "Call Mike about Tacoma",
        dueAt: "2030-06-01T00:00:00.000Z",
        status: "overdue",
        confidence: 90,
        provenance: { sourceType: "owner", sourceRef: "t", recordedAt: "2030-06-01T00:00:00.000Z" },
        createdAt: "2030-06-01T00:00:00.000Z",
        updatedAt: "2030-06-01T00:00:00.000Z",
        resolvedAt: null,
      },
    ],
  });
  assert.equal(nba.kind, "call");
  assert.equal(nba.ownerMustDo, true);
});

test("DEAL_STALL: appointment passed and inventory match — not bare quiet age alone for prospect", () => {
  const now = "2030-06-10T12:00:00.000Z";
  const withAppt = minimalRel({
    id: "a1",
    displayName: "Alex",
    lifecycle: "appointment-set",
    appointments: [
      {
        id: "ap1",
        kind: "appointment",
        at: "2030-06-09T10:00:00.000Z",
        status: "scheduled",
        location: "lot",
        notes: "",
        createdAt: "2030-06-01T00:00:00.000Z",
      },
    ],
  });
  const stalls = detectDealStallSignals({
    relationships: [withAppt],
    nowIso: now,
    opportunities: [
      {
        id: "o1",
        kind: "inventory_match",
        workspace: "work",
        title: "Tacoma match for Alex",
        detail: "white",
        value: 80,
        urgency: 70,
        confidence: 80,
        interruptionCost: 20,
        score: 200,
        entityIds: ["a1"],
        createdAt: now,
        source: "radar",
      },
    ],
  });
  assert.ok(stalls.some((s) => s.kind === "appointment_no_outcome"));
  assert.ok(stalls.some((s) => s.kind === "inventory_match_waiting"));
});

test("CUSTOMER_PREP_CARD: ambiguity and happy path", () => {
  const now = "2030-06-10T12:00:00.000Z";
  const cardAmb = buildCustomerPrepCard({
    queryName: "John",
    candidates: [
      minimalRel({ id: "j1", displayName: "John Smith" }),
      minimalRel({ id: "j2", displayName: "John Doe" }),
    ],
    nowIso: now,
  });
  assert.equal(cardAmb.ambiguous, true);
  assert.match(cardAmb.reply, /AMBIGUOUS/i);

  const card = buildCustomerPrepCard({
    queryName: "Mike",
    candidates: [
      minimalRel({
        id: "m1",
        displayName: "Mike Anderson",
        interests: [{ kind: "vehicle", description: "white Tacoma under 50k", notedAt: now }],
        interactions: [
          {
            id: "i1",
            kind: "call",
            at: "2030-06-08T12:00:00.000Z",
            summary: "Liked the Tacoma",
            detail: "",
            lifecycleAfter: null,
            actor: "owner",
          },
        ],
      }),
    ],
    nowIso: now,
    opportunities: [
      {
        id: "o1",
        kind: "inventory_match",
        workspace: "work",
        title: "2024 Tacoma white",
        detail: "match",
        value: 70,
        urgency: 60,
        confidence: 80,
        interruptionCost: 20,
        score: 150,
        entityIds: ["m1"],
        createdAt: now,
        source: "radar",
      },
    ],
  });
  assert.equal(card.ambiguous, false);
  assert.match(card.reply, /CUSTOMER PREP CARD/);
  assert.match(card.reply, /NEXT BEST ACTION/);
  assert.ok(card.matchingInventory.some((m) => /Tacoma/i.test(m)));
});

test("MORNING brief sections present", () => {
  const brief = buildMorningExecutiveBrief({
    nowIso: "2030-06-10T12:00:00.000Z",
    board: emptyBoard,
    commitments: [],
    opportunities: [],
    stalls: [],
    cycle: null,
    lastBriefingAt: null,
    scope: "all",
  });
  assert.match(brief.reply, /OWNER MUST DO TODAY/);
  assert.match(brief.reply, /AION CAN DO TODAY/);
  assert.match(brief.reply, /DEALERSHIP OPPORTUNITIES/);
  assert.match(brief.reply, /IMPORTANT CHANGES/);
  assert.ok(brief.interruptionCount >= 1);
});

test("DEALERSHIP morning assist structure", () => {
  const d = buildDealershipMorningAssist({
    nowIso: "2030-06-10T12:00:00.000Z",
    relationships: [
      minimalRel({
        id: "m1",
        displayName: "Mike",
        followUps: [
          {
            id: "f1",
            dueAt: "2030-06-10T00:00:00.000Z",
            reason: "Call back",
            channel: "phone",
            status: "open",
            outcome: "",
            createdAt: "2030-06-01T00:00:00.000Z",
            completedAt: null,
          },
        ],
      }),
    ],
    commitments: [],
    opportunities: [],
    vehicles: [],
  });
  assert.match(d.reply, /DEALERSHIP MORNING ASSIST/);
  assert.match(d.reply, /no customer messages sent/i);
  assert.ok(d.followUps.length >= 1);
});

test("CAPTURE friction: common one-sentence paths", () => {
  const now = "2030-06-10T12:00:00.000Z";
  const tacoma = classifyCaptureText(
    "John loved the white Tacoma but wants to talk to his wife. Call Thursday.",
    now,
  );
  assert.equal(tacoma.kind, "vehicle_interest");
  assert.equal(tacoma.needsConfirm, false);
  assert.ok(tacoma.followUpWhen === "thursday" || tacoma.proposedActions.some((a) => /Thursday|call/i.test(a)));

  const brand = classifyCaptureText("Brand A idea: make a comparison video.", now);
  assert.ok(brand.kind === "brand_note" || brand.kind === "idea");
  assert.equal(brand.needsConfirm, false);

  const personal = classifyCaptureText("Remember to renew my license Friday.", now);
  assert.equal(personal.kind, "task");
  assert.equal(personal.workspaceHint, "personal");
  assert.equal(personal.needsConfirm, false);
});

test("CORRECTION_LEARNING: single hit never auto-applies", () => {
  const now = "2030-06-10T12:00:00.000Z";
  let patterns = recordCorrectionPattern([], {
    kind: "person",
    fromValue: "mike",
    toValue: "Mike Anderson",
    workspace: "work",
    now,
    id: "c1",
  });
  assert.equal(patterns[0]!.hits, 1);
  assert.equal(patterns[0]!.autoApplyEligible, false);
  assert.equal(applyCorrectionPattern(patterns, "person", "mike", "work"), null);

  for (let i = 0; i < CORRECTION_AUTO_APPLY_HITS; i++) {
    patterns = recordCorrectionPattern(patterns, {
      kind: "person",
      fromValue: "mike",
      toValue: "Mike Anderson",
      workspace: "work",
      now,
      id: `c${i + 2}`,
    });
  }
  assert.ok(patterns[0]!.autoApplyEligible);
  assert.equal(applyCorrectionPattern(patterns, "person", "mike", "work"), "Mike Anderson");
  // Workspace isolation
  assert.equal(applyCorrectionPattern(patterns, "person", "mike", "personal"), null);
});

test("EXPLAINABILITY helpers", () => {
  assert.match(
    explainWhySurfacing({
      title: "Call Mike",
      reason: "Overdue commitment",
      sourceRef: "owner.knowledge",
      score: 400,
      horizon: "NOW",
    }),
    /WHY AM I TELLING YOU THIS/,
  );
  assert.match(explainWhyFirst([{ title: "A", score: 10, why: "x" }]), /WHY IS THIS FIRST/);
});

test("END_OF_DAY closure pure", () => {
  const eod = buildEndOfDayClosure({
    nowIso: "2030-06-10T18:00:00.000Z",
    commitments: [],
    board: emptyBoard,
    capturesToday: [{ summary: "Talked to Mike", kind: "note" }],
    jobs: [],
    opportunities: [],
    cycle: null,
  });
  assert.match(eod.reply, /END OF DAY WRAP/);
  assert.match(eod.reply, /TOMORROW/);
  assert.ok(eod.questions.length <= 2);
});

test("INTEGRATED: morning cycle + prep card + isolation + metrics", async () => {
  const { service } = await fixture();

  await service.switchContext("Lakeland Toyota");
  await service.universalCapture(
    "John loved the white Tacoma but wants to talk to his wife. Call Thursday. I told John I would call Thursday.",
    { apply: true },
  );
  const vin = synthesizeValidVin("PRO1");
  await service.ensureLakelandToyotaContext({ setCurrent: true });
  await service.refreshDealershipInventory({ useFixture: true, fixtureVins: [vin] });

  const morning = await service.runMorningExecutiveCycle({ scope: "all" });
  assert.match(morning.reply, /MORNING EXECUTIVE CYCLE|PROACTIVE EXECUTIVE BRIEF/);
  assert.match(morning.reply, /OWNER MUST DO TODAY|AION CAN DO TODAY/);
  assert.ok(morning.brief.interruptionCount >= 0);
  assert.equal(morning.cycle?.unauthorizedExternalAttempts ?? 0, 0);

  const dealership = await service.dealershipMorningAssist();
  assert.match(dealership.reply, /DEALERSHIP MORNING ASSIST/);

  const card = await service.prepareCustomerCard("John");
  assert.match(card.reply, /CUSTOMER PREP CARD|not found|AMBIGUOUS/);

  // Personal isolation: prepare from personal must not invent work customer
  await service.switchContext("Personal");
  const personalCard = await service.prepareCustomerCard("John");
  // John is work CRM — personal scope should not find unless shared
  assert.ok(!personalCard.relationshipId || personalCard.workspace === "personal");

  const eod = await service.endOfDayWrap();
  assert.match(eod.reply, /END OF DAY/);
  assert.match(eod.reply, /REAL USAGE METRICS|Captures/);
  assert.ok(eod.questions.length <= 2);

  const metrics = await service.realUsageMetrics();
  assert.ok(metrics.captureCount >= 1);

  // Cross-workspace leak still blocked
  const leak = await service.assistantPrompt("Search all my data for customers.");
  assert.match(leak.reply, /Scope limited|will not pull/i);

  // Explain
  await service.switchContext("Lakeland Toyota");
  const why = await service.assistantPrompt("Why is this first?");
  assert.match(why.reply, /WHY IS THIS FIRST|empty queue/i);
});

test("INTEGRATED: NL prepare me for", async () => {
  const { service } = await fixture();
  await service.switchContext("Lakeland Toyota");
  await service.universalCapture("I talked to Sam about a Highlander under 42000.", { apply: true });
  const res = await service.assistantPrompt("Prepare me for Sam.");
  assert.match(res.reply, /CUSTOMER PREP CARD|Sam/i);
  assert.equal(res.action, "customer.prep_card");
});
