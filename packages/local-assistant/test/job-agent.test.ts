import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobApplication,
  draftCoverLetterSkeleton,
  interviewPrepFromKnowledge,
  scoreJobFit,
} from "../src/job-agent.js";
import { emptyOwnerKnowledge, buildOwnerKnowledgeFact } from "../src/owner-knowledge.js";
import { findCustomersMentioning, findStalledDeals, routeCrmAssistantIntent } from "../src/crm-assistant.js";
import type { RelationshipV1 } from "../src/contracts.js";

const now = "2030-06-01T00:00:00.000Z";

test("job application is never submission-authorized", () => {
  const app = buildJobApplication(
    { employer: "Acme", title: "Sales Manager" },
    { id: "11111111-1111-4111-8111-111111111111", now },
  );
  assert.equal(app.submissionAuthorized, false);
  assert.equal(app.status, "researching");
});

test("fit score uses owner knowledge keywords", () => {
  const k = emptyOwnerKnowledge();
  k.facts = [
    buildOwnerKnowledgeFact(
      { category: "skill", title: "Negotiation", content: "B2B enterprise negotiation" },
      { id: "22222222-2222-4222-8222-222222222222", now },
    ),
  ];
  const fit = scoreJobFit(k, "Looking for B2B negotiation and enterprise sales");
  assert.ok(fit.score > 0);
  assert.ok(fit.matched.length >= 1);
});

test("cover letter and interview prep are drafts", () => {
  const app = buildJobApplication(
    { employer: "Acme", title: "AE" },
    { id: "33333333-3333-4333-8333-333333333333", now },
  );
  const cover = draftCoverLetterSkeleton(app, "Owner", []);
  assert.match(cover, /DRAFT ONLY/);
  const prep = interviewPrepFromKnowledge(app, []);
  assert.match(prep, /will not apply/i);
});

test("routes job and product intents", () => {
  assert.equal(routeCrmAssistantIntent("Track application for AE at Acme").intent, "JOB_WORK");
  assert.equal(routeCrmAssistantIntent("Which deals are stalled?").intent, "SALES_INSIGHT");
  assert.equal(routeCrmAssistantIntent("Find a product opportunity").intent, "PRODUCT_BUILD");
});

test("stalled deals and pricing mentions", () => {
  const r = {
    id: "1",
    displayName: "Quiet Co",
    organisation: "Quiet Co",
    archived: false,
    lifecycle: "engaged",
    lastContactAt: "2020-01-01T00:00:00.000Z",
    followUps: [],
    notes: "They asked about pricing last year",
    objections: [],
    interactions: [],
  } as unknown as RelationshipV1;
  const stalled = findStalledDeals([r], now, 14);
  assert.ok(stalled.some((s) => s.customer === "Quiet Co"));
  const pricing = findCustomersMentioning([r], "pricing");
  assert.equal(pricing.length, 1);
});
