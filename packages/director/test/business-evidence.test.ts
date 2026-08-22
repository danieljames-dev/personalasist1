/**
 * The business evidence layer.
 *
 * These tests are about the two sentences the model is built on — an artifact is not knowledge, and
 * a summary is never stronger than its source — plus the thing that motivated the whole milestone:
 * the May profile and the certificate disagree, both are true of their own dates, and only one
 * governs now. If supersession or source ranking is wrong, everything downstream inherits a
 * confident falsehood, so these are written to fail loudly rather than to pass easily.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  KNOWLEDGE_BEARING_CLASSES_V1,
  SOURCE_CLASSES_V1,
  entitledState,
  judgeConflict,
  sensitiveFieldsIn,
  sourceRank,
  type BusinessEvidenceV1,
} from "../src/business-evidence.js";
import {
  createFileBusinessEvidenceStore,
  type BusinessEvidenceStoreV1,
  type ProposedSourceV1,
} from "../src/business-evidence-store.js";
import {
  CLAIM_V1,
  COMPASSIONATE_CHOICE_WORKSPACE_V1 as CC,
  LOCALFINDS_WORKSPACE_V1 as LF,
  TALK_TO_CALEB_WORKSPACE_V1 as TTC,
  AISERVICE_CO_WORKSPACE_V1 as AI,
  corpusFor,
} from "../src/business-corpus.js";
import {
  OWNER_INTAKE_REJECTED_FIELDS_V1,
  closeOwnerQuestion,
  ensureOwnerQuestion,
  recordOwnerAnswer,
} from "../src/business-intake.js";
import {
  PORTFOLIO_SUMMARY_FIELDS_V1,
  assessRevenueReadiness,
  portfolioSummary,
} from "../src/business-readiness.js";

const NOW = "2026-08-22T01:11:31Z";
const temps: string[] = [];
function store(): BusinessEvidenceStoreV1 {
  const dir = mkdtempSync(join(tmpdir(), "aion-bev-"));
  temps.push(dir);
  return createFileBusinessEvidenceStore(dir);
}
test.after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function ingestAll(s: BusinessEvidenceStoreV1, workspaceId: string) {
  for (const source of corpusFor(workspaceId, NOW)) s.commitImport(workspaceId, source, NOW);
}
function claimOf(s: BusinessEvidenceStoreV1, ws: string, claim: string): BusinessEvidenceV1[] {
  return [...s.evidence(ws)].filter((row) => row.claim === claim);
}

/* -------------------------------------------------------------------------- */
/* Source ranking                                                              */
/* -------------------------------------------------------------------------- */

test("a certificate outranks a machine transcript, structurally", () => {
  assert.ok(sourceRank("OFFICIAL_REGULATORY_DOCUMENT") < sourceRank("ASR_TRANSCRIPT"));
  assert.ok(sourceRank("OWNER_STATEMENT") < sourceRank("DERIVED_SUMMARY"));
  assert.ok(sourceRank("OFFICIAL_REGULATORY_DOCUMENT") < sourceRank("OWNER_STATEMENT"),
    "an official document outranks a recollection of it");
  assert.equal(SOURCE_CLASSES_V1.length, new Set(SOURCE_CLASSES_V1).size);
});

test("a summary is never stronger than its source", () => {
  for (const weak of ["ASR_TRANSCRIPT", "DERIVED_SUMMARY", "RESEARCH", "WEBSITE_CONTENT", "TRANSCRIPT"] as const) {
    assert.ok(!KNOWLEDGE_BEARING_CLASSES_V1.includes(weak), `${weak} must not carry a fact alone`);
    assert.equal(entitledState({ sourceClass: weak, readable: true, asserted: "KNOWN" }).state, "HYPOTHESIS");
  }
});

test("an artifact is not knowledge: an unreadable source yields UNREAD_SOURCE", () => {
  const verdict = entitledState({
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT", readable: false, asserted: "KNOWN",
  });
  assert.equal(verdict.state, "UNREAD_SOURCE");
  assert.match(verdict.reason, /could not read/u);
});

/* -------------------------------------------------------------------------- */
/* Conflict and supersession                                                   */
/* -------------------------------------------------------------------------- */

test("a newer stronger source supersedes; a newer weaker one does not", () => {
  const base = {
    schema: "aion.director.businessEvidence.v1", workspaceId: CC, subject: "x", claim: "c",
    effectiveFromUtc: "", effectiveToUtc: "", ingestedAtUtc: NOW, sensitivity: "INTERNAL",
    contradicts: [], supersededBy: "", note: "",
  } as const;
  const may = { ...base, evidenceId: "may", value: "PENDING", state: "KNOWN",
    sourceId: "s1", sourceClass: "BUSINESS_DOCUMENT", observedAtUtc: "2026-05-17T00:00:00Z" } as BusinessEvidenceV1;
  const owner = { ...base, evidenceId: "own", value: "REGISTERED", state: "KNOWN",
    sourceId: "s2", sourceClass: "OWNER_STATEMENT", observedAtUtc: "2026-08-21T00:00:00Z" } as BusinessEvidenceV1;
  const asr = { ...base, evidenceId: "asr", value: "CLEARED", state: "KNOWN",
    sourceId: "s3", sourceClass: "ASR_TRANSCRIPT", observedAtUtc: "2026-07-09T00:00:00Z" } as BusinessEvidenceV1;

  const supersede = judgeConflict(may, owner);
  assert.equal(supersede.conflicting, false);
  assert.equal(supersede.superseded?.evidenceId, "may");
  assert.equal(supersede.governing?.evidenceId, "own");

  const weakLater = judgeConflict(owner, asr);
  assert.equal(weakLater.conflicting, false);
  assert.equal(weakLater.superseded?.evidenceId, "asr",
    "a later transcript is history against a stronger earlier statement, not a new truth");
});

test("a stronger-but-older source against a weaker-but-newer one is a conflict for a person", () => {
  const base = {
    schema: "aion.director.businessEvidence.v1", workspaceId: CC, subject: "x", claim: "c",
    effectiveFromUtc: "", effectiveToUtc: "", ingestedAtUtc: NOW, sensitivity: "INTERNAL",
    contradicts: [], supersededBy: "", note: "", state: "KNOWN",
  } as const;
  const official = { ...base, evidenceId: "off", value: "A", sourceId: "s1",
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT", observedAtUtc: "2026-01-01T00:00:00Z" } as BusinessEvidenceV1;
  const ownerLater = { ...base, evidenceId: "own", value: "B", sourceId: "s2",
    sourceClass: "OWNER_STATEMENT", observedAtUtc: "2026-08-01T00:00:00Z" } as BusinessEvidenceV1;

  const judged = judgeConflict(official, ownerLater);
  assert.equal(judged.conflicting, true, "guessing here is how a memory becomes confidently wrong");
  assert.equal(judged.governing, null);
  assert.match(judged.reason, /a person must resolve/u);
});

/* -------------------------------------------------------------------------- */
/* Dry run and idempotency                                                     */
/* -------------------------------------------------------------------------- */

test("a dry run changes nothing on disk", () => {
  const s = store();
  const source = corpusFor(CC, NOW)[0]!;
  const plan = s.planImport(CC, source, NOW);

  assert.equal(plan.mutated, false);
  assert.ok(plan.entries.length > 0);
  assert.deepEqual(s.evidence(CC), [], "planning must not write evidence");
  assert.deepEqual(s.sources(CC), [], "planning must not write a source record");
});

test("importing the same source twice creates no duplicate", () => {
  const s = store();
  const source = corpusFor(CC, NOW)[0]!;
  s.commitImport(CC, source, NOW);
  const before = s.evidence(CC).length;
  const second = s.commitImport(CC, source, NOW);

  assert.equal(s.evidence(CC).length, before);
  assert.ok(second.entries.every((e) => e.action === "UNCHANGED"));
  assert.equal(s.sources(CC).length, 1, "an unchanged source does not create a second version");
});

test("a changed source becomes a new version and keeps the old one", () => {
  const s = store();
  const v1: ProposedSourceV1 = {
    sourceClass: "BUSINESS_DOCUMENT", reference: "profile.md", readable: true,
    content: "v1", observedAtUtc: "2026-05-17T00:00:00Z",
    claims: [{ subject: "X", claim: "c", value: "one", asserted: "KNOWN" }],
  };
  s.commitImport(CC, v1, NOW);
  const plan = s.commitImport(CC, { ...v1, content: "v2", claims: [
    { subject: "X", claim: "c", value: "two", asserted: "KNOWN" },
  ] }, NOW);

  assert.equal(plan.sourceVersion, 2);
  assert.equal(plan.entries[0]!.action, "NEW_VERSION");
  const versions = s.sources(CC);
  assert.equal(versions.length, 2, "the earlier version is retained");
  assert.deepEqual(versions.map((v) => v.version).sort(), [1, 2]);
  assert.equal(s.evidence(CC).filter((r) => r.claim === "c").length, 1, "one logical claim per source");
  assert.equal(s.evidence(CC).find((r) => r.claim === "c")!.value, "two");
});

test("a claim with no subject or category is quarantined rather than stored", () => {
  const s = store();
  const plan = s.commitImport(CC, {
    sourceClass: "OWNER_STATEMENT", reference: "junk", readable: true, content: "j",
    observedAtUtc: NOW, claims: [{ subject: "", claim: "", value: "v", asserted: "KNOWN" }],
  }, NOW);
  assert.equal(plan.entries[0]!.action, "QUARANTINED");
  assert.equal(plan.quarantined.length, 1);
  assert.deepEqual(s.evidence(CC), []);
});

/* -------------------------------------------------------------------------- */
/* The real Compassionate Choice corpus                                        */
/* -------------------------------------------------------------------------- */

test("the certificate supersedes the May pending state, and the May state is kept", () => {
  const s = store();
  ingestAll(s, CC);

  const status = claimOf(s, CC, CLAIM_V1.status);
  const live = status.filter((row) => row.supersededBy === "" && row.state === "KNOWN");
  const superseded = status.filter((row) => row.supersededBy !== "" || row.state === "SUPERSEDED");

  assert.equal(live.length, 1, `expected one governing status, got ${live.map((r) => r.value).join(", ")}`);
  assert.equal(live[0]!.value, "REGISTERED");
  assert.equal(live[0]!.effectiveFromUtc, "2026-06-26T00:00:00Z");
  assert.equal(live[0]!.effectiveToUtc, "2028-06-25T00:00:00Z");

  assert.ok(superseded.some((row) => row.value === "PENDING_REGISTRATION"),
    "the May pending state must be preserved as history, not deleted");
  assert.ok(superseded.some((row) => /cleared/u.test(row.value)),
    "the July transcript must be preserved too");
});

test("the certificate PDF is recorded as UNREAD_SOURCE rather than silently skipped", () => {
  const s = store();
  ingestAll(s, CC);
  const unread = s.evidence(CC).filter((row) => row.state === "UNREAD_SOURCE");
  assert.equal(unread.length, 1);
  const source = s.sources(CC).find((row) => !row.readable)!;
  assert.equal(source.sourceClass, "OFFICIAL_REGULATORY_DOCUMENT");
  assert.match(source.unreadableReason, /extraction is unavailable/u);
});

test("the five counties are recorded and the expansion is not authority", () => {
  const s = store();
  ingestAll(s, CC);

  const area = claimOf(s, CC, CLAIM_V1.serviceArea).find((r) => r.supersededBy === "")!;
  assert.equal(area.state, "KNOWN");
  for (const county of ["Hardee", "Highlands", "Hillsborough", "Manatee", "Polk"]) {
    assert.match(area.value, new RegExp(county, "u"));
  }
  assert.doesNotMatch(area.value, /statewide/iu);

  const pending = claimOf(s, CC, CLAIM_V1.serviceAreaPending)[0]!;
  assert.equal(pending.state, "HYPOTHESIS", "pending expansion must never be actionable authority");
});

test("legal scope and business policy are separate claims", () => {
  const s = store();
  ingestAll(s, CC);
  const legal = claimOf(s, CC, CLAIM_V1.transportLegal)[0]!;
  const policy = claimOf(s, CC, CLAIM_V1.transportPolicy)[0]!;
  assert.match(legal.value, /legally permitted/u);
  assert.match(policy.value, /chosen not to offer/u);
  assert.notEqual(legal.claim, policy.claim, "merging these would misstate both");
});

test("no sensitive identifier reaches the corpus", () => {
  const s = store();
  for (const ws of [CC, LF, TTC, AI]) ingestAll(s, ws);
  for (const ws of [CC, LF, TTC, AI]) {
    for (const row of s.evidence(ws)) {
      assert.deepEqual(sensitiveFieldsIn(row.value), [], `${row.claim} carries ${sensitiveFieldsIn(row.value).join(", ")}`);
    }
  }
  // The detector itself works, or the assertion above proves nothing.
  assert.deepEqual(sensitiveFieldsIn("call 863-555-1212"), ["phone"]);
  assert.deepEqual(sensitiveFieldsIn("EIN 12-3456789"), ["EIN"]);
  assert.ok(sensitiveFieldsIn("License Number: AHCA12345").includes("licence or account number"));
});

/* -------------------------------------------------------------------------- */
/* Readiness                                                                   */
/* -------------------------------------------------------------------------- */

test("Compassionate Choice is revenue-ready and is not still blocked on registration", () => {
  const s = store();
  ingestAll(s, CC);
  const readiness = assessRevenueReadiness(CC, s.evidence(CC), s.questions(CC));
  assert.equal(readiness.readiness, "READY_FOR_REVENUE_DISCOVERY", readiness.reason);
  assert.ok(readiness.knownCount > 5);
  assert.ok(readiness.supersededCount >= 2, "history is retained, not deleted");
});

test("a business with assets but no model is short of evidence, not blocked", () => {
  const s = store();
  for (const ws of [LF, TTC, AI]) ingestAll(s, ws);
  for (const ws of [LF, TTC, AI]) {
    const readiness = assessRevenueReadiness(ws, s.evidence(ws), s.questions(ws));
    assert.equal(readiness.readiness, "INSUFFICIENT_EVIDENCE", `${ws}: ${readiness.reason}`);
    assert.ok(readiness.unknownCount > 0, `${ws} must record what it does not know`);
  }
});

test("a contradicted legal status blocks revenue work outright", () => {
  const s = store();
  ingestAll(s, CC);
  // An official document that disagrees with the Owner relay, and predates it: unresolvable here.
  s.commitImport(CC, {
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT", reference: "conflicting notice", readable: true,
    content: "conflict", observedAtUtc: "2026-06-01T00:00:00Z",
    claims: [{ subject: "Compassionate Choice", claim: CLAIM_V1.status, value: "SUSPENDED", asserted: "KNOWN" }],
  }, NOW);
  const readiness = assessRevenueReadiness(CC, s.evidence(CC), s.questions(CC));
  assert.equal(readiness.readiness, "BLOCKED_BY_LEGAL_STATUS");
  assert.ok(readiness.conflictedCount > 0);
});

/* -------------------------------------------------------------------------- */
/* Isolation                                                                   */
/* -------------------------------------------------------------------------- */

test("one business's evidence is unreadable as another's", () => {
  const s = store();
  ingestAll(s, CC);
  ingestAll(s, LF);
  ingestAll(s, TTC);
  ingestAll(s, AI);

  assert.deepEqual(s.evidence(LF).filter((r) => r.workspaceId !== LF), []);
  assert.ok(!s.evidence(LF).some((r) => /AHCA|Hardee|Kristina/u.test(r.value)),
    "Compassionate Choice evidence must not be visible as LocalFinds");
  assert.ok(!s.evidence(TTC).some((r) => r.subject === "AIService Co"));
  assert.ok(!s.evidence(AI).some((r) => r.subject === "Talk to Caleb"));
  assert.deepEqual(s.evidence("no-such-workspace"), [], "an unknown workspace fails closed and empty");
});

test("the portfolio summary carries counts and states, never content", () => {
  const s = store();
  for (const ws of [CC, LF, TTC, AI]) ingestAll(s, ws);
  const summary = portfolioSummary(s, [CC, LF, TTC, AI]);

  assert.equal(summary.length, 4);
  for (const entry of summary) {
    assert.deepEqual(Object.keys(entry).sort(), [...PORTFOLIO_SUMMARY_FIELDS_V1].sort(),
      "a new field here is a leak with a friendly name");
  }
  const serialized = JSON.stringify(summary);
  for (const leak of ["Hardee", "Kristina", "AHCA", "LakelandFinds", "transportation", "Homemaker"]) {
    assert.ok(!serialized.includes(leak), `portfolio summary leaked ${leak}`);
  }
  assert.equal(summary.find((e) => e.workspaceId === CC)!.readiness, "READY_FOR_REVENUE_DISCOVERY");
  assert.equal(summary.find((e) => e.workspaceId === CC)!.blocker, "NONE");
});

test("a business AION knows least about carries the highest information gain", () => {
  const s = store();
  for (const ws of [CC, LF]) ingestAll(s, ws);
  const summary = portfolioSummary(s, [CC, LF]);
  const cc = summary.find((e) => e.workspaceId === CC)!;
  const lf = summary.find((e) => e.workspaceId === LF)!;
  assert.ok(lf.informationGainValue > cc.informationGainValue,
    "asking beats acting where nothing is known; acting beats asking where it is");
});

/* -------------------------------------------------------------------------- */
/* Owner intake                                                                */
/* -------------------------------------------------------------------------- */

test("the Owner answers in words and the server decides everything that matters", () => {
  const s = store();
  const result = recordOwnerAnswer(s, {
    workspaceId: LF,
    question: "Is LakelandFinds the same business as LocalFinds?",
    answer: "Yes — same brand, LocalFinds is the current name.",
    claims: [{ subject: "LocalFinds", claim: CLAIM_V1.brandAlias, value: "LakelandFinds is a legacy name for LocalFinds" }],
  }, NOW);

  const stored = s.evidence(LF)[0]!;
  assert.equal(stored.sourceClass, "OWNER_STATEMENT", "the client cannot choose its own source class");
  assert.equal(stored.state, "KNOWN");
  assert.equal(result.plan.entries[0]!.action, "CREATE");
});

test("fields that would let a client grade its own evidence are ignored", () => {
  const s = store();
  const forged = {
    workspaceId: LF,
    question: "q",
    answer: "a",
    claims: [{ subject: "LocalFinds", claim: "c", value: "v" }],
    state: "KNOWN",
    verified: true,
    confidence: 1,
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT",
    supersededBy: "anything",
    authorityId: "AION-SOMETHING",
    effectScope: "PRODUCTION",
    permission: "YES",
  };
  const result = recordOwnerAnswer(s, forged as never, NOW);

  assert.ok(result.ignoredFields.length >= 6, `ignored ${result.ignoredFields.join(", ")}`);
  const stored = s.evidence(LF)[0]!;
  assert.equal(stored.sourceClass, "OWNER_STATEMENT", "a client must not be able to claim an official source");
  assert.equal(stored.supersededBy, "", "a client must not name a supersession target");
  // The record legitimately has `state`, `sourceClass` and `sensitivity` — what matters is that the
  // forged *values* had no effect, not that the fields are absent.
  assert.notEqual(stored.sourceClass, forged.sourceClass);
  assert.notEqual(stored.supersededBy, forged.supersededBy);
  assert.ok(!JSON.stringify(stored).includes("AION-SOMETHING"), "a forged authority id reached the record");
  assert.ok(!JSON.stringify(stored).includes("PRODUCTION"), "a forged effect scope reached the record");
  for (const field of ["verified", "confidence", "authorityId", "effectScope", "permission"]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(stored, field), `${field} reached the stored record`);
  }
});

test("an Owner answer that contradicts an official record becomes a conflict, not an overwrite", () => {
  const s = store();
  s.commitImport(CC, {
    sourceClass: "OFFICIAL_REGULATORY_DOCUMENT", reference: "official", readable: true,
    content: "o", observedAtUtc: "2026-09-01T00:00:00Z",
    claims: [{ subject: "Compassionate Choice", claim: CLAIM_V1.status, value: "REGISTERED", asserted: "KNOWN" }],
  }, NOW);
  recordOwnerAnswer(s, {
    workspaceId: CC,
    question: "What is the registration status?",
    answer: "I think it lapsed.",
    claims: [{ subject: "Compassionate Choice", claim: CLAIM_V1.status, value: "LAPSED" }],
  }, "2026-08-22T00:00:00Z");

  const rows = claimOf(s, CC, CLAIM_V1.status);
  assert.equal(rows.length, 2, "both records survive");
  const owner = rows.find((r) => r.sourceClass === "OWNER_STATEMENT")!;
  assert.equal(owner.state, "SUPERSEDED", "a weaker, older claim is history against a stronger newer one");
  assert.equal(rows.find((r) => r.sourceClass === "OFFICIAL_REGULATORY_DOCUMENT")!.supersededBy, "");
});

test("a resolved question stays resolved, and is not recreated", () => {
  const s = store();
  const opened = ensureOwnerQuestion(s, {
    workspaceId: LF,
    missingFact: "Is LakelandFinds the same business as LocalFinds?",
    whyItMatters: "two workspaces for one business would corrupt every downstream comparison",
    blocking: true,
    evidenceNeeded: "an Owner statement",
  }, NOW);
  assert.equal(opened.created, true);

  assert.equal(closeOwnerQuestion(s, LF, opened.question.missingFact, "ev-1", NOW), true);
  assert.equal(closeOwnerQuestion(s, LF, opened.question.missingFact, "ev-2", NOW), false,
    "a closed question does not reopen");

  const again = ensureOwnerQuestion(s, {
    workspaceId: LF, missingFact: opened.question.missingFact,
    whyItMatters: "x", blocking: true, evidenceNeeded: "y",
  }, NOW);
  assert.equal(again.created, false, "restart must not ask the Owner the same thing again");
  assert.notEqual(again.question.resolvedAtUtc, "");
  assert.equal(s.questions(LF).length, 1);
});

test("an Owner answer closes the matching open question exactly once", () => {
  const s = store();
  const question = "What does LocalFinds sell?";
  ensureOwnerQuestion(s, {
    workspaceId: LF, missingFact: question, whyItMatters: "nothing can be ranked without it",
    blocking: true, evidenceNeeded: "an Owner statement",
  }, NOW);

  const first = recordOwnerAnswer(s, {
    workspaceId: LF, question, answer: "Local deal listings.",
    claims: [{ subject: "LocalFinds", claim: CLAIM_V1.businessModel, value: "local deal listings" }],
  }, NOW);
  assert.equal(first.resolvedQuestionIds.length, 1);

  const second = recordOwnerAnswer(s, {
    workspaceId: LF, question, answer: "Local deal listings.",
    claims: [{ subject: "LocalFinds", claim: CLAIM_V1.businessModel, value: "local deal listings" }],
  }, NOW);
  assert.deepEqual(second.resolvedQuestionIds, [], "an already-resolved question is not resolved twice");
});

test("an Owner answer needs a workspace and an answer", () => {
  const s = store();
  assert.throws(() => recordOwnerAnswer(s, { workspaceId: "", question: "q", answer: "a", claims: [] }, NOW), /workspace/u);
  assert.throws(() => recordOwnerAnswer(s, { workspaceId: LF, question: "q", answer: "  ", claims: [] }, NOW), /answer/u);
});

/* -------------------------------------------------------------------------- */
/* Restart                                                                     */
/* -------------------------------------------------------------------------- */

test("every state survives a restart, with no duplication and no reopened question", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-bev-restart-"));
  temps.push(dir);
  const first = createFileBusinessEvidenceStore(dir);
  for (const ws of [CC, LF]) ingestAll(first, ws);
  closeOwnerQuestion(first, LF, "alias", "", NOW);
  ensureOwnerQuestion(first, {
    workspaceId: LF, missingFact: "alias", whyItMatters: "w", blocking: true, evidenceNeeded: "e",
  }, NOW);
  closeOwnerQuestion(first, LF, "alias", "ev", NOW);
  const before = first.evidence(CC).length;

  // A new store object over the same directory: everything it knows came off disk.
  const second = createFileBusinessEvidenceStore(dir);
  assert.equal(second.evidence(CC).length, before);
  assert.equal(second.evidence(CC).filter((r) => r.state === "SUPERSEDED" || r.supersededBy !== "").length >= 2, true);
  assert.equal(assessRevenueReadiness(CC, second.evidence(CC), second.questions(CC)).readiness,
    "READY_FOR_REVENUE_DISCOVERY");
  assert.notEqual(second.questions(LF).find((q) => q.missingFact === "alias")!.resolvedAtUtc, "");

  // Re-importing the whole corpus after a restart must not duplicate anything.
  for (const ws of [CC, LF]) ingestAll(second, ws);
  assert.equal(second.evidence(CC).length, before, "re-import after restart duplicated evidence");
});

/* -------------------------------------------------------------------------- */
/* Runtime integration                                                         */
/* -------------------------------------------------------------------------- */

test("the runtime reports evidence readiness, and Compassionate Choice is ready", async () => {
  const { mkdirSync } = await import("node:fs");
  const { startAutonomy, runtimeStatus } = await import("../src/autonomy-runtime.js");

  const root = mkdtempSync(join(tmpdir(), "aion-bev-runtime-"));
  temps.push(root);
  const artifactRoot = join(root, "artifacts");
  mkdirSync(artifactRoot, { recursive: true });
  const deps = {
    storeRoot: join(root, "store"),
    artifactRoot,
    now: () => NOW,
    currentSha: "test",
    provenance: "Owner portfolio direction",
  };

  startAutonomy(deps);
  const status = runtimeStatus(deps);

  const cc = status.evidenceReadiness.find((e) => e.workspaceId === CC)!;
  assert.equal(cc.readiness, "READY_FOR_REVENUE_DISCOVERY",
    "the registration is issued; leaving it blocked would be the bug this milestone fixes");
  assert.equal(cc.blocker, "NONE");

  for (const ws of [LF, TTC, AI]) {
    const entry = status.evidenceReadiness.find((e) => e.workspaceId === ws)!;
    // The runtime opens the blocking discovery questions during registration, so these businesses
    // are waiting on the Owner rather than merely short of evidence — a more precise answer.
    assert.equal(entry.readiness, "NEEDS_OWNER_INFORMATION", `${ws} should need the Owner, not be blocked`);
    assert.ok(entry.openBlockingQuestions > 0, `${ws} has no question to ask`);
    assert.ok(entry.researchReady, `${ws} can still be researched`);
    assert.ok(entry.informationGainValue > cc.informationGainValue);
  }

  // Restart: the evidence is on disk and re-registration does not duplicate it.
  const before = status.evidenceReadiness;
  startAutonomy(deps);
  const after = runtimeStatus(deps).evidenceReadiness;
  assert.deepEqual(after, before, "a second start changed the evidence picture");
});
