#!/usr/bin/env node
/**
 * Prove the Personal Context engine on real files, through real code, over harmless project data.
 *
 * Unit tests drive a fake filesystem, which is right for the hostile cases and wrong as the only
 * evidence: a fake filesystem cannot show that the real `realpath` resolves the way the boundary
 * assumes, that a store written to a real disk reloads, or that the engine works when it is called
 * the way an operator would call it. So this harness registers a real source over
 * `packages/personal-context/fixtures/aion-project-context`, synchronizes it with the real adapter,
 * and asserts what came out.
 *
 * The source is deliberately about the AION project, under the subject `aion-project`. Proving the
 * engine is not the same as knowing anything about the Owner, and this script says so in its own
 * output: `SYNC_ENGINE_PROVEN` and `OWNER_CONTEXT_COMPLETE` are separate lines with separate values.
 *
 * It also re-reads the durable governance facts this milestone must not disturb — D2 certification,
 * standing authority, Provider Bridge V1, MVA Real Dispatch V1 — because "we did not break anything"
 * is a claim that should be checked rather than asserted.
 *
 * Everything it writes goes under `.aion-local/personal-context-acceptance/`. It reads no personal
 * file, contacts no external system, and spends nothing.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const {
  authorityFromPersonalContext,
  buildOwnerContextReport,
  readOwnerAuthorityRecord,
  recordOwnerCurrentJob,
  renderOwnerContextReport,
  resolveEnrollmentCeiling,
  createFilePersonalContextStore,
  createNodePersonalContextFs,
  failoverBroadensDisclosure,
  failoverDisclosure,
  getContextForJob,
  registerContextSource,
  resolveWithinSource,
  setSourceState,
  syncSource,
} = await import(pathToFileURL(join(repositoryRoot, "packages", "personal-context", "dist", "index.js")).href);

const results = [];
function record(name, value) {
  results.push(`${name} = ${value}`);
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* -------------------------------------------------------------------------- */
/* Durable governance truth this milestone must leave alone                    */
/* -------------------------------------------------------------------------- */

const d2State = JSON.parse(readFileSync(join(repositoryRoot, ".aion-local", "certifications", "d2", "state.json"), "utf8"));
assert.equal(d2State.d2Certification, "GRANTED", "D2 certification is no longer GRANTED");
assert.equal(
  d2State.d2CertifiedSha,
  "17b012b28d911fe563aab19f6e4a697a05b9b718",
  "D2 certified SHA changed",
);
record("D2_CERTIFICATION_AFTER", d2State.d2Certification);
record("D2_CERTIFIED_SHA_AFTER", d2State.d2CertifiedSha);

const authorityDir = join(repositoryRoot, ".aion-local", "owner-authority");
const authorityIds = [
  "OWNER-STANDING-AUTHORITY-V1-20260818T030626Z",
  "PROVIDER-BRIDGE-V1-20260818T034500Z",
  "MVA-REAL-DISPATCH-V1-20260818T072919Z",
  "PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z",
];
for (const id of authorityIds) {
  const authority = JSON.parse(readFileSync(join(authorityDir, `${id}.json`), "utf8"));
  assert.equal(authority.state, "ACTIVE", `${id} is not ACTIVE`);
}
record("OWNER_STANDING_AUTHORITY_V1_AFTER", "ACTIVE");

const bridgeSource = readFileSync(join(repositoryRoot, "packages", "director", "src", "provider-bridge.ts"), "utf8");
assert.match(bridgeSource, /export function routeJob/, "Provider Bridge V1 routing is missing");
assert.match(bridgeSource, /sensitivityEligibility/, "Provider Bridge V1 sensitivity eligibility is missing");
record("PROVIDER_BRIDGE_V1_AFTER", "IMPLEMENTED");

const dispatchSource = readFileSync(join(repositoryRoot, "packages", "director", "src", "mva-dispatch.ts"), "utf8");
assert.match(dispatchSource, /export function createDispatchBootstrap/, "MVA Real Dispatch V1 bootstrap is missing");
assert.match(dispatchSource, /MVA_OWNER_AUTHORIZATION_ID/, "MVA Real Dispatch V1 authorization binding is missing");
record("MVA_REAL_DISPATCH_V1_AFTER", "IMPLEMENTED");

/* -------------------------------------------------------------------------- */
/* A clean acceptance workspace                                                */
/* -------------------------------------------------------------------------- */

const workspace = join(repositoryRoot, ".aion-local", "personal-context-acceptance");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });

const storeRoot = join(workspace, "store");
const store = createFilePersonalContextStore(storeRoot);
const fs = createNodePersonalContextFs();

const fixtureRoot = join(repositoryRoot, "packages", "personal-context", "fixtures", "aion-project-context");
assert.ok(existsSync(fixtureRoot), "the acceptance fixture is missing");

/* -------------------------------------------------------------------------- */
/* 1. Enroll, and prove enrollment is a gate rather than a formality           */
/* -------------------------------------------------------------------------- */

const refused = registerContextSource(
  {
    sourceId: "would-be-confidential",
    sourceType: "APPROVED_LOCAL_FOLDER",
    location: fixtureRoot,
    displayName: "Refused",
    purpose: "prove the ceiling holds",
    sensitivityClass: "CONFIDENTIAL",
  },
  { store, now: nowUtc() },
);
assert.equal(refused.registered, false);
assert.equal(refused.reason, "SENSITIVITY_ABOVE_MILESTONE_CEILING");
record("SENSITIVITY_CEILING_ENFORCED", "PASS");

const primary = registerContextSource(
  {
    sourceId: "aion-project-context",
    sourceType: "APPROVED_PROJECT_ARTIFACT",
    location: fixtureRoot,
    displayName: "AION project context",
    purpose: "Bounded acceptance source describing the AION project, not the Owner",
    sensitivityClass: "INTERNAL",
    // Widened deliberately. This is AION's own project data, not personal material, and the widening
    // has to be explicit precisely because the default is local-only.
    eligibleProviders: ["codex", "grok", "claude", "local"],
    syncMode: "ON_DEMAND",
    maxDepth: 2,
    maxFiles: 20,
    priority: 100,
  },
  { store, now: nowUtc() },
);
assert.equal(primary.registered, true, `enrollment failed: ${primary.detail ?? ""}`);
record("SOURCE_REGISTERED", primary.source.sourceId);

// Omitting the provider flag must produce the least-disclosure row, not the convenient one.
const defaulted = registerContextSource(
  {
    sourceId: "default-disclosure-probe",
    sourceType: "APPROVED_PROJECT_ARTIFACT",
    location: fixtureRoot,
    displayName: "Least-disclosure probe",
    purpose: "Prove the default provider set is local-only",
  },
  { store, now: nowUtc() },
);
assert.equal(defaulted.registered, true, `probe enrollment failed: ${defaulted.detail ?? ""}`);
assert.deepEqual([...defaulted.source.eligibleProviders], ["local"], "the default must be least disclosure");
setSourceState("default-disclosure-probe", "REVOKED", { store, now: nowUtc() });
record("LEAST_DISCLOSURE_DEFAULT", "PASS");

/* -------------------------------------------------------------------------- */
/* 2. A real bounded sync over real files                                      */
/* -------------------------------------------------------------------------- */

const firstReceipt = syncSource("aion-project-context", { store, fs, now: nowUtc() });
assert.equal(firstReceipt.outcome, "COMPLETED", `first sync was ${firstReceipt.outcome}`);
assert.equal(firstReceipt.filesRead, 2, "expected the declaration and the README to be read");
assert.equal(firstReceipt.filesUnsupported, 1, "expected the README to yield no facts");
assert.equal(firstReceipt.boundaryEscapeAttempts, 0);
assert.ok(firstReceipt.factsCreated >= 5, "expected the declaration's facts to be created");
record("REAL_SYNC", "PASS");
record("REAL_FACTS_PERSISTED", store.listFacts().length > 0 ? "YES" : "NO");

const persisted = createFilePersonalContextStore(storeRoot).listFacts();
assert.ok(persisted.length >= 5, "facts did not survive a store reload");
assert.ok(
  persisted.every((fact) => fact.sourceId === "aion-project-context" && fact.sourceReference.length > 0 && fact.evidenceReference.length > 0),
  "a persisted fact is missing provenance",
);
record("REAL_PROVENANCE_PERSISTED", "YES");
record("RESTART_RELOAD", "PASS");

const historical = persisted.find((fact) => fact.predicate === "priorMilestone");
const current = persisted.find((fact) => fact.predicate === "activeMilestone");
assert.equal(historical?.temporalState, "HISTORICAL");
assert.equal(historical?.freshnessState, "HISTORICAL");
assert.equal(current?.temporalState, "CURRENT");
record("TEMPORAL_DISTINCTION", "PASS");
record("FRESHNESS_TRACKING", "PASS");

/* -------------------------------------------------------------------------- */
/* 3. Unchanged content is not reprocessed                                     */
/* -------------------------------------------------------------------------- */

const secondReceipt = syncSource("aion-project-context", { store, fs, now: nowUtc() });
assert.equal(secondReceipt.outcome, "SKIPPED_UNCHANGED");
assert.equal(secondReceipt.filesRead, 0, "an unchanged source was re-read");
record("UNCHANGED_RESYNC_SKIPPED", "PASS");

/* -------------------------------------------------------------------------- */
/* 4. The boundary refuses to leave the approved root, on the real filesystem  */
/* -------------------------------------------------------------------------- */

const enrolled = store.loadSource("aion-project-context");
let escapes = 0;
for (const hostile of ["../../../AGENTS.md", "..\\..\\package.json", "c:/windows/win.ini", "/etc/passwd", "nul"]) {
  const decision = resolveWithinSource(enrolled, hostile, fs);
  assert.equal(decision.allowed, false, `boundary allowed ${hostile}`);
  escapes += 1;
}
assert.equal(escapes, 5);
record("PATH_ESCAPE_PROTECTION", "PASS");
record("REAL_SOURCE_ESCAPE", "NO");

/* -------------------------------------------------------------------------- */
/* 5. A second approved source that disagrees, on real files                   */
/* -------------------------------------------------------------------------- */

const altRoot = join(workspace, "alt-source");
mkdirSync(altRoot, { recursive: true });
const altDeclaration = (milestone) =>
  JSON.stringify(
    {
      schema: "aion.personalContext.declaration.v1",
      subject: "aion-project",
      documentId: "aion-project-context-alt",
      facts: [
        {
          category: "PROJECT",
          predicate: "activeMilestone",
          value: milestone,
          evidenceReference: "alt-source/project-context.json",
          temporalState: "CURRENT",
          lastConfirmedAt: "2026-08-18T00:00:00Z",
          confidence: "MEDIUM",
          sensitivity: "INTERNAL",
          eligibleUses: ["BUSINESS_CONTEXT", "INTERNAL_DIAGNOSTIC"],
        },
      ],
    },
    null,
    2,
  );
writeFileSync(join(altRoot, "project-context.json"), altDeclaration("JOB-DISCOVERY-MATCHING-V1"), "utf8");

// Narrower than the bridge would allow, to prove a source can restrict disclosure further.
const alternate = registerContextSource(
  {
    sourceId: "aion-project-context-alt",
    sourceType: "APPROVED_LOCAL_FOLDER",
    location: altRoot,
    displayName: "Alternate project record",
    purpose: "Second approved source used to prove conflict handling on real files",
    sensitivityClass: "INTERNAL",
    eligibleProviders: ["claude", "local"],
    priority: 50,
  },
  { store, now: nowUtc() },
);
assert.equal(alternate.registered, true, `alternate enrollment failed: ${alternate.detail ?? ""}`);

const altReceipt = syncSource("aion-project-context-alt", { store, fs, now: nowUtc() });
assert.equal(altReceipt.outcome, "COMPLETED");
assert.ok(altReceipt.conflictsConfirmed >= 1, "two sources claiming different current milestones did not conflict");
record("CONFLICT_TRACKING", "PASS");

const bothSides = createFilePersonalContextStore(storeRoot)
  .listFacts()
  .filter((fact) => fact.predicate === "activeMilestone" && fact.supersededBy === null);
assert.equal(bothSides.length, 2, "a conflicting claim was silently dropped");
assert.ok(bothSides.every((fact) => fact.conflictState === "CONFIRMED"));
record("NO_SILENT_OVERWRITE", "PASS");

/* -------------------------------------------------------------------------- */
/* 6. A changed source produces a new version and a supersession               */
/* -------------------------------------------------------------------------- */

writeFileSync(join(altRoot, "project-context.json"), altDeclaration("PERSONAL-CONTEXT-SYNC-V1-ALT"), "utf8");
const changedReceipt = syncSource("aion-project-context-alt", { store, fs, now: nowUtc() });
assert.equal(changedReceipt.outcome, "COMPLETED");
assert.notEqual(changedReceipt.fingerprintBefore, changedReceipt.fingerprintAfter);
assert.equal(changedReceipt.factsSuperseded, 1, "the alternate source's earlier claim was not superseded");
assert.equal(store.loadSource("aion-project-context-alt").version, 3);
record("CHANGED_SOURCE_RESYNC", "PASS");
record("SOURCE_VERSIONING", "PASS");

/* -------------------------------------------------------------------------- */
/* 7. Bounded retrieval and provider-scoped disclosure                         */
/* -------------------------------------------------------------------------- */

const request = (overrides) => ({
  jobId: "acceptance-1",
  objective: "Describe the AION project's current milestone and technology",
  subject: "aion-project",
  categories: ["PROJECT", "TECHNOLOGY"],
  provider: "claude",
  sensitivityCeiling: "INTERNAL",
  minimumFreshness: "UNKNOWN_FRESHNESS",
  maxItems: 10,
  maxCharacters: 5_000,
  allowedUses: ["BUSINESS_CONTEXT"],
  ...overrides,
});

const toClaude = getContextForJob(request({}), { store });
assert.ok(toClaude.facts.length > 0, "bounded retrieval returned nothing");
assert.ok(toClaude.facts.every((fact) => fact.provenance.sourceId.length > 0));
assert.ok(toClaude.conflictWarnings.length >= 1, "the conflict was not surfaced to the consumer");
assert.ok(toClaude.contextFingerprint.length > 0);
assert.equal(
  toClaude.facts.some((fact) => fact.category === "BUSINESS_CONTEXT"),
  false,
  "a category the job did not ask for was disclosed",
);
record("REAL_CONTEXT_RETRIEVAL", "PASS");

const toGrok = getContextForJob(request({ provider: "grok" }), { store });
assert.equal(
  toGrok.facts.some((fact) => fact.provenance.sourceId === "aion-project-context-alt"),
  false,
  "a source that excluded grok was disclosed to grok",
);
assert.ok(
  toGrok.omissions.some((entry) => entry.reason === "PROVIDER_NOT_ELIGIBLE"),
  "the provider omission was not reported",
);
record("REAL_PROVIDER_FILTERING", "PASS");

const liveFacts = store.listFacts().filter((fact) => fact.supersededBy === null);
const handover = failoverDisclosure(liveFacts, "claude", "grok");
assert.equal(failoverBroadensDisclosure(handover), false, "a takeover widened disclosure");
assert.deepEqual(handover.newlyDisclosed, []);
record("PROVIDER_SCOPED_DISCLOSURE", "PASS");

const bounded = getContextForJob(request({ maxItems: 1 }), { store });
assert.equal(bounded.facts.length, 1);
assert.equal(bounded.truncated, true);
record("MAX_CONTEXT_BOUND", "PASS");

/* -------------------------------------------------------------------------- */
/* 8. Revocation stops future reads and future disclosure                      */
/* -------------------------------------------------------------------------- */

const revoked = setSourceState("aion-project-context-alt", "REVOKED", { store, now: nowUtc() });
assert.equal(revoked.changed, true);

const afterRevocation = getContextForJob(request({}), { store });
assert.equal(
  afterRevocation.facts.some((fact) => fact.provenance.sourceId === "aion-project-context-alt"),
  false,
  "a revoked source was still disclosed",
);
assert.ok(afterRevocation.omissions.some((entry) => entry.reason === "SOURCE_REVOKED"));

const deniedReceipt = syncSource("aion-project-context-alt", { store, fs, now: nowUtc() });
assert.equal(deniedReceipt.outcome, "DENIED");
assert.equal(deniedReceipt.denialReason, "SOURCE_REVOKED");
assert.equal(deniedReceipt.filesRead, 0);

// The evidence itself is retained, so where a past disclosure came from is still answerable.
assert.ok(
  createFilePersonalContextStore(storeRoot).listFacts().some((fact) => fact.sourceId === "aion-project-context-alt"),
  "revocation erased provenance instead of stopping disclosure",
);
record("SOURCE_REVOCATION", "PASS");

/* -------------------------------------------------------------------------- */
/* 9. Knowledge is not permission                                              */
/* -------------------------------------------------------------------------- */

for (const fact of store.listFacts()) {
  const answer = authorityFromPersonalContext(fact);
  assert.equal(answer.granted, false, "a stored fact granted authority");
}
record("KNOWLEDGE_AUTHORITY_SEPARATION", "PASS");

/* -------------------------------------------------------------------------- */
/* 10. Receipts are durable and never flatter a partial run                    */
/* -------------------------------------------------------------------------- */

const receipts = createFilePersonalContextStore(storeRoot).listReceipts();
assert.ok(receipts.length >= 5, "receipts were not persisted");
assert.ok(receipts.some((receipt) => receipt.outcome === "SKIPPED_UNCHANGED"));
assert.ok(receipts.some((receipt) => receipt.outcome === "DENIED"));
record("SYNC_RECEIPTS_DURABLE", "PASS");

/* -------------------------------------------------------------------------- */
/* 11. The ceiling is the Owner authority record, not a constant               */
/* -------------------------------------------------------------------------- */

const enrollmentAuthority = readOwnerAuthorityRecord(repositoryRoot, "OWNER-CONTEXT-ENROLLMENT-V1-20260818T172656Z");
assert.ok(enrollmentAuthority !== null, "the enrollment authority record could not be read");
const grantedCeiling = resolveEnrollmentCeiling(enrollmentAuthority, nowUtc());
assert.equal(grantedCeiling.ceiling, "CONFIDENTIAL");
assert.equal(grantedCeiling.basis, "OWNER_AUTHORITY_SENSITIVE_YES");

const withoutAuthority = resolveEnrollmentCeiling(null, nowUtc());
assert.equal(withoutAuthority.ceiling, "INTERNAL", "no authority must fail closed");

const personalRefused = registerContextSource(
  {
    sourceId: "personal-without-authority",
    sourceType: "RESUME_CV",
    location: fixtureRoot,
    displayName: "Refused",
    purpose: "prove the ceiling is authority-driven",
  },
  { store, now: nowUtc() },
);
assert.equal(personalRefused.registered, false);
assert.equal(personalRefused.reason, "SENSITIVITY_ABOVE_MILESTONE_CEILING");
record("CEILING_FROM_OWNER_AUTHORITY", "PASS");

/* -------------------------------------------------------------------------- */
/* 12. File-free Owner current-job entry, on synthetic acceptance values       */
/* -------------------------------------------------------------------------- */

const ownerJobSource = registerContextSource(
  {
    sourceId: "acceptance-current-job",
    sourceType: "OWNER_ENTERED_CURRENT_JOB",
    location: join(workspace, "owner-entry"),
    displayName: "Acceptance current job",
    purpose: "Synthetic Owner-entry source used to prove the file-free entry path",
  },
  { store, now: nowUtc(), authority: enrollmentAuthority },
);
assert.equal(ownerJobSource.registered, true, `owner-entry enrollment failed: ${ownerJobSource.detail ?? ""}`);
assert.equal(ownerJobSource.source.sensitivityClass, "CONFIDENTIAL");
assert.deepEqual([...ownerJobSource.source.eligibleProviders], ["local"], "least disclosure by default");

// Deliberately synthetic and obviously not the Owner: this harness proves the mechanism, and must
// never be mistaken for real context.
const SUBJECT = "acceptance-subject";
const partial = recordOwnerCurrentJob(
  "acceptance-current-job",
  { subject: SUBJECT, title: "Acceptance Role", skills: ["Fixture Skill A", "Fixture Skill B"] },
  { store, now: nowUtc() },
);
assert.ok(!("error" in partial), `owner entry failed: ${"error" in partial ? partial.error : ""}`);
assert.equal(partial.receipt.filesRead, 0, "an Owner entry must read no file");
assert.ok(partial.facts.length >= 3);
assert.ok(partial.notSupplied.includes("employer"), "an unsupplied field must be reported, not invented");
assert.equal(partial.facts.every((fact) => fact.origin === "OWNER_ENTERED"), true);
record("OWNER_ENTERED_CURRENT_JOB", "PASS");
record("OWNER_ENTRY_NO_FABRICATION", "PASS");

const storedOwnerFacts = createFilePersonalContextStore(storeRoot).listFacts().filter((fact) => fact.subject === SUBJECT);
assert.ok(storedOwnerFacts.length >= 3, "Owner-entered facts did not survive a store reload");
assert.equal(storedOwnerFacts.some((fact) => fact.predicate === "employer"), false, "nothing stood in for the missing employer");

// A restatement retires what it does not repeat, and keeps the retired row answerable.
const restated = recordOwnerCurrentJob(
  "acceptance-current-job",
  { subject: SUBJECT, title: "Acceptance Role Updated", skills: ["Fixture Skill A"] },
  { store, now: nowUtc() },
);
assert.ok(!("error" in restated));
assert.ok(restated.retired.length >= 1, "an unrepeated value should be retired");
const liveOwner = store.listFacts().filter((fact) => fact.subject === SUBJECT && fact.supersededBy === null);
assert.equal(liveOwner.some((fact) => fact.value === "Fixture Skill B"), false, "a retired skill is no longer live");
assert.equal(store.listFacts().some((fact) => fact.value === "Fixture Skill B"), true, "but it is not deleted");
record("OWNER_ENTRY_RESTATEMENT", "PASS");

/* -------------------------------------------------------------------------- */
/* 13. Owner review report                                                     */
/* -------------------------------------------------------------------------- */

const ownerReport = buildOwnerContextReport({ store }, { subject: SUBJECT, now: nowUtc() });
assert.equal(ownerReport.byOrigin.INFERRED, 0, "nothing may ever be inferred");
assert.ok(ownerReport.byOrigin.OWNER_ENTERED > 0);
assert.ok(ownerReport.missingCategories.includes("WORK_HISTORY"), "a gap must be named rather than omitted");
assert.equal(ownerReport.ownerContextComplete, "PARTIAL");

const rendered = renderOwnerContextReport(ownerReport);
assert.match(rendered, /## Missing important career context/);
assert.match(rendered, /## Provider disclosure restrictions/);
assert.match(rendered, /origin: `OWNER_ENTERED`/);
assert.match(rendered, /No fact here was inferred/);

const redacted = renderOwnerContextReport(ownerReport, { redactValues: true });
assert.equal(redacted.includes("Acceptance Role Updated"), false, "redaction must remove values");
assert.match(redacted, /chars withheld/);

const grokRow = ownerReport.providerDisclosure.find((row) => row.provider === "grok");
assert.equal(grokRow?.visibleFacts, 0, "least disclosure means a cloud provider sees none of the personal facts");
record("OWNER_REVIEW_REPORT", "PASS");
record("REPORT_ORIGIN_LABELLING", "PASS");
record("REPORT_REDACTION", "PASS");

/* -------------------------------------------------------------------------- */
/* The distinction that must not be blurred                                    */
/* -------------------------------------------------------------------------- */

const foreign = store
  .listFacts()
  .filter((fact) => fact.subject !== "aion-project" && fact.subject !== SUBJECT);
assert.equal(foreign.length, 0, "the acceptance run ingested something that was neither project data nor its own fixture");

record("SYNC_ENGINE_PROVEN", "YES");
record("OWNER_CONTEXT_COMPLETE", "NO");
record("PERSONAL_FILES_SCANNED", "NO");
record("UNBOUNDED_DRIVE_SCAN", "NO");
record("EXTERNAL_SYSTEMS_ACCESSED", "NO");
record("SPEND_USD", "0");

console.log("AION PERSONAL CONTEXT SYNC V1 — REAL ACCEPTANCE");
for (const line of results) console.log(line);
console.log(
  "\nNote: the engine is proven over AION project data only. The Owner's real personal and work " +
    "sources are not enrolled, so nothing here describes the Owner.",
);
