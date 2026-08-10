import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailAuthUrl,
  createGmailDraftFromFixture,
  defaultGmailConfig,
  extractCommitmentsFromBody,
  gmailConnectorStatus,
  searchGmailFixtures,
} from "../src/connectors/gmail-connector.js";
import {
  bestPerformingPosts,
  brandsNeedingAttention,
  defaultMetricoolConfig,
  listMetricoolBrandFixtures,
  metricoolConnectorStatus,
} from "../src/connectors/metricool-connector.js";

test("gmail status is NOT_CONFIGURED without client id", () => {
  const s = gmailConnectorStatus(defaultGmailConfig(), {});
  assert.equal(s.code, "NOT_CONFIGURED");
  assert.equal(s.authorized, false);
});

test("gmail status asks for Owner consent when client id present but no refresh", () => {
  const cfg = defaultGmailConfig();
  cfg.clientId = "test-client.apps.googleusercontent.com";
  const s = gmailConnectorStatus(cfg, {});
  assert.equal(s.code, "GMAIL_OWNER_CONSENT_REQUIRED");
  assert.equal(s.consentRequired, true);
});

test("gmail fixture search and commitments", () => {
  const msgs = [
    {
      id: "1",
      threadId: "t1",
      from: "jane@acme.test",
      to: "owner@test",
      subject: "Pricing",
      snippet: "about pricing",
      bodyText: "We will decide by Friday.\nThanks",
      internalDate: "2030-01-01T00:00:00.000Z",
      labelIds: ["INBOX"],
    },
  ];
  assert.equal(searchGmailFixtures(msgs, "pricing").length, 1);
  assert.ok(extractCommitmentsFromBody(msgs[0]!.bodyText).some((c) => /Friday/i.test(c)));
  const d = createGmailDraftFromFixture({
    to: "jane@acme.test",
    subject: "Re: Pricing",
    body: "Draft body",
    basedOn: "fixture",
  });
  assert.equal(d.status, "draft");
});

test("gmail auth url uses official Google endpoint", () => {
  const cfg = defaultGmailConfig();
  cfg.clientId = "cid";
  const url = buildGmailAuthUrl(cfg, "state123");
  assert.match(url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.match(url, /gmail\.readonly/);
  assert.match(url, /access_type=offline/);
});

test("metricool status requires token", () => {
  const s = metricoolConnectorStatus(defaultMetricoolConfig(), {});
  assert.equal(s.code, "METRICOOL_OWNER_TOKEN_REQUIRED");
});

test("metricool is READY when token env is set", () => {
  const s = metricoolConnectorStatus(defaultMetricoolConfig(), {
    AION_METRICOOL_USER_TOKEN: "test-token-not-real",
  });
  assert.equal(s.code, "READY");
  assert.equal(s.authorized, true);
});

test("gmail is READY when client secret and refresh token env present", () => {
  const cfg = defaultGmailConfig();
  cfg.clientId = "test-client.apps.googleusercontent.com";
  const s = gmailConnectorStatus(cfg, {
    AION_GMAIL_CLIENT_SECRET: "secret",
    AION_GMAIL_REFRESH_TOKEN: "refresh",
  });
  assert.equal(s.code, "READY");
  assert.ok(!s.capabilities.includes("send"));
});

test("metricool fixtures: active brands and quiet brands", () => {
  const brands = [
    { id: "b1", name: "Alpha", networks: ["instagram"], active: true },
    { id: "b2", name: "Beta", networks: ["linkedin"], active: false },
  ];
  assert.equal(listMetricoolBrandFixtures(brands).length, 1);
  const posts = [
    {
      id: "p1",
      brandId: "b1",
      network: "instagram",
      text: "hello",
      publishedAt: "2020-01-01T00:00:00.000Z",
      scheduledAt: null,
      metrics: { likes: 10, comments: 2, reach: 1000 },
    },
  ];
  assert.equal(bestPerformingPosts(posts)[0]!.id, "p1");
  const quiet = brandsNeedingAttention(brands, posts, "2030-01-01T00:00:00.000Z", 14);
  assert.ok(quiet.some((q) => q.brand === "Alpha"));
});
