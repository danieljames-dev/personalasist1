/**
 * Staged public inventory expansion for Lakeland Toyota.
 * Uses worktree-built local-assistant against production private/aion state.
 * Courtesy pacing; scoped new then used; never invents vehicles.
 *
 * Usage:
 *   node scripts/inventory-expand.mjs measure
 *   node scripts/inventory-expand.mjs expand-new
 *   node scripts/inventory-expand.mjs expand-used
 *   node scripts/inventory-expand.mjs enrich
 *   node scripts/inventory-expand.mjs report
 */
import {
  AionAssistantV1,
  DeterministicModelProviderV1,
  FileStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
  findNextPageUrl,
  parseDealerReportedTotal,
  parsePublicInventoryHtml,
} from "../packages/local-assistant/dist/index.js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const DATA_ROOT = "C:\\AION-HQ\\private\\aion";
const EXPORT_ROOT = "C:\\AION-HQ\\private\\aion\\exports";
const OUT_DIR = "C:\\AION-HQ-grok-inventory-expansion\\.aion-local\\inventory-expansion";
const NEW_URL = "https://www.lakelandtoyota.com/searchnew.aspx";
const USED_URL = "https://www.lakelandtoyota.com/searchused.aspx";

class SystemClock {
  now() {
    return new Date().toISOString();
  }
}

/** Production-safe IDs — never reuse DeterministicIdGenerator against live state. */
class RandomIdGenerator {
  next(kind) {
    const hex = randomBytes(16).toString("hex");
    return `${String(kind).slice(0, 12)}-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 28)}`;
  }
}

async function makeService() {
  await mkdir(EXPORT_ROOT, { recursive: true });
  return new AionAssistantV1({
    repository: new FileStateRepositoryV1(DATA_ROOT),
    clock: new SystemClock(),
    ids: new RandomIdGenerator(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(EXPORT_ROOT),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

function countVehicles(vehicles) {
  const live = vehicles.filter((v) =>
    v.presenceStatus === "ONLINE_LISTED" ||
    v.presenceStatus === "PHYSICALLY_VERIFIED" ||
    v.presenceStatus === "NOT_VERIFIED",
  );
  return {
    total: live.length,
    new: live.filter((v) => v.condition === "new").length,
    used: live.filter((v) => v.condition === "used" || v.condition === "cpo").length,
    noLonger: vehicles.filter((v) => v.presenceStatus === "NO_LONGER_FOUND_ONLINE").length,
    all: vehicles.length,
  };
}

async function measureFeed(start, label, maxPages) {
  let url = start;
  const visited = new Set();
  let pages = 0;
  const vins = new Set();
  let reported = null;
  let missingPrice = 0;
  let missingTrim = 0;
  let unknownCondition = 0;
  let invalidVins = 0;
  const t0 = Date.now();
  while (url && pages < maxPages) {
    if (visited.has(url)) break;
    visited.add(url);
    const res = await fetch(url, {
      headers: {
        accept: "text/html",
        "user-agent": "AION-InventoryResearch/1.0 (owner-authorized public inventory; no login)",
      },
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    if (!res.ok) break;
    const text = await res.text();
    const landed = res.url || url;
    pages += 1;
    if (reported == null) reported = parseDealerReportedTotal(text);
    const cond = /used/i.test(landed) ? "used" : "new";
    const listings = parsePublicInventoryHtml(
      text,
      landed,
      new Date().toISOString(),
      (k) => `${k}-${Math.random().toString(16).slice(2)}`,
      cond,
    );
    let added = 0;
    for (const l of listings) {
      if (l.vin && !vins.has(l.vin)) {
        vins.add(l.vin);
        added += 1;
      }
      if (l.vin && l.vin.length === 17) {
        /* structure check is cheap via length; full validate later */
      } else if (l.vin) invalidVins += 1;
      if (l.advertisedPrice == null && l.msrp == null && l.dealerPrice == null) missingPrice += 1;
      if (!l.trim) missingTrim += 1;
      if (!l.condition || l.condition === "unknown") unknownCondition += 1;
    }
    process.stdout.write(
      `${label} page=${pages} unique=${vins.size} added=${added} reported=${reported ?? "—"} next=${!!findNextPageUrl(text, landed)}\n`,
    );
    if (added === 0) break;
    const next = findNextPageUrl(text, landed);
    if (!next || visited.has(next)) break;
    url = next;
    await new Promise((r) => setTimeout(r, 900));
  }
  return {
    label,
    pages,
    uniqueVins: vins.size,
    dealerReported: reported,
    missingPrice,
    missingTrim,
    unknownCondition,
    invalidVins,
    ms: Date.now() - t0,
  };
}

async function cmdMeasure() {
  await mkdir(OUT_DIR, { recursive: true });
  const service = await makeService();
  const before = countVehicles((await service.snapshot()).vehicleInventory?.vehicles ?? []);
  const stateBytes = (await stat(join(DATA_ROOT, "state-v1.json"))).size;
  const newM = await measureFeed(NEW_URL, "NEW", 50);
  const usedM = await measureFeed(USED_URL, "USED", 120);
  const report = {
    at: new Date().toISOString(),
    aionBefore: before,
    stateBytesBefore: stateBytes,
    dealerNew: newM,
    dealerUsed: usedM,
    dealerTotalUniqueHint: newM.uniqueVins + usedM.uniqueVins,
    coverageVsCrawl:
      before.total && newM.uniqueVins + usedM.uniqueVins
        ? Number(((before.total / (newM.uniqueVins + usedM.uniqueVins)) * 100).toFixed(1))
        : null,
  };
  await writeFile(join(OUT_DIR, "measure.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function cmdExpand(scope, maxPages) {
  await mkdir(OUT_DIR, { recursive: true });
  const service = await makeService();
  const before = countVehicles((await service.snapshot()).vehicleInventory?.vehicles ?? []);
  const t0 = Date.now();
  const result = await service.refreshDealershipInventory({
    scope,
    maxPagesPerUrl: maxPages,
    pageDelayMs: 1100,
  });
  const after = countVehicles((await service.snapshot()).vehicleInventory?.vehicles ?? []);
  const out = {
    at: new Date().toISOString(),
    scope,
    maxPages,
    durationMs: Date.now() - t0,
    before,
    after,
    pagesFetched: result.pagesFetched,
    listings: result.listings?.length,
    uniqueVins: result.uniqueVins,
    dealerReportedTotal: result.dealerReportedTotal,
    mode: result.mode,
    message: result.message,
    temporal: result.temporal,
    quality: result.quality,
  };
  await writeFile(join(OUT_DIR, `expand-${scope}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

async function cmdEnrich() {
  const service = await makeService();
  const t0 = Date.now();
  // Bounded batches — many new VINs; don't hammer NHTSA.
  const vin = await service.enrichLiveVinFacts({ limit: 80, delayMs: 280 });
  const recall = await service.enrichRecallAssessments({ limit: 80, delayMs: 200 });
  const snap = await service.snapshot();
  const vs = snap.vehicleInventory?.vehicles ?? [];
  const withVin = vs.filter((v) => v.vin).length;
  const decoded = vs.filter((v) => v.govVinFacts?.status === "DECODED").length;
  const recallDone = vs.filter((v) => v.recallAssessment && v.recallAssessment.status !== "NOT_CHECKED").length;
  const out = {
    at: new Date().toISOString(),
    durationMs: Date.now() - t0,
    vin,
    recall,
    coverage: {
      withVin,
      govDecoded: decoded,
      govPct: withVin ? Number(((decoded / withVin) * 100).toFixed(1)) : 0,
      recallDone,
      recallPct: vs.length ? Number(((recallDone / vs.length) * 100).toFixed(1)) : 0,
    },
  };
  await writeFile(join(OUT_DIR, "enrich.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

async function cmdReport() {
  const service = await makeService();
  const t0 = Date.now();
  const cov = await service.inventoryCoverageReport();
  const q1 = await service.assistantPrompt("How many new vehicles do we have?");
  const q2 = await service.assistantPrompt("Show me Camrys under 30k");
  const q3 = await service.assistantPrompt("What disappeared from the site?");
  const q4 = await service.assistantPrompt("What changed price?");
  const q5 = await service.assistantPrompt("What arrived recently?");
  const stateBytes = (await stat(join(DATA_ROOT, "state-v1.json"))).size;
  const after = countVehicles((await service.snapshot()).vehicleInventory?.vehicles ?? []);
  const out = {
    at: new Date().toISOString(),
    aion: after,
    coverage: cov,
    stateBytes,
    queryLatencyMs: Date.now() - t0,
    samples: {
      howManyNew: q1.reply.slice(0, 200),
      camrys: q2.reply.slice(0, 300),
      disappeared: q3.reply.slice(0, 250),
      priceChanged: q4.reply.slice(0, 250),
      arrived: q5.reply.slice(0, 250),
    },
  };
  await writeFile(join(OUT_DIR, "report.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

const cmd = process.argv[2] || "measure";
if (cmd === "measure") await cmdMeasure();
else if (cmd === "expand-new") await cmdExpand("new", Number(process.argv[3] || 45));
else if (cmd === "expand-used") await cmdExpand("used", Number(process.argv[3] || 160));
else if (cmd === "enrich") await cmdEnrich();
else if (cmd === "report") await cmdReport();
else {
  console.error("Unknown command", cmd);
  process.exit(1);
}
