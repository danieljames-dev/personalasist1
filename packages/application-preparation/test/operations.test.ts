import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationDraftV1 } from "../src/index.js";
import { ports, request, setup } from "./helpers.js";

test("persistence creates one draft, one match edge, and one edge per used fact", async () => {
  const p = ports(); const { matchId } = await setup(p); const result = await createApplicationDraftV1(request(matchId), p);
  assert.equal(result.createdObjectCount, 1); assert.equal(result.createdRelationshipCount, result.usedFactCount + 1);
  assert.equal(result.relationshipReferences.length, result.usedFactCount + 1);
});
test("stale match revisions fail closed without writes", async () => {
  const p = ports(); const { matchId } = await setup(p); const result = await createApplicationDraftV1(request(matchId, 2), p);
  assert.equal(result.outcome, "rejected"); assert.equal(result.error?.code, "revision-conflict"); assert.equal(result.createdObjectCount, 0);
});
