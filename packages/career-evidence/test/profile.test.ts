import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAREER_FACT_OBJECT_V1,
  createObjectV1,
  type RelationshipObjectDataV1,
} from "@aion/object";
import {
  buildCareerProfileV1,
  importCareerEvidenceV1,
  markCareerFactsConflictingV1,
  validateCareerProfilePayloadV1,
  CAREER_FACT_PAYLOAD_VERSION_V1,
} from "../src/index.js";
import { ACTOR_ID, evidencePorts, inputFixture, OWNER_ID, syntheticFactsInput } from "./helpers.js";

async function profileFacts(t: Parameters<typeof inputFixture>[0]) {
  const fixture = await inputFixture(t);
  const ports = evidencePorts();
  const factIds = [];
  for (const [index, role] of ["Synthetic Profile Role Alpha", "Synthetic Profile Role Beta"].entries()) {
    const input = syntheticFactsInput();
    input.entries[0]!.factId = `synthetic-profile-entry-${index}`;
    input.entries[0]!.value.value = role;
    const path = join(fixture.approved, `profile-${index}.json`);
    await writeFile(path, JSON.stringify(input), "utf8");
    const operation = `phase7.synthetic.profile-source-${index}`;
    const imported = await importCareerEvidenceV1({
      version: "1", importOperationId: operation, ownerId: OWNER_ID, actorId: ACTOR_ID,
      approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
      sourcePath: { version: "1", absolutePath: path }, sourceType: "career-facts-json",
    }, ports);
    assert.equal(imported.outcome, "success");
    factIds.push(ports.idDeriver.derive(operation, "career-fact", `synthetic-profile-entry-${index}\0/entries/0/value`));
  }
  return { ports, factIds: factIds.sort() };
}

test("profile preserves fact evidence states and represents membership only with RelationshipObjects", async (t) => {
  const { ports, factIds } = await profileFacts(t);
  const conflict = await markCareerFactsConflictingV1({
    version: "1", conflictOperationId: "phase7.synthetic.profile-conflict", ownerId: OWNER_ID, actorId: ACTOR_ID,
    factIds, expectedRevisions: [1, 1], fieldLocations: ["/entries/0/value"],
  }, ports);
  assert.equal(conflict.outcome, "success");
  const request = {
    version: "1", buildOperationId: "phase7.synthetic.profile-build", ownerId: OWNER_ID, actorId: ACTOR_ID,
    profileObjectId: null, expectedRevision: null, factIds,
    requiredFactTypes: ["employer", "role-title"], buildConfigurationVersion: "1",
  };
  const built = await buildCareerProfileV1(request, ports);
  assert.equal(built.outcome, "success");
  assert.equal(built.includedFactCount, 2);
  assert.deepEqual(built.missingFactTypes, ["employer"]);
  const profileId = ports.idDeriver.derive(request.buildOperationId, "career-profile", "profile");
  const profile = await ports.repository.loadCurrent(profileId);
  assert.ok(profile);
  const payload = validateCareerProfilePayloadV1(profile.data);
  assert.equal(payload.processingOutcome.state, "success");
  assert.equal(payload.factStates.every((state) => state.status.conflict === "conflicting"), true);
  assert.equal(Object.hasOwn(payload, "relationships"), false);
  for (const factId of factIds) {
    const relationshipId = ports.idDeriver.derive(profileId, "profile-contains-fact", factId);
    const relationship = await ports.repository.loadCurrent(relationshipId);
    assert.ok(relationship);
    const data = relationship.data as unknown as RelationshipObjectDataV1;
    assert.equal(data.relationshipKind, "aion.relationship.career.profile-contains-fact.v1");
    assert.equal(data.source.objectId, profileId);
    assert.equal(data.target.objectId, factId);
  }
  const retry = await buildCareerProfileV1(request, ports);
  assert.equal(retry.outcome, "already-completed");
  assert.equal((await ports.repository.loadCurrent(profileId))!.revision, 2);
});

test("profile rebuild ends removed membership and rejects stale expected revision without corruption", async (t) => {
  const { ports, factIds } = await profileFacts(t);
  const initial = {
    version: "1", buildOperationId: "phase7.synthetic.profile-initial", ownerId: OWNER_ID, actorId: ACTOR_ID,
    profileObjectId: null, expectedRevision: null, factIds,
    requiredFactTypes: ["role-title"], buildConfigurationVersion: "1",
  };
  assert.equal((await buildCareerProfileV1(initial, ports)).outcome, "success");
  const profileId = ports.idDeriver.derive(initial.buildOperationId, "career-profile", "profile");
  const rebuild = {
    ...initial, buildOperationId: "phase7.synthetic.profile-rebuild", profileObjectId: profileId,
    expectedRevision: 2, factIds: [factIds[1]!],
  };
  assert.equal((await buildCareerProfileV1(rebuild, ports)).outcome, "success");
  const removedRelationshipId = ports.idDeriver.derive(profileId, "profile-contains-fact", factIds[0]!);
  const removed = await ports.repository.loadCurrent(removedRelationshipId);
  assert.ok(removed);
  assert.notEqual((removed.data as unknown as RelationshipObjectDataV1).effectiveUntil, null);
  const beforeStale = await ports.repository.loadCurrent(profileId);
  const stale = await buildCareerProfileV1({
    ...rebuild, buildOperationId: "phase7.synthetic.profile-stale", expectedRevision: 2,
  }, ports);
  assert.equal(stale.outcome, "rejected");
  assert.deepEqual(await ports.repository.loadCurrent(profileId), beforeStale);
});

test("synthetic profile construction retains owner-confirmed, extracted, inferred, and missing states distinctly", async () => {
  const ports = evidencePorts();
  const timestamp = "2026-08-06T12:00:00.000Z";
  const definitions = [
    { key: "owner", factType: "skill", assertion: "owner-confirmed", confidence: "owner-asserted", method: "structured-owner-input", ownerConfirmed: true, normalizedValue: { state: "supplied", value: "Synthetic skill" }, ruleId: null },
    { key: "extracted", factType: "employer", assertion: "extracted", confidence: "deterministic-extraction", method: "deterministic-structured-extraction", ownerConfirmed: false, normalizedValue: { state: "supplied", value: "Synthetic organization" }, ruleId: null },
    { key: "inferred", factType: "industry", assertion: "inferred", confidence: "deterministic-inference", method: "deterministic-rule", ownerConfirmed: false, normalizedValue: { state: "supplied", value: "Synthetic domain" }, ruleId: "aion.rule.synthetic-industry.v1" },
    { key: "missing", factType: "education", assertion: "missing", confidence: "not-assessed", method: "deterministic-missing-state", ownerConfirmed: false, normalizedValue: { state: "unknown" }, ruleId: null },
  ] as const;
  const factIds = [];
  for (const definition of definitions) {
    const factId = ports.idDeriver.derive("phase7.synthetic.state-fixtures", "career-fact", definition.key);
    const sourceId = ports.idDeriver.derive("phase7.synthetic.state-fixtures", "career-source", definition.key);
    const snapshot = createObjectV1({
      registration: CAREER_FACT_OBJECT_V1, ownerId: OWNER_ID, actorId: ACTOR_ID,
      lifecycleState: "active", metadata: { labels: [], extensions: {} },
      provenance: {
        version: "1", originCategory: "derived", observedAt: timestamp,
        correlationId: "phase7.synthetic.state-fixtures", sourceObjectId: sourceId,
        derivationMethodId: "aion.rule.synthetic-fixture.v1",
      },
      data: {
        contractVersion: CAREER_FACT_PAYLOAD_VERSION_V1, factId, factType: definition.factType,
        normalizedValue: definition.normalizedValue, sourceObjectId: sourceId,
        sourceLocation: "/entries/0/value", confidence: definition.confidence,
        ownerConfirmed: definition.ownerConfirmed,
        status: { version: "1", verification: "unverified", assertion: definition.assertion, conflict: "none" },
        extractionMethod: {
          version: "1", method: definition.method,
          parser: { version: "1", parserId: "aion.parser.synthetic", parserVersion: "1", sourceLocationFormat: "json-pointer-v1" },
          ruleId: definition.ruleId,
        },
        createdAt: timestamp, conflict: { version: "1", state: "none" }, supersession: { version: "1", state: "current" },
      },
    }, {
      ...ports,
      idGenerator: { generate: () => factId },
      clock: { now: () => timestamp },
    });
    await ports.repository.commit({ expectedRevision: null, snapshot });
    factIds.push(factId);
  }
  factIds.sort();
  const result = await buildCareerProfileV1({
    version: "1", buildOperationId: "phase7.synthetic.profile-state-build", ownerId: OWNER_ID, actorId: ACTOR_ID,
    profileObjectId: null, expectedRevision: null, factIds,
    requiredFactTypes: ["education", "employer", "industry", "skill"], buildConfigurationVersion: "1",
  }, ports);
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.missingFactTypes, ["education"]);
  const profileId = ports.idDeriver.derive("phase7.synthetic.profile-state-build", "career-profile", "profile");
  const profile = await ports.repository.loadCurrent(profileId);
  assert.ok(profile);
  const assertions = validateCareerProfilePayloadV1(profile.data).factStates.map((state) => state.status.assertion).sort();
  assert.deepEqual(assertions, ["extracted", "inferred", "missing", "owner-confirmed"]);
});
