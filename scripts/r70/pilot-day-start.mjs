/**
 * One-shot daily pilot start: backup → brief → optional Gmail refresh ≤25 → record day.
 */
const BASE = "http://127.0.0.1:31415";

async function action(payload) {
  const res = await fetch(`${BASE}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return { status: res.status, json };
}

const bak = (await action({ type: "import.preBackup" })).json?.result || {};
console.log("BACKUP", JSON.stringify({ ok: bak.ok, encrypted: bak.encrypted, revision: bak.revision }));
if (!bak.ok || !bak.encrypted) process.exit(2);

const start = (await action({ type: "pilot.start" })).json?.result || {};
console.log("PILOT_START", start.reply || start);

const morning = (await action({ type: "executive.morning", skipCycle: true })).json?.result || {};
const daily = morning.daily || (await action({ type: "executive.daily" })).json?.result || {};

const gmail = (await action({
  type: "connector.gmail.sync",
  maxMessages: 25,
  query: "in:inbox newer_than:7d -category:promotions -category:social",
})).json?.result || {};

console.log(
  "GMAIL",
  JSON.stringify({
    ok: gmail.ok,
    scanned: gmail.scanned,
    uniqueNew: gmail.uniqueNew,
    contacts: gmail.contactsCreated,
    commits: gmail.commitmentsExtracted,
  }),
);

const day = (await action({
  type: "pilot.day",
  briefGenerated: true,
  ownerMustDo: daily.ownerMustDo?.length ?? 0,
  aionCanDo: daily.aionCanDo?.length ?? 0,
  waitingOn: daily.waitingOnOthers?.length ?? 0,
  attentionItems: morning.board?.ownerMustDo?.length ?? daily.highPriorityCount ?? 0,
  gmailNewScanned: gmail.uniqueNew ?? gmail.scanned ?? 0,
  draftsPrepared: 0,
  emailsSent: 0,
  corrections: 0,
  ownerPrompts: 0,
  notes: "pilot-day-start automated",
})).json?.result || {};

const status = (await action({ type: "pilot.status" })).json?.result || {};
console.log("DAY", JSON.stringify(day));
console.log("STATUS_HEAD", String(status.reply || "").slice(0, 800));
console.log("BRIEF_HEAD", String(morning.reply || daily.reply || "").slice(0, 500));
process.exit(gmail.contactsCreated > 1 || gmail.commitmentsExtracted > 1 ? 3 : 0);
