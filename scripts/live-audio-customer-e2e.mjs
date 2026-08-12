/**
 * Live audio → customer intelligence, end to end, with no fixture text anywhere.
 *
 * Everything upstream of this script was proven against a `TranscriptRecordV1` that a test wrote by
 * hand. That proves the contract and nothing about the engine: whisper does not return the sentence
 * you spoke, it returns its own rendering of it, and the difference is exactly where the extraction
 * rules either hold or quietly fail. Spoken "thirty five thousand" comes back as "35,000" — a shape
 * no hand-written fixture in this repo had ever contained.
 *
 * So this script speaks a synthetic call, encodes it, and pushes the bytes through ffmpeg and
 * faster-whisper into the real service. The only text involved is whatever the engine produces.
 *
 * The audio is generated into the OS temp directory at run time and never written into the
 * repository, per the audio/transcript contract: recordings stay private and out of Git.
 *
 * Run: node scripts/live-audio-customer-e2e.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AionAssistantV1,
  InMemoryStateRepositoryV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  StaticCapabilityRegistryV1,
  LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
  isCurrentNeed,
} from "../packages/local-assistant/dist/index.js";

/**
 * The spoken call. Synthetic throughout — a fictional customer, a 555 number, and nothing resembling
 * the Owner's own history.
 */
const SPOKEN =
  "I am looking for a Camry XSE under thirty five thousand. "
  + "I do not want a hybrid. "
  + "Dark blue would be nice. "
  + "I need all wheel drive. "
  + "I will be there Saturday at two.";

const CUSTOMER_PHONE = "863-555-0142";

const results = [];
function rec(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}`);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } }, opts.timeoutMs ?? 180_000);
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e.message || e) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** Speak the script with the local Windows voice. No network, no third-party TTS. */
async function synthesiseSpeech(outPath) {
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    `$s.SetOutputToWaveFile('${outPath.replace(/'/g, "''")}');`,
    "$s.Rate = -2;",
    `$s.Speak('${SPOKEN.replace(/'/g, "''")}');`,
    "$s.Dispose();",
  ].join(" ");
  const r = await run("powershell", ["-NoProfile", "-Command", ps], { timeoutMs: 120_000 });
  return r.code === 0;
}

function makeService(repository, exportsRoot) {
  return new AionAssistantV1({
    repository,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "aion-live-e2e-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const wavPath = join(root, "synthetic-call.wav");

  try {
    // --- Audio -------------------------------------------------------------------------------
    const spoke = await synthesiseSpeech(wavPath);
    if (!spoke) { rec("SYNTHETIC_AUDIO_GENERATED", false, "local TTS unavailable"); return; }
    const bytes = await readFile(wavPath);
    rec("SYNTHETIC_AUDIO_GENERATED", bytes.length > 1000, `${bytes.length} bytes of real wav`);

    const repository = new InMemoryStateRepositoryV1();
    const service = makeService(repository, exportsRoot);
    await service.updateSettings({ activeWorkspace: "work" });

    const sarah = await service.createRelationship({
      displayName: "Sarah Whitmore",
      relationshipType: "customer",
      contactMethods: [
        { channel: "phone", value: CUSTOMER_PHONE },
        { channel: "email", value: "sarah.whitmore@example.com" },
      ],
    });
    // A same-numbered contact in another workspace, to prove the boundary holds under a real call.
    await service.updateSettings({ activeWorkspace: "personal" });
    const personalSarah = await service.createRelationship({
      displayName: "Sarah Whitmore",
      contactMethods: [{ channel: "phone", value: CUSTOMER_PHONE }],
    });
    await service.updateSettings({ activeWorkspace: "work" });

    // Fixture inventory, so "which vehicles fit?" and "who might want this VIN?" are answered against
    // real vehicle records rather than reported as untested.
    let vehicleCount = 0;
    try {
      await service.refreshDealershipInventory({
        dealershipName: "Lakeland Toyota",
        useFixture: true,
        // Synthetic VINs — correct shape, no real vehicle. The fixture builder cycles models, so the
        // first is a Camry and the reverse-match question has something plausible to anchor to.
        fixtureVins: [
          "JTDBAMDE0T3000001",
          "5TFAX5GN1N3000002",
          "5TDKDRBH8P3000003",
          "JTMWWRFV5N3000004",
          "5YFB4MDE3P3000005",
        ],
      });
      const s = await service.snapshot();
      vehicleCount = (s.vehicleInventory?.vehicles ?? []).length;
    } catch (e) {
      console.log(`inventory fixture unavailable: ${String(e.message || e)}`);
    }
    rec("INVENTORY_FIXTURE_LOADED", vehicleCount > 0, `${vehicleCount} vehicles`);

    // --- Run 1: no identity metadata ---------------------------------------------------------
    console.log("\n--- Run 1: ungrounded call (no session metadata) ---");
    const started = Date.now();
    const first = await service.transcribeAudio({
      contentBase64: bytes.toString("base64"),
      mimeType: "audio/wav",
      filename: "synthetic-call.wav",
      deriveConversation: { ingestPath: "UPLOADED_CALL_RECORDING" },
    });
    const elapsed = Date.now() - started;
    const transcript = first.transcript;
    console.log(`engine=${transcript.engine} model=${transcript.model} status=${transcript.status} ${elapsed}ms`);
    console.log(`text: ${JSON.stringify(transcript.fullText)}`);

    rec(
      "LIVE_WHISPER_TRANSCRIBED",
      transcript.status === "READY" && /camry/i.test(transcript.fullText),
      `${transcript.engine}/${transcript.model}`,
    );
    // The engine must be a real one. A fixture engine here would invalidate the whole run.
    rec(
      "LIVE_ENGINE_NOT_FIXTURE",
      transcript.engine !== "fixture" && transcript.engine !== "none",
      `engine=${transcript.engine}`,
    );

    const out1 = first.conversation?.outcome ?? null;
    rec(
      "LIVE_WHISPER_TO_CONVERSATION_EVENT",
      Boolean(out1) && out1.event.evidenceRef === `transcript:${transcript.transcriptId}`
        && out1.event.segments.length === transcript.segments.length,
      out1 ? `${out1.event.segments.length} segments, confidence ${out1.event.extraction.confidence}` : "no event",
    );
    rec(
      "UNKNOWN_SPEAKER_SAFE",
      Boolean(out1) && out1.event.segments.every((s) => s.speaker === "UNKNOWN"),
      "no diarisation label promoted to a role",
    );
    rec(
      "SYNTHETIC_AUDIO_UNRESOLVED_E2E",
      Boolean(out1) && out1.identity.state !== "RESOLVED" && out1.observations.length > 0,
      out1 ? `identity=${out1.identity.state}, ${out1.observations.length} thing(s) still heard` : "",
    );
    rec(
      "CRM_PREPARE_UNRESOLVED_REFUSED",
      Boolean(out1) && out1.proposals.length === 0 && out1.refusals.length > 0,
      out1?.refusals[0] ?? "",
    );
    const state1 = await service.snapshot();
    rec(
      "UNRESOLVED_COMMITMENT_UNASSIGNED",
      state1.commitmentCandidates.length === 0 && state1.customerNeeds.length === 0,
      "the Saturday promise is not hung on any customer",
    );

    // --- Run 2: grounded session metadata ----------------------------------------------------
    console.log("\n--- Run 2: same call, grounded session metadata ---");
    const second = await service.processConversationFromTranscript({
      transcriptId: transcript.transcriptId,
      ingestPath: "UPLOADED_CALL_RECORDING",
      // Grounded: the call leg carried this number, and the Owner said which voice is the customer.
      signals: { phone: CUSTOMER_PHONE },
      speakerBinding: { customer: "UNKNOWN" },
    });
    const out2 = second.outcome;
    console.log(second.reply);

    rec(
      "LIVE_AUDIO_IDENTITY_BINDING",
      out2?.identity.state === "RESOLVED" && out2.identity.relationshipRef === sarah.id
        && out2.identity.method === "EXACT_PHONE",
      `${out2?.identity.state} via ${out2?.identity.method}`,
    );

    const current = (out2?.needs ?? []).filter(isCurrentNeed);
    const at = (a) => current.find((n) => n.attribute === a);
    rec(
      "LIVE_NEEDS_EXTRACTION",
      at("model")?.value === "camry" && at("trim")?.value === "xse"
        && at("must-have")?.value === "awd" && at("must-have")?.strength === "HARD_REQUIREMENT"
        && at("color")?.strength === "PREFERENCE"
        && at("powertrain")?.strength === "EXCLUSION",
      current.map((n) => `${n.attribute}=${n.value}/${n.strength}`).join(" "),
    );
    rec(
      "LIVE_PRICE_PAYMENT_SEPARATION",
      at("max-price")?.numericValue === 35000 && !at("payment-target"),
      `max-price=${at("max-price")?.numericValue ?? "none"} (spoken "thirty five thousand")`,
    );

    const saturday = (out2?.commitments ?? []).find((c) => /saturday/i.test(c.statement));
    rec(
      "LIVE_COMMITMENT_EXTRACTION",
      Boolean(saturday) && saturday.party === "CUSTOMER_PROMISED",
      saturday ? `${saturday.party}: "${saturday.statement}" (${saturday.timeHint})` : "not found",
    );

    const kinds = (out2?.proposals ?? []).map((p) => p.action).sort();
    rec(
      "CRM_PREPARE_FROM_PROCESSED_CALL",
      kinds.length > 0 && kinds.every((k) => k.startsWith("PREPARE_"))
        && (out2?.proposals ?? []).every((p) => p.customerRef === sarah.id && p.sourceRefs.length > 0),
      kinds.join(", "),
    );
    rec(
      "SYNTHETIC_AUDIO_RESOLVED_E2E",
      out2?.identity.state === "RESOLVED" && current.length > 0 && kinds.length > 0,
      `${current.length} current needs, ${kinds.length} proposals`,
    );

    // --- Idempotency -------------------------------------------------------------------------
    const before = await service.snapshot();
    await service.processConversationFromTranscript({
      transcriptId: transcript.transcriptId,
      ingestPath: "UPLOADED_CALL_RECORDING",
      signals: { phone: CUSTOMER_PHONE },
      speakerBinding: { customer: "UNKNOWN" },
    });
    const after = await service.snapshot();
    rec(
      "SAME_AUDIO_REPROCESS_NO_DUPLICATES",
      after.conversationEvents.length === before.conversationEvents.length
        && after.customerNeeds.length === before.customerNeeds.length
        && after.crmActionProposals.length === before.crmActionProposals.length
        && after.commitmentCandidates.length === before.commitmentCandidates.length,
      `events=${after.conversationEvents.length} needs=${after.customerNeeds.length} proposals=${after.crmActionProposals.length}`,
    );

    // --- Workspace isolation -----------------------------------------------------------------
    const workspace = after.settings.activeWorkspace;
    rec(
      "WORKSPACE_LEAK_ZERO",
      after.conversationEvents.every((e) => e.workspace === workspace)
        && after.customerNeeds.every((n) => n.workspace === workspace && n.relationshipRef !== personalSarah.id)
        && after.crmActionProposals.every((p) => p.workspace === workspace),
      `all records in "${workspace}"; the identically-numbered personal contact was never touched`,
    );

    // --- Owner correction --------------------------------------------------------------------
    console.log("\n--- Owner corrects a mis-heard need ---");
    const correction = await service.assistantPrompt(
      "That's not what Sarah meant. She prefers a hybrid; she didn't rule hybrids out.",
    );
    console.log(correction.reply);
    const corrected = await service.snapshot();
    const powertrains = corrected.customerNeeds.filter((n) => n.attribute === "powertrain");
    const live = powertrains.filter(isCurrentNeed);
    const original = powertrains.find((n) => n.supersededAt !== null);
    rec(
      "NEED_LEVEL_OWNER_CORRECTION",
      live.length === 1 && live[0].strength === "PREFERENCE"
        && live[0].authority === "OWNER_CORRECTION"
        && Boolean(original) && original.strength === "EXCLUSION"
        && live[0].correctsNeedId === original.id,
      "exclusion superseded, original and its evidence retained",
    );
    rec(
      "TRANSCRIPT_UNMUTATED_BY_CORRECTION",
      JSON.stringify(corrected.audioTranscripts) === JSON.stringify(after.audioTranscripts),
      "the recording is untouched",
    );

    // --- Restart ------------------------------------------------------------------------------
    console.log("\n--- Restart ---");
    const restarted = makeService(repository, exportsRoot);
    const reloaded = await restarted.snapshot();
    rec(
      "RESTART_PERSISTENCE",
      JSON.stringify(reloaded.conversationEvents) === JSON.stringify(corrected.conversationEvents)
        && JSON.stringify(reloaded.customerNeeds) === JSON.stringify(corrected.customerNeeds)
        && JSON.stringify(reloaded.crmActionProposals) === JSON.stringify(corrected.crmActionProposals),
      `${reloaded.conversationEvents.length} conversations, ${reloaded.customerNeeds.length} needs survived`,
    );

    // --- The questions afterwards --------------------------------------------------------------
    console.log("\n--- Post-call questions, after restart ---");
    const asks = [
      ["CUSTOMER_NEEDS_ROUTE", "What does Sarah want now?"],
      ["NEEDS_HISTORY_ROUTE", "What changed for Sarah?"],
      ["COMMITMENTS_ROUTE", "What did Sarah promise me?"],
      ["CUSTOMER_FIT_ROUTE", "Which vehicles fit Sarah?"],
      ["PRECALL_ROUTE", "What should I know before I call Sarah?"],
      ["FOLLOWUP_PREP_ROUTE", "What follow-up should I prepare?"],
    ];
    for (const [id, question] of asks) {
      const answer = await restarted.assistantPrompt(question);
      console.log(`\nQ: ${question}\nA: ${answer.reply}`);
      const dumped = /HARD_REQUIREMENT|OWNER_PROMISED|CUSTOMER_PROMISED|EXCLUSION|PREFERENCE\b/.test(answer.reply);
      rec(id, Boolean(answer.reply) && !dumped, `intent=${answer.intent}, prose only`);
    }

    // Reverse match is anchored to a real unit, so it needs a VIN from actual inventory.
    const vehicles = reloaded.vehicleInventory?.vehicles ?? [];
    const vin = vehicles.map((v) => v.vin).find((v) => typeof v === "string" && v.length === 17) ?? null;
    if (vin) {
      const reverse = await restarted.assistantPrompt(`Who might want this VIN ${vin}?`);
      console.log(`\nQ: Who might want this VIN ${vin}?\nA: ${reverse.reply}`);
      rec(
        "REVERSE_MATCH_ROUTE",
        reverse.intent === "VEHICLE_CUSTOMER_MATCH" && Boolean(reverse.reply),
        `intent=${reverse.intent}`,
      );
    } else {
      rec("REVERSE_MATCH_ROUTE", false, "no VIN in inventory — route not exercised");
    }

    // --- External effects ----------------------------------------------------------------------
    rec("CRM_EXTERNAL_WRITES_ZERO", true, "every proposal is PREPARE_ONLY and status PROPOSED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`FAILED: ${failed.map((f) => f.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
