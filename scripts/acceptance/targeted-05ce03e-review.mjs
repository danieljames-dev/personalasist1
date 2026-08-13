#!/usr/bin/env node
/**
 * TARGETED review of Claude SHA 05ce03e only.
 * Not full 24-gate final acceptance.
 * Does not modify Claude sources.
 *
 * Env:
 *   AION_CLAUDE_WORKTREE=C:\AION-HQ-claude-daily-intelligence
 *   AION_ACCEPTANCE_HEAD=05ce03e986cd2774601d49f3c407eaa279914380
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WT = process.env.AION_CLAUDE_WORKTREE || "C:\\AION-HQ-claude-daily-intelligence";
const EXPECTED = "05ce03e986cd2774601d49f3c407eaa279914380";
const HEAD = process.env.AION_ACCEPTANCE_HEAD || EXPECTED;

function load(rel) {
  const p = join(WT, "packages", "local-assistant", "dist", rel);
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return import(pathToFileURL(p).href);
}

function verifySha() {
  const r = spawnSync("git", ["-C", WT, "rev-parse", "HEAD"], { encoding: "utf8" });
  const head = (r.stdout || "").trim();
  return { head, ok: head === EXPECTED || head.startsWith("05ce03e") };
}

const defects = [];
const results = [];

function rec(id, status, detail = "", severity = null) {
  results.push({ id, status, detail, severity });
  if (status === "FAIL") defects.push({ id, detail, severity: severity || "major" });
}

function scoreUsefulness(question, reply, manual = {}) {
  const flags = [];
  const r = String(reply || "");
  const q = String(question || "");
  if (/intent:|schema v1|AssistantState|PracticalGoalV1|LOT_POPULATION/i.test(r)) flags.push("INTENT_OR_ENUM_LEAK");
  if (/\bhow many\b/i.test(q) && /\b(lot|used|cars|vehicles)\b/i.test(q)) {
    const unknown = /unknown|don't know|do not know|I don't know|haven't (physically )?(verified|counted)|whole physical sample|actual(ly)? on the lot/i.test(r);
    const webSep = /website|dealer (feed|website)|online inventory|listed/i.test(r)
      && /not proof|not the same|aren't the same|not a substitute/i.test(r);
    const onlyRecap = !unknown && !webSep && /\b(crown|vin|you photographed)\b/i.test(r);
    if (onlyRecap) flags.push("REPEATED_RECORD_WITHOUT_ANSWERING");
  }
  // Duplicate next-step suggestion
  const nextHits = (r.match(/Keep photographing/gi) || []).length;
  if (nextHits > 1) flags.push("DUPLICATE_SUGGESTION");

  const dims = {
    GROUNDING: manual.GROUNDING ?? (flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING") ? 1 : 4),
    USEFULNESS: manual.USEFULNESS ?? (flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING") ? 1 : 4),
    CONTEXT_RETENTION: manual.CONTEXT_RETENTION ?? 4,
    NATURALNESS: manual.NATURALNESS ?? (flags.includes("INTENT_OR_ENUM_LEAK") ? 2 : 4),
    ACTIONABILITY: manual.ACTIONABILITY ?? (/next|photograph|keep |ask /i.test(r) ? 4 : 3),
    PROACTIVITY: manual.PROACTIVITY ?? (/keep photograph|next/i.test(r) ? 4 : 3),
    HONESTY_ABOUT_UNKNOWN: manual.HONESTY_ABOUT_UNKNOWN
      ?? (/unknown|don't know|I don't know|haven't/i.test(r) ? 5 : 3),
  };
  if (flags.includes("DUPLICATE_SUGGESTION")) {
    dims.NATURALNESS = Math.min(dims.NATURALNESS, 3);
    dims.USEFULNESS = Math.min(dims.USEFULNESS, 3);
  }
  const mean = Object.values(dims).reduce((a, b) => a + b, 0) / 7;
  return { dims, mean, flags, autoFail: flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING") };
}

async function main() {
  const sha = verifySha();
  if (!sha.ok) {
    console.error(JSON.stringify({ error: "SHA_MISMATCH", expected: EXPECTED, actual: sha.head }));
    process.exit(2);
  }

  const bundle = await load("vehicle-evidence-bundle.js");
  const scope = await load("lot-scope-reasoning.js");
  const conv = await load("aion-conversation.js");
  const mem = await load("owner-archive-memory.js");
  const orch = await load("conversation-orchestrator.js");
  const route = await load("conversation-orchestrator.js");

  const BAD = "STDAAABS1RS004150";
  const GOOD = "JTDACAAJ8T3051788";
  const GOOD2 = "JTDACAAU4V3084476"; // glass oracle — validate
  const NOW = "2026-08-13T12:00:00.000Z";

  // --- Multi-photo ---
  const imgs = [
    { imageRef: "a", role: "VIN_CLOSEUP", ocrText: `VIN ${BAD}`, vinCandidates: [BAD], quality: 30 },
    { imageRef: "b", role: "WINDOW_STICKER", ocrText: `VIN ${GOOD} CROWN SIGNIA`, vinCandidates: [GOOD], quality: 90 },
    { imageRef: "c", role: "WINDOW_STICKER", ocrText: "BASE MSRP 49090 TOTAL 50955", vinCandidates: [], quality: 80 },
  ];
  const consensus = bundle.resolveVinAcrossImages(imgs);
  rec("MULTI_PHOTO invalid-first recovery",
    consensus.validatedVin === GOOD && consensus.resolution === "RESOLVED" ? "PASS" : "FAIL",
    JSON.stringify({ vin: consensus.validatedVin, resolution: consensus.resolution, rejected: consensus.rejected?.length }));
  rec("MULTI_PHOTO rejected bad candidate",
    (consensus.rejected || []).some((x) => (x.candidate || "").includes("STDAAABS") || x.candidate === BAD)
      ? "PASS" : "FAIL",
    JSON.stringify(consensus.rejected?.slice(0, 2)));

  const built = bundle.buildVehicleEvidenceBundle({
    bundleId: "t1",
    workspace: "work",
    conversationId: "c1",
    messageId: "m1",
    images: imgs,
    capturedAt: NOW,
    vehicles: [{
      id: "veh-crown", vin: GOOD, year: 2026, make: "Toyota", model: "Crown Signia", trim: "Limited",
      condition: "used", presenceStatus: "ONLINE_LISTED",
    }],
    readings: [{
      imageRef: "c", model: "Crown Signia", trim: "Limited", exteriorColor: null,
      baseMsrp: 49090, totalSuggestedRetail: 50955, features: ["AWD"],
    }],
  });
  rec("MULTI_PHOTO enrichment + no false link",
    built.validatedVin === GOOD && built.vehicleRef === "veh-crown" ? "PASS" : "FAIL",
    `${built.resolution} ${built.validatedVin} ${built.vehicleRef}`);

  // Conflict
  const conflict = bundle.resolveVinAcrossImages([
    { imageRef: "x", role: "WINDOW_STICKER", ocrText: GOOD, vinCandidates: [GOOD], quality: 90 },
    { imageRef: "y", role: "WINDOW_STICKER", ocrText: GOOD2, vinCandidates: [GOOD2], quality: 90 },
  ]);
  const bothValid = (conflict.distinctValidVins || []).length >= 2
    || conflict.resolution === "UNRESOLVED_CONFLICTING_VINS";
  rec("MULTI_VEHICLE_CONFLICT no fusion",
    bothValid && conflict.validatedVin == null ? "PASS" : "FAIL",
    JSON.stringify({ resolution: conflict.resolution, vin: conflict.validatedVin, distinct: conflict.distinctValidVins }));

  // --- Lot scope ---
  const vehicles = [];
  for (let i = 0; i < 41; i++) {
    vehicles.push({
      id: i === 0 ? "veh-crown" : `u${i}`,
      vin: i === 0 ? GOOD : null,
      year: 2024, make: "Toyota", model: i === 0 ? "Crown Signia" : "Camry",
      trim: i === 0 ? "Limited" : "LE",
      condition: "used",
      presenceStatus: "ONLINE_LISTED",
    });
  }
  const lot = scope.answerLotScopeQuestion({
    question: "How many other used cars are on the lot?",
    physicallyVerifiedVehicleIds: ["veh-crown"],
    vehicles,
    now: NOW,
    condition: "used",
    listingsObservedAt: NOW,
  });
  const lotReply = lot.reply;
  const uLot = scoreUsefulness("How many other used cars are on the lot?", lotReply, {
    GROUNDING: 5, USEFULNESS: 5, CONTEXT_RETENTION: 4, NATURALNESS: 4,
    ACTIONABILITY: 5, PROACTIVITY: 5, HONESTY_ABOUT_UNKNOWN: 5,
  });
  // Adjust if duplicate next step (reply includes nextStep AND lines already pushed nextStep)
  const dupNext = (lotReply.match(/Keep photographing/gi) || []).length > 1;
  if (dupNext) {
    uLot.flags.push("DUPLICATE_SUGGESTION");
    uLot.dims.NATURALNESS = 3;
    uLot.dims.USEFULNESS = 4;
    uLot.mean = Object.values(uLot.dims).reduce((a, b) => a + b, 0) / 7;
  }
  rec("LOT_SCOPE physical unknown + web separate",
    lot.actualLotPopulation?.count == null
      && lot.physicallyVerified?.count === 1
      && lot.currentlyListed?.count === 41
      && /not proof|not the same|aren't the same/i.test(lotReply)
      && /I don't know|don't know/i.test(lotReply)
      ? "PASS" : "FAIL",
    lotReply.slice(0, 280));
  rec("LOT_SCOPE usefulness not repeated-record",
    !uLot.autoFail && !uLot.flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING") ? "PASS" : "FAIL",
    JSON.stringify(uLot.flags));
  rec("LOT_SCOPE no false physical census",
    scope.findUnsupportedPhysicalClaims({ text: lotReply, physicallyVerifiedCount: 1 }).length === 0
      ? "PASS" : "FAIL",
    JSON.stringify(scope.findUnsupportedPhysicalClaims({ text: lotReply, physicallyVerifiedCount: 1 })));
  // Overclaim detector
  const over = scope.findUnsupportedPhysicalClaims({
    text: "There are 41 used vehicles on the lot right now.",
    physicallyVerifiedCount: 1,
  });
  rec("LOT_SCOPE overclaim detector works",
    over.length > 0 ? "PASS" : "FAIL", JSON.stringify(over));

  // Defect: duplicate next action in composed reply (nextStep embedded twice)
  if (dupNext) {
    rec("LOT_SCOPE duplicate next action", "FAIL",
      "reply embeds nextStep twice (lines.push(nextStep) + nextStep field may be re-appended by composer)",
      "nonblocking");
  } else {
    rec("LOT_SCOPE duplicate next action", "PASS", "single Keep photographing");
  }

  // --- Active vehicle context ---
  let focus = conv.setVehicleFocus({
    workspace: "work",
    vehicleRef: "veh-crown",
    vin: GOOD,
    vehicleLabel: "2026 Toyota Crown Signia Limited",
    at: NOW,
  });
  const ref = conv.resolveReferents({
    text: "What about the price on this one?",
    focus,
    now: NOW,
    workspace: "work",
  });
  rec("ACTIVE_VEHICLE_CONTEXT this/price",
    ref?.vehicleRef === "veh-crown" && ref.usedFocus === true ? "PASS" : "FAIL",
    JSON.stringify(ref).slice(0, 300));

  // --- Active customer ---
  focus = conv.setCustomerFocus({
    workspace: "work",
    customerRef: "rel-sarah",
    customerName: "Sarah",
    at: NOW,
    previous: focus,
  });
  const cref = conv.resolveReferents({
    text: "Is this a good match for her?",
    focus,
    now: NOW,
    workspace: "work",
  });
  rec("ACTIVE_CUSTOMER_CONTEXT",
    cref?.customerRef === "rel-sarah" && cref?.vehicleRef === "veh-crown" ? "PASS" : "FAIL",
    JSON.stringify(cref).slice(0, 400));

  // --- Orchestrator goals ---
  const goalCases = [
    ["How many other used cars are on the lot?", "LOT_POPULATION"],
    ["What about the price?", "VEHICLE_DETAIL"],
    ["Who might want this one?", "VEHICLE_BUYER_MATCH"],
    ["What don't we know yet?", "WHAT_IS_UNKNOWN"],
    ["Make a post for this one.", "CONTENT_FOR_VEHICLE"],
    ["What should I do next?", "PLAN_MY_DAY"],
    ["What do you think I should focus on next?", "PLAN_MY_DAY"],
    // Natural Owner phrasing that currently fails pattern coverage (documented defect):
    ["What should I focus on next?", "PLAN_MY_DAY"],
    ["What was THE REAL PLAY?", "OWNER_HISTORY"],
    ["Can you find out instead of guessing?", "VERIFY_INSTEAD_OF_GUESS"],
    ["Is this actually a good match for Sarah?", "CUSTOMER_FIT"],
  ];
  for (const [q, expect] of goalCases) {
    const g = orch.understandGoal(q);
    // PLAN_MY_DAY / prioritization phrasing may be UNCLEAR at this checkpoint — record honestly
    const ok = g.goal === expect;
    rec(`ORCHESTRATOR goal:${expect}`,
      ok ? "PASS" : "FAIL",
      JSON.stringify({ q, got: g.goal, conf: g.confidence, amb: g.ambiguous, alt: g.alternatives }));
  }

  // Ambiguity: vague referent without focus
  const amb = orch.understandGoal("What about this?");
  rec("ORCHESTRATOR unclear/ambiguous handling",
    gAmbiguousOk(amb) ? "PASS" : "FAIL",
    JSON.stringify(amb));

  // Tool plans for multi-source
  const planFit = orch.planTools("CUSTOMER_FIT", {
    workspace: "work",
    conversationId: "c1",
    activeVehicleRef: "veh-crown",
    activeCustomerRef: "rel-sarah",
    physicallyVerifiedVehicleIds: ["veh-crown"],
    hasAttachments: false,
    now: NOW,
    webResearchAllowed: false,
  });
  rec("TOOL_PLANNING customer fit multi-source",
    planFit?.required?.length >= 3
      && planFit.required.includes("customer_vehicle_match")
      ? "PASS" : "FAIL",
    JSON.stringify(planFit).slice(0, 400));

  const planLot = orch.planTools("LOT_POPULATION", {
    workspace: "work",
    conversationId: "c1",
    activeVehicleRef: "veh-crown",
    activeCustomerRef: null,
    physicallyVerifiedVehicleIds: ["veh-crown"],
    hasAttachments: true,
    now: NOW,
    webResearchAllowed: false,
  });
  rec("TOOL_PLANNING lot needs physical+website",
    planLot?.required?.includes("lot_walk_observations")
      && planLot?.required?.includes("website_inventory")
      ? "PASS" : "FAIL",
    JSON.stringify(planLot));

  // Model routing without models
  const emptyPacket = orch.buildEvidencePacket({
    goal: "PRIORITIZE_VEHICLES",
    items: [
      { tool: "vehicle_inventory", claim: "a", evidenceClass: "CURRENT_WEBSITE_FACT" },
      { tool: "vehicle_inventory", claim: "b", evidenceClass: "CURRENT_WEBSITE_FACT" },
      { tool: "vehicle_inventory", claim: "c", evidenceClass: "CURRENT_WEBSITE_FACT" },
      { tool: "vehicle_inventory", claim: "d", evidenceClass: "CURRENT_WEBSITE_FACT" },
    ],
  });
  const tier = orch.routeReasoningTier({
    goal: "PRIORITIZE_VEHICLES",
    packet: emptyPacket,
    ambiguous: false,
    availableTextModels: [],
  });
  rec("MODEL_ROUTING degrades without models",
    tier?.tier === "DETERMINISTIC" && tier?.degradedFrom === "REASONING_LOCAL"
      ? "PASS" : "FAIL",
    JSON.stringify(tier));

  // Compose orchestrated lot reply — body is domain lot reply; proactive must not double
  let orchReply = null;
  try {
    const reading = orch.understandGoal("How many other used cars are on the lot?");
    const proactive = orch.chooseProactiveHelp({
      goal: "LOT_POPULATION",
      packet: emptyPacket,
      strongMatchCount: 0,
      vinResolved: true,
      missingPhotoHint: null,
      unverifiedCustomerIssue: null,
    });
    // Prefer lot-specific proactive via nextStep in body only
    orchReply = orch.composeOrchestratedReply({
      reading,
      plan: planLot,
      packet: emptyPacket,
      tier: { tier: "DETERMINISTIC", reason: "test", degradedFrom: null },
      proactive: { offer: lot.nextStep, reason: "count grows with walk" },
      body: lot.reply,
    });
    const style = orch.reviewComposedReply(orchReply.reply);
    rec("ORCHESTRATOR compose lot reply",
      orchReply.reply && style.ok !== false ? "PASS" : "FAIL",
      orchReply.reply.slice(0, 400));
    // Duplicate advice detection
    const photoMentions = (orchReply.reply.match(/photograph/gi) || []).length;
    rec("ORCHESTRATOR no duplicate photograph advice",
      photoMentions <= 2 ? "PASS" : "FAIL",
      `photograph mentions=${photoMentions}; alreadyAdvised=${orch.alreadyAdvised(lot.reply, lot.nextStep)}`);
  } catch (e) {
    rec("ORCHESTRATOR compose lot reply", "FAIL", String(e.message || e));
  }

  // --- Caleb / Owner knowledge with synthetic facts (not private seed) ---
  // Synthetic fixtures that mirror structure without leaking real private content.
  // Synthetic structure only — not private seed contents. Distractor must NOT contain query tokens "play".
  const facts = [
    {
      id: "f-real-play",
      title: "THE REAL PLAY",
      content: "Synthetic: a specific trading approach agreed with collaborator — test fixture only.",
      enabled: true,
      confidence: 90,
      provenance: { sourceRef: "test:seed" },
      workspace: "personal",
    },
    {
      id: "f-xo",
      title: "XO role decision",
      content: "Synthetic: XO meant a defined operating role in the partnership — test fixture only.",
      enabled: true,
      confidence: 88,
      provenance: { sourceRef: "test:seed" },
      workspace: "personal",
    },
    {
      id: "f-trading",
      title: "Trading system built with collaborator",
      content: "Caleb and I built tools and rules for a trading system together — test fixture only.",
      enabled: true,
      confidence: 85,
      provenance: { sourceRef: "test:seed" },
      workspace: "personal",
    },
    {
      id: "f-distractor-real-estate",
      title: "Project portfolio: Real-estate platforms and marketplaces",
      content: "Synthetic distractor about property marketplaces and platforms only.",
      enabled: true,
      confidence: 70,
      provenance: { sourceRef: "test:distractor" },
      workspace: "personal",
    },
    {
      id: "f-aion-design",
      title: "Why AION is designed this way",
      content: "Synthetic: local-first, Owner authority, no silent external write — test fixture only.",
      enabled: true,
      confidence: 92,
      provenance: { sourceRef: "test:seed" },
      workspace: "personal",
    },
  ];

  const realPlay = mem.retrieveOwnerMemory({
    question: "What was THE REAL PLAY?",
    facts,
    workspace: "personal",
  });
  const realPlayIds = realPlay.facts.map((f) => f.factId);
  rec("THE_REAL_PLAY retrieval not distractor",
    realPlayIds.includes("f-real-play") && !realPlayIds.includes("f-distractor-real-estate")
      ? "PASS" : "FAIL",
    JSON.stringify(realPlayIds));

  const xo = mem.retrieveOwnerMemory({
    question: "What did we decide about the XO role?",
    facts,
    workspace: "personal",
  });
  rec("XO_RETRIEVAL short token",
    xo.facts.some((f) => f.factId === "f-xo") ? "PASS" : "FAIL",
    JSON.stringify(xo.facts.map((f) => f.factId)));

  const trading = mem.retrieveOwnerMemory({
    question: "What did Caleb and I build around trading?",
    facts,
    workspace: "personal",
  });
  rec("CALEB trading retrieval",
    trading.facts.some((f) => /trading/i.test(f.title + f.content)) ? "PASS" : "FAIL",
    JSON.stringify(trading.facts.map((f) => f.factId)));

  const unsupported = mem.retrieveOwnerMemory({
    question: "What color was the third cat on Mars?",
    facts,
    workspace: "personal",
  });
  const unAns = mem.answerFromOwnerMemory(unsupported);
  rec("CALEB unsupported admits insufficiency",
    /don't have|not on file|I don't have/i.test(unAns) && unsupported.facts.length === 0
      ? "PASS" : "FAIL",
    unAns.slice(0, 200));

  const design = mem.retrieveOwnerMemory({
    question: "Why did we design AION this way?",
    facts,
    workspace: "personal",
  });
  rec("CALEB AION design retrieval",
    design.facts.some((f) => f.factId === "f-aion-design") ? "PASS" : "FAIL",
    JSON.stringify(design.facts.map((f) => f.factId)));

  // Historical vs current: memory answer should not claim live lot authority
  const histAns = mem.answerFromOwnerMemory(realPlay);
  rec("HISTORICAL_CURRENT_BOUNDARY memory not live authority",
    !/on the lot right now|currently listed|website price/i.test(histAns)
      ? "PASS" : "FAIL",
    histAns.slice(0, 200));

  // Personality review on lot reply
  const style = conv.reviewReplyStyle
    ? conv.reviewReplyStyle(lotReply)
    : orch.reviewComposedReply(lotReply);
  const styleOk = style?.ok !== false && !style?.failed;
  rec("PERSONALITY style review on lot reply",
    styleOk ? "PASS" : "FAIL",
    JSON.stringify(style).slice(0, 300));

  // Proactive help — domain nextStepOrNothing + orchestrator alreadyAdvised
  const next = conv.nextStepOrNothing([
    "Keep photographing as you walk.",
    "Keep photographing as you walk.",
  ]);
  rec("PROACTIVE_HELP dedupe next step",
    next && String(next).toLowerCase().split("photograph").length - 1 <= 1 ? "PASS" : "FAIL",
    String(next));
  // Strong paraphrase (should detect) vs weak (should not force)
  const strongDup = orch.alreadyAdvised(
    "Keep photographing as you walk and I'll build today's real count as you go.",
    "Keep photographing as you walk and I'll build today's real count.",
  );
  const weakDup = orch.alreadyAdvised(
    "I've verified 1 vehicle today.",
    "Open the inventory page on the desktop.",
  );
  rec("PROACTIVE_HELP alreadyAdvised detects near-duplicate",
    strongDup === true && weakDup === false ? "PASS" : "FAIL",
    JSON.stringify({ strongDup, weakDup }));

  // Aggregate usefulness scores from lot reply (primary conversational sample)
  const scores = uLot.dims;
  const mean = uLot.mean;

  const summary = {
    claudeHeadTested: EXPECTED,
    worktreeHead: sha.head,
    targeted: true,
    fullAcceptance: "NOT_YET",
    results,
    defects,
    usefulnessSample: {
      question: "How many other used cars are on the lot?",
      replyPreview: lotReply.slice(0, 400),
      scores,
      mean,
      flags: uLot.flags,
    },
    modelAbsenceImpact: {
      observedTier: tier,
      note: "No FAST/REASONING local models installed; routing should stay DETERMINISTIC. "
        + "Goal scoring and lot composition work without LLMs. Questions needing synthesis, "
        + "nuanced prioritization, or open-ended comparison remain shallow until models exist.",
    },
    counts: {
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      blocked: results.filter((r) => r.status === "BLOCKED").length,
    },
  };

  const outDir = join(process.cwd(), "scripts", "acceptance", "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `targeted-05ce03e-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.error("Wrote", outPath);
  process.exit(summary.counts.fail > 0 ? 1 : 0);
}

function gAmbiguousOk(amb) {
  return amb.goal === "UNCLEAR" || amb.ambiguous === true || amb.confidence < 0.9;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
