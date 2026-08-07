import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationDraftV1, Sha256ApplicationPreparationIdDeriverV1, validateApplicationDraftPayloadV1, validateApplicationPreparationRequestV1 } from "../src/index.js";
import { ports, request, setup } from "./helpers.js";

test("preparation request is closed and pins the Job Match revision", async () => {
  const p = ports(); const { matchId } = await setup(p);
  assert.equal(validateApplicationPreparationRequestV1(request(matchId)).jobMatchRevision, 1);
  assert.throws(() => validateApplicationPreparationRequestV1({ ...request(matchId), extra: true }));
  assert.throws(() => validateApplicationPreparationRequestV1({ ...request(matchId), jobMatchRevision: 0 }));
});

test("new draft canonical positions reject non-NFC, binary floating-point, oversize, and unknown members", async () => {
  const p = ports(); const { matchId } = await setup(p); await createApplicationDraftV1(request(matchId), p);
  const draftId = new Sha256ApplicationPreparationIdDeriverV1().derive("phase10.synthetic.prepare", "application-draft", request(matchId).ownerId);
  const stored = await p.repository.loadCurrent(draftId); assert.ok(stored);
  const draft = structuredClone(validateApplicationDraftPayloadV1(stored.data));
  assert.throws(() => validateApplicationDraftPayloadV1({ ...draft, unknownMember: true }));
  assert.throws(() => validateApplicationDraftPayloadV1({ ...draft, jobMatch: {
    objectId: draft.jobMatch.objectId, payloadVersion: draft.jobMatch.payloadVersion, revision: 1.5,
  } }));
  assert.throws(() => validateApplicationDraftPayloadV1({ ...draft, coverLetterDraft: "Draft — Owner Review Required\nCafe\u0301" }));
  assert.throws(() => validateApplicationDraftPayloadV1({ ...draft, coverLetterDraft: `Draft — Owner Review Required\n${"A".repeat(1_048_577)}` }));
});
