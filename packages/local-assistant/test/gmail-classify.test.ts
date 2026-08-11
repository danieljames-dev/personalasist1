import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGmailAuthUrl,
  classifyGmailMessage,
  defaultGmailConfig,
  extractCommitmentsFromBody,
} from "../src/connectors/gmail-connector.js";
import { mapMetricoolBrandsToWorkspaces } from "../src/connectors/metricool-connector.js";

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
