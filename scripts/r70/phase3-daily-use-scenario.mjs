/**
 * Phase 3 daily-use quality scenario against production HTTP.
 */
const BASE = "http://127.0.0.1:31415";

async function action(type, input = {}) {
  const res = await fetch(`${BASE}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, input }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const bak = (await action("import.preBackup", {})).json?.result || {};
console.log("BACKUP", JSON.stringify({ ok: bak.ok, encrypted: bak.encrypted, revision: bak.revision }));
if (!bak.ok || !bak.encrypted) process.exit(2);

// Limited Gmail refresh
const sync = (await action("connector.gmail.sync", {
  maxMessages: 25,
  query: "in:inbox newer_than:14d -category:promotions -category:social",
})).json?.result || {};
console.log(
  "GMAIL_REFRESH",
  JSON.stringify({
    ok: sync.ok,
    scanned: sync.scanned,
    uniqueNew: sync.uniqueNew,
    contacts: sync.contactsCreated,
    commits: sync.commitmentsExtracted,
  }),
);

const morning = (await action("executive.morning", { skipCycle: true })).json?.result || {};
console.log("MORNING_HEAD", String(morning.reply || "").slice(0, 600));
console.log(
  "COUNTS",
  JSON.stringify({
    must: morning.daily?.ownerMustDo?.length ?? morning.board?.ownerMustDo?.length,
    aion: morning.daily?.aionCanDo?.length ?? morning.board?.aionCanDo?.length,
    waiting: morning.daily?.waitingOnOthers?.length,
    hi: morning.daily?.highPriorityCount,
  }),
);

const qs = [
  "What should I do today?",
  "What changed since yesterday?",
  "Who should I follow up with?",
  "What am I waiting on?",
  "What can AION handle for me?",
  "What is happening at Lakeland Toyota?",
  "What is happening with Compassionate Choice?",
  "What career activity needs attention?",
];

// Use executive APIs directly (chat may need conversation id)
const daily = (await action("executive.daily", {})).json?.result || {};
const changed = (await action("executive.whatChanged", { hours: 24 })).json?.result || {};
const work = (await action("executive.contextDaily", { context: "work" })).json?.result || {};
const cc = (await action("executive.contextDaily", { context: "compassionate-choice" })).json?.result || {};
const career = (await action("executive.contextDaily", { context: "career" })).json?.result || {};
const personal = (await action("executive.contextDaily", { context: "personal" })).json?.result || {};

console.log("WHAT_SHOULD", String(daily.reply || "").includes("OWNER MUST DO") ? "PASS" : "FAIL");
console.log("WHAT_CHANGED", String(changed.reply || "").includes("WHAT CHANGED") ? "PASS" : "FAIL", String(changed.reply || "").slice(0, 300));
console.log("LAKELAND", String(work.reply || "").slice(0, 250));
console.log("CC", String(cc.reply || "").slice(0, 250));
console.log("CAREER", String(career.reply || "").slice(0, 250));
console.log("PERSONAL", String(personal.reply || "").slice(0, 250));

// Grounded draft for Sarah if present
const rels = (await action("relationship.find", { query: { kind: "all" } })).json?.result?.relationships || [];
const sarah = rels.find((r) => !r.archived && /^sarah$/i.test(r.displayName || ""));
let drafts = 0;
if (sarah?.id) {
  // create draft via CRM path if available
  try {
    const d = await action("chat.send", { id: "n/a", content: `prepare draft for ${sarah.displayName}` });
    void d;
  } catch {
    /* */
  }
}

const board = (await action("attention.board", {})).json?.result || {};
const g = (await action("connector.gmail.status", {})).json?.result || {};
console.log(
  "FINAL",
  JSON.stringify({
    gmail: g.code,
    lastSync: g.lastSyncAt,
    must: (board.ownerMustDo || []).length,
    aion: (board.aionCanDo || []).length,
    mustTitles: (board.ownerMustDo || []).map((x) => x.title),
    aionTitles: (board.aionCanDo || []).map((x) => x.title),
    drafts,
    falseCrmGate: sync.contactsCreated > 1 ? "WARN" : "OK",
  }),
);

process.exit(0);
