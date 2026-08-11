/**
 * Repair first-sync marketing false positives; re-classify first-batch equivalents;
 * optional second bounded live sync (max 25).
 */
import { createAionServer } from "../../apps/aion/server.mjs";
import {
  classifyGmailMessage,
  extractInterpersonalCommitments,
} from "../../packages/local-assistant/dist/connectors/gmail-connector.js";

const app = await createAionServer({});
const service = app.service;

const FALSE_RELS = [
  "d3cef3f8-0bdb-47a5-89cd-898b1fbe7f0c", // FunderPro
  "149060b0-58c3-46b4-82d9-7a83f60fd628", // Vesica
];
const FALSE_COMMITS = [
  "57f3417d-196a-46d6-9a8b-8ab4996279ad",
  "22b7375b-a779-4ff0-a1ee-800f5d9bbad8",
  "a4763628-8f20-4558-8e13-834023857539",
];

const repair = await service.repairGmailMarketingContamination({
  relationshipIds: FALSE_RELS,
  commitmentIds: FALSE_COMMITS,
  reason: "First-sync marketing false positives: FunderPro/Vesica prospects + SOMA marketing commitments",
});
console.log("REPAIR", JSON.stringify(repair));

const firstBatchFixtures = [
  {
    id: "19ff0b1d5de7628e",
    from: "Kristen at FunderPro <support@funderpro.com>",
    subject: "GOBIG30 is still on",
    bodyText: "Friday is the deadline. Claim your offer. Unsubscribe.",
    headers: { "list-unsubscribe": "<mailto:x@y.com>" },
  },
  {
    id: "19ff13f38ef1cde3",
    from: "The Vesica Institute <info@vesica.org>",
    subject: "Free Series! The Original Sacred Geometry Course",
    bodyText: "Free series. View in browser. Unsubscribe.",
    headers: { "list-unsubscribe": "<https://vesica.org/u>" },
  },
  {
    id: "19ff16cca690c9c7",
    from: "SOMA Breath <support@somabreath.com>",
    subject: "She got high to heal",
    bodyText:
      "I'll show you how to achieve a drug-like high using only your breath.\nBook a free Vision & Flow Call and we'll help you create a plan.\nUnsubscribe",
    headers: { "list-unsubscribe": "<mailto:u@s.com>" },
  },
  {
    id: "legit-other",
    from: "Alex Buyer <alex.buyer@gmail.com>",
    to: "Daniel Coffman <nearmiss1193@gmail.com>",
    subject: "Re: Tacoma quote",
    bodyText: "Daniel, I'll send you the quote tomorrow.",
  },
];

let retestFalseProspects = 0;
let retestFalseOwner = 0;
let retestLegit = 0;
for (const m of firstBatchFixtures) {
  const cls = classifyGmailMessage(m);
  const hits = extractInterpersonalCommitments(m.bodyText, {
    marketing: cls.marketingOrBulk,
    fromOwnerMailbox: false,
  });
  const ownerHits = hits.filter((h) => h.actor === "owner");
  if (m.id.startsWith("19ff") && (cls.shouldProposeContact || cls.contactClass === "PROSPECT")) retestFalseProspects += 1;
  if (m.id.startsWith("19ff") && ownerHits.length) retestFalseOwner += 1;
  if (m.id === "legit-other" && hits.some((h) => h.actor === "other")) retestLegit += 1;
  console.log(
    "RECLASS",
    m.id,
    cls.relevance,
    "propose=",
    cls.shouldProposeContact,
    "class=",
    cls.contactClass,
    "ownerHits=",
    ownerHits.length,
    "otherHits=",
    hits.filter((h) => h.actor === "other").length,
  );
}

// Live state check after repair
const snap = await service.snapshot();
const activeFalseProspects = (snap.relationships || []).filter(
  (r) =>
    !r.archived &&
    FALSE_RELS.includes(r.id),
).length;
const activeFalseCommits = (snap.executive?.commitments || []).filter(
  (c) => FALSE_COMMITS.includes(c.id) && c.status !== "cancelled",
).length;
const board = await service.attentionBoard();
const falseAttention = (board.ownerMustDo || []).filter((i) => FALSE_COMMITS.includes(i.id)).length;

console.log(
  JSON.stringify({
    RETEST_FALSE_PROSPECTS: retestFalseProspects,
    RETEST_FALSE_OWNER_COMMITMENTS: retestFalseOwner,
    RETEST_LEGITIMATE_OTHER: retestLegit,
    ACTIVE_FALSE_PROSPECTS: activeFalseProspects,
    ACTIVE_FALSE_COMMITS: activeFalseCommits,
    FALSE_ATTENTION: falseAttention,
    BOARD_MUST: (board.ownerMustDo || []).map((x) => x.title).slice(0, 10),
  }),
);

await app.close?.();
process.exit(activeFalseProspects === 0 && activeFalseCommits === 0 && falseAttention === 0 && retestFalseProspects === 0 && retestFalseOwner === 0 ? 0 : 2);
