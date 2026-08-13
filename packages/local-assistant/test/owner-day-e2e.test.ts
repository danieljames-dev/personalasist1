/**
 * One Owner day, driven through the real Chat entry point from end to end.
 *
 * Everything here goes through `assistantPrompt` and `answerAboutVehiclePhotoBundle` — the two
 * methods the server actually calls. The point is not to exercise the domain functions again; it is
 * to prove that a sequence of ordinary sentences, in the order the Owner would say them while
 * walking a lot, produces useful answers without him ever typing a VIN or a command.
 *
 * The retrieval assertions are the ones worth reading twice. They pin two failures that were live
 * until this suite existed: a question the archive does not cover was answered confidently from an
 * unrelated entry, and "XO" was discarded by the tokenizer as too short, so a question about the XO
 * role matched on the word "role" and returned a note about a dispatcher job.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryStateRepositoryV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, StaticCapabilityRegistryV1, LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";
import { reviewComposedReply } from "../src/conversation-orchestrator.js";
import { retrieveOwnerMemory, MIN_MATCHED_TERMS } from "../src/owner-archive-memory.js";
import { findUnsupportedPhysicalClaims } from "../src/lot-scope-reasoning.js";

const FLEET = [
  "JTDACAAJ8T3051788", "JTDACAAU4V3084476", "JTDBAMDE0T3000001",
  "5TFAX5GN1N3000002", "JTMWWRFV5N3000004",
];
/** Used condition and a check-digit-valid VIN — the only fixture unit that is both. */
const WALKED_VIN = "JTDACAAJ8T3051788";
const BAD_OCR = "STDAAABS1RS004150";

const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
  + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/E"
  + "ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const ARCHIVE = [
  {
    content: "XO role definition (2026-05-20): Dan promoted the AI partner from crew to XO. Captain in "
      + "everything but name; tells him when he is wrong; must push back when data contradicts, and "
      + "execute when ordered after debate.",
    source_type: "agent", source_locator: "session", tags: ["xo", "caleb", "decisions"], confidence: 0.95,
  },
  {
    content: "Professional trading systems: built mechanical futures stacks with Caleb, with "
      + "walk-forward validation and prop-firm compliance.",
    source_type: "git", source_locator: "repo", tags: ["trading", "risk"], confidence: 0.9,
  },
  {
    content: "AION design decisions: start lean, memory-first before more agents, deterministic "
      + "grounded synthesis until a model adapter exists.",
    source_type: "agent", source_locator: "session", tags: ["aion", "architecture"], confidence: 0.9,
  },
];

async function makeService() {
  const root = await mkdtemp(join(tmpdir(), "aion-day-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  await service.updateSettings({ activeWorkspace: "work" });
  await service.refreshDealershipInventory({
    dealershipName: "Lakeland Toyota", useFixture: true, fixtureVins: FLEET,
  });
  await service.ingestOwnerSeedFacts(ARCHIVE);
  return service;
}

const CONV = "conv-owner-day";

test("a whole Owner day runs through Chat without a single VIN typed by hand", async () => {
  const service = await makeService();
  const said: string[] = [];
  const ask = async (text: string) => {
    const answer = await service.assistantPrompt(text, { conversationId: CONV });
    said.push(answer.reply);
    // Nothing on any turn may leak internal vocabulary onto the Owner's phone.
    const style = reviewComposedReply(answer.reply);
    assert.ok(style.ok, `"${text}" → ${style.problems.join("; ")}\n${answer.reply}`);
    return answer;
  };

  // 2 — open the day.
  const day = await ask("My sales day.");
  assert.ok(day.reply.length > 0);

  // 3-7 — three photos of one car: a bad read, then the VIN, then the sticker.
  const bundle = await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [
      { contentBase64: TINY_JPEG_B64, mimeType: "image/jpeg", filename: "a.jpg", documentRef: "doc-a" },
      { contentBase64: TINY_JPEG_B64, mimeType: "image/jpeg", filename: "b.jpg", documentRef: "doc-b" },
      { contentBase64: TINY_JPEG_B64, mimeType: "image/jpeg", filename: "c.jpg", documentRef: "doc-c" },
    ],
    conversationId: CONV,
    offline: true,
    extractedTexts: [
      `VIN ${BAD_OCR} glare across the plate`,
      `VEHICLE IDENTIFICATION NUMBER ${WALKED_VIN}`,
      "TOTAL SUGGESTED RETAIL PRICE $34,120 CAMRY XLE",
    ],
  });
  const bundleData = bundle.data as { bundle: { resolution: string; validatedVin: string | null } };
  assert.equal(bundleData.bundle.resolution, "RESOLVED", bundle.reply);
  assert.equal(bundleData.bundle.validatedVin, WALKED_VIN, "the valid VIN must win over the bad read");
  assert.ok(!bundle.reply.includes(BAD_OCR), "an invalid read is never presented as an identity");

  // 9-11 — follow-ups that rely entirely on the vehicle staying in focus.
  const buyers = await ask("Who might want this one?");
  assert.ok(!/which vehicle do you mean/i.test(buyers.reply), "the car must stay in focus");

  const price = await ask("What about the price?");
  assert.ok(!/which vehicle do you mean/i.test(price.reply));

  const unknowns = await ask("What don't we know about this one?");
  assert.ok(!/which vehicle do you mean/i.test(unknowns.reply));

  // 12-13 — the question that started all of this.
  const population = await ask("How many other used cars are on the lot?");
  const popData = population.data as Record<string, unknown>;
  assert.equal(popData.goal, "LOT_POPULATION");
  assert.ok(/don't know|do not know/i.test(population.reply), population.reply);
  assert.match(population.reply, /website|dealer (?:feed|site)/i);
  assert.deepEqual(
    findUnsupportedPhysicalClaims({
      text: population.reply,
      physicallyVerifiedCount: Number(popData.physicallyVerifiedCount ?? 0),
    }),
    [],
    "no sentence may claim more cars physically present than were photographed",
  );

  // 14-15 — a recommendation for what to do next.
  const next = await ask("What should I do next?");
  assert.ok(next.reply.length > 0);

  // 16 — content, which must remain a draft and publish nothing.
  const post = await ask("Make a Facebook post for this one.");
  assert.ok(!/published|posted to facebook/i.test(post.reply), "nothing may be published");

  // 17 — the Owner's own history.
  const history = await ask("What did Caleb and I decide about the XO role?");
  assert.match(history.reply, /XO/, "the recorded XO decision must surface");
  assert.match(history.reply, /not the whole archive/i, "coverage must be stated honestly");

  // Every turn produced something, and no turn repeated the previous one verbatim.
  assert.equal(said.length, 8);
  for (let i = 1; i < said.length; i += 1) {
    assert.notEqual(said[i], said[i - 1], "a turn must not repeat the previous answer");
  }
});

test("a question the archive does not cover is answered as a gap, not from a near-miss", async () => {
  const service = await makeService();
  // "THE REAL PLAY" appears in none of the ingested facts. Matching the single common word "real"
  // against a title once cleared the threshold and produced a confident, unrelated answer.
  const answer = await service.assistantPrompt("What was THE REAL PLAY?", { conversationId: CONV });
  assert.match(answer.reply, /don't have anything on file|none of them cover that/i, answer.reply);
  assert.match(answer.reply, /gap in what I hold, not proof it never happened/i);
  assert.equal(answer.sources.length, 0, "an uncovered question must cite nothing");
});

test("retrieval needs breadth, not one common word landing on a title", () => {
  const facts = [
    {
      id: "f1", category: "project" as const, title: "Project portfolio: Real-estate platforms",
      content: "Real-estate platforms, property scraper, agency landing page.",
      confidence: 90, enabled: true,
      provenance: { sourceType: "import" as const, sourceRef: "owner-archive:git seed-x", recordedAt: "2026-01-01T00:00:00.000Z" },
      corrections: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const packet = retrieveOwnerMemory({ question: "What was THE REAL PLAY?", facts, workspace: "work" });
  assert.equal(packet.facts.length, 0, "one shared word is not a topic");
  assert.ok(MIN_MATCHED_TERMS >= 2);
});

test("short proper nouns survive tokenising, so XO is not discarded", () => {
  const facts = [
    {
      id: "f-xo", category: "role" as const, title: "XO role definition",
      content: "The XO pushes back when data contradicts, and executes when ordered after debate.",
      confidence: 95, enabled: true,
      provenance: { sourceType: "import" as const, sourceRef: "owner-archive:agent seed-y", recordedAt: "2026-01-01T00:00:00.000Z" },
      corrections: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "f-job", category: "goal" as const, title: "Land a remote dispatcher role by December",
      content: "Target a remote dispatcher role.",
      confidence: 80, enabled: true,
      provenance: { sourceType: "owner" as const, sourceRef: "owner.knowledge", recordedAt: "2026-01-01T00:00:00.000Z" },
      corrections: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const packet = retrieveOwnerMemory({ question: "What did we decide about the XO role?", facts, workspace: "work" });
  assert.ok(packet.facts.length >= 1, "the XO entry must be found");
  assert.equal(packet.facts[0]!.factId, "f-xo", "and it must outrank a note matching only on 'role'");
  assert.ok(
    !packet.facts.some((f) => f.factId === "f-job"),
    "an unrelated goal matching one generic word must not be retrieved at all",
  );
});
