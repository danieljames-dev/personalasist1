/**
 * Phase 2: controlled Gmail expansion (max 100 new messages, batches of 25).
 * Quality gate after each batch. No sends.
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

const BATCHES = [
  {
    name: "inbox_high_value",
    query: "in:inbox newer_than:90d -category:promotions -category:social -category:forums",
  },
  {
    name: "career_direct",
    query:
      "newer_than:180d (interview OR recruiter OR \"application\" OR greenhouse OR lever OR \"phone screen\" OR \"job offer\" OR indeed OR linkedin) -category:promotions -category:social",
  },
  {
    name: "dealership_work",
    query:
      "newer_than:180d (toyota OR tacoma OR highlander OR camry OR dealership OR \"test drive\" OR trade-in OR \"stock #\" OR VIN) -category:promotions -category:social",
  },
  {
    name: "owner_sent_and_cc",
    query:
      "newer_than:120d (in:sent OR compassionate OR kristina OR kris.leach OR \"home care\" OR AHCA) -category:promotions -category:social",
  },
];

function qualityFromSync(s, beforeRels, beforeCommits, afterRels, afterCommits) {
  const newRels = afterRels.filter((r) => !beforeRels.has(r.id) && !r.archived);
  const newCommits = afterCommits.filter((c) => !beforeCommits.has(c.id) && c.status !== "cancelled");
  // Heuristic false: gmail-live prospect from support@/info@/marketing domains
  const falseCrm = newRels.filter((r) => {
    const email = (r.contactMethods || []).map((m) => m.value).join(" ").toLowerCase();
    return (
      r.source === "gmail-live" &&
      (r.relationshipType === "prospect" || r.relationshipType === "customer") &&
      /^(support|info|hello|noreply|no-reply|marketing|newsletter|team)@/i.test(email)
    );
  });
  const falseOwner = newCommits.filter(
    (c) =>
      /^owner$/i.test(c.committedBy) &&
      /i'll show you|we'll help you|book a free|unsubscribe|drug-like/i.test(c.statement),
  );
  return {
    newRels: newRels.length,
    newCommits: newCommits.length,
    falseCrm: falseCrm.length,
    falseOwner: falseOwner.length,
    stop: falseCrm.length > 1 || falseOwner.length > 1,
    newRelSample: newRels.slice(0, 8).map((r) => ({
      name: r.displayName,
      type: r.relationshipType,
      ws: r.workspace,
      src: r.source,
    })),
    newCommitSample: newCommits.slice(0, 8).map((c) => ({
      by: c.committedBy,
      to: c.committedTo,
      st: String(c.statement || "").slice(0, 80),
      ws: c.workspace,
    })),
  };
}

async function snapshotParts() {
  const st = await action("state.export", {});
  const exp = st.json?.result?.export ?? st.json?.export ?? st.json?.result;
  const state = typeof exp === "string" ? JSON.parse(exp) : exp;
  if (!state?.relationships) {
    // fallback: read via coverage + find
    const rel = await action("relationship.find", { query: { kind: "all" } });
    const list = rel.json?.result?.relationships || [];
    return {
      rels: list,
      commits: [],
      revision: null,
    };
  }
  return {
    rels: state.relationships || [],
    commits: state.executive?.commitments || [],
    revision: state.revision,
  };
}

const report = {
  batches: [],
  totalScanned: 0,
  totalUseful: 0,
  stopped: false,
};

const bak = (await action("import.preBackup", {})).json?.result || {};
console.log("BACKUP", JSON.stringify({ ok: bak.ok, encrypted: bak.encrypted, revision: bak.revision, msg: (bak.message || "").slice(0, 120) }));
if (!bak.ok || !bak.encrypted) {
  console.error("BACKUP_FAIL");
  process.exit(2);
}
report.backup = bak;

const g0 = (await action("connector.gmail.status", {})).json?.result;
console.log("GMAIL", g0?.code, g0?.lastSyncAt);

for (const batch of BATCHES) {
  if (report.totalScanned >= 100) break;
  const remaining = 100 - report.totalScanned;
  const maxMessages = Math.min(25, remaining);

  const before = await snapshotParts();
  const beforeRel = new Set(before.rels.map((r) => r.id));
  const beforeCom = new Set(before.commits.map((c) => c.id));

  console.log("\n=== BATCH", batch.name, "max", maxMessages, "===");
  const syncRes = await action("connector.gmail.sync", {
    maxMessages,
    query: batch.query,
  });
  const s = syncRes.json?.result || syncRes.json || {};
  console.log(
    "SYNC",
    JSON.stringify({
      ok: s.ok,
      scanned: s.scanned,
      uniqueNew: s.uniqueNew,
      skippedSeen: s.skippedSeen,
      commits: s.commitmentsExtracted,
      contacts: s.contactsCreated,
      byRel: (s.classified || []).reduce((a, c) => {
        a[c.relevance] = (a[c.relevance] || 0) + 1;
        return a;
      }, {}),
      msg: (s.message || s.error || "").slice(0, 160),
    }),
  );

  const after = await snapshotParts();
  const q = qualityFromSync(s, beforeRel, beforeCom, after.rels, after.commits);
  console.log("QUALITY", JSON.stringify(q));

  const useful = (s.classified || []).filter((c) => c.relevance !== "noise").length;
  report.totalScanned += Number(s.scanned) || 0;
  report.totalUseful += useful;
  report.batches.push({
    name: batch.name,
    query: batch.query,
    ok: s.ok,
    scanned: s.scanned,
    uniqueNew: s.uniqueNew,
    skippedSeen: s.skippedSeen,
    useful,
    byRel: (s.classified || []).reduce((a, c) => {
      a[c.relevance] = (a[c.relevance] || 0) + 1;
      return a;
    }, {}),
    byWs: (s.classified || []).reduce((a, c) => {
      a[c.workspaceHint] = (a[c.workspaceHint] || 0) + 1;
      return a;
    }, {}),
    quality: q,
  });

  if (q.stop) {
    report.stopped = true;
    console.log("STOP quality gate");
    break;
  }
  // If no new unique messages, still continue other queries
}

const board = (await action("attention.board", {})).json?.result;
const brief = (await action("executive.brief", {})).json?.result;
const g1 = (await action("connector.gmail.status", {})).json?.result;
const final = await snapshotParts();

const gmailRels = final.rels.filter((r) => !r.archived && /gmail/i.test(`${r.source} ${r.notes} ${r.reference}`));
const openCommits = final.commits.filter((c) => c.status === "open" || c.status === "due_soon" || c.status === "overdue");
const gmailCommits = openCommits.filter((c) => /gmail:/i.test(c.provenance?.sourceRef || ""));

// Up to 3 drafts if we have grounded high-value contacts (not marketing)
let draftsCreated = 0;
const draftTargets = gmailRels
  .filter((r) => r.relationshipType === "prospect" || r.relationshipType === "partner" || r.relationshipType === "customer")
  .filter((r) => {
    const email = (r.contactMethods || []).map((m) => m.value).join(" ");
    return email && !/^(support|info|hello|noreply)@/i.test(email);
  })
  .slice(0, 3);

for (const t of draftTargets) {
  const email = (t.contactMethods || []).find((m) => m.channel === "email")?.value;
  if (!email) continue;
  try {
    // Prefer service draft path if available; otherwise skip
    const d = await action("gmail.fixture.seed", { messages: [] }); // no-op probe
    void d;
  } catch {
    /* */
  }
}

console.log(
  "\nPHASE2_SUMMARY",
  JSON.stringify(
    {
      totalScanned: report.totalScanned,
      totalUseful: report.totalUseful,
      stopped: report.stopped,
      batches: report.batches.length,
      gmailStatus: g1?.code,
      lastSync: g1?.lastSyncAt,
      gmailRels: gmailRels.map((r) => ({ n: r.displayName, t: r.relationshipType, w: r.workspace })),
      gmailCommits: gmailCommits.map((c) => ({
        by: c.committedBy,
        to: c.committedTo,
        st: String(c.statement).slice(0, 60),
        ws: c.workspace,
      })),
      must: (board?.ownerMustDo || []).map((x) => x.title).slice(0, 12),
      aion: (board?.aionCanDo || []).map((x) => x.title).slice(0, 8),
      briefHead: String(brief?.reply || "").slice(0, 400),
      draftsCreated,
      revision: final.revision,
    },
    null,
    2,
  ),
);

process.exit(report.stopped ? 3 : 0);
