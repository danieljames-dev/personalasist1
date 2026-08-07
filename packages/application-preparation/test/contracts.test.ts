import assert from "node:assert/strict";
import test from "node:test";
import { validateApplicationPreparationRequestV1 } from "../src/index.js";
import { ports, request, setup } from "./helpers.js";

test("preparation request is closed and pins the Job Match revision", async () => {
  const p = ports(); const { matchId } = await setup(p);
  assert.equal(validateApplicationPreparationRequestV1(request(matchId)).jobMatchRevision, 1);
  assert.throws(() => validateApplicationPreparationRequestV1({ ...request(matchId), extra: true }));
  assert.throws(() => validateApplicationPreparationRequestV1({ ...request(matchId), jobMatchRevision: 0 }));
});
