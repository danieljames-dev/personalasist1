import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationDraftV1, OWNER_REVIEW_LABEL_V1, Sha256ApplicationPreparationIdDeriverV1, validateApplicationDraftPayloadV1 } from "../src/index.js";
import { ports, request, setup } from "./helpers.js";

test("draft outputs are deterministic, review-gated, and every positive claim is cited", async () => {
  const p = ports(); const { matchId } = await setup(p); const first = await createApplicationDraftV1(request(matchId), p);
  assert.equal(first.outcome, "success"); assert.ok(first.usedFactCount > 0);
  const draftId = new Sha256ApplicationPreparationIdDeriverV1().derive("phase10.synthetic.prepare", "application-draft", request(matchId).ownerId);
  const stored = await p.repository.loadCurrent(draftId); assert.ok(stored);
  const draft = validateApplicationDraftPayloadV1(stored!.data);
  assert.equal(draft.reviewStatus, OWNER_REVIEW_LABEL_V1); assert.match(draft.coverLetterDraft, /Owner Review Required/);
  assert.ok(draft.resumeRecommendations.every((claim) => claim.citations.length > 0));
  assert.ok(draft.coverLetterClaims.every((claim) => claim.citations.length > 0));
  assert.equal(JSON.stringify(draft).includes("undefined"), false);
  const retry = await createApplicationDraftV1(request(matchId), p); assert.equal(retry.outcome, "already-completed");
});

test("unknown and unsupported requirements become placeholders, never invented claims", async () => {
  const p = ports(); const { matchId } = await setup(p, { unknownRequirement: true }); await createApplicationDraftV1(request(matchId), p);
  const draftId = new Sha256ApplicationPreparationIdDeriverV1().derive("phase10.synthetic.prepare", "application-draft", request(matchId).ownerId);
  const draft = validateApplicationDraftPayloadV1((await p.repository.loadCurrent(draftId))!.data);
  assert.ok(draft.missingInformationChecklist.some((item) => item.includes("Unrecorded Skill")));
  assert.equal(draft.coverLetterDraft.includes("Unrecorded Skill"), false);
});

test("conflicted facts are excluded from positive claims", async () => {
  const p = ports(); const { matchId } = await setup(p, { conflict: true }); await createApplicationDraftV1(request(matchId), p);
  const draftId = new Sha256ApplicationPreparationIdDeriverV1().derive("phase10.synthetic.prepare", "application-draft", request(matchId).ownerId);
  const draft = validateApplicationDraftPayloadV1((await p.repository.loadCurrent(draftId))!.data);
  assert.equal(draft.coverLetterDraft.includes("Deterministic Testing"), false);
  assert.ok(draft.missingInformationChecklist.some((item) => item.includes("conflict")));
});
