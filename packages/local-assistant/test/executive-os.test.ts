import assert from "node:assert/strict";
import test from "node:test";
import {
  mayUseAcrossContexts,
  resolveContextSwitch,
  emptyExecutiveContext,
  buildTemporalFact,
  supersedeTemporalFact,
  buildGraphEdge,
} from "../src/executive-context.js";
import { buildAttentionBoard } from "../src/attention-engine.js";
import { classifyCaptureText } from "../src/universal-capture.js";
import { detectInventoryMatches, buildValueLedgerEntry } from "../src/opportunity-radar.js";
import type { RelationshipV1 } from "../src/contracts.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import { synthesizeValidVin } from "../src/vehicle-inventory.js";

test("workspace-only facts do not leak across contexts", () => {
  const deny = mayUseAcrossContexts({
    sourceWorkspace: "work",
    activeWorkspace: "personal",
    visibility: "WORKSPACE_ONLY",
  });
  assert.equal(deny.allowed, false);
  const share = mayUseAcrossContexts({
    sourceWorkspace: "work",
    activeWorkspace: "personal",
    visibility: "OWNER_SHARED",
  });
  assert.equal(share.allowed, true);
  const same = mayUseAcrossContexts({
    sourceWorkspace: "work",
    activeWorkspace: "work",
    visibility: "WORKSPACE_ONLY",
  });
  assert.equal(same.allowed, true);
});

test("context switch resolves Lakeland and Personal", () => {
  const ctx = emptyExecutiveContext("2030-01-01T00:00:00.000Z");
  const lakeland = resolveContextSwitch("Switch to Lakeland Toyota", ctx, []);
  assert.ok(lakeland);
  assert.equal(lakeland!.workspaceId, "work");
  const personal = resolveContextSwitch("Use Personal", ctx, []);
  assert.ok(personal);
  assert.equal(personal!.workspaceId, "personal");
});

test("temporal supersession preserves history", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const a = buildTemporalFact(
    { title: "Price", content: "Was 30k", category: "pricing" },
    { id: "f1", now, workspace: "work" },
  );
  assert.equal(a.temporalStatus, "CURRENT");
  const b = supersedeTemporalFact(a, "f2", "2030-01-02T00:00:00.000Z");
  assert.equal(b.temporalStatus, "SUPERSEDED");
  assert.equal(b.supersededBy, "f2");
  assert.equal(a.temporalStatus, "CURRENT"); // original object unchanged
});

test("attention board separates OWNER_MUST_DO and AION_CAN_DO", () => {
  const board = buildAttentionBoard({
    nowIso: "2030-01-01T12:00:00.000Z",
    relationships: [
      {
        id: "r1",
        reference: "r1",
        workspace: "work",
        relationshipType: "customer",
        displayName: "Mike",
        organisation: "",
        role: "",
        lifecycle: "prospect",
        origin: "owner-created",
        contactMethods: [],
        communicationPreference: "unknown",
        source: "",
        notes: "",
        interests: [],
        objections: [],
        preferences: [],
        appointments: [],
        followUps: [
          {
            id: "fu1",
            dueAt: "2030-01-01T15:00:00.000Z",
            channel: "phone",
            reason: "Call about Tacoma",
            status: "open",
            outcome: "",
            createdAt: "2030-01-01T00:00:00.000Z",
            completedAt: null,
          },
        ],
        nextAction: "",
        nextActionAt: null,
        lastContactAt: null,
        interactions: [],
        taskIds: [],
        routineIds: [],
        planIds: [],
        opportunityIds: [],
        outcome: { state: "open", at: null, detail: "" },
        archived: false,
        provenance: { sourceType: "owner", sourceRef: "t", recordedAt: "2030-01-01T00:00:00.000Z" },
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-01T00:00:00.000Z",
      } as RelationshipV1,
    ],
    tasks: [],
    openApprovals: 1,
  });
  assert.ok(board.ownerMustDo.some((i) => /Mike|Follow up/i.test(i.title)));
  assert.ok(board.aionCanDo.some((i) => i.aionCanComplete));
  assert.ok(board.briefingLines.some((l) => /OWNER MUST DO/i.test(l)));
});

test("universal capture classifies dealership conversation", () => {
  const c = classifyCaptureText(
    "I just talked to Mike. He likes the Limited but wants to stay under fifty thousand. Follow up tomorrow.",
    "2030-01-01T00:00:00.000Z",
  );
  assert.ok(c.kind === "vehicle_interest" || c.kind === "follow_up" || c.kind === "customer_update");
  assert.ok(c.personName && /mike/i.test(c.personName));
  assert.equal(c.workspaceHint, "work");
  assert.ok(c.followUpWhen);
});

test("inventory opportunity match surfaces meaningful scores only", () => {
  const now = "2030-01-01T00:00:00.000Z";
  let n = 0;
  const vin = synthesizeValidVin("MATCH1");
  const vehicles: VehicleRecordV1[] = [
    {
      id: "v1",
      vin,
      dealershipId: "d1",
      dealershipName: "Lakeland Toyota",
      stockNumber: "S1",
      year: 2025,
      make: "Toyota",
      model: "Highlander",
      trim: "XLE",
      condition: "used",
      exteriorColor: "White",
      interiorColor: null,
      mileage: 10000,
      presenceStatus: "ONLINE_LISTED",
      listingUrl: null,
      detailUrl: null,
      lastOnlineAt: now,
      lastPhysicalAt: null,
      priceHistory: [{ at: now, advertisedPrice: 39000, msrp: null, dealerPrice: null, sourceUrl: "x" }],
      statusHistory: [],
      listingObservations: [],
      relationshipIds: [],
      opportunityIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  const relationships = [
    {
      id: "r1",
      workspace: "work",
      archived: false,
      displayName: "Sarah",
      notes: "wants SUV third row under $42000 not black",
      interests: [{ kind: "vehicle", description: "SUV third row", notedAt: now }],
      interactions: [],
      followUps: [],
      nextAction: "call",
    } as unknown as RelationshipV1,
  ];
  const signals = detectInventoryMatches({
    relationships,
    vehicles,
    nowIso: now,
    nextId: (k) => `${k}-${n++}`,
  });
  assert.ok(signals.some((s) => s.kind === "inventory_match" && /Sarah/i.test(s.title)));
});

test("value ledger estimates are labeled not invented measured", () => {
  const e = buildValueLedgerEntry(
    {
      action: "draft follow-up",
      timeSavedMinutes: 5,
      estimateKind: "estimated",
      notes: "not measured revenue",
    },
    { id: "v1", now: "2030-01-01T00:00:00.000Z", workspace: "work" },
  );
  assert.equal(e.estimateKind, "estimated");
  assert.equal(e.revenueInfluenced, null);
});

test("graph edge requires endpoints", () => {
  assert.throws(() =>
    buildGraphEdge({ type: "works_at" }, { id: "e1", now: "2030-01-01T00:00:00.000Z", workspace: "work" }),
  );
  const e = buildGraphEdge(
    {
      type: "works_at",
      fromId: "owner",
      fromLabel: "Owner",
      toId: "lakeland",
      toLabel: "Lakeland Toyota",
    },
    { id: "e1", now: "2030-01-01T00:00:00.000Z", workspace: "work" },
  );
  assert.equal(e.type, "works_at");
  assert.equal(e.active, true);
});
