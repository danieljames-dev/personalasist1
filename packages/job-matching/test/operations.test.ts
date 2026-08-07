import assert from "node:assert/strict";
import test from "node:test";
import { JOB_MATCH_REPORT_OBJECT_V1, type RelationshipObjectDataV1 } from "@aion/object";
import { createJobMatchReportV1, validateJobMatchReportPayloadV1 } from "../src/index.js";
import { JOB_ID, matchRequest, matchingPorts, PROFILE_ID, setupMatchInputs } from "./helpers.js";

test("match operation persists one report and the two approved RelationshipObjects", async () => {
  const ports = matchingPorts();
  await setupMatchInputs(ports);
  const result = await createJobMatchReportV1(matchRequest(), ports);
  assert.equal(result.outcome, "success");
  assert.equal(result.createdObjectCount, 1);
  assert.equal(result.createdRelationshipCount, 2);
  const matchId = ports.idDeriver.derive(matchRequest().matchOperationId, "job-match-report", matchRequest().ownerId);
  const stored = await ports.repository.loadCurrent(matchId);
  assert.equal(stored?.objectType, JOB_MATCH_REPORT_OBJECT_V1.objectType);
  assert.equal(validateJobMatchReportPayloadV1(stored?.data).overallScoreBps, result.overallScoreBps);
  for (const [purpose, target, kind] of [
    ["evaluates", JOB_ID, "aion.relationship.career.match-evaluates-posting.v1"],
    ["uses", PROFILE_ID, "aion.relationship.career.match-uses-profile.v1"],
  ] as const) {
    const relation = await ports.repository.loadCurrent(ports.idDeriver.derive(matchRequest().matchOperationId, `relationship-${purpose}`, target));
    assert.ok(relation);
    const data = relation.data as unknown as RelationshipObjectDataV1;
    assert.equal(data.relationshipKind, kind);
    assert.equal(data.source.objectId, matchId);
    assert.equal(data.target.objectId, target);
  }
});

test("retry is idempotent and stale input revisions fail without persistence", async () => {
  const ports = matchingPorts();
  await setupMatchInputs(ports);
  assert.equal((await createJobMatchReportV1(matchRequest(), ports)).outcome, "success");
  assert.equal((await createJobMatchReportV1(matchRequest(), ports)).outcome, "already-completed");
  const stale = await createJobMatchReportV1({ ...matchRequest(), matchOperationId: "phase9.synthetic.stale", jobPostingRevision: 2 }, ports);
  assert.equal(stale.outcome, "rejected");
  assert.equal(stale.error?.code, "revision-conflict");
  const staleId = ports.idDeriver.derive("phase9.synthetic.stale", "job-match-report", matchRequest().ownerId);
  assert.equal(await ports.repository.loadCurrent(staleId), null);
});
