import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailAuthUrl,
  classifyGmailMessage,
  defaultGmailConfig,
  extractCommitmentsFromBody,
  extractInterpersonalCommitments,
  isMarketingOrBulkMail,
} from "../src/connectors/gmail-connector.js";
import { mapMetricoolBrandsToWorkspaces } from "../src/connectors/metricool-connector.js";
import { buildCommitment } from "../src/commitments.js";
import { buildAttentionBoard } from "../src/attention-engine.js";

test("Gmail OAuth auth URL uses AION loopback callback only (never Google tutorial 8080)", () => {
  const cfg = {
    ...defaultGmailConfig(),
    clientId: "000000000000-placeholder.apps.googleusercontent.com",
  };
  const url = buildGmailAuthUrl(cfg, "aion-proof-state", { includeSend: true });
  const u = new URL(url);
  const redirect = u.searchParams.get("redirect_uri");
  const scope = u.searchParams.get("scope") || "";
  assert.equal(redirect, "http://127.0.0.1:31415/oauth/gmail/callback");
  assert.equal(cfg.redirectUri, "http://127.0.0.1:31415/oauth/gmail/callback");
  assert.equal(url.includes("8080"), false);
  assert.equal(url.includes("oauth2callback"), false);
  assert.equal(url.includes("localhost"), false);
  assert.ok(scope.includes("gmail.readonly"));
  assert.ok(scope.includes("gmail.compose"));
  assert.ok(scope.includes("gmail.send"));
});

test("Gmail classify: noise vs career vs business", () => {
  assert.equal(
    classifyGmailMessage({ from: "noreply@store.com", subject: "Sale!" }).relevance,
    "noise",
  );
  assert.equal(
    classifyGmailMessage({
      from: "recruiter@company.com",
      subject: "Interview next week",
      bodyText: "We would like to schedule an interview for the logistics role.",
    }).relevance,
    "career_or_job",
  );
  assert.equal(
    classifyGmailMessage({
      from: "kris.leach0@gmail.com",
      subject: "AHCA checklist",
      bodyText: "Compassionate Choice grant follow-up",
    }).workspaceHint,
    "compassionate-choice",
  );
  assert.equal(
    classifyGmailMessage({
      from: "buyer@example.com",
      subject: "Tacoma appointment",
      bodyText: "Interested in a test drive this weekend",
    }).relevance,
    "customer_or_prospect",
  );
});

test("Gmail commitments extract without inventing CRM", () => {
  const hits = extractCommitmentsFromBody("I will call you Friday.\nThanks!");
  assert.ok(hits.some((h) => /friday/i.test(h)));
});

test("A: newsletter I'll show you how → no Owner commitment", () => {
  const body = "I'll show you how to achieve a drug-like high using only your breath.\nUnsubscribe here.";
  const cls = classifyGmailMessage({
    from: "SOMA Breath <support@somabreath.com>",
    subject: "She got high to heal",
    bodyText: body,
    headers: { "list-unsubscribe": "<mailto:unsub@example.com>" },
  });
  assert.equal(cls.relevance, "noise");
  assert.equal(cls.shouldExtractCommitments, false);
  assert.equal(extractInterpersonalCommitments(body, { marketing: true }).length, 0);
  assert.equal(extractInterpersonalCommitments(body, { marketing: false }).length, 0);
});

test("B: marketing we'll contact you → no Owner commitment", () => {
  const body = "We'll help you create a step-by-step plan. Book a free Vision & Flow Call today.";
  const cls = classifyGmailMessage({
    from: "Team <hello@marketing.example>",
    subject: "Free coaching call",
    bodyText: body,
    labelIds: ["CATEGORY_PROMOTIONS"],
  });
  assert.equal(cls.marketingOrBulk, true);
  assert.equal(cls.shouldExtractCommitments, false);
  const hits = extractInterpersonalCommitments(body);
  assert.equal(hits.filter((h) => h.actor === "owner").length, 0);
});

test("C: promotional auto-mail from named salesperson → no CRM prospect solely from message", () => {
  const cls = classifyGmailMessage({
    from: "Kristen at FunderPro <support@funderpro.com>",
    subject: "GOBIG30 is still on — extended through end of week",
    bodyText: "Friday is the deadline. Claim your offer now. Unsubscribe.",
    headers: { "list-unsubscribe": "<https://funderpro.com/unsub>" },
  });
  assert.equal(cls.shouldProposeContact, false);
  assert.equal(cls.contactClass, "UNKNOWN");
  assert.ok(cls.marketingOrBulk || cls.relevance === "noise");
});

test("D: genuine direct email other-person commitment", () => {
  const body = "Daniel, I'll send you the quote tomorrow.";
  const cls = classifyGmailMessage({
    from: "Alex Buyer <alex.buyer@gmail.com>",
    to: "Daniel Coffman <nearmiss1193@gmail.com>",
    subject: "Re: Tacoma quote",
    bodyText: body,
  });
  assert.notEqual(cls.relevance, "noise");
  const hits = extractInterpersonalCommitments(body, { fromOwnerMailbox: false });
  assert.ok(hits.some((h) => h.actor === "other" && /quote/i.test(h.statement)));
  assert.equal(hits.filter((h) => h.actor === "owner").length, 0);
});

test("E: genuine Owner-authored reply → Owner commitment", () => {
  const body = "I'll send you the paperwork Friday.";
  const hits = extractInterpersonalCommitments(body, { fromOwnerMailbox: true });
  assert.ok(hits.some((h) => h.actor === "owner" && /paperwork/i.test(h.statement)));
});

test("F: legitimate direct prospect correspondence may propose CRM", () => {
  const cls = classifyGmailMessage({
    from: "Jordan Lee <jordan.lee@gmail.com>",
    to: "Daniel Coffman <nearmiss1193@gmail.com>",
    subject: "Interested in a Tacoma test drive",
    bodyText: "Hi Daniel, I talked to you yesterday about the Limited Tacoma. Can we set an appointment this weekend?",
  });
  assert.equal(cls.relevance, "customer_or_prospect");
  assert.equal(cls.shouldProposeContact, true);
  assert.equal(cls.contactClass, "PROSPECT");
});

test("F2: internal @lakelandtoyota.com is never auto-prospect", () => {
  const cls = classifyGmailMessage({
    from: "Michele Drake <micheled@lakelandtoyota.com>",
    subject: "directions",
    bodyText: "Here are the directions for the Toyota appointment lot.",
  });
  assert.equal(cls.shouldProposeContact, false);
  assert.equal(cls.contactClass, "UNKNOWN");
  assert.equal(cls.workspaceHint, "work");
});

test("G: cancelled/invalidated commitment does not create Attention OWNER_MUST_DO", () => {
  const now = "2026-08-11T18:00:00.000Z";
  const open = buildCommitment(
    {
      committedBy: "Owner",
      committedTo: "SOMA",
      statement: "I'll show you how [INVALIDATED 2026-08-11: marketing]",
      sourceRef: "gmail:fake",
      confidence: 70,
      status: "cancelled",
    },
    { id: "c1", now, workspace: "personal" },
  );
  open.status = "cancelled";
  const board = buildAttentionBoard({
    nowIso: now,
    relationships: [],
    tasks: [],
    commitments: [open],
  });
  assert.equal(board.ownerMustDo.filter((i) => i.id === "c1").length, 0);
});

test("isMarketingOrBulkMail multi-signal without single keyword reliance", () => {
  const a = isMarketingOrBulkMail({
    from: "news@brand.com",
    subject: "Weekly tips",
    bodyText: "Hello friend",
    headers: { "list-unsubscribe": "<mailto:x@y.com>" },
  });
  assert.equal(a.bulk, true);
});

test("Metricool mapping auto only high confidence", () => {
  const m = mapMetricoolBrandsToWorkspaces(
    [
      { id: "1", name: "Compassionate Choice Home Services" },
      { id: "2", name: "Totally Unrelated Brand XYZ" },
    ],
    [
      { id: "compassionate-choice", label: "Compassionate Choice", brandName: "Compassionate Choice Home Services" },
      { id: "work", label: "Lakeland Toyota" },
    ],
  );
  assert.equal(m[0]!.action, "auto_map");
  assert.equal(m[0]!.workspaceId, "compassionate-choice");
  assert.equal(m[1]!.action, "review");
  assert.equal(m[1]!.workspaceId, null);
});
