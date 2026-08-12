/**
 * The mock browser worker, tested mostly on what it refuses.
 *
 * The handlers are dull by design, so a test suite weighted towards happy paths would be measuring
 * the wrong thing. What has to hold is the set of refusals — wrong customer, wrong workspace, a name
 * instead of a reference, a write dressed as a preview, a retry after an unknown outcome — because
 * each of those is a way a real worker silently writes into a real person's record.
 *
 * The proposals used here are not hand-written. They come out of the actual live-audio pipeline
 * (`ingestConversationFromTranscript`) driven by the verbatim text faster-whisper produced from the
 * synthetic call, so what reaches the browser layer has the shape production really emits — including
 * the engine's own rendering of the spoken price as "35,000".
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RelationshipV1 } from "../src/contracts.js";
import { resolveCustomerIdentity } from "../src/customer-identity.js";
import { buildTranscriptFromEngineText } from "../src/audio-transcription.js";
import { ingestConversationFromTranscript } from "../src/conversation-ingest.js";
import { buildCrmActionProposal, type CrmActionProposalV1 } from "../src/crm-action-proposal.js";
import {
  BROWSER_TASK_SCHEMA_V1,
  buildBrowserTask,
  isBrowserTaskRefusal,
  isCanonicalCustomerRef,
  type BrowserTaskRefusalV1,
  type BrowserTaskV1,
} from "../src/browser-task.js";
import { BROWSER_RESULT_SCHEMA_V1, describeBrowserResult } from "../src/browser-result.js";
import {
  createMockTekionStore,
  MOCK_INJECTION_NOTE,
  type MockTekionStoreV1,
} from "../src/browser-mock-tekion.js";
import {
  InMemoryBrowserPreviewLedgerV1,
  reconcileBrowserTask,
  submitBrowserTask,
  type BrowserWorkerDepsV1,
} from "../src/browser-worker.js";
import {
  browserTaskFromCrmProposal,
  describeTaskLineage,
  resolveExternalCustomerRef,
  type ExternalCustomerLinkV1,
} from "../src/browser-proposal-adapter.js";

const NOW = "2026-08-12T12:00:00.000Z";
const SARAH_AION = "6103a23c-ff4a-4a2d-aefc-775fb2a99fd5";
const SARAH_TEKION = "tekion:customer:C-100418";
const PERSONAL_TEKION = "tekion:customer:C-900001";

/** Verbatim faster-whisper output for the synthetic call. */
const CALL_TEXT =
  "I am looking for a Camry XSE under 35,000. I do not want a hybrid. Dark blue would be nice. "
  + "I need all wheel drive. I will be there Saturday at 2.";

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    workspace: "work", organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, kind: "customer", lifecycle: "prospect", contactMethods: [],
    followUps: [], interactions: [],
    ...over,
  } as unknown as RelationshipV1;
}

const SARAH = rel({
  id: SARAH_AION,
  displayName: "Sarah Whitmore",
  contactMethods: [
    { channel: "phone", value: "863-555-0142" },
    { channel: "email", value: "sarah.whitmore@example.com" },
  ],
} as never);

const LINKS: ExternalCustomerLinkV1[] = [
  {
    workspace: "work", relationshipRef: SARAH_AION, externalRef: SARAH_TEKION,
    linkedAt: NOW, method: "OWNER_CONFIRMED",
  },
];

function resolvedIdentity() {
  return resolveCustomerIdentity({
    signals: { workspace: "work", phone: "863-555-0142" },
    relationships: [SARAH],
  });
}

/** Proposals as the live audio pipeline actually emits them. */
function realProposals(): CrmActionProposalV1[] {
  const transcript = buildTranscriptFromEngineText({
    transcriptId: "t-live-001",
    sourceRef: "audio:synthetic-call.wav",
    workspace: "work",
    startedAt: NOW,
    audioSourceRef: "private:intake/synthetic-call.wav",
    mimeType: "audio/wav",
    byteLength: 245854,
    engine: "faster-whisper",
    model: "tiny.en",
    fullText: CALL_TEXT,
    confidence: 82,
  });
  const outcome = ingestConversationFromTranscript({
    transcript,
    identity: resolvedIdentity(),
    ingestPath: "UPLOADED_CALL_RECORDING",
    speakerBinding: { customer: "UNKNOWN" },
    capturedAt: NOW,
    existingNeeds: [],
  });
  assert.ok(outcome.proposals.length >= 3, "the audio pipeline must produce the three PREPARE kinds");
  return outcome.proposals;
}

function proposalOf(action: CrmActionProposalV1["action"]): CrmActionProposalV1 {
  const found = realProposals().find((p) => p.action === action);
  assert.ok(found, `pipeline produced no ${action}`);
  return found;
}

function deps(over: Partial<BrowserWorkerDepsV1> = {}): BrowserWorkerDepsV1 & { store: MockTekionStoreV1 } {
  return {
    store: createMockTekionStore(),
    ledger: new InMemoryBrowserPreviewLedgerV1(),
    now: () => NOW,
    ...over,
  } as BrowserWorkerDepsV1 & { store: MockTekionStoreV1 };
}

function read(taskType: string, over: Record<string, unknown> = {}) {
  return {
    taskId: `task-${taskType}`,
    workspaceId: "work",
    taskType,
    idempotencyKey: `key-${taskType}`,
    requestedBy: "owner",
    createdAt: NOW,
    ...over,
  } as never;
}

function refusalOf(value: BrowserTaskV1 | BrowserTaskRefusalV1): BrowserTaskRefusalV1 {
  assert.ok(isBrowserTaskRefusal(value), "expected a refusal");
  return value;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

test("a built task carries the design's schema and every audit field", () => {
  const task = buildBrowserTask(read("READ_CUSTOMER", { customerRef: SARAH_TEKION }));
  assert.ok(!isBrowserTaskRefusal(task));
  assert.equal(task.schema, BROWSER_TASK_SCHEMA_V1);
  assert.equal(task.appId, "tekion");
  assert.equal(task.provider, "TEKION_MOCK");
  assert.equal(task.authorityMode, "READ_ONLY");
  assert.equal(task.workspaceId, "work");
  assert.equal(task.customerRef, SARAH_TEKION);
  assert.ok(task.idempotencyKey);
  assert.equal(task.createdAt, NOW);
});

test("every result carries the schema, and none of them can claim an external effect", () => {
  const d = deps();
  const results = [
    submitBrowserTask(read("SEARCH_CUSTOMER", { input: { query: "Sarah" } }), d),
    submitBrowserTask(read("READ_CUSTOMER", { customerRef: SARAH_TEKION }), d),
    submitBrowserTask(read("READ_TIMELINE", { customerRef: SARAH_TEKION }), d),
    submitBrowserTask(read("SEARCH_VEHICLE", { input: { model: "Camry" } }), d),
    submitBrowserTask(read("ADD_NOTE", { customerRef: SARAH_TEKION, authorityMode: "APPROVED_WRITE" }), d),
    submitBrowserTask(read("NOT_A_REAL_TASK"), d),
  ];
  for (const r of results) {
    assert.equal(r.schema, BROWSER_RESULT_SCHEMA_V1);
    assert.equal(r.externalEffect, false);
    assert.deepEqual(r.actualWrites, []);
    assert.equal(r.provider, "TEKION_MOCK");
    assert.ok(r.observedAt);
    assert.ok(typeof r.message === "string" && r.message.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

test("customer search returns candidates and refuses to choose between them", () => {
  const r = submitBrowserTask(read("SEARCH_CUSTOMER", { input: { query: "Sarah" } }), deps());
  assert.equal(r.status, "SUCCESS");
  const data = r.resultData as { candidates: Array<{ customerRef: string }>; ambiguous: boolean };
  assert.equal(data.candidates.length, 2);
  assert.equal(data.ambiguous, true);
  assert.match(r.message, /candidates, not an identification/i);
  // Both are offered; neither is confirmed as the answer.
  assert.equal(r.customerRefConfirmed, null);
});

test("profile, contact, timeline and tasks all read from the grounded record", () => {
  const d = deps();
  const profile = submitBrowserTask(read("READ_CUSTOMER", { customerRef: SARAH_TEKION }), d);
  assert.equal(profile.status, "SUCCESS");
  assert.equal(profile.customerRefConfirmed, SARAH_TEKION);
  assert.equal((profile.resultData as { displayName: string }).displayName, "Sarah Whitmore");

  const contact = submitBrowserTask(read("READ_CONTACT", { customerRef: SARAH_TEKION }), d);
  assert.equal((contact.resultData as { phone: string }).phone, "863-555-0142");

  const timeline = submitBrowserTask(read("READ_TIMELINE", { customerRef: SARAH_TEKION }), d);
  const entries = (timeline.resultData as { entries: Array<{ body: string }> }).entries;
  assert.equal(entries.length, 3);

  const tasks = submitBrowserTask(read("READ_TASKS", { customerRef: SARAH_TEKION }), d);
  const open = (tasks.resultData as { tasks: unknown[] }).tasks;
  assert.equal(open.length, 2);
});

test("vehicle search and detail read real units and preserve the VIN", () => {
  const d = deps();
  const search = submitBrowserTask(read("SEARCH_VEHICLE", { input: { model: "Camry", maxPrice: "35000" } }), d);
  assert.equal(search.status, "SUCCESS");
  const vehicles = (search.resultData as { vehicles: Array<{ vin: string }> }).vehicles;
  assert.equal(vehicles.length, 1);
  const vin = vehicles[0]!.vin;
  assert.ok(search.targetRefs.includes(vin));

  const detail = submitBrowserTask(read("READ_VEHICLE_CONTEXT", { vehicleRef: vin }), d);
  assert.equal(detail.status, "SUCCESS");
  assert.equal((detail.resultData as { vin: string }).vin, vin);
  assert.ok(detail.targetRefs.includes(vin));

  const missing = submitBrowserTask(read("READ_VEHICLE_CONTEXT", { vehicleRef: "JTDBAMDE0T3099999" }), d);
  assert.equal(missing.status, "BLOCKED");
  assert.equal(missing.errorCode, "VEHICLE_NOT_FOUND");
});

test("reading a vehicle needs a vehicle reference", () => {
  const r = submitBrowserTask(read("READ_VEHICLE_CONTEXT"), deps());
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.errorCode, "MISSING_VEHICLE_REF");
});

// ---------------------------------------------------------------------------
// Identity safety
// ---------------------------------------------------------------------------

test("a display name is never a target", () => {
  assert.equal(isCanonicalCustomerRef("Sarah Whitmore"), false);
  assert.equal(isCanonicalCustomerRef("sarah"), false);
  assert.equal(isCanonicalCustomerRef(SARAH_TEKION), true);
  assert.equal(isCanonicalCustomerRef(SARAH_AION), true);

  const refused = refusalOf(buildBrowserTask(read("READ_CUSTOMER", { customerRef: "Sarah Whitmore" })));
  assert.equal(refused.code, "NAME_ONLY_TARGET");
});

test("a customer-targeted task with no reference is refused", () => {
  const refused = refusalOf(buildBrowserTask(read("PREPARE_ADD_NOTE", {
    authorityMode: "PREPARE_ONLY", sourceRefs: ["transcript:t1"], input: { content: "x" },
  })));
  assert.equal(refused.code, "MISSING_CUSTOMER_REF");
});

test("unresolved, ambiguous and conflicting identities are all refused", () => {
  const sarahTwo = rel({ id: "2b0b6f0e-0000-4000-8000-000000000002", displayName: "Sarah Delgado",
    contactMethods: [{ channel: "email", value: "s.delgado@example.com" }] } as never);

  const unresolved = resolveCustomerIdentity({
    signals: { workspace: "work", spokenName: "Sarah" }, relationships: [SARAH],
  });
  assert.equal(unresolved.state, "UNRESOLVED");

  const ambiguous = resolveCustomerIdentity({
    signals: { workspace: "work", spokenName: "Sarah" }, relationships: [SARAH, sarahTwo],
  });
  assert.equal(ambiguous.state, "AMBIGUOUS");

  const conflicting = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "863-555-0142", email: "s.delgado@example.com" },
    relationships: [SARAH, sarahTwo],
  });
  assert.equal(conflicting.state, "CONFLICTING_SIGNALS");

  for (const identity of [unresolved, ambiguous, conflicting]) {
    // Refused even when a reference is supplied alongside — the resolution state is decisive.
    const refused = refusalOf(buildBrowserTask(read("PREPARE_ADD_NOTE", {
      customerRef: SARAH_TEKION, authorityMode: "PREPARE_ONLY",
      sourceRefs: ["transcript:t1"], input: { content: "x" }, identity,
    })));
    assert.equal(refused.code, "CUSTOMER_NOT_RESOLVED", `${identity.state} must refuse`);

    // And no proposal can even be built from one, so the browser layer is the second line, not the first.
    const proposal = buildCrmActionProposal({
      proposalId: "p1", workspace: "work", identity, action: "PREPARE_CALL_NOTE",
      note: "x", sourceRefs: ["transcript:t1"], confidence: 80,
      expectedExternalEffect: "drafts a note", now: NOW,
    });
    assert.ok("refused" in proposal, `${identity.state} must not yield a proposal`);
  }
});

test("a customer with no recorded CRM link is refused rather than searched for", () => {
  const proposal = proposalOf("PREPARE_CALL_NOTE");
  const refused = refusalOf(browserTaskFromCrmProposal({
    proposal, links: [], taskId: "task-1", requestedBy: "owner", createdAt: NOW,
  }));
  assert.equal(refused.code, "NO_EXTERNAL_LINK");
  assert.match(refused.reason, /searching by name is not a substitute/i);
  assert.equal(resolveExternalCustomerRef([], "work", SARAH_AION), null);
});

// ---------------------------------------------------------------------------
// Workspace safety
// ---------------------------------------------------------------------------

test("dealership tasks run only in the dealership workspace", () => {
  for (const workspace of ["personal", "compassionate-choice", "career"]) {
    const refused = refusalOf(buildBrowserTask(read("READ_CUSTOMER", {
      workspaceId: workspace, customerRef: SARAH_TEKION,
    })));
    assert.equal(refused.code, "WORKSPACE_NOT_PERMITTED", `${workspace} must be refused`);
  }
});

test("a work task cannot reach a record in another workspace, and says nothing about it", () => {
  const r = submitBrowserTask(read("READ_CUSTOMER", { customerRef: PERSONAL_TEKION }), deps());
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.errorCode, "WORKSPACE_MISMATCH");
  // The refusal must not carry any of the record it refused to open.
  const serialised = JSON.stringify(r);
  assert.ok(!/Ruth/i.test(serialised), "the refusal leaked the other workspace's data");
  assert.ok(!/0199/.test(serialised), "the refusal leaked a phone number");
  assert.deepEqual(r.resultData, {});
});

test("customer search never crosses a workspace boundary", () => {
  const r = submitBrowserTask(read("SEARCH_CUSTOMER", { input: { query: "Ruth" } }), deps());
  const data = r.resultData as { candidates: unknown[] };
  assert.equal(data.candidates.length, 0, "a personal contact must not surface in a dealership search");
});

// ---------------------------------------------------------------------------
// Allowlist and authority
// ---------------------------------------------------------------------------

test("an unknown task type is refused, not attempted", () => {
  const refused = refusalOf(buildBrowserTask(read("EXPORT_EVERYTHING")));
  assert.equal(refused.code, "UNKNOWN_TASK_TYPE");
});

test("an unsupported provider and an unsupported app are both refused", () => {
  const provider = refusalOf(buildBrowserTask(read("READ_CUSTOMER", {
    customerRef: SARAH_TEKION, provider: "TEKION_LIVE",
  })));
  assert.equal(provider.code, "UNSUPPORTED_PROVIDER");

  const app = refusalOf(buildBrowserTask(read("READ_CUSTOMER", {
    customerRef: SARAH_TEKION, appId: "informativ",
  })));
  assert.equal(app.code, "UNSUPPORTED_APP");
  assert.match(app.reason, /credit, fraud and identity decisions are refused/i);
});

test("every high-consequence operation is refused by name", () => {
  const dangerous = [
    "SUBMIT_CREDIT_APPLICATION", "CHANGE_FINANCING_TERMS", "ACCEPT_DISCLOSURE", "ACCEPT_CONSENT",
    "FRAUD_DETERMINATION", "IDENTITY_VERIFICATION_DECISION", "PAYMENT_ACTION", "DEAL_STRUCTURE_CHANGE",
    "CONTRACT_SIGNATURE", "ESIGN", "CREDIT_BUREAU_ACTION", "HARD_CREDIT_PULL", "INFORMATIV_CREDIT_ACTION",
    "BULK_CUSTOMER_EXPORT",
  ];
  for (const taskType of dangerous) {
    const refused = refusalOf(buildBrowserTask(read(taskType, { customerRef: SARAH_TEKION })));
    assert.equal(refused.code, "HIGH_CONSEQUENCE_TASK", `${taskType} must refuse as high-consequence`);
  }
});

test("a prepare cannot be escalated into a write, and a write has no handler", () => {
  // Asking for a preview with write authority is refused rather than quietly downgraded.
  const escalated = refusalOf(buildBrowserTask(read("PREPARE_ADD_NOTE", {
    customerRef: SARAH_TEKION, authorityMode: "APPROVED_WRITE",
    sourceRefs: ["transcript:t1"], input: { content: "x" },
  })));
  assert.equal(escalated.code, "AUTHORITY_MODE_MISMATCH");

  // And the write types themselves execute nothing.
  for (const taskType of ["ADD_NOTE", "CREATE_FOLLOWUP", "UPDATE_ALLOWED_PREFERENCE"]) {
    const r = submitBrowserTask(read(taskType, {
      customerRef: SARAH_TEKION, authorityMode: "APPROVED_WRITE",
    }), deps());
    assert.equal(r.status, "BLOCKED");
    assert.equal(r.errorCode, "WRITE_NOT_AUTHORIZED");
    assert.equal(r.externalEffect, false);
    assert.deepEqual(r.actualWrites, []);
  }
});

// ---------------------------------------------------------------------------
// The real proposal chain
// ---------------------------------------------------------------------------

test("the three PREPARE proposals become the three browser previews, lineage intact", () => {
  const d = deps();
  const expected: Array<[CrmActionProposalV1["action"], string]> = [
    ["PREPARE_CALL_NOTE", "PREPARE_ADD_NOTE"],
    ["PREPARE_FOLLOWUP", "PREPARE_CREATE_FOLLOWUP"],
    ["PREPARE_PREFERENCE_UPDATE", "PREPARE_UPDATE_PREFERENCE"],
  ];

  for (const [action, taskType] of expected) {
    const proposal = proposalOf(action);
    const task = browserTaskFromCrmProposal({
      proposal, links: LINKS, taskId: `task-${action}`, requestedBy: "owner", createdAt: NOW,
    });
    assert.ok(!isBrowserTaskRefusal(task), `${action} should adapt`);
    assert.equal(task.taskType, taskType);

    // Everything the proposal decided is preserved.
    assert.equal(task.proposalId, proposal.proposalId);
    assert.equal(task.workspaceId, proposal.workspace);
    assert.equal(task.idempotencyKey, proposal.idempotencyKey);
    assert.equal(task.confidence, proposal.confidence);
    assert.equal(task.expectedExternalEffect, proposal.expectedExternalEffect);
    assert.equal(task.authorityMode, proposal.authorityRequired);
    // AION's id became the CRM's id through a recorded link, not a lookup by name.
    assert.equal(task.customerRef, SARAH_TEKION);
    assert.notEqual(task.customerRef, proposal.customerRef);
    assert.deepEqual(task.sourceRefs, proposal.sourceRefs);

    const result = submitBrowserTask(task as never, d);
    assert.equal(result.status, "SUCCESS", result.message);
    assert.ok(result.proposedWrites.length > 0, `${taskType} must show what it would change`);
    assert.equal(result.externalEffect, false);
    assert.deepEqual(result.actualWrites, []);
    assert.ok(result.preparedEffect && /nothing has been submitted/i.test(result.preparedEffect));

    // Lineage survives all the way to the result.
    for (const ref of proposal.sourceRefs) {
      assert.ok(result.sourceRefs.includes(ref), `lost source ref ${ref}`);
    }
    assert.ok(result.sourceRefs.some((r) => r.startsWith("transcript:")), "lost the transcript ref");
    assert.ok(result.sourceRefs.some((r) => r.startsWith("conversation:")), "lost the conversation ref");
  }
});

test("the lineage is printable from the audio to the preview", () => {
  const proposal = proposalOf("PREPARE_CALL_NOTE");
  const task = browserTaskFromCrmProposal({
    proposal, links: LINKS, taskId: "task-lineage", requestedBy: "owner", createdAt: NOW,
  });
  assert.ok(!isBrowserTaskRefusal(task));
  const line = describeTaskLineage(task);
  assert.match(line, /transcript:t-live-001/);
  assert.match(line, /conversation:/);
  assert.match(line, new RegExp(proposal.proposalId));
  assert.match(line, /PREPARE_ADD_NOTE/);
  assert.match(line, /PREPARE_ONLY/);
});

test("the note preview carries the call's actual content and diffs a real preference", () => {
  const d = deps();
  const note = proposalOf("PREPARE_CALL_NOTE");
  const noteTask = browserTaskFromCrmProposal({
    proposal: note, links: LINKS, taskId: "t-n", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;
  const noteResult = submitBrowserTask(noteTask as never, d);
  const body = noteResult.proposedWrites.find((w) => w.field === "note.body");
  assert.ok(body);
  assert.match(String(body.after), /camry/i);
  assert.match(String(body.after), /35,000|35000/);

  const pref = proposalOf("PREPARE_PREFERENCE_UPDATE");
  const prefTask = browserTaskFromCrmProposal({
    proposal: pref, links: LINKS, taskId: "t-p", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;
  const prefResult = submitBrowserTask(prefTask as never, d);
  const model = prefResult.proposedWrites.find((w) => w.field === "preference.vehicleModel");
  assert.ok(model, "expected a model preference diff");
  // A real before/after, read from the record rather than assumed.
  assert.equal(model.before, "Highlander");
  assert.equal(model.after, "camry");
  const budget = prefResult.proposedWrites.find((w) => w.field === "preference.budgetMax");
  assert.equal(budget?.before, "40000");
  assert.equal(budget?.after, "35000");
});

// ---------------------------------------------------------------------------
// Idempotency and uncertainty
// ---------------------------------------------------------------------------

test("the same prepare submitted twice is one logical operation", () => {
  const d = deps();
  const proposal = proposalOf("PREPARE_CALL_NOTE");
  const task = browserTaskFromCrmProposal({
    proposal, links: LINKS, taskId: "t-first", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;

  const first = submitBrowserTask(task as never, d);
  const second = submitBrowserTask({ ...task, taskId: "t-second" } as never, d);

  assert.equal(first.status, "SUCCESS");
  assert.equal(second.status, "SUCCESS");
  // The second submission returns the first preview rather than making another.
  assert.equal(second.taskId, first.taskId);
  assert.match(second.message, /already prepared/i);
  assert.deepEqual(second.proposedWrites, first.proposedWrites);

  const ledger = d.ledger.entries();
  assert.equal(ledger.length, 1, "one ledger entry means one logical operation");
  assert.equal(ledger[0]!.attempts, 2);
});

test("reads are allowed to re-run", () => {
  const d = deps();
  const a = submitBrowserTask(read("READ_TASKS", { customerRef: SARAH_TEKION }), d);
  const b = submitBrowserTask(read("READ_TASKS", { customerRef: SARAH_TEKION }), d);
  assert.equal(a.status, "SUCCESS");
  assert.equal(b.status, "SUCCESS");
  assert.equal(d.ledger.entries().length, 0, "reads do not occupy the idempotency ledger");
});

test("an uncertain outcome latches and is never retried automatically", () => {
  const proposal = proposalOf("PREPARE_CALL_NOTE");
  const d = deps({ ambiguousResponseKeys: new Set([proposal.idempotencyKey]) });
  const task = browserTaskFromCrmProposal({
    proposal, links: LINKS, taskId: "t-uncertain", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;

  const first = submitBrowserTask(task as never, d);
  assert.equal(first.status, "UNCERTAIN_WRITE");
  assert.equal(first.certainty, "UNCERTAIN");
  assert.equal(first.reconciliationRequired, true);
  assert.equal(first.externalEffect, false);
  // Even uncertain, it still says what it was attempting — otherwise it cannot be reconciled.
  assert.ok(first.proposedWrites.length > 0);

  const retry = submitBrowserTask({ ...task, taskId: "t-uncertain-retry" } as never, d);
  assert.equal(retry.status, "UNCERTAIN_WRITE");
  assert.equal(retry.taskId, first.taskId, "a retry must not become a second operation");
  assert.match(retry.message, /will not retry it/i);
  assert.equal(d.ledger.entries().length, 1);
  assert.equal(d.ledger.entries()[0]!.attempts, 2);

  // Only an explicit human reconciliation clears it.
  const cleared = reconcileBrowserTask(proposal.idempotencyKey, d.ledger);
  assert.equal(cleared.reconciled, true);
  assert.equal(d.ledger.entries().length, 0);
});

// ---------------------------------------------------------------------------
// Imported text is data
// ---------------------------------------------------------------------------

test("a CRM note telling AION to submit the deal changes nothing", () => {
  const d = deps();
  const timeline = submitBrowserTask(read("READ_TIMELINE", { customerRef: SARAH_TEKION }), d);
  const entries = (timeline.resultData as { entries: Array<{ body: string }> }).entries;
  const injected = entries.find((e) => e.body === MOCK_INJECTION_NOTE);
  assert.ok(injected, "the hostile fixture note must actually be read");

  // Read faithfully, and marked as what it is.
  assert.equal(timeline.status, "SUCCESS");
  assert.equal((timeline.resultData as { contentIsUntrustedData: boolean }).contentIsUntrustedData, true);
  assert.equal(timeline.externalEffect, false);
  assert.deepEqual(timeline.actualWrites, []);

  // Nothing downstream is widened by having read it.
  const after = submitBrowserTask(read("PREPARE_ADD_NOTE", {
    customerRef: SARAH_TEKION, authorityMode: "PREPARE_ONLY",
    sourceRefs: ["transcript:t-live-001"], input: { content: "Follow-up from call." },
  }), d);
  assert.equal(after.status, "SUCCESS");
  assert.equal(after.taskType, "PREPARE_ADD_NOTE");
  assert.equal(after.externalEffect, false);
  assert.deepEqual(after.actualWrites, []);

  // The dangerous operations the note asks for are still refused afterwards.
  for (const taskType of ["SUBMIT_CREDIT_APPLICATION", "PAYMENT_ACTION", "CONTRACT_SIGNATURE"]) {
    const refused = refusalOf(buildBrowserTask(read(taskType, { customerRef: SARAH_TEKION })));
    assert.equal(refused.code, "HIGH_CONSEQUENCE_TASK");
  }
  const write = submitBrowserTask(read("ADD_NOTE", {
    customerRef: SARAH_TEKION, authorityMode: "APPROVED_WRITE",
  }), d);
  assert.equal(write.errorCode, "WRITE_NOT_AUTHORIZED");
});

test("hostile text inside a note body is previewed, never interpreted", () => {
  const d = deps();
  const r = submitBrowserTask(read("PREPARE_ADD_NOTE", {
    customerRef: SARAH_TEKION, authorityMode: "PREPARE_ONLY",
    sourceRefs: ["transcript:t1"],
    input: { content: MOCK_INJECTION_NOTE },
  }), d);
  assert.equal(r.status, "SUCCESS");
  assert.equal(r.taskType, "PREPARE_ADD_NOTE");
  // Carried through verbatim as the proposed content — and still just a preview.
  assert.equal(r.proposedWrites[0]!.after, MOCK_INJECTION_NOTE);
  assert.equal(r.externalEffect, false);
  assert.deepEqual(r.actualWrites, []);
});

// ---------------------------------------------------------------------------
// Read-first flow, end to end
// ---------------------------------------------------------------------------

test("read first, then prepare — a whole customer flow with no external effect", () => {
  const d = deps();
  const identity = resolvedIdentity();
  assert.equal(identity.state, "RESOLVED");
  const externalRef = resolveExternalCustomerRef(LINKS, "work", identity.relationshipRef!);
  assert.equal(externalRef, SARAH_TEKION);

  const steps = [
    submitBrowserTask(read("READ_CUSTOMER", { customerRef: externalRef }), d),
    submitBrowserTask(read("READ_TIMELINE", { customerRef: externalRef }), d),
    submitBrowserTask(read("READ_TASKS", { customerRef: externalRef }), d),
  ];
  for (const s of steps) assert.equal(s.status, "SUCCESS", s.message);

  const note = browserTaskFromCrmProposal({
    proposal: proposalOf("PREPARE_CALL_NOTE"), links: LINKS,
    taskId: "flow-note", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;
  const followup = browserTaskFromCrmProposal({
    proposal: proposalOf("PREPARE_FOLLOWUP"), links: LINKS,
    taskId: "flow-followup", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;

  const previews = [submitBrowserTask(note as never, d), submitBrowserTask(followup as never, d)];
  for (const p of previews) {
    assert.equal(p.status, "SUCCESS", p.message);
    assert.equal(p.customerRefConfirmed, SARAH_TEKION);
    assert.equal(p.externalEffect, false);
  }

  // Nothing in the whole flow touched anything outside.
  for (const r of [...steps, ...previews]) {
    assert.equal(r.externalEffect, false);
    assert.deepEqual(r.actualWrites, []);
  }
  // And the fixture store is unchanged — no preview leaked into the mock CRM.
  assert.deepEqual(d.store, createMockTekionStore());
});

test("an audit line answers what ran, on whom, on what authority, and whether anything changed", () => {
  const d = deps();
  const task = browserTaskFromCrmProposal({
    proposal: proposalOf("PREPARE_CALL_NOTE"), links: LINKS,
    taskId: "audit-1", requestedBy: "owner", createdAt: NOW,
  }) as BrowserTaskV1;
  const line = describeBrowserResult(submitBrowserTask(task as never, d));
  assert.match(line, /PREPARE_ADD_NOTE/);
  assert.match(line, /workspace work/);
  assert.match(line, new RegExp(SARAH_TEKION));
  assert.match(line, /transcript:t-live-001/);
  assert.match(line, /external effect: none/i);
});
