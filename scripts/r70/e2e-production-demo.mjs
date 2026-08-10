/**
 * R7 real production E2E demo against localhost:31415 (not unit fixtures only).
 */
import { createHash } from "node:crypto";

const BASE = process.env.AION_URL || "http://127.0.0.1:31415";

async function api(type, body = {}) {
  const res = await fetch(`${BASE}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, ...body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${type} ${res.status}: ${json.error || JSON.stringify(json)}`);
  return json.result ?? json;
}

async function state() {
  const res = await fetch(`${BASE}/api/state`);
  if (!res.ok) throw new Error(`state ${res.status}`);
  return res.json();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const results = [];
function rec(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

async function main() {
  const s0 = await state();
  rec("PRODUCTION_REACHABLE", true, `workspace=${s0.state?.settings?.activeWorkspace}`);

  // Switch to Work workspace for CRM (clear stale developer bridge if it blocks settings.update)
  if (s0.state?.settings?.activeWorkspace !== "work") {
    await api("settings.update", {
      settings: { activeWorkspace: "work", developerBridgeId: "" },
    });
  }

  const company = await api("relationship.create", {
    relationship: {
      displayName: "ACME R7 TEST COMPANY",
      organisation: "ACME R7 TEST COMPANY",
      relationshipType: "prospect",
      notes: "Synthetic R7 demo company",
    },
  });
  rec("CREATE_COMPANY", !!company.id, company.id);

  const contact = await api("relationship.create", {
    relationship: {
      displayName: "Jane Test",
      organisation: "ACME R7 TEST COMPANY",
      relationshipType: "contact",
      role: "Buyer",
      notes: "Synthetic contact for ACME R7",
    },
  });
  rec("CREATE_CONTACT", !!contact.id, contact.id);

  await api("customer.interaction", {
    id: contact.id,
    interaction: {
      kind: "call",
      summary: "Jane is interested in Product Alpha but is concerned about delivery time.",
      detail: "Synthetic interaction for R7 demo.",
    },
  });
  await api("customer.update", {
    id: contact.id,
    change: { objections: ["delivery time"], interests: [{ kind: "product", description: "Product Alpha" }] },
  });
  await api("customer.followup", {
    id: contact.id,
    followUp: {
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      channel: "email",
      reason: "Follow up tomorrow about Product Alpha delivery.",
    },
  });
  rec("SEED_INTERACTION_TASK", true, "interaction+objection+followup");

  const q1 = await api("assistant.prompt", { text: "What do we know about ACME R7 TEST COMPANY?" });
  rec("R7_ASSISTANT_QUERY", /ACME R7|Jane|delivery/i.test(q1.reply || ""), (q1.reply || "").slice(0, 160));

  const q2 = await api("assistant.prompt", { text: "What is Jane concerned about?" });
  rec("CONCERN_LOOKUP", /delivery/i.test(q2.reply || ""), (q2.reply || "").slice(0, 160));

  const q3 = await api("assistant.prompt", { text: "What should I do next?" });
  rec("NEXT_ACTION", /follow|attention|Product Alpha|Jane|ACME/i.test(q3.reply || ""), (q3.reply || "").slice(0, 160));

  const q4 = await api("assistant.prompt", { text: "Draft Jane a follow-up email." });
  rec("R7_EMAIL_DRAFT", /DRAFT|Subject|Jane|follow/i.test(q4.reply || ""), (q4.reply || "").slice(0, 160));

  // Checkpoint A: natural-language breadth (must not dead-end)
  const nlCases = [
    ["What should I follow up on?", /follow|overdue|attention|Jane|ACME/i],
    ["Who do I need to call?", /follow|call|attention|Jane|ACME|overdue/i],
    ["What should I do today?", /follow|attention|task|overdue|Jane|ACME/i],
    ["What's going on with ACME?", /ACME|Jane|delivery|Product/i],
    ["How is the weather on Mars?", /ground|stored|follow|You can also ask/i],
  ];
  for (const [prompt, re] of nlCases) {
    const ans = await api("assistant.prompt", { text: prompt });
    rec(`NL:${prompt.slice(0, 28)}`, re.test(ans.reply || ""), `${ans.intent}: ${(ans.reply || "").slice(0, 120)}`);
  }

  // Document intake (metadata path) with tags retention
  const doc = await api("crm.document.attach", {
    relationshipId: company.id,
    filename: "acme-r7-quote.txt",
    storedPath: "C:\\AION-HQ\\private\\aion\\intake\\acme-r7-quote.txt",
    mimeType: "text/plain",
    byteLength: 42,
    summary: "Synthetic quote attachment for ACME R7",
    extractedText: "Product Alpha delivery estimate 6 weeks.",
    kind: "document",
    tags: ["synthetic", "r7-e2e", "quote"],
  });
  rec("DOCUMENT_INTAKE", !!doc.id && Array.isArray(doc.tags) && doc.tags.includes("synthetic"), `${doc.filename} tags=${JSON.stringify(doc.tags)}`);

  // Real byte upload path
  const sample = "ACME R7 real upload: Product Alpha lead time 6 weeks. Contact Jane.";
  const up = await api("crm.document.upload", {
    relationshipId: company.id,
    filename: "acme-r7-upload.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from(sample, "utf8").toString("base64"),
    tags: ["synthetic", "upload-e2e"],
    summary: "E2E real byte upload",
  });
  rec(
    "DOCUMENT_UPLOAD_BYTES",
    !!up.id && up.byteLength === sample.length && /Product Alpha/i.test(up.extractedText || ""),
    `${up.filename} bytes=${up.byteLength} path=${(up.storedPath || "").slice(0, 60)}`,
  );

  // relationship.update routing
  const renamed = await api("relationship.update", {
    id: contact.id,
    change: { role: "Buyer (E2E)" },
  });
  rec("RELATIONSHIP_UPDATE", /Buyer \(E2E\)/i.test(renamed.role || ""), renamed.role || "");

  // Owner knowledge + brand registry (Checkpoint C/D foundations)
  const profile = await api("owner.profile.update", {
    displayName: "E2E Owner",
    summary: "Synthetic profile for runway e2e — not production identity.",
  });
  rec("OWNER_PROFILE", /E2E Owner/i.test(profile.profile?.displayName || ""), profile.profile?.displayName || "");
  const fact = await api("owner.knowledge.add", {
    category: "skill",
    title: "E2E Skill",
    content: "Synthetic skill fact for tests.",
    confidence: 85,
    sourceRef: "e2e",
  });
  rec("OWNER_KNOWLEDGE_FACT", fact.category === "skill" && fact.confidence === 85, `${fact.title}@${fact.confidence}`);
  const brand = await api("workspace.create", {
    workspace: {
      label: `E2E Brand ${Date.now().toString(36)}`,
      kind: "business",
      purpose: "Synthetic brand for e2e",
      brand: { name: "E2E Brand", positioning: "test only", audience: "testers", channels: ["web"], valueProposition: "", notes: "" },
    },
  });
  rec("BRAND_WORKSPACE", brand.kind === "business" && !!brand.brand?.name, brand.id);
  const collab = await api("brand.collaborator.add", {
    name: "E2E Collaborator",
    role: "test role",
    brandWorkspaceId: brand.id,
    brandResponsibility: "Owner-supplied e2e responsibility only",
  });
  rec("BRAND_COLLABORATOR", collab.name === "E2E Collaborator" && !!collab.brandResponsibility, collab.id);

  const brief = await api("work.briefing", {});
  rec("DAILY_BRIEFING", /Daily briefing|What needs you|follow/i.test(brief.text || ""), (brief.text || "").slice(0, 120));

  const briefNl = await api("assistant.prompt", { text: "What needs me?" });
  rec("NL_WHAT_NEEDS_ME", /needs you|follow|task|draft/i.test(briefNl.reply || ""), (briefNl.reply || "").slice(0, 120));

  await api("gmail.fixture.seed", {
    messages: [
      {
        id: "fix-e2e-1",
        threadId: "thr-e2e-1",
        from: "Jane Test <jane@acme-r7.test>",
        to: "owner@test",
        subject: "Pricing follow-up",
        snippet: "We will decide by Friday",
        bodyText: "Thanks for the call. We will decide by Friday on Product Alpha.",
        internalDate: new Date().toISOString(),
        labelIds: ["INBOX"],
      },
    ],
  });
  const gmail = await api("gmail.fixture.search", { query: "pricing" });
  rec("GMAIL_FIXTURE_SEARCH", (gmail.messages?.length ?? 0) >= 1 && (gmail.commitments?.length ?? 0) >= 1, `msgs=${gmail.messages?.length} commitments=${gmail.commitments?.length}`);
  const assoc = await api("gmail.fixture.associate", { messageId: "fix-e2e-1" });
  rec("GMAIL_FIXTURE_ASSOCIATE", /Jane|ACME|Associated/i.test(assoc.reply || ""), (assoc.reply || "").slice(0, 120));

  const research = await api("assistant.prompt", { text: "Research ACME R7 TEST COMPANY." });
  rec("RESEARCH_PROPOSE", /research job|Proposed research|Stored research/i.test(research.reply || ""), (research.reply || "").slice(0, 120));

  const stalled = await api("assistant.prompt", { text: "Which deals are stalled?" });
  rec("STALLED_DEALS", /stalled|quiet|follow|No stalled/i.test(stalled.reply || ""), (stalled.reply || "").slice(0, 120));

  const pricing = await api("assistant.prompt", { text: "Which customers mentioned pricing?" });
  rec("PRICING_MENTIONS", /pricing|mention|No stored/i.test(pricing.reply || ""), (pricing.reply || "").slice(0, 120));

  const job = await api("assistant.prompt", { text: "Track application for Account Executive at Northline Test Co." });
  rec("JOB_TRACK", /Tracked application|Account Executive|not submitted|fit/i.test(job.reply || ""), (job.reply || "").slice(0, 140));

  const product = await api("assistant.prompt", { text: "Find a product opportunity for local services." });
  rec("PRODUCT_PROJECT", /Created project|opportunity|stage idea/i.test(product.reply || ""), (product.reply || "").slice(0, 140));

  // Capture pre-restart digests of reply content existence via state
  const mid = await state();
  const hasJane = (mid.state.relationships || []).some((r) => /Jane Test/i.test(r.displayName));
  rec("R7_REAL_CRM_PERSISTENCE", hasJane, `relationships=${(mid.state.relationships || []).length}`);

  // Restart production process
  const { spawnSync } = await import("node:child_process");
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\AION-HQ\\scripts\\aion-production.ps1", "-Action", "restart"],
    { encoding: "utf8", timeout: 120000 },
  );
  // wait for health
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const s = await state();
      if (s.state) {
        healthy = true;
        const still = (s.state.relationships || []).some((r) => /ACME R7 TEST COMPANY/i.test(r.displayName + r.organisation));
        rec("R7_RESTART_MEMORY", still, `after restart relationships=${(s.state.relationships || []).length}`);
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!healthy) rec("R7_RESTART_MEMORY", false, "production not healthy after restart");

  // Cleanup synthetic data
  try {
    await api("customer.archive", { id: company.id, archived: true });
    await api("customer.archive", { id: contact.id, archived: true });
    rec("CLEANUP", true, "archived synthetic CRM rows");
  } catch (e) {
    rec("CLEANUP", false, String(e.message || e));
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ pass, fail, results }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
