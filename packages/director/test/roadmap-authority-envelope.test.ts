/**
 * Authorize once, cover the routine children, stop at real boundaries.
 *
 * This is the file where a mistake is expensive. Everything else in the roadmap fails closed by
 * refusing to act; an envelope fails *open* by letting something act, so the tests below spend far
 * more effort on the refusals than on the one path that allows work.
 *
 * The property that matters most is not any single ceiling — it is that nothing in `src/` can write
 * an envelope. An envelope is projected read-only from the Owner authority record the Founder
 * PowerShell script writes. If that ever stops being true, every ceiling below becomes advisory.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALWAYS_GATED_BOUNDARIES_V1,
  ROADMAP_ENVELOPE_SCHEMA_V1,
  deriveEnvelopeFromOwnerAuthority,
  deriveEnvelopes,
  resolveInheritedAuthority,
  type OwnerRoadmapAuthorityEnvelopeV1,
} from "../src/roadmap-authority-envelope.js";
import { resolveMilestoneAuthority, type OwnerAuthorityRecordV1 } from "../src/roadmap-policy.js";
import { ROADMAP_MILESTONE_SCHEMA_V1, type RoadmapMilestoneV1 } from "../src/roadmap-contracts.js";

const NOW = "2026-08-19T05:00:00Z";
const PARENT_OBJECTIVE = "Improve the AION engineering roadmap";
const AUTH_ID = "FIXTURE-ENGINEERING-V1-20260819T000000Z";
const ENVELOPE_ID = `ENVELOPE-${AUTH_ID}`;

function record(overrides: Partial<OwnerAuthorityRecordV1> = {}): OwnerAuthorityRecordV1 {
  return {
    schemaVersion: "aion.ownerStandingAuthority.v1",
    ownerAuthorizationId: AUTH_ID,
    milestoneId: "FIXTURE-ENGINEERING-V1",
    authorizedObjective: PARENT_OBJECTIVE,
    allowedWriteDomains: ["apps", "packages/director", "docs", "scripts"],
    allowedExternalEffects: ["CONTROLLED_PUSH"],
    allowedProviders: ["local"],
    spendingCeilingUsd: 0,
    productionWriterPermission: "NO",
    sensitiveDataPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    state: "ACTIVE",
    expiresAtUtc: "",
    supersededBy: "",
    createdAtUtc: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

function milestone(overrides: Partial<RoadmapMilestoneV1> = {}): RoadmapMilestoneV1 {
  return {
    schema: ROADMAP_MILESTONE_SCHEMA_V1,
    milestoneId: "routine-child",
    title: "Routine child",
    objective: "wire the panel to the port",
    status: "PLANNED",
    priority: 500,
    dependencies: [],
    requiredCapabilities: ["CODING"],
    requiredContextCategories: [],
    authorityClass: "MILESTONE_AUTHORIZED",
    ownerAuthorizationId: null,
    authorityEnvelopeId: ENVELOPE_ID,
    derivedFromObjective: PARENT_OBJECTIVE,
    writeDomains: ["apps", "docs"],
    sensitivityClass: "INTERNAL",
    allowedProviders: ["local"],
    spendCapUsd: 0,
    externalEffectClass: "REPOSITORY_REVERSIBLE",
    reversibilityClass: "REVERSIBLE",
    riskClasses: [],
    verificationPlan: { steps: [{ kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true }], declaredAt: NOW },
    independentReviewPolicy: "NONE",
    retryPolicy: { maxAttempts: 3, maxIdenticalFailures: 2, maxIdenticalPatches: 2, maxProviderSwitches: 4 },
    leaseTtlMs: 60_000,
    expectedArtifacts: [],
    completionCriteria: ["done"],
    attempts: 0,
    blockedReason: null,
    provenance: "fixture",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function envelopes(overrides: Partial<OwnerAuthorityRecordV1> = {}): readonly OwnerRoadmapAuthorityEnvelopeV1[] {
  return deriveEnvelopes([record(overrides)], NOW);
}

function decide(m: Partial<RoadmapMilestoneV1>, r: Partial<OwnerAuthorityRecordV1> = {}) {
  return resolveInheritedAuthority(milestone(m), envelopes(r), NOW);
}

/* -------------------------------------------------------------------------- */
/* The property that makes every other test meaningful                         */
/* -------------------------------------------------------------------------- */

test("nothing in src can create, write or widen an envelope", () => {
  // Tests compile into `dist-test/test/`, so `src` is two levels up — the same walk `wiring.test.ts`
  // makes for the same reason.
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(join(srcDir, name), "utf8");
    // `JobEnvelopeV1` is a different thing entirely — the unit of work handed to a provider — and the
    // modules that persist it must keep being able to write. Only the *authority* envelope is at
    // stake here, so match its type name rather than the word.
    if (!source.includes("OwnerRoadmapAuthorityEnvelopeV1")) continue;
    for (const forbidden of ["writeFileSync", "appendFileSync", "mkdirSync", "createWriteStream"]) {
      assert.equal(source.includes(forbidden), false, `${name} can write, and it handles authority envelopes`);
    }
  }
  const module = readFileSync(join(srcDir, "roadmap-authority-envelope.ts"), "utf8");
  for (const forbidden of ["node:fs", "createEnvelope", "saveEnvelope", "widenEnvelope", "grantEnvelope"]) {
    assert.equal(module.includes(forbidden), false, `the envelope module exposes ${forbidden}`);
  }
});

test("an envelope carries exactly the ceilings the Owner record states, and invents none", () => {
  const envelope = deriveEnvelopeFromOwnerAuthority(record(), NOW);
  assert.notEqual(envelope, null);
  assert.equal(envelope!.schema, ROADMAP_ENVELOPE_SCHEMA_V1);
  assert.equal(envelope!.envelopeId, ENVELOPE_ID, "the envelope id must be derived, not chosen");
  assert.deepEqual([...envelope!.allowedWriteDomains], ["apps", "packages/director", "docs", "scripts"]);
  assert.deepEqual([...envelope!.allowedProviders], ["local"]);
  assert.equal(envelope!.spendCeilingUsd, 0);
  assert.equal(envelope!.sensitivityCeiling, "INTERNAL");
  assert.equal(envelope!.productionWriterPermission, "NO");
  assert.equal(envelope!.requiresReversible, true);
  assert.deepEqual([...envelope!.approvedObjectives], [PARENT_OBJECTIVE]);
  assert.deepEqual([...envelope!.alwaysGatedBoundaries], [...ALWAYS_GATED_BOUNDARIES_V1]);
});

test("a record missing any ceiling yields no envelope rather than a generous one", () => {
  for (const missing of [
    { authorizedObjective: "" },
    { allowedWriteDomains: [] },
    { allowedProviders: [] },
    { state: "" },
    { ownerAuthorizationId: "" },
  ] as Partial<OwnerAuthorityRecordV1>[]) {
    assert.equal(deriveEnvelopeFromOwnerAuthority(record(missing), NOW), null, `${JSON.stringify(missing)} produced an envelope`);
  }
  assert.equal(deriveEnvelopeFromOwnerAuthority(null, NOW), null);
  assert.equal(deriveEnvelopeFromOwnerAuthority(undefined, NOW), null);
  assert.equal(deriveEnvelopeFromOwnerAuthority({ ownerAuthorizationId: 5 } as unknown as OwnerAuthorityRecordV1, NOW), null);
});

test("sensitivity ceiling only rises on an explicit YES", () => {
  assert.equal(deriveEnvelopeFromOwnerAuthority(record({ sensitiveDataPermission: "NO" }), NOW)!.sensitivityCeiling, "INTERNAL");
  assert.equal(deriveEnvelopeFromOwnerAuthority(record({ sensitiveDataPermission: "yes" }), NOW)!.sensitivityCeiling, "INTERNAL");
  assert.equal(deriveEnvelopeFromOwnerAuthority(record({ sensitiveDataPermission: "YES" }), NOW)!.sensitivityCeiling, "CONFIDENTIAL");
});

/* -------------------------------------------------------------------------- */
/* The one path that allows                                                    */
/* -------------------------------------------------------------------------- */

test("a routine child inside the envelope inherits authority", () => {
  const decision = decide({});
  assert.equal(decision.outcome, "ALLOW_INHERITED", decision.reason);
  assert.equal(decision.envelopeId, ENVELOPE_ID);
  assert.equal(decision.ownerAuthorizationId, AUTH_ID);
  assert.ok(decision.checks.length >= 10, "the decision must record what it checked");
  assert.deepEqual(decision.checks.filter((c) => !c.passed), [], "an allow with a failed check");
});

test("a sibling routine child inherits too — inheritance is not one-shot", () => {
  for (const id of ["routine-child", "routine-sibling", "routine-third"]) {
    assert.equal(decide({ milestoneId: id }).outcome, "ALLOW_INHERITED", `${id} did not inherit`);
  }
});

test("provider failover inside the approved set needs no new authorization", () => {
  const wide = { allowedProviders: ["codex", "grok", "claude", "local"] };
  assert.equal(decide({ allowedProviders: ["local", "claude"] }, wide).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ allowedProviders: ["codex"] }, wide).outcome, "ALLOW_INHERITED");
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                    */
/* -------------------------------------------------------------------------- */

test("a milestone claiming no envelope is not inherited", () => {
  const decision = resolveInheritedAuthority(milestone({ authorityEnvelopeId: null }), envelopes(), NOW);
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("a claim on an envelope nobody authorized is DENIED, not gated", () => {
  // Denied rather than gated on purpose: this is not "we cannot prove it", it is a claim of coverage
  // that does not exist, and treating it as a question to ask the Owner would reward inventing ids.
  const decision = decide({ authorityEnvelopeId: "ENVELOPE-anything-i-like" });
  assert.equal(decision.outcome, "DENY");
  assert.match(decision.reason, /no durable Owner authority implies/);
});

test("a missing envelope fails closed", () => {
  const decision = resolveInheritedAuthority(milestone(), [], NOW);
  assert.equal(decision.outcome, "DENY");
});

test("revoked denies; suspended and expired gate", () => {
  assert.equal(decide({}, { state: "REVOKED" }).outcome, "DENY");
  assert.equal(decide({}, { state: "SUSPENDED" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({}, { state: "EXPIRED" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({}, { expiresAtUtc: "2026-08-18T00:00:00Z" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({}, { supersededBy: "SOMETHING-NEWER" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("an unreadable expiry denies rather than being ignored", () => {
  const decision = decide({}, { expiresAtUtc: "not a date" });
  assert.equal(decision.outcome, "DENY");
  assert.match(decision.reason, /unreadable/);
});

test("lineage must be proven, not asserted vaguely", () => {
  assert.equal(decide({ derivedFromObjective: null }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ derivedFromObjective: "some other objective entirely" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  // Casing and spacing do not change what an objective is.
  assert.equal(decide({ derivedFromObjective: `  ${PARENT_OBJECTIVE.toUpperCase()}  ` }).outcome, "ALLOW_INHERITED");
  // A milestone cannot use its own objective as its own parent.
  assert.equal(decide({ derivedFromObjective: "wire the panel to the port" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("undeclared write scope gates rather than being read as writing nothing", () => {
  // A milestone stored before write domains existed has no such field at all — the case a stored
  // record actually presents after this change ships.
  const legacy = { ...milestone() } as Record<string, unknown>;
  delete legacy["writeDomains"];
  assert.equal(
    resolveInheritedAuthority(legacy as unknown as RoadmapMilestoneV1, envelopes(), NOW).outcome,
    "REQUIRE_FRESH_OWNER_APPROVAL",
  );
  assert.equal(decide({ writeDomains: [] }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("write-domain expansion gates", () => {
  const decision = decide({ writeDomains: ["apps", "private"] });
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.match(decision.reason, /write domains outside the envelope: private/);
});

test("provider expansion gates", () => {
  const decision = decide({ allowedProviders: ["local", "claude"] });
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.match(decision.reason, /providers outside the envelope: claude/);
});

test("sensitivity expansion gates", () => {
  assert.equal(decide({ sensitivityClass: "CONFIDENTIAL" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ sensitivityClass: "RESTRICTED" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  // Even with CONFIDENTIAL approved, RESTRICTED is still above the ceiling.
  assert.equal(decide({ sensitivityClass: "CONFIDENTIAL" }, { sensitiveDataPermission: "YES" }).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ sensitivityClass: "RESTRICTED" }, { sensitiveDataPermission: "YES" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("an unknown sensitivity class denies rather than being ranked as low", () => {
  const decision = decide({ sensitivityClass: "SUPER_SECRET" as RoadmapMilestoneV1["sensitivityClass"] });
  assert.equal(decision.outcome, "DENY");
});

test("spend expansion gates", () => {
  assert.equal(decide({ spendCapUsd: 1 }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ spendCapUsd: 25 }, { spendingCeilingUsd: 50 }).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ spendCapUsd: 51 }, { spendingCeilingUsd: 50 }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("an external effect outside the envelope gates, and repository-local work does not need listing", () => {
  assert.equal(decide({ externalEffectClass: "NONE" }).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ externalEffectClass: "REPOSITORY_REVERSIBLE" }).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ externalEffectClass: "CONTROLLED_PUSH" }).outcome, "ALLOW_INHERITED");
  assert.equal(decide({ externalEffectClass: "IDEMPOTENT_EXTERNAL" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ externalEffectClass: "IRREVERSIBLE_EXTERNAL", reversibilityClass: "IRREVERSIBLE" }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("irreversible work gates under a reversible-only envelope", () => {
  const decision = decide({ reversibilityClass: "IRREVERSIBLE" });
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.match(decision.reason, /irreversible/i);
});

test("OAuth, production, money and security risks each gate on their own", () => {
  assert.equal(decide({ riskClasses: ["PRODUCTION_OR_EXTERNAL"] }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ riskClasses: ["MONEY"] }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ riskClasses: ["SENSITIVE_DATA"] }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.equal(decide({ riskClasses: ["SECURITY_OR_PRIVACY"] }).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("a high-consequence milestone never inherits, however clean everything else is", () => {
  const decision = decide({ authorityClass: "HIGH_CONSEQUENCE" });
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.match(decision.reason, /high-consequence/);
});

/* -------------------------------------------------------------------------- */
/* Integration with the milestone authority resolver                           */
/* -------------------------------------------------------------------------- */

test("the direct-record path is unchanged for milestones that do not claim an envelope", () => {
  const direct = milestone({ authorityEnvelopeId: null, ownerAuthorizationId: AUTH_ID });
  const decision = resolveMilestoneAuthority(direct, [record({ milestoneId: "routine-child" })], NOW);
  assert.equal(decision.outcome, "ALLOW_STANDING");

  const unknown = milestone({ authorityEnvelopeId: null, ownerAuthorizationId: "NOT-A-REAL-ID" });
  assert.equal(resolveMilestoneAuthority(unknown, [record()], NOW).outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
});

test("an inherited milestone resolves through the same entry point the orchestrator calls", () => {
  const decision = resolveMilestoneAuthority(milestone(), [record()], NOW);
  assert.equal(decision.outcome, "ALLOW_STANDING");
  assert.equal(decision.ownerAuthorizationId, AUTH_ID);
});

test("a failed envelope claim is not laundered into the direct-record path", () => {
  // The milestone names a real authorization *and* an envelope it does not qualify for. Falling back
  // would let a refused inheritance be re-asked as a different question until one of them said yes.
  const sneaky = milestone({ ownerAuthorizationId: AUTH_ID, writeDomains: ["private"] });
  const decision = resolveMilestoneAuthority(sneaky, [record({ milestoneId: "routine-child" })], NOW);
  assert.notEqual(decision.outcome, "ALLOW_STANDING", "a refused inheritance fell through to the direct path");
  assert.match(decision.reason, /write domains outside the envelope/);
});

test("an unrelated new objective gates even under an active envelope", () => {
  const unrelated = milestone({
    milestoneId: "owner-context-history-access",
    objective: "Bounded read-only recovery of Owner-controlled Git, AION workspace and local AI history",
    derivedFromObjective: null,
    authorityEnvelopeId: null,
    ownerAuthorizationId: null,
  });
  const decision = resolveMilestoneAuthority(unrelated, [record()], NOW);
  assert.equal(decision.outcome, "REQUIRE_FRESH_OWNER_APPROVAL");
  assert.match(decision.reason, /names no Owner authorization/);
});
