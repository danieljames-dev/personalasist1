// AION Command Center UI. Same-origin only; no hosted dependency, analytics, or telemetry.
const areas = ["Sales", "People", "Chat", "Knowledge", "Brain", "Studio", "Research", "Projects", "Learning", "Tasks", "Routines", "Memory", "Planner", "Approvals", "Verify", "Activity", "Career", "Imports", "Settings"];
let model = null;
let area = "Chat";
let streaming = "";
let openConversation = null;
/** Held in memory only, shown once, never persisted. */
let pairingCode = null;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Nothing from another workspace is ever rendered. Work material never appears in Personal. */
const scoped = (items) => (items ?? []).filter((item) => (item.workspace ?? "personal") === (model.state.settings.activeWorkspace ?? "personal"));
/** A datetime-local field carries no zone; treat it as this device's time and store UTC. */
const localToIso = (value) => value ? new Date(value).toISOString() : "";
const short = (value, length = 16) => `${String(value ?? "").slice(0, length)}…`;

const SESSION_KEY = "aion.session";
/** A paired phone keeps its token here. The console never has one and never needs one. */
const sessionToken = () => { try { return localStorage.getItem(SESSION_KEY) ?? ""; } catch { return ""; } };
const setSessionToken = (value) => { try { value ? localStorage.setItem(SESSION_KEY, value) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } };
/** Bearer material travels in a header, never in a URL where it would reach logs and history. */
function authHeaders() { const token = sessionToken(); return token ? { authorization: `Bearer ${token}` } : {}; }

async function api(type, payload = {}) {
  // `type` is written last on purpose: a payload field can never displace the action being called.
  const response = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ ...payload, type }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.result;
}
async function load() {
  const response = await fetch("/api/state", { headers: authHeaders() });
  if (response.status === 401 || response.status === 403) { setSessionToken(""); renderPairing(await response.json().then((d) => d.error).catch(() => "This device is not paired.")); return; }
  model = await response.json();
  render();
}

/** The only screen an unpaired phone ever sees. It shows no owner data of any kind. */
function renderPairing(message) {
  document.querySelector("#onboarding").hidden = true;
  const content = document.querySelector("#content");
  content.hidden = false;
  content.innerHTML = `<div class="sales"><h1>Pair this device</h1>
<p class="lead">${esc(message)}</p>
<p class="hint">On the computer running AION, open <b>Settings</b>, turn on private phone access, and choose <b>Create pairing code</b>. Codes last ten minutes and work once.</p>
<form data-form="pair" class="quick-form"><label>Pairing code<input name="code" required maxlength="20" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCDE-FGHIJ"></label><button>Pair</button></form></div>`;
}
function toast(message) { const node = document.querySelector("#toast"); node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 4000); }
function cards(items, renderItem, empty = "Nothing here yet. Use the form above to begin.") {
  return items.length ? `<div class="grid">${items.map(renderItem).join("")}</div>` : `<div class="empty">${esc(empty)}</div>`;
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

/** Streams one chat turn so provider tokens appear as they arrive rather than after the turn. */
async function sendStreamed(id, content) {
  streaming = ""; openConversation = id;
  const response = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ id, content }) });
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === "chunk") { streaming += parsed.text; render(); }
      if (event === "error") { streaming = ""; throw new Error(parsed.error); }
      if (event === "done") {
        streaming = "";
        const proposals = (parsed.proposedActions?.length ?? 0) + (parsed.proposedMemories?.length ?? 0);
        if (proposals) toast(`${proposals} proposal(s) recorded for your review. Nothing has been executed or confirmed.`);
      }
    }
  }
  await load();
}

function chatArea(s) {
  return `<h1>Assistant</h1><p class="lead">Daily CRM assistant: natural language works. CRM lookup, notes, follow-ups, account summaries, email drafts (never auto-sent), plus offline chat. Answers ground in stored Work-workspace records.</p>
<div class="card"><h2>Ask AION</h2>
<p class="meta">Try: What should I follow up on? · Who do I need to call? · What should I do today? · What do we know about Jane? · What's going on with ACME? · Draft John an email · Research ACME · Remember this</p>
<form data-form="assistant-prompt"><label>Prompt<textarea name="text" required maxlength="10000" placeholder="What do we know about …"></textarea></label><button>Ask</button></form>
${window.__aionLastAssistant ? `<div class="thread"><p class="msg assistant"><b>assistant · ${esc(window.__aionLastAssistant.intent || "reply")}:</b> ${esc(window.__aionLastAssistant.reply || "")}</p>
${(window.__aionLastAssistant.sources || []).length ? `<p class="meta">Sources: ${window.__aionLastAssistant.sources.map((x) => esc(x.label || x.id)).join("; ")}</p>` : ""}</div>` : ""}
</div>
<p class="hint">Raw model chat (below) is offline by default. CRM prompts above use structured production CRM first.</p>
<form data-form="conversation"><label>Conversation title<input name="title" value="New conversation" maxlength="200"></label><button>Create conversation</button></form>
${cards(scoped(s.conversations), (c) => `<article class="card"><h2>${esc(c.title)}</h2><p class="meta">${esc(c.state)} · ${c.messages.length} messages · memory context ${c.memoryContextEnabled ? "on" : "off"} · updated ${esc(c.updatedAt)}</p>
<div class="thread">${c.messages.slice(-8).map((m) => `<p class="msg ${esc(m.role)}"><b>${esc(m.role)}${m.providerId ? ` · ${esc(m.providerId)}` : ""}:</b> ${esc(m.content)}</p>`).join("")}${streaming && openConversation === c.id ? `<p class="msg assistant streaming"><b>assistant:</b> ${esc(streaming)}<span class="cursor">▍</span></p>` : ""}</div>
<form data-form="message"><input type="hidden" name="id" value="${esc(c.id)}"><label>Message<textarea name="content" required maxlength="10000"></textarea></label><button>Send</button></form>
<form data-form="conversation-rename"><input type="hidden" name="id" value="${esc(c.id)}"><label>Rename<input name="title" value="${esc(c.title)}" maxlength="200"></label><button>Rename</button></form>
<div class="actions"><button data-do="chat-cancel" data-id="${esc(c.id)}">Cancel request</button><button data-do="conversation-state" data-id="${esc(c.id)}" data-state="${c.state === "archived" ? "active" : "archived"}">${c.state === "archived" ? "Unarchive" : "Archive"}</button><button data-do="conversation-memory" data-id="${esc(c.id)}" data-enabled="${!c.memoryContextEnabled}">Memory context ${c.memoryContextEnabled ? "off" : "on"}</button><button data-do="conversation-delete" data-id="${esc(c.id)}" class="danger">Delete</button></div></article>`, "No conversations yet. Create one above to talk to the offline provider.")}`;
}

function tasksArea(s) {
  return `<h1>Tasks</h1><p class="lead">Persisted work with deterministic state transitions, provenance, and complete history.</p>
<form data-form="task"><label>Title<input name="title" required maxlength="500"></label><label>Description<textarea name="description" maxlength="10000"></textarea></label>
<label>Priority<select name="priority"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></label>
<label>Tags (comma separated)<input name="tags" maxlength="500"></label><button>Create task</button></form>
${cards(scoped(s.tasks), (t) => `<article class="card"><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p>
<p class="meta">${esc(t.priority)} · ${esc(t.state)} · ${esc(t.tags.join(", ") || "no tags")} · from ${esc(t.provenance.sourceType)} · ${t.history.length} history entries</p>
<form data-form="task-edit"><input type="hidden" name="id" value="${esc(t.id)}"><label>Edit title<input name="title" value="${esc(t.title)}" maxlength="500"></label><label>Edit description<textarea name="description" maxlength="10000">${esc(t.description)}</textarea></label><button>Save changes</button></form>
<div class="actions">${t.state !== "completed" ? `<button data-do="task" data-id="${esc(t.id)}" data-state="completed">Complete</button>` : `<button data-do="task" data-id="${esc(t.id)}" data-state="ready">Reopen</button>`}
${t.state === "ready" ? `<button data-do="task" data-id="${esc(t.id)}" data-state="in-progress">Start</button><button data-do="task" data-id="${esc(t.id)}" data-state="blocked">Block</button>` : ""}
<button data-do="task" data-id="${esc(t.id)}" data-state="cancelled" class="danger">Cancel</button></div></article>`)}`;
}

function routinesArea(s) {
  return `<h1>Routines</h1><p class="lead">In-app routines run while AION is open. Production autostart (R7) is a separate Windows logon task for the Command Center process — see <code>scripts/aion-production.ps1</code>.</p>
<form data-form="routine"><label>Name<input name="name" required maxlength="500"></label><label>Instructions<textarea name="instructions" required maxlength="10000"></textarea></label>
<label>Every minutes<input name="intervalMinutes" type="number" min="1" max="525600" value="60"></label><button>Create routine</button></form>
${cards(scoped(s.routines), (r) => `<article class="card"><h2>${esc(r.name)}</h2><p>${esc(r.instructions)}</p>
<p class="meta">${r.enabled ? "enabled" : "disabled"} · every ${r.intervalMinutes} min · next ${esc(r.nextRunAt ?? "not scheduled")} · last ${esc(r.lastRunAt ?? "never")} · ${r.history.length} history entries</p>
<form data-form="routine-interval"><input type="hidden" name="id" value="${esc(r.id)}"><label>Change interval (minutes)<input name="intervalMinutes" type="number" min="1" max="525600" value="${r.intervalMinutes}"></label><button>Save interval</button></form>
<div class="actions"><button data-do="routine" data-id="${esc(r.id)}">Run now</button><button data-do="routine-enabled" data-id="${esc(r.id)}" data-enabled="${!r.enabled}">${r.enabled ? "Disable" : "Enable"}</button></div></article>`)}
<div class="card"><h2>Scheduler</h2><p>The scheduler is ${s.settings.schedulerEnabled ? "enabled" : "disabled"} and runs every 30 seconds while this window is open.</p><button data-do="tick">Run due routines now</button></div>`;
}

function memoryArea(s) {
  return `<h1>Memory</h1><p class="lead">Owner-controlled facts with provenance, corrections, disablement, deletion, export, and preserved conflicts.</p>
<form data-form="memory"><label>Memory<textarea name="content" required maxlength="20000"></textarea></label>
<label>Category<select name="category"><option>semantic</option><option>procedural</option><option>episodic</option><option>strategic</option></select></label><button>Save memory</button></form>
<form data-form="memory-search"><label>Search enabled memories<input name="query" maxlength="500"></label><button>Search</button></form>
<div class="actions"><button data-do="memory-export">Export memories</button></div>
${cards(scoped(s.memories), (m) => `<article class="card ${m.conflict === "conflicting" ? "conflict" : ""}"><h2>${esc(m.category)}${m.conflict === "conflicting" ? " · conflicting" : ""}</h2><p>${esc(m.content)}</p>
<p class="meta">${esc(m.confirmation)} · ${m.enabled ? "enabled" : "disabled"} · source ${esc(m.provenance.sourceType)}/${esc(m.provenance.sourceRef)} · recorded ${esc(m.sourceTimestamp)} · ${m.corrections.length} corrections</p>
${m.conflict === "conflicting" ? `<p class="warn">Another enabled memory in this category states something different about the same subject. Both are preserved until you correct or disable one.</p>` : ""}
${m.corrections.length ? `<details><summary>Correction history</summary>${m.corrections.map((c) => `<p class="meta">${esc(c.at)}: “${esc(c.previousContent)}” → “${esc(c.correctedContent)}” (${esc(c.reason)})</p>`).join("")}</details>` : ""}
<form data-form="memory-correct"><input type="hidden" name="id" value="${esc(m.id)}"><label>Correct to<textarea name="content" required maxlength="20000">${esc(m.content)}</textarea></label><label>Reason<input name="reason" required maxlength="500"></label><button>Correct</button></form>
<div class="actions">${m.confirmation === "unconfirmed" ? `<button data-do="memory-accept" data-id="${esc(m.id)}">Confirm</button>` : ""}<button data-do="memory-toggle" data-id="${esc(m.id)}" data-enabled="${!m.enabled}">${m.enabled ? "Disable" : "Enable"}</button><button data-do="memory-delete" data-id="${esc(m.id)}" class="danger">Forget</button></div></article>`)}`;
}

function plannerArea(s) {
  return `<h1>Planner</h1><p class="lead">Plans are reviewable proposals. They carry no execution authority until you convert steps into Tasks.</p>
<form data-form="plan"><label>Goal<input name="goal" required maxlength="2000"></label><label>Steps (one per line, in order)<textarea name="steps" required maxlength="10000"></textarea></label><button>Create plan</button></form>
${cards(scoped(s.plans), (p) => `<article class="card"><h2>${esc(p.goal)}</h2><p class="meta">${esc(p.status)} · ${p.steps.length} steps · from ${esc(p.provenance.sourceType)} · ${esc(p.createdAt)}</p>
<ol>${p.steps.map((x) => `<li>${esc(x.title)} — ${esc(x.status)}${x.dependencies.length ? ` · depends on ${x.dependencies.length} earlier step(s)` : ""}${x.approvalRequired ? " · approval required" : ""}${x.requiredCapabilities.length ? ` · needs ${esc(x.requiredCapabilities.join(", "))}` : ""}${x.blockedReason ? ` · blocked: ${esc(x.blockedReason)}` : ""}<br><span class="meta">expects ${esc(x.expectedOutput)}</span></li>`).join("")}</ol>
<div class="actions">${p.status === "proposed" ? `<button data-do="plan-accept" data-id="${esc(p.id)}">Accept plan</button>` : ""}${p.status === "accepted" ? `<button data-do="plan-convert" data-id="${esc(p.id)}">Convert steps to Tasks</button>` : ""}</div></article>`)}`;
}

function verifyArea(s) {
  const operations = model.verificationOperations ?? [];
  const runs = s.verifications ?? [];
  return `<h1>Verify</h1><p class="lead">AION runs these itself. Each one is chosen from a fixed allowlist written in the repository — there is no command box, and nothing a model says can become part of a command.</p>
<p class="hint">This is how you get “run the tests and tell me what failed” without giving a developer agent a shell or write access: AION produces the evidence, then a <em>read-only</em> agent analyses it.</p>
${operations.length ? `<form data-form="verify"><label>Operation<select name="operationId">${operations.map((o) => `<option value="${esc(o.id)}">${esc(o.label)} — ${esc(o.displayCommand)}</option>`).join("")}</select></label>
<p class="meta">${operations.map((o) => `<code>${esc(o.displayCommand)}</code>`).join(" · ")} — all read-only.</p><button>Propose verification</button></form>` : `<div class="empty">No verification tooling is available on this computer.</div>`}
${cards(runs, (r) => `<article class="card"><h2>${esc(r.operationId)} · ${esc(r.outcome)}</h2>
<p class="meta"><code>${esc(r.displayCommand)}</code> · exit ${r.exitCode}${r.timedOut ? " · timed out" : ""} · ${r.durationMs} ms · ${esc(r.startedAt)} · digest ${esc(short(r.resultDigest))}${r.truncated ? " · output truncated" : ""}</p>
<details><summary>Evidence</summary><pre>${esc((r.stdout || "") + (r.stderr ? `\n${r.stderr}` : "") || "(no output)")}</pre></details>
<form data-form="verify-analyse"><input type="hidden" name="id" value="${esc(r.id)}"><label>Ask a read-only developer agent about this run<input name="question" maxlength="500" value="Explain what is failing and why."></label><button>Propose read-only analysis</button></form></article>`, "No verification has been run yet. Propose one above.")}`;
}

// --- Sales: built for a salesperson holding a phone on the lot, not a desktop dashboard. -------
let salesTab = "TODAY";
let openCustomer = null;
let coachPanel = null;

const today = () => new Date().toISOString().slice(0, 10);
const active = (s) => (s.relationships ?? []).filter((c) => c.workspace === "work" && !c.archived);
const openFollowUps = (c) => c.followUps.filter((f) => f.status === "open");
const dueFollowUps = (s, onDate = today()) => active(s).flatMap((c) => openFollowUps(c).filter((f) => f.dueAt.slice(0, 10) <= onDate).map((f) => ({ c, f })));
const overdueCallbacks = (s, onDate = today()) => active(s).flatMap((c) => openFollowUps(c).filter((f) => f.channel === "phone" && f.dueAt.slice(0, 10) < onDate).map((f) => ({ c, f })));
const todayAppointments = (s, onDate = today()) => active(s).flatMap((c) => c.appointments.filter((a) => a.at.slice(0, 10) === onDate && !["cancelled", "no-show"].includes(a.status)).map((a) => ({ c, a })));

/** A short human interval so the timeline reads like a person wrote it. */
function ago(at) {
  const days = Math.floor((Date.parse(today() + "T00:00:00.000Z") - Date.parse(at.slice(0, 10) + "T00:00:00.000Z")) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return at.slice(0, 10);
}

function nextUp(s) {
  const due = dueFollowUps(s).sort((x, y) => x.f.dueAt.localeCompare(y.f.dueAt))[0];
  if (due) return { c: due.c, why: due.f.reason };
  const appt = todayAppointments(s).sort((x, y) => x.a.at.localeCompare(y.a.at))[0];
  if (appt) return { c: appt.c, why: `${appt.a.kind} at ${appt.a.at.slice(11, 16)}` };
  const waiting = active(s).filter((c) => c.nextAction).sort((x, y) => (x.nextActionAt ?? "9999").localeCompare(y.nextActionAt ?? "9999"))[0];
  return waiting ? { c: waiting, why: waiting.nextAction } : null;
}

function customerRow(c, detail) {
  return `<button class="row" data-do="customer-open" data-id="${esc(c.id)}"><span class="row-main"><b>${esc(c.displayName)}</b><span class="row-sub">${esc(detail)}</span></span><span class="pill">${esc(c.lifecycle)}</span></button>`;
}

function customerDetail(s) {
  const c = (s.relationships ?? []).find((x) => x.id === openCustomer);
  if (!c) { openCustomer = null; return ""; }
  const interest = c.interests.map((i) => i.description).join("; ") || "not recorded";
  const timeline = [...c.interactions].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  return `<div class="sheet"><div class="sheet-head"><button class="back" data-do="customer-close">‹ Back</button><h2>${esc(c.displayName)}</h2></div>
<dl class="facts"><div><dt>Stage</dt><dd>${esc(c.lifecycle)}</dd></div><div><dt>Interest</dt><dd>${esc(interest)}</dd></div>
<div><dt>Last contact</dt><dd>${esc(c.lastContactAt ? ago(c.lastContactAt) : "none")}</dd></div>
<div><dt>Next action</dt><dd>${esc(c.nextAction || "none set")}${c.nextActionAt ? ` · ${esc(ago(c.nextActionAt))}` : ""}</dd></div></dl>
<div class="tap-grid"><button data-do="coach" data-kind="call-preparation" data-id="${esc(c.id)}">Call Prep</button>
<button data-do="sheet" data-sheet="note" data-id="${esc(c.id)}">Add Note</button>
<button data-do="coach" data-kind="follow-up-draft" data-id="${esc(c.id)}">Follow-up Draft</button>
<button data-do="sheet" data-sheet="appointment" data-id="${esc(c.id)}">Appointment</button>
<button data-do="sheet" data-sheet="stage" data-id="${esc(c.id)}">Change Stage</button>
<button data-do="sheet" data-sheet="followup" data-id="${esc(c.id)}">Follow-up</button></div>
${coachPanel && coachPanel.for === c.id ? `<div class="card coach"><h2>${esc(coachPanel.output.title)}</h2>${coachPanel.output.draft ? `<p class="warn">Draft only — AION never sends anything.</p>` : ""}<pre>${esc(coachPanel.output.lines.join("\n"))}</pre><div class="actions"><button data-do="coach-close">Close</button></div></div>` : ""}
${openFollowUps(c).length ? `<div class="card"><h2>Open follow-ups</h2>${openFollowUps(c).map((f) => `<p class="meta">${esc(ago(f.dueAt))} · ${esc(f.channel)} · ${esc(f.reason)} <button data-do="followup-done" data-id="${esc(c.id)}" data-followup="${esc(f.id)}">Done</button></p>`).join("")}</div>` : ""}
${c.appointments.length ? `<div class="card"><h2>Appointments</h2>${c.appointments.map((a) => `<p class="meta">${esc(a.at.slice(0, 16).replace("T", " "))} · ${esc(a.kind)} · ${esc(a.status)}${a.location ? ` · ${esc(a.location)}` : ""} ${["scheduled", "confirmed"].includes(a.status) ? `<button data-do="appt-status" data-id="${esc(c.id)}" data-appt="${esc(a.id)}" data-status="shown">Shown</button><button data-do="appt-status" data-id="${esc(c.id)}" data-appt="${esc(a.id)}" data-status="no-show">No-show</button>` : ""}</p>`).join("")}</div>` : ""}
<div class="card"><h2>Timeline</h2>${timeline.length ? timeline.map((entry) => `<p class="tl"><span class="tl-when">${esc(ago(entry.at))}</span><span class="tl-what"><b>${esc(entry.kind)}</b> ${esc(entry.summary)}</span></p>`).join("") : `<p class="meta">Nothing recorded yet.</p>`}</div>
<details><summary>Edit details</summary><form data-form="customer-edit"><input type="hidden" name="id" value="${esc(c.id)}">
<label>Name or alias<input name="displayName" value="${esc(c.displayName)}" maxlength="200"></label>
<label>Notes<textarea name="notes" maxlength="20000">${esc(c.notes)}</textarea></label>
<label>Next action<input name="nextAction" value="${esc(c.nextAction)}" maxlength="500"></label><button>Save</button></form>
<div class="actions"><button data-do="customer-archive" data-id="${esc(c.id)}" data-archived="${!c.archived}" class="danger">${c.archived ? "Reactivate" : "Archive"}</button></div></details></div>`;
}

function salesArea(s) {
  if (s.settings.activeWorkspace !== "work") {
    return `<h1>Sales</h1><div class="empty">Sales lives in the Work workspace. Switch to ${esc(s.settings.workspaceLabels?.work ?? "Work")} at the top of the screen.</div>`;
  }
  if (openCustomer) return customerDetail(s);
  const label = s.settings.workspaceLabels?.work ?? "Work";
  const due = dueFollowUps(s); const appts = todayAppointments(s); const overdue = overdueCallbacks(s);
  const next = nextUp(s);
  const tabs = ["TODAY", "FOLLOW-UPS", "APPOINTMENTS", "PROSPECTS", "COACH", "METRICS"];
  const list = (() => {
    if (salesTab === "FOLLOW-UPS") return due.length ? due.sort((x, y) => x.f.dueAt.localeCompare(y.f.dueAt)).map(({ c, f }) => customerRow(c, `${ago(f.dueAt)} · ${f.channel} · ${f.reason}`)).join("") : `<div class="empty">Nothing due. Check who has gone quiet.</div>`;
    if (salesTab === "APPOINTMENTS") return appts.length ? appts.sort((x, y) => x.a.at.localeCompare(y.a.at)).map(({ c, a }) => customerRow(c, `${a.at.slice(11, 16)} · ${a.kind} · ${a.status}`)).join("") : `<div class="empty">No appointments today.</div>`;
    if (salesTab === "PROSPECTS") return active(s).length ? active(s).map((c) => customerRow(c, c.interests[0]?.description ?? c.source ?? "no interest recorded")).join("") : `<div class="empty">No prospects yet. Add one above.</div>`;
    if (salesTab === "COACH") return `<div class="tap-grid">${["morning-plan", "follow-up-queue", "end-of-day-recap"].map((k) => `<button data-do="coach" data-kind="${k}">${esc(k.replace(/-/gu, " "))}</button>`).join("")}</div>
${coachPanel && !coachPanel.for ? `<div class="card coach"><h2>${esc(coachPanel.output.title)}</h2><pre>${esc(coachPanel.output.lines.join("\n"))}</pre><div class="actions"><button data-do="coach-close">Close</button></div></div>` : ""}
<div class="card"><h2>Routine templates</h2><p class="meta">Nothing is scheduled until you create it.</p>${(model.salesRoutineTemplates ?? []).map((t) => `<p class="meta">${esc(t.name)} <button data-do="sales-routine" data-template="${esc(t.id)}">Create</button></p>`).join("")}</div>`;
    if (salesTab === "METRICS") return `<form data-form="metrics"><label>Day<input name="date" type="date" value="${esc(today())}"></label>
${["newLeads", "calls", "contacts", "appointmentsSet", "appointmentsShown", "sales", "followUpsCompleted"].map((k) => `<label>${esc(k.replace(/([A-Z])/gu, " $1").toLowerCase())}<input name="${k}" type="number" min="0" max="10000" value="0"></label>`).join("")}
<button>Record my day</button></form>
<div class="card"><h2>Recent days</h2><p class="meta">Your own counts, not a dealership system's numbers.</p>${(s.salesMetrics ?? []).slice(0, 14).map((m) => `<p class="meta">${esc(m.date)} · ${["calls", "contacts", "appointmentsSet", "appointmentsShown", "sales"].map((k) => `${k} ${m.counts[k]}`).join(" · ")}</p>`).join("") || `<p class="meta">Nothing recorded yet.</p>`}</div>`;
    return `${next ? `<div class="card next"><p class="meta">NEXT</p><h2>${esc(next.c.displayName)}</h2><p>${esc(next.why)}</p>
<div class="actions"><button data-do="customer-open" data-id="${esc(next.c.id)}">Open</button><button data-do="coach" data-kind="call-preparation" data-id="${esc(next.c.id)}">Call Prep</button></div></div>` : `<div class="empty">Nothing is queued. Add a prospect to begin.</div>`}
${coachPanel && !coachPanel.for ? `<div class="card coach"><h2>${esc(coachPanel.output.title)}</h2><pre>${esc(coachPanel.output.lines.join("\n"))}</pre><div class="actions"><button data-do="coach-close">Close</button></div></div>` : ""}
${overdue.length ? `<div class="card warnbox"><h2>${overdue.length} overdue callback(s)</h2>${overdue.map(({ c, f }) => customerRow(c, `${ago(f.dueAt)} · ${f.reason}`)).join("")}</div>` : ""}`;
  })();
  return `<div class="sales"><header class="sales-head"><p class="meta">AION — WORK</p><h1>${esc(label)}</h1>
<div class="today"><span><b>${appts.length}</b> appointments</span><span><b>${due.length}</b> follow-ups due</span><span class="${overdue.length ? "bad" : ""}"><b>${overdue.length}</b> callbacks overdue</span></div></header>
<div class="tap-grid quick"><button data-do="sheet" data-sheet="prospect">+ Prospect</button><button data-do="sheet" data-sheet="note">+ Note</button>
<button data-do="sheet" data-sheet="followup">Follow-up</button><button data-do="sheet" data-sheet="appointment">Appointment</button>
<button data-do="tab" data-tab="COACH">Coach</button><button data-do="tab" data-tab="METRICS">Metrics</button></div>
${sheet(s)}
<nav class="tabs">${tabs.map((t) => `<button class="${t === salesTab ? "active" : ""}" data-do="tab" data-tab="${t}">${esc(t)}</button>`).join("")}</nav>
<div class="list">${list}</div></div>`;
}

/** One inline sheet at a time, so a quick action never navigates away from the floor view. */
let openSheet = null;
/** The last honest assessment the owner asked for. Held in memory; nothing is stored. */
let assessment = null;
function sheet(s) {
  if (!openSheet) return "";
  const people = active(s);
  const picker = (name) => `<label>Person<select name="${name}" required>${people.map((c) => `<option value="${esc(c.id)}" ${c.id === openSheet.id ? "selected" : ""}>${esc(c.displayName)}</option>`).join("")}</select></label>`;
  if (openSheet.sheet === "prospect") return `<form data-form="prospect" class="quick-form"><h2>New prospect</h2>
<label>Name or alias<input name="displayName" required maxlength="200" autofocus></label>
<label>Interest<input name="interest" maxlength="2000" placeholder="what they are looking for"></label>
<label>Source<input name="source" maxlength="200" placeholder="walk-in, referral, enquiry"></label>
<label>Prefers<select name="communicationPreference"><option>phone</option><option>text</option><option>email</option><option>in-person</option><option value="unknown">unknown</option></select></label>
<p class="meta">Store only what your employer permits. AION never accepts identity, credit, banking, or financing details.</p>
<div class="actions"><button>Add</button><button data-do="sheet-close" type="button">Cancel</button></div></form>`;
  if (openSheet.sheet === "note") return `<form data-form="note" class="quick-form"><h2>Add note</h2>${picker("id")}
<label>What happened<input name="summary" required maxlength="500" autofocus></label>
<label>Kind<select name="kind"><option>note</option><option>call</option><option>text</option><option>email</option><option>visit</option></select></label>
<div class="actions"><button>Save</button><button data-do="sheet-close" type="button">Cancel</button></div></form>`;
  if (openSheet.sheet === "followup") return `<form data-form="followup" class="quick-form"><h2>New follow-up</h2>${picker("id")}
<label>When<input name="dueAt" type="datetime-local" required></label>
<label>How<select name="channel"><option>phone</option><option>text</option><option>email</option><option>in-person</option></select></label>
<label>Why<input name="reason" required maxlength="500"></label>
<div class="actions"><button>Schedule</button><button data-do="sheet-close" type="button">Cancel</button></div></form>`;
  if (openSheet.sheet === "appointment") return `<form data-form="appointment" class="quick-form"><h2>New appointment</h2>${picker("id")}
<label>When<input name="at" type="datetime-local" required></label>
<label>Kind<select name="kind"><option>appointment</option><option>callback</option><option>delivery</option></select></label>
<label>Where<input name="location" maxlength="300"></label>
<div class="actions"><button>Book</button><button data-do="sheet-close" type="button">Cancel</button></div></form>`;
  if (openSheet.sheet === "stage") return `<form data-form="stage" class="quick-form"><h2>Change stage</h2><input type="hidden" name="id" value="${esc(openSheet.id)}">
<label>Stage<select name="lifecycle">${["prospect", "contacted", "engaged", "appointment-set", "appointment-shown", "negotiating", "sold", "lost", "follow-up", "inactive"].map((x) => `<option>${x}</option>`).join("")}</select></label>
<label>Why<input name="summary" maxlength="500" value="Owner updated the relationship state."></label>
<div class="actions"><button>Update</button><button data-do="sheet-close" type="button">Cancel</button></div></form>`;
  return "";
}

// --- V1.2 areas. Same responsive shell as Sales: tap targets first, no second application. -----

/** The label of the workspace currently in view, so every area can say where it is. */
const here = (s) => s.settings.workspaceLabels?.[s.settings.activeWorkspace] ?? s.settings.activeWorkspace;

function peopleArea(s) {
  const scopedPeople = (s.relationships ?? []).filter((r) => r.workspace === s.settings.activeWorkspace && !r.archived);
  if (openCustomer) return customerDetail(s);
  return `<div class="sales"><header class="sales-head"><p class="meta">AION — ${esc(here(s)).toUpperCase()}</p><h1>People</h1>
<div class="today"><span><b>${scopedPeople.length}</b> in this workspace</span></div></header>
<p class="hint">Prospects, customers, contacts, partners, vendors, and support contacts are one kind of record with a declared type. Nothing here is visible from another workspace, and AION never stores identity, credit, banking, or financing material about anyone.</p>
<form data-form="relationship" class="quick-form"><label>Name or alias<input name="displayName" required maxlength="200"></label>
<label>Type<select name="relationshipType">${["contact", "prospect", "customer", "lead", "partner", "vendor", "support-contact", "other"].map((t) => `<option>${t}</option>`).join("")}</select></label>
<label>Organisation<input name="organisation" maxlength="200"></label>
<label>Role<input name="role" maxlength="200"></label>
<button>Add to ${esc(here(s))}</button></form>
<div class="list">${scopedPeople.length ? scopedPeople.map((r) => customerRow(r, `${r.relationshipType}${r.organisation ? ` · ${r.organisation}` : ""}${r.lastContactAt ? ` · last ${ago(r.lastContactAt)}` : ""}`)).join("") : `<div class="empty">Nobody recorded in ${esc(here(s))} yet.</div>`}</div></div>`;
}

function brainArea(s) {
  const brain = s.brain ?? { mode: "local-preferred", endpoints: [], offlineMode: false, remoteFallbackEnabled: false };
  const independence = model.independence ?? null;
  const runs = s.evaluations ?? [];
  const badge = (e) => e.location === "local-machine" ? "local" : e.location === "owner-controlled-host" ? "yours" : "third party";
  return `<h1>Brain</h1><p class="lead">AION owns what it knows. A model is a replaceable reasoning provider, and removing every one of them changes nothing in your Memory, Tasks, relationships, or anything else.</p>
${independence ? `<div class="card ${independence.independent ? "" : "warnbox"}"><h2>Independence</h2><p>${esc(independence.summary)}</p>
<p class="meta">${independence.ownerControlledEndpoints} endpoint(s) you control · ${independence.thirdPartyEndpoints} third-party · offline floor ${independence.offlineFloorPresent ? "present" : "MISSING"}</p></div>` : ""}
<form data-form="brain-settings"><label>Routing mode<select name="mode">${["local-only", "local-preferred", "manual", "maximum-capability"].map((m) => `<option value="${m}" ${m === brain.mode ? "selected" : ""}>${m.replace(/-/gu, " ")}</option>`).join("")}</select></label>
<label>Primary endpoint<select name="primaryEndpointId">${brain.endpoints.map((e) => `<option value="${esc(e.id)}" ${e.id === brain.primaryEndpointId ? "selected" : ""}>${esc(e.label)} — ${badge(e)}</option>`).join("")}</select></label>
<label><input type="checkbox" name="offlineMode" ${brain.offlineMode ? "checked" : ""}> Offline mode — no inference leaves this computer, not even to a host you control</label>
<label><input type="checkbox" name="remoteFallbackEnabled" ${brain.remoteFallbackEnabled ? "checked" : ""}> Allow AION to propose a third-party endpoint when nothing you control can do the work</label>
<p class="meta">Maximum Capability prefers the strongest endpoint. It is never consent to send private context out: a third-party endpoint still discloses what would leave and still needs your approval.</p>
<button>Save brain policy</button></form>
<div class="card"><h2>Endpoints</h2>
${brain.endpoints.map((e) => `<p class="meta"><b>${esc(e.label)}</b> — ${badge(e)} · ${esc(e.runtime)} · model ${esc(e.model)}${e.hostLabel ? ` · ${esc(e.hostLabel)}` : ""}${e.credentialEnvironmentVariable ? ` · credential from ${esc(e.credentialEnvironmentVariable)} (name only)` : ""}
<br>${e.lastHealth ? `${e.lastHealth.available ? "reachable" : "not reachable"} — ${esc(e.lastHealth.detail)}` : "not checked yet"}
<button data-do="brain-health" data-id="${esc(e.id)}">Check</button><button data-do="brain-evaluate" data-id="${esc(e.id)}">Evaluate</button>${e.id === "deterministic-offline" ? "" : `<button data-do="brain-remove" data-id="${esc(e.id)}" class="danger">Remove</button>`}</p>`).join("")}
<div class="actions"><button data-do="brain-detect">Look for a runtime on this computer</button></div>
<p class="meta">Detection checks a short list of documented loopback addresses. It installs nothing, downloads nothing, and searches no part of your computer. Adding what it finds is up to you.</p></div>
<form data-form="brain-endpoint"><h2>Add an endpoint</h2>
<label>Name<input name="label" required maxlength="80" placeholder="Home GPU"></label>
<label>Runtime<select name="runtime">${["ollama", "llama-cpp", "vllm", "openai-compatible"].map((r) => `<option>${r}</option>`).join("")}</select></label>
<label>Where it runs<select name="location"><option value="local-machine">this computer</option><option value="owner-controlled-host">a machine or rented GPU I control</option><option value="third-party-service">a third-party service</option></select></label>
<label>Address<input name="baseUrl" required maxlength="2048" placeholder="http://127.0.0.1:11434"></label>
<label>Model<input name="model" required maxlength="200"></label>
<label>Host label (your own note)<input name="hostLabel" maxlength="120"></label>
<label>Credential environment-variable NAME (never the value)<input name="credentialEnvironmentVariable" maxlength="128" placeholder="AION_GPU_TOKEN"></label>
<label>Context tokens<input name="contextTokens" type="number" min="512" max="10000000" value="8192"></label>
<label>${["reasoning", "code", "structuredJson", "toolProposal", "vision", "embeddings"].map((f) => `<label class="inline"><input type="checkbox" name="${f}"> ${f}</label>`).join(" ")}</label>
<button>Add endpoint</button></form>
${gpuCard()}
${runs.length ? `<div class="card"><h2>Evaluation evidence</h2><p class="meta">Deterministic synthetic fixtures. This measures the cases in this repository on the day it ran, not the model in general.</p>
${runs.slice(0, 10).map((r) => `<p class="meta"><b>${esc(r.endpointLabel)}</b> — ${r.passed}/${r.total} · median ${r.medianLatencyMs} ms${r.isFloor ? " · the floor" : ""}<br>${esc(r.summary)}</p>`).join("")}</div>` : ""}`;
}

/**
 * Rented GPU capacity: what it costs, what is running, and how to stop it.
 *
 * Shown on the phone as well as the console, because a session left running is a problem wherever
 * the owner happens to be. Credentials are never displayed — only the name of the variable.
 */
/** Every state in which the meter may be running. All of them show a stop button. */
const LIVE_GPU_STATES = ["provisioning", "booting-runtime", "waiting-for-endpoint", "health-checking", "ready", "in-use", "stopping"];
const ACTIVATING_GPU_STATES = ["provisioning", "booting-runtime", "waiting-for-endpoint", "health-checking"];

function gpuCard() {
  const gpu = model.gpu;
  if (!gpu) return "";
  const live = (gpu.sessions ?? []).filter((x) => LIVE_GPU_STATES.includes(x.state));
  const recentFailure = (gpu.sessions ?? []).find((x) => x.state === "activation-failed" || (x.state === "failed" && !x.teardownConfirmed));
  const pending = (gpu.proposals ?? []).filter((x) => x.state === "pending");
  const cost = gpu.cost ?? null;
  return `<div class="card ${live.length ? "warnbox" : ""}"><h2>Rented GPU</h2>
<p class="meta">${esc(gpu.credential.detail)}</p>
${live.length ? live.map((x) => `<p class="warn"><b>${esc((x.label ?? x.state).toUpperCase())}</b> — ${esc(x.standing)}
${ACTIVATING_GPU_STATES.includes(x.state) ? `<br><span class="meta">It is billing while it loads and is not usable yet. ${esc(x.readiness?.reason ?? "")}</span>` : ""}
${x.endpointId ? `<br><span class="meta">Routable as an endpoint you control${x.endpointHost ? ` at ${esc(x.endpointHost)}` : ""}. <button data-do="brain-evaluate" data-id="${esc(x.endpointId)}">Evaluate this model</button></span>` : ""}
${x.cost ? `<br><span class="meta">About ${x.cost.totalCents} cent(s) so far: ${x.cost.provisioningMinutes} provisioning, ${x.cost.readinessMinutes} loading, ${x.cost.servingMinutes} serving.</span>` : ""}
<br><button data-do="gpu-stop" data-id="${esc(x.id)}" class="danger">Stop now</button>
${ACTIVATING_GPU_STATES.includes(x.state) ? `<button data-do="gpu-poll" data-id="${esc(x.id)}">Check readiness</button>` : ""}</p>`).join("") : `<p class="meta">Nothing is rented right now.</p>`}
${recentFailure ? `<p class="warn"><b>FAILED</b> — ${esc(recentFailure.standing)}</p>` : ""}
${pending.map((x) => `<p class="meta"><b>Awaiting your decision</b> — ${esc(x.disclosure)}
<button data-do="gpu-decide" data-id="${esc(x.id)}" data-value="true">Approve exactly this</button>
<button data-do="gpu-decide" data-id="${esc(x.id)}" data-value="false" class="danger">Deny</button></p>`).join("")}
${cost ? `<p class="meta">${esc(cost.summary)}</p><p class="meta"><b>Rent or buy:</b> ${esc(cost.verdict.detail)}</p>` : ""}
<div class="actions">${gpu.credential.configured ? `<button data-do="gpu-discover">Look at capacity and prices</button>` : ""}</div>
<p class="meta">AION never rents anything without a bounded proposal you approve, and every session carries a stored deadline so a forgotten instance stops on its own. A machine only becomes an endpoint after it answers a real request — an open port is not a loaded model. No endpoint credential is ever shown here.</p></div>`;
}

function studioArea(s) {
  const list = (s.opportunities ?? []).filter((o) => o.workspace === s.settings.activeWorkspace && !o.archived);
  return `<h1>Product Studio</h1><p class="lead">An idea is not a product and a hunch is not a market. AION scores an opportunity on what is actually established about it, and never invents market evidence — it has no way to know what customers want.</p>
<form data-form="opportunity"><label>Title<input name="title" required maxlength="200"></label>
<label>Problem<textarea name="problem" maxlength="4000"></textarea></label>
<label>Target customer<input name="targetCustomer" maxlength="2000"></label>
<label>Problem severity 0-10<input name="problemSeverity" type="number" min="0" max="10" value="5"></label>
<label>Reachability 0-10<input name="reachability" type="number" min="0" max="10" value="5"></label>
<label>Your advantage 0-10<input name="ownerAdvantage" type="number" min="0" max="10" value="5"></label>
<label>Effort 0-10<input name="effort" type="number" min="0" max="10" value="5"></label>
<button>Open opportunity in ${esc(here(s))}</button></form>
${cards(list, (o) => `<article class="card"><h2>${esc(o.title)}</h2><p>${esc(o.problem)}</p>
<p class="meta">${esc(o.stage)} · ${o.claims.length} claim(s) · ${o.experiments.length} experiment(s) · ${o.competitors.length} competitor note(s)</p>
${o.claims.length ? `<details><summary>Claims</summary>${o.claims.map((c) => `<p class="meta"><b>${esc(c.class)}</b> ${esc(c.statement)}${c.supersededBy ? " · superseded" : ""}${c.promotions.length ? ` · was ${esc(c.promotions[0].from)}` : ""}</p>`).join("")}</details>` : ""}
<form data-form="claim"><input type="hidden" name="id" value="${esc(o.id)}">
<label>Record a claim<input name="statement" required maxlength="4000"></label>
<label>What kind<select name="class">${["assumption", "hypothesis", "observation", "inference", "fact"].map((c) => `<option>${c}</option>`).join("")}</select></label>
<label>What it rests on (comma separated; required for observation, inference)<input name="supportedBy" maxlength="2000"></label>
<button>Record</button></form>
${o.taskIds.length || o.planIds.length ? `<div class="card"><h2>Linked work</h2>
${o.taskIds.map((id) => { const t = scoped(s.tasks).find((x) => x.id === id); return `<p class="meta">task · ${t ? `${esc(t.title)} — ${esc(t.state)}` : "a task that no longer exists"} <button data-do="unlink" data-id="${esc(o.id)}" data-kind="task" data-ref="${esc(id)}">Unlink</button></p>`; }).join("")}
${o.planIds.map((id) => { const p = scoped(s.plans).find((x) => x.id === id); return `<p class="meta">plan · ${p ? `${esc(p.goal)} — ${esc(p.status)}` : "a plan that no longer exists"} <button data-do="unlink" data-id="${esc(o.id)}" data-kind="plan" data-ref="${esc(id)}">Unlink</button></p>`; }).join("")}
<p class="meta">Unlinking removes the reference only. The task or plan keeps its own history.</p></div>` : ""}
${scoped(s.tasks).some((t) => !o.taskIds.includes(t.id)) || scoped(s.plans).some((p) => !o.planIds.includes(p.id)) ? `<form data-form="opportunity-link"><input type="hidden" name="id" value="${esc(o.id)}">
<label>Link work from ${esc(here(s))}<select name="ref">
${scoped(s.tasks).filter((t) => !o.taskIds.includes(t.id)).map((t) => `<option value="task:${esc(t.id)}">task · ${esc(t.title)} (${esc(t.state)})</option>`).join("")}
${scoped(s.plans).filter((p) => !o.planIds.includes(p.id)).map((p) => `<option value="plan:${esc(p.id)}">plan · ${esc(p.goal)}</option>`).join("")}
</select></label><button>Link</button></form>` : ""}
<div class="actions"><button data-do="assess" data-id="${esc(o.id)}">Assess honestly</button></div>
${assessment && assessment.id === o.id ? `<div class="card coach"><h2>Score ${assessment.data.score.total}/100</h2><p>${esc(assessment.data.score.explanation)}</p>
<p class="meta">${esc(assessment.data.linkedWork.summary)}</p>
<p class="warn">${esc(assessment.data.caution)}</p>
${assessment.data.openQuestions.length ? `<p class="meta">Still open: ${assessment.data.openQuestions.map((q) => esc(q)).join(" · ")}</p>` : ""}
<div class="actions"><button data-do="assess-close">Close</button></div></div>` : ""}</article>`, "No opportunities yet. Open one above; it will score zero until something is established about it.")}`;
}

function researchArea(s) {
  const jobs = (s.researchJobs ?? []).filter((j) => j.workspace === s.settings.activeWorkspace);
  return `<h1>Research</h1><p class="lead">Research is a job, not a background capability: a written question, a declared scope, hard limits, your approval, and a record of exactly what was consulted. Proposing runs nothing.</p>
<p class="hint">AION ships with no research provider at all, so it cannot reach the internet until you configure one you control. Every finding must cite a source AION actually retrieved, and no finding is ever a fact.</p>
<form data-form="research"><label>Question<input name="question" required maxlength="2000"></label>
<label>Scope<select name="scope"><option value="local-only">local only — nothing leaves this computer</option><option value="owner-supplied-sources">only the sources I supply</option><option value="public-web">the public web</option></select></label>
<label>Sources I supply (one per line)<textarea name="seedReferences" maxlength="8000"></textarea></label>
<label>At most this many sources<input name="maxSources" type="number" min="0" max="50" value="8"></label>
<label>At most this many cents<input name="maxCostCents" type="number" min="0" max="10000" value="0"></label>
<button>Propose research job</button></form>
<form data-form="url-check"><label>Check whether AION would fetch a URL<input name="url" maxlength="2048" placeholder="a public https address"></label><button>Check</button></form>
${cards(jobs, (j) => `<article class="card"><h2>${esc(j.question)}</h2>
<p class="meta">${esc(j.state)} · ${esc(j.scope)} · ${j.sources.length} source(s) · ${j.findings.length} finding(s) · ${j.costCents} cent(s)${j.outputDigest ? ` · digest ${esc(short(j.outputDigest))}` : ""}</p>
${j.findings.map((f) => `<p class="meta"><b>${esc(f.class)}</b> ${esc(f.statement)}${f.caveat ? ` — ${esc(f.caveat)}` : ""}</p>`).join("")}
${j.unresolved.length ? `<p class="warn">${j.unresolved.map((u) => esc(u)).join(" ")}</p>` : ""}
<div class="actions">${j.state === "proposed" ? `<button data-do="research-approve" data-id="${esc(j.id)}">Approve</button>` : ""}${j.state === "approved" ? `<button data-do="research-run" data-id="${esc(j.id)}">Run</button>` : ""}</div></article>`, "No research jobs yet.")}`;
}

function projectsArea(s) {
  // Projects come from the API with their honest standing line already computed.
  const list = model.projects ?? (s.projects ?? []).filter((p) => p.workspace === s.settings.activeWorkspace);
  return `<h1>Projects</h1><p class="lead">From an idea to something you can look at. Stages are not skipped, a review needs evidence behind it, and an implementation stage needs your approval naming that stage — no agent raises its own authority.</p>
<p class="hint">AION cannot deploy. Putting something where other people can reach it is irreversible, and this build ships no capability that does it.</p>
<form data-form="project"><label>Title<input name="title" required maxlength="200"></label><label>Summary<textarea name="summary" maxlength="4000"></textarea></label><button>Open project in ${esc(here(s))}</button></form>
${cards(list, (p) => `<article class="card"><h2>${esc(p.title)}</h2><p class="meta">${esc(p.standing ?? p.stage)}</p>
${p.runs.length ? `<details><summary>Pipeline runs</summary>${p.runs.map((r) => `<p class="meta">${esc(r.step)} · ${esc(r.outcome)}${r.previewUrl ? ` · ${esc(r.previewUrl)}` : ""}</p>`).join("")}</details>` : ""}
${p.proposals.length ? `<details><summary>Agent proposals</summary>${p.proposals.map((x) => `<p class="meta">${esc(x.bridgeId)} · ${esc(x.mode)} · ${esc(x.summary)}</p>`).join("")}</details>` : ""}
<form data-form="project-advance"><input type="hidden" name="id" value="${esc(p.id)}">
<label>Move to<select name="stage">${["specification", "plan", "tasks", "implementation", "verification", "review", "preview", "owner-approved", "abandoned"].map((x) => `<option>${x}</option>`).join("")}</select></label>
<label>Why<input name="reason" required maxlength="1000"></label><button>Advance</button></form>
<div class="actions"><button data-do="project-approve" data-id="${esc(p.id)}" data-stage="implementation">Approve implementation</button>
${["install", "build", "test", "preview"].map((step) => `<button data-do="project-step" data-id="${esc(p.id)}" data-step="${step}">${step}</button>`).join("")}</div></article>`, "No projects yet.")}`;
}

function learningArea(s) {
  const lessons = model.lessons ?? [];
  const summary = model.learningSummary ?? null;
  return `<h1>Learning</h1><p class="lead">AION learns in records outside any model. Replace the model and none of this is lost, because none of it was ever inside the model.</p>
${summary ? `<div class="card"><h2>What AION has learned</h2><p>${esc(summary.summary)}</p></div>` : ""}
<p class="hint">AION does not fine-tune anything and does not train on your data. A lesson a model proposed stays a hypothesis until you promote it.</p>
<form data-form="lesson"><label>What you learned<input name="statement" required maxlength="4000"></label>
<label>What to do differently<textarea name="guidance" maxlength="4000"></textarea></label>
<label>What it rests on (comma separated)<input name="supportedBy" maxlength="2000"></label>
<button>Record lesson in ${esc(here(s))}</button></form>
${cards(lessons, (l) => `<article class="card"><h2>${esc(l.claim.class)}</h2><p>${esc(l.claim.statement)}</p>
${l.guidance ? `<p class="meta">${esc(l.guidance)}</p>` : ""}
<p class="meta">${esc(l.standing.summary)}</p>
<div class="actions"><button data-do="lesson-outcome" data-id="${esc(l.id)}" data-result="worked">It worked</button>
<button data-do="lesson-outcome" data-id="${esc(l.id)}" data-result="did-not-work">It did not</button>
<button data-do="lesson-disable" data-id="${esc(l.id)}" class="danger">Turn off</button></div></article>`, "Nothing learned yet. AION will not pretend otherwise.")}`;
}

function approvalsArea(s) {
  const capabilities = model.capabilities ?? [];
  return `<h1>Approvals</h1><p class="lead">One decision authorises one exact capability and one exact input digest. A changed input needs a new approval, and the model can never approve its own proposal.</p>
<div class="card"><h2>Capability registry</h2><p class="meta">Only these capabilities are callable. Nothing else is reachable, and no capability accepts shell text.</p>
<ul>${capabilities.map((c) => `<li><code>${esc(c.id)}</code> — ${esc(c.privacy)} · approval ${esc(c.approval)} · timeout ${c.timeoutMs} ms · ${c.maxRetries} retries</li>`).join("")}</ul></div>
<form data-form="action"><label>Propose a bounded local echo<input name="text" required maxlength="1000"></label><button>Propose action</button></form>
<form data-form="developer-task"><label>Propose a bounded developer-agent task<textarea name="instruction" maxlength="4000"></textarea></label>
<label>Task boundary<select name="mode"><option value="read-only">read-only — the agent may read this repository but not change it</option><option value="workspace-write">workspace-write — the agent may modify files inside this repository</option></select></label>
<p class="meta">Selected bridge: ${esc(model.developerBridge.displayName)} — ${esc(model.developerBridge.detail)}${model.developerBridge.available ? "" : " Proposals will be rejected at execution."}</p>
<p class="meta">The boundary you choose is part of the approval digest, so a read-only approval can never be spent on a writing run. Your instruction is sent to the agent on its standard input and is never treated as a command.</p><button>Propose developer task</button></form>
<h2>Pending and decided approvals</h2>
${cards(s.approvals, (a) => `<article class="card"><h2>${esc(a.capabilityId)}</h2><p>${esc(a.summary)}</p>
<p class="meta">${esc(a.state)} · digest ${esc(short(a.inputDigest))} · requested ${esc(a.requestedAt)} · expires ${esc(a.expiresAt)}${a.decidedAt ? ` · decided ${esc(a.decidedAt)}` : ""}</p>
${a.state === "pending" ? `<div class="actions"><button data-do="approve" data-id="${esc(a.id)}" data-value="true">Approve once</button><button data-do="approve" data-id="${esc(a.id)}" data-value="false" class="danger">Deny</button></div>` : ""}
${a.state === "approved" ? `<div class="actions"><button data-do="execute" data-id="${esc(a.actionId)}">Execute approved action</button></div>` : ""}</article>`, "No approvals requested yet.")}
<h2>Agent actions</h2>
${cards(s.actions, (a) => `<article class="card"><h2>${esc(a.capabilityId)}</h2>
<p class="meta">${esc(a.state)} · ${esc(a.origin)} proposal · ${esc(a.privacy)} · digest ${esc(short(a.inputDigest))} · ${a.retryCount}/${a.maxRetries} retries</p>
${a.result ? `<p>Result: ${esc(JSON.stringify(a.result).slice(0, 2000))}</p>` : ""}${a.error ? `<p class="warn">${esc(a.error)}</p>` : ""}
${a.state === "running" ? `<div class="actions"><button data-do="action-cancel" data-id="${esc(a.id)}" class="danger">Cancel</button></div>` : ""}</article>`, "No actions proposed yet.")}`;
}

function activityArea(s) {
  return `<h1>Activity</h1><p class="lead">Privacy-safe local audit history. Secrets, credentials, and imported document bodies are never recorded.</p>
<p class="hint">Retaining ${s.settings.privacy.retainActivityDays} days of history. Older entries are removed on the next write.</p>
${cards(scoped(s.activity).slice(0, 300), (a) => `<article class="card"><h2>${esc(a.action)}</h2><p>${esc(a.summary)}</p><p class="meta">${esc(a.category)} · ${esc(a.outcome)} · ${esc(a.at)}${a.subjectRef ? ` · ${esc(short(a.subjectRef, 12))}` : ""}</p></article>`, "No activity recorded yet.")}`;
}

function careerArea() {
  return `<h1>Career</h1><p class="lead">The accepted Career engine remains the single source of truth. AION runs its commands with explicit paths; it never discovers, browses, submits, or emails anything.</p>
<div class="card"><h2>Run a Career command</h2>
<form data-form="career"><label>Command<select name="command"><option value="init">init — create the private workspace and blank templates</option><option value="ingest">ingest — import one evidence file</option><option value="profile">profile — build the CareerProfile</option><option value="job:import">job:import — import one Job Posting you supply</option><option value="match">match — transparent scoring against a posting</option><option value="draft">draft — prepare owner-review materials</option><option value="export">export — write a local export bundle</option><option value="demo">demo — neutral synthetic walkthrough</option></select></label>
<label>Workflow root (absolute, not needed for demo)<input name="root" maxlength="4096"></label>
<label>Value — evidence file, posting file, Job Posting id, Match id, or export path<input name="value" maxlength="4096"></label>
<p class="hint">Run <code>init</code> first. Evidence files and Job Postings must then be placed inside <code>&lt;workflow root&gt;\private\input\</code> — the Career engine refuses any file outside that approved input root, and <code>init</code> writes blank templates there for you to fill in.</p>
<label>Source type (ingest only)<input name="sourceType" maxlength="64" placeholder="optional"></label>
<label><input type="checkbox" name="dryRun" checked> Dry run first (no writes)</label><button>Run command</button></form>
<p class="meta">Review CareerFacts, provenance, conflicts, and transparent match scoring in the command output below. Every prepared document is marked draft and requires your review. Application submission does not exist in AION.</p></div>
<div class="card"><h2>Output</h2><pre id="careerOutput">Run a command to see its output. Local paths are removed before display.</pre></div>`;
}

function knowledgeArea(s) {
  const docs = (s.crmDocuments ?? []).filter((d) => d.workspace === s.settings.activeWorkspace).slice(0, 40);
  const people = (s.relationships ?? []).filter((r) => r.workspace === s.settings.activeWorkspace && !r.archived);
  const brands = (s.workspaces ?? []).filter((w) => w.kind === "business" && !w.archived);
  const ok = s.ownerKnowledge ?? { profile: { displayName: "", summary: "" }, facts: [] };
  const facts = (ok.facts ?? []).filter((f) => f.enabled !== false).slice(0, 40);
  const collabs = s.brandCollaborators ?? [];
  const cats = ["profile","employment","skill","experience","project","preference","goal","product-service","sales-experience","writing","business-role","process","other"];
  return `<h1>Knowledge / Import</h1>
<p class="lead">Owner profile, brand registry, and real file intake. Originals are preserved under private intake. AION never scans your drives automatically and never invents collaborator roles.</p>
<div class="card"><h2>Owner profile</h2>
<form data-form="owner-profile">
<label>Display name<input name="displayName" maxlength="200" value="${esc(ok.profile?.displayName || "")}"></label>
<label>Short bio / summary<textarea name="summary" maxlength="8000">${esc(ok.profile?.summary || "")}</textarea></label>
<button>Save profile</button>
</form>
<form data-form="owner-fact">
<label>Category<select name="category">${cats.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></label>
<label>Title<input name="title" required maxlength="200" placeholder="e.g. Current role, Skill: negotiation"></label>
<label>Fact<textarea name="content" required maxlength="20000" placeholder="Owner-supplied fact only"></textarea></label>
<label>Confidence 0–100<input name="confidence" type="number" min="0" max="100" value="90"></label>
<button>Add knowledge fact</button>
</form>
${facts.length ? facts.map((f) => `<p class="meta"><b>${esc(f.category)}</b> · ${esc(f.title)} (${f.confidence}%) — ${esc(f.content.slice(0, 180))}${f.content.length > 180 ? "…" : ""}</p>`).join("") : `<p class="meta">No structured owner facts yet.</p>`}
</div>
<div class="card"><h2>Upload file</h2>
<form data-form="document-upload" id="docUploadForm">
<label>File or camera photo<input type="file" name="file" required accept=".txt,.csv,.json,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.log,text/*,image/*" capture="environment"></label>
<label>Associate with customer/contact (optional)
<select name="relationshipId"><option value="">— none yet —</option>
${people.map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}${p.organisation ? ` (${esc(p.organisation)})` : ""}</option>`).join("")}
</select></label>
<label>Tags (comma separated)<input name="tags" maxlength="500" placeholder="quote, resume, brand-doc"></label>
<label>Summary (optional)<input name="summary" maxlength="2000" placeholder="Short note about this file"></label>
<button>Upload into AION</button>
</form>
<form data-form="folder-import">
<label>Import folder (absolute path under approved import root or private AION data)
<input name="path" required maxlength="4096" placeholder="C:\path\to\owner-selected-folder"></label>
<label>Tags (comma separated)<input name="tags" maxlength="500" placeholder="resume, brand-doc"></label>
<button>Import folder (recursive, bounded)</button>
</form>
<form data-form="csv-contacts">
<label>Import contacts CSV (paste or upload later via file)
<textarea name="csvText" required maxlength="500000" placeholder="name,email,company&#10;Jane,jane@acme.test,Acme"></textarea></label>
<label>Source label<input name="sourceLabel" maxlength="200" value="owner-csv"></label>
<button>Import contacts from CSV</button>
</form>
<form data-form="import-queue">
<label>Queue import source path (Owner-selected once; AION processes on demand)
<input name="path" required maxlength="4096" placeholder="C:\path\selected-by-owner"></label>
<label>Kind<select name="kind"><option>folder</option><option>file</option><option>csv</option><option>json</option><option>document-batch</option></select></label>
<label>Associate<select name="associateWith"><option value="none">none</option><option>owner</option><option>business</option><option>brand</option><option>customer</option></select></label>
<button>Add to import queue</button>
</form>
${(s.importSourceQueue ?? []).length ? `<div class="actions"><button data-do="import-queue-process" type="button">Process next queued source</button></div>
<p class="meta">Sources: ${(s.importSourceQueue ?? []).slice(0, 8).map((q) => `${esc(q.label)} [${esc(q.status)}] +${q.itemsImported || 0}`).join("; ")}</p>` : ""}
<div class="card"><h2>Import dashboard</h2>
<div class="actions"><button data-do="import-dashboard-refresh" type="button">Refresh import status</button></div>
${importDashboardHtml(s)}
</div>
<p class="meta">Supported: TXT, CSV, JSON, MD, PNG/JPG/WEBP, PDF/DOCX (best-effort text). Recursive under Owner-approved roots only — content-hash dedupe, resume, per-file error continuation. Max ~6 MB/file, depth/count caps. Never scans whole drives.</p>
</div>
<div class="card"><h2>Business / brand workspaces</h2>
<form data-form="workspace-brand">
<label>Brand / business name<input name="label" required maxlength="80" placeholder="e.g. Northline Media"></label>
<label>Positioning<textarea name="positioning" maxlength="2000" placeholder="Owner-supplied only — never invented"></textarea></label>
<label>Target audience<textarea name="audience" maxlength="2000"></textarea></label>
<label>Channels (comma separated)<input name="channels" maxlength="500" placeholder="instagram, linkedin, website"></label>
<button>Create brand workspace</button>
</form>
${brands.length ? brands.map((w) => `<p class="meta"><b>${esc(w.brand?.name || w.label)}</b> — ${esc(w.purpose || "business")}${w.brand?.channels?.length ? ` · ${esc(w.brand.channels.join(", "))}` : ""}</p>`).join("") : `<p class="meta">No brand workspaces yet. Create one only with facts you supply.</p>`}
<form data-form="brand-collaborator">
<label>Collaborator name<input name="name" required maxlength="200" placeholder="Only names you supply"></label>
<label>Role<input name="role" maxlength="200" placeholder="e.g. social manager — only if known"></label>
<label>Brand workspace
<select name="brandWorkspaceId"><option value="">— none —</option>
${brands.map((w) => `<option value="${esc(w.id)}">${esc(w.brand?.name || w.label)}</option>`).join("")}
</select></label>
<label>Brand responsibility (owner-supplied only)<input name="brandResponsibility" maxlength="2000"></label>
<label>Notes<textarea name="notes" maxlength="10000"></textarea></label>
<button>Add collaborator</button>
</form>
${collabs.length ? collabs.map((c) => `<p class="meta"><b>${esc(c.name)}</b>${c.role ? ` · ${esc(c.role)}` : ""}${c.brandResponsibility ? ` — ${esc(c.brandResponsibility)}` : ""}</p>`).join("") : `<p class="meta">No collaborators recorded. AION will not invent who manages a brand.</p>`}
</div>
<div class="card"><h2>Recent documents (${docs.length})</h2>
${docs.length ? docs.map((d) => `<article class="card"><h3>${esc(d.filename)}</h3>
<p class="meta">${esc(d.kind)} · ${esc(d.mimeType)} · ${d.byteLength} bytes · ${esc(d.createdAt)}${d.tags?.length ? ` · tags: ${esc(d.tags.join(", "))}` : ""}</p>
<p>${esc(d.summary || "(no summary)")}</p>
${d.extractedText ? `<details><summary>Extracted text</summary><pre class="meta">${esc(d.extractedText.slice(0, 2000))}</pre></details>` : ""}
<p class="meta">Stored: <code>${esc(d.storedPath)}</code>${d.relationshipId ? ` · CRM link ${esc(d.relationshipId.slice(0, 8))}…` : " · unassociated"}</p>
</article>`).join("") : `<p class="empty">No documents yet. Upload a file above.</p>`}
</div>
<div class="card"><h2>Phone intake</h2>
<p class="meta">On the same private network (after enabling Private phone access in Settings), open <code>/phone</code> on your phone, pair once, then take a photo and upload. Originals land under private intake with tags including <code>phone-intake</code>.</p>
</div>
<div class="card"><h2>Conversation archive import</h2>
<p class="meta">Legacy chat archive import remains on the Imports screen (dry-run first, explicit path only).</p>
<button data-area="Imports" type="button">Open Imports</button>
</div>`;
}

function importsArea(s) {
  return `<h1>Import Center</h1><p class="lead">Explicit path, exact SHA-256 digests, duplicate detection, and preserved provenance. A dry run always comes first, originals are never modified, and AION never scans your drives. For CRM/file intake use <b>Knowledge</b>.</p>
<form data-form="import"><label>Platform<select name="platform"><option>chatgpt</option><option>claude</option><option>grok</option><option>career</option></select></label>
<label>Approved root (absolute)<input name="root" required maxlength="4096"></label><label>Selected file or folder inside that root<input name="path" required maxlength="4096"></label><button>Dry run</button></form>
${cards(s.imports, (r) => `<article class="card"><h2>${esc(r.platform)} · ${esc(r.state)}</h2>
<p>${r.items.length} file(s) · ${r.items.filter((x) => x.duplicate).length} duplicate(s) · ${r.items.reduce((n, x) => n + x.conversationCount, 0)} conversation(s) · ${r.importedConversationIds.length} imported</p>
<p class="meta">${esc(r.selectedRootRef)} · ${esc(r.createdAt)} · source files unchanged</p>
${r.warnings.length ? `<p class="warn">${esc(r.warnings.join(" "))}</p>` : ""}
<details><summary>Inventory</summary>${r.items.map((i) => `<p class="meta">${esc(i.relativePath)} — ${esc(i.classification)} · ${i.bytes} bytes · ${i.conversationCount} conversation(s)${i.duplicate ? " · duplicate" : ""}${i.digest ? ` · ${esc(short(i.digest))}` : ""}</p>`).join("")}</details>
${r.state === "dry-run" ? `<form data-form="import-execute"><input type="hidden" name="id" value="${esc(r.id)}"><label>Confirm the same root<input name="root" required maxlength="4096"></label><label>Confirm the same selection<input name="path" required maxlength="4096"></label><button>Import conversations</button></form>
<div class="actions"><button data-do="import-cancel" data-id="${esc(r.id)}" class="danger">Cancel this dry run</button></div>` : ""}</article>`, "No imports yet. Start with a dry run above.")}`;
}

/** Console-only. A paired phone can drive AION but never changes how access itself works. */
function privateAccessCard() {
  const r = model.remoteAccess ?? { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30, privateNetwork: { available: false, detail: "" }, summary: "" };
  const devices = model.devices ?? [];
  const suggested = r.lanDiscovery?.suggestedBind || r.lanDiscovery?.preferred?.address || "";
  const phoneUrl = r.phoneUrl || (suggested && r.port ? `http://${suggested}:${r.port}/phone` : "");
  return `<div class="card"><h2>Private phone access</h2>
<p>${esc(r.summary)}</p>
<p class="meta">AION binds <code>${esc(r.boundAddress ?? "127.0.0.1")}</code>. It never opens a public port, never creates a tunnel, and never changes your router. Reaching AION over a private network is not enough on its own: a device must also be paired.</p>
${phoneUrl ? `<p class="meta"><b>Phone URL (current LAN):</b> <a href="${esc(phoneUrl)}"><code>${esc(phoneUrl)}</code></a></p>
<p class="meta">On your phone (same Wi-Fi), open that URL, enter the pairing code from below, then upload.</p>` : `<p class="meta">No phone URL yet — enable private access and ensure a private LAN IPv4 is active.</p>`}
<p class="meta">Live LAN discovery: ${suggested ? `<code>${esc(suggested)}</code> (${esc(r.lanDiscovery?.preferred?.interfaceName || "")} · ${esc(r.lanDiscovery?.preferred?.reason || "")})` : "no usable private IPv4 on active interfaces"}</p>
${(r.lanDiscovery?.candidates || []).length ? `<details><summary>All private candidates</summary>${r.lanDiscovery.candidates.map((c) => `<p class="meta"><code>${esc(c.address)}</code> · ${esc(c.interfaceName)} · score ${c.score} · ${esc(c.reason)}</p>`).join("")}</details>` : ""}
<p class="meta">Private network tool: ${r.privateNetwork.available ? `${esc(r.privateNetwork.tool)} ${esc(r.privateNetwork.version ?? "")} detected` : "not configured"} — ${esc(r.privateNetwork.detail)}</p>
<form data-form="remote-access">
<label><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}> Allow paired devices to reach AION</label>
<label>Bind address (loopback or a private range only; leave loopback to auto-discover LAN)
<input name="bindAddress" value="${esc(r.bindAddress)}" maxlength="60" placeholder="${esc(suggested || "127.0.0.1")}"></label>
<label>Sign a device out after (days)<input name="sessionDays" type="number" min="1" max="365" value="${r.sessionDays}"></label>
<button>Save access settings</button></form>
<div class="actions"><button data-do="lan-discover" type="button">Refresh LAN discovery</button>
${suggested ? `<button data-do="lan-use-suggested" data-ip="${esc(suggested)}" type="button">Use discovered ${esc(suggested)}</button>` : ""}</div>
${r.enabled ? `<form data-form="pair-code"><label>Pair a new device — name it so you can tell phones apart<input name="label" required maxlength="80" placeholder="Work phone"></label><button>Create pairing code</button></form>` : `<p class="meta">Turn access on to pair a device.</p>`}
${pairingCode ? `<div class="card next"><h2>Pairing code</h2><p style="font-size:1.6rem;letter-spacing:.12em"><code>${esc(pairingCode.code)}</code></p>
<p class="meta">Type it on the phone within ten minutes. It works once, and AION does not store it — if you lose it, make another.</p>
<div class="actions"><button data-do="pair-code-clear">Done</button></div></div>` : ""}
<h2>Paired devices</h2>
${devices.length ? devices.map((device) => `<p class="meta"><b>${esc(device.label)}</b> — ${device.revokedAt ? "revoked" : `${device.activeSessions} active session(s)`}${device.lastSeenAt ? ` · last seen ${esc(device.lastSeenAt)}` : ""}${device.expiresAt ? ` · expires ${esc(device.expiresAt)}` : ""}
${device.revokedAt ? "" : `<button data-do="device-revoke" data-id="${esc(device.id)}" class="danger">Revoke</button>`}</p>`).join("") : `<p class="meta">No device is paired.</p>`}
${devices.some((device) => !device.revokedAt) ? `<div class="actions"><button data-do="device-revoke-all" class="danger">Sign out all devices</button></div>` : ""}
<p class="meta">Revoking a device ends its access only. No conversation, memory, task, relationship, or Career record is changed.</p></div>`;
}

function importDashboardHtml(s) {
  const dash = s._importDashboard;
  if (!dash) {
    return `<p class="meta">Open refresh to load live counts: Queued / Processing / Completed / Needs Review / Failed, plus files discovered, processed, duplicates, facts, entities, review items, errors.</p>`;
  }
  const t = dash.totals || {};
  const st = dash.byStatus || {};
  const reviews = dash.reviewItems || [];
  return `<p class="meta"><b>Status:</b> Queued ${st.queued || 0} · Processing ${st.processing || 0} · Completed ${st.completed || 0} · Needs Review ${st["needs-review"] || 0} · Failed ${st.failed || 0}</p>
<p class="meta"><b>Counts:</b> discovered ${t.filesDiscovered || 0} · processed ${t.filesProcessed || 0} · duplicates skipped ${t.duplicatesSkipped || 0} · facts ${t.factsExtracted || 0} · entities ${t.entitiesAssociated || 0} · review ${dash.reviewOpen || 0} · errors ${t.errors || 0} · documents ${dash.documents || 0}</p>
${(dash.sources || []).slice(0, 12).map((q) => {
    const qs = q.stats || {};
    return `<article class="card"><h3>${esc(q.label)} · <span class="meta">${esc(q.status)}</span></h3>
<p class="meta">${esc(q.path)}</p>
<p class="meta">+${q.itemsImported || 0} imported · ${q.itemsSkipped || 0} skipped · disc ${qs.filesDiscovered || 0} · dup ${qs.duplicatesSkipped || 0} · review ${qs.reviewItems || 0} · err ${qs.errors || 0}</p>
${q.lastError ? `<p class="warn">${esc(q.lastError)}</p>` : ""}
</article>`;
  }).join("")}
${reviews.length ? `<h3>Needs review (${reviews.length})</h3>${reviews.map((r) => `<p class="meta"><b>${esc(r.relativePath)}</b> — ${esc(r.reason)}
<button data-do="import-review-accept" data-id="${esc(r.id)}">Accept</button>
<button data-do="import-review-reject" data-id="${esc(r.id)}" class="danger">Reject</button>
</p>`).join("")}` : `<p class="meta">No open review items.</p>`}`;
}

function settingsArea(s) {
  const p = model.providers ?? [];
  const bridges = model.developerBridges ?? [];
  return `<h1>Settings</h1><p class="lead">Local privacy, provider, and data controls. AION stores the <em>name</em> of a credential environment variable, never its value.</p>
<form data-form="settings">
<label>Provider<select name="providerId">${p.map((x) => `<option value="${esc(x.id)}" ${x.id === s.settings.providerId ? "selected" : ""}>${esc(x.id)} — ${esc(x.location)}${x.available ? ", ready" : ", unavailable"}</option>`).join("")}</select></label>
<label>Model identifier<input name="model" value="${esc(s.settings.model)}" maxlength="200"></label>
<label><input type="checkbox" name="remoteDisclosureAccepted" ${s.settings.remoteDisclosureAccepted ? "checked" : ""}> I accept that a remote provider receives the conversation and any context I enable</label>
<label><input type="checkbox" name="memoryContextEnabled" ${s.settings.memoryContextEnabled ? "checked" : ""}> Memory context enabled for new conversations</label>
<label><input type="checkbox" name="includeMemoryByDefault" ${s.settings.privacy.includeMemoryByDefault ? "checked" : ""}> Include memory by default</label>
<label><input type="checkbox" name="schedulerEnabled" ${s.settings.schedulerEnabled ? "checked" : ""}> Routine scheduler enabled while AION is open</label>
<label><input type="checkbox" name="externalActionsRequireApproval" ${s.settings.externalActionsRequireApproval ? "checked" : ""}> Require an approval for every proposed action (capabilities marked always or external always require one regardless)</label>
<label>Activity retention (days)<input name="retainActivityDays" type="number" min="1" max="3650" value="${s.settings.privacy.retainActivityDays}"></label>
<label>Credential environment-variable name<input name="credentialEnvironmentVariable" value="${esc(s.settings.credentialEnvironmentVariable)}" maxlength="128" placeholder="AION_PROVIDER_TOKEN"></label>
<label>Developer-agent bridge<select name="developerBridgeId"><option value="" ${s.settings.developerBridgeId ? "" : "selected"}>AION default — ${esc(model.developerBridge.displayName)}</option>${bridges.map((b) => `<option value="${esc(b.bridgeId)}" ${b.bridgeId === s.settings.developerBridgeId ? "selected" : ""}>${esc(b.displayName)}${b.available ? "" : " — unavailable"}</option>`).join("")}</select></label>
<label>Approved import roots (one per line)<textarea name="importRoots" maxlength="8000">${esc(s.settings.importRoots.join("\n"))}</textarea></label>
<label>Export root<input name="exportRoot" value="${esc(s.settings.exportRoot)}" maxlength="500"></label>
<button>Save settings</button></form>
<div class="card"><h2>Encrypted private backup</h2><p>Authenticated AES-256-GCM with a scrypt-derived key. Your passphrase and the derived key are never stored or logged, and every backup is decrypted and verified immediately after it is written.</p>
<form data-form="backup"><label>Destination file inside the export root<input name="destination" required maxlength="4096"></label><label>Passphrase (12+ characters)<input name="passphrase" type="password" required minlength="12" maxlength="256"></label><button>Create and verify backup</button></form>
<form data-form="backup-verify"><label>Verify an existing backup<input name="destination" required maxlength="4096"></label><label>Passphrase<input name="passphrase" type="password" required minlength="12" maxlength="256"></label><button>Verify restore</button></form></div>
${model.viewer === "console" ? privateAccessCard() : ""}
<div class="card"><h2>Developer-agent bridges</h2><p>AION checks only documented install locations; it never searches your computer. An installed executable is not the same thing as a usable account, so the two are reported separately. Checking account health is a local sign-in question and never a paid call, and AION never reads or stores the account address or organisation.</p>
${bridges.length ? `<ul>${bridges.map((b) => `<li><b>${esc(b.displayName)}</b>${b.selected ? " · selected" : ""} — ${b.available ? "installed" : "unavailable"}${b.executable ? ` (<code>${esc(b.executable)}</code>${b.version ? `, ${esc(b.version)}` : ""})` : ""}<br><span class="meta">${esc(b.detail)}</span><br><span class="meta">Account: ${esc(b.account)} — ${esc(b.accountDetail)}</span>
${b.commands.map((c) => `<br><span class="meta">Exact ${esc(c.mode)} command: <code>${esc(c.executable)} ${esc(c.args.join(" "))}</code> — your instruction is written to standard input, never to this list.</span>`).join("")}</li>`).join("")}</ul>` : `<p class="empty">No developer-agent bridge was found.</p>`}
<div class="actions"><button data-do="developer-health">Check developer-agent account health</button></div></div>
<div class="card"><h2>Data locations</h2><p class="meta">Assistant state: <code>${esc(model.dataRoot)}</code> · exports and private backups: <code>${esc(model.exportRoot)}</code>. Both are inside the ignored private directory and are excluded from Git and from source backups.</p>
<div class="actions"><button data-do="state-export">Export all local data</button></div></div>`;
}

function page() {
  const s = model.state;
  if (area === "People") return peopleArea(s);
  if (area === "Brain") return brainArea(s);
  if (area === "Studio") return studioArea(s);
  if (area === "Research") return researchArea(s);
  if (area === "Projects") return projectsArea(s);
  if (area === "Learning") return learningArea(s);
  if (area === "Chat") return chatArea(s);
  if (area === "Tasks") return tasksArea(s);
  if (area === "Routines") return routinesArea(s);
  if (area === "Memory") return memoryArea(s);
  if (area === "Planner") return plannerArea(s);
  if (area === "Sales") return salesArea(s);
  if (area === "Knowledge") return knowledgeArea(s);
  if (area === "Approvals") return approvalsArea(s);
  if (area === "Verify") return verifyArea(s);
  if (area === "Activity") return activityArea(s);
  if (area === "Career") return careerArea();
  if (area === "Imports") return importsArea(s);
  return settingsArea(s);
}

function render() {
  const provider = (model.providers ?? []).find((x) => x.id === model.state.settings.providerId);
  const badge = document.querySelector("#providerBadge");
  badge.textContent = provider?.location === "remote" ? `● Remote provider selected (${provider.id})` : "● Local-only";
  badge.className = provider?.location === "remote" ? "remote" : "local";
  const active = model.state.settings.activeWorkspace ?? "personal";
  // The switcher is the one place that legitimately spans workspaces. It shows names only — never
  // a count, a record, or anything else from inside a workspace you are not currently in.
  const registry = (model.state.workspaces ?? []).filter((w) => !w.archived);
  const switcher = document.querySelector("#workspaceSwitch");
  if (switcher) {
    switcher.innerHTML = registry.map((w) => `<button class="${w.id === active ? "active" : ""}" data-workspace="${esc(w.id)}">${esc(w.label)}</button>`).join("");
    switcher.dataset.active = active;
  }
  document.querySelector("nav").innerHTML = areas.map((x) => `<button class="${x === area ? "active" : ""}" data-area="${x}">${x}</button>`).join("");
  document.querySelector("#onboarding").hidden = model.state.onboardingComplete;
  document.querySelector("#content").hidden = !model.state.onboardingComplete;
  document.querySelector("#content").innerHTML = page();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { area: target, action, do: verb, id, state, enabled, value, workspace, tab, sheet: sheetName, kind, followup, appt, status, template, archived, step, stage, result, ref } = button.dataset;
  if (!target && !action && !verb && !workspace) return; // a plain form submit button; the submit handler owns it
  event.preventDefault();
  try {
    if (workspace) { await api("settings.update", { settings: { activeWorkspace: workspace } }); openCustomer = null; openSheet = null; coachPanel = null; await load(); toast(`Switched to ${model.state.settings.workspaceLabels?.[workspace] ?? workspace}. Records stay in the workspace they were created in.`); return; }
    if (target) { area = target; openCustomer = null; openSheet = null; coachPanel = null; render(); return; }
    if (verb === "tab") { salesTab = tab; coachPanel = null; render(); return; }
    if (verb === "sheet") { openSheet = { sheet: sheetName, id }; render(); return; }
    if (verb === "sheet-close") { openSheet = null; render(); return; }
    if (verb === "customer-open") { openCustomer = id; coachPanel = null; render(); return; }
    if (verb === "customer-close") { openCustomer = null; coachPanel = null; render(); return; }
    if (verb === "coach-close") { coachPanel = null; render(); return; }
    if (verb === "assess-close") { assessment = null; render(); return; }
    if (verb === "unlink") { await api(kind === "plan" ? "opportunity.plan.unlink" : "opportunity.task.unlink", { id, ...(kind === "plan" ? { planId: ref } : { taskId: ref }) }); assessment = null; toast("Unlinked. The " + kind + " itself is untouched."); }
    if (verb === "assess") { assessment = { id, data: await api("opportunity.assess", { id }) }; render(); return; }
    if (verb === "brain-health") { const endpoint = await api("brain.health", { id }); toast(`${endpoint.label}: ${endpoint.lastHealth.detail}`); }
    if (verb === "brain-detect") { const found = await api("brain.detect"); toast(found.runtimes.length ? found.runtimes.map((r) => r.detail).join(" ") : "Nothing is listening on any documented local runtime address. AION installed nothing and searched nothing."); return; }
    if (verb === "brain-remove") { await api("brain.endpoint.remove", { id }); toast("Endpoint removed. Nothing AION knows was affected."); }
    if (verb === "brain-evaluate") { const run = await api("brain.evaluate", { id }); toast(run.summary); }
    if (verb === "gpu-stop") { const stopped = await api("gpu.stop", { id, reason: "owner stop from the Command Center" }); toast(stopped.teardownConfirmed ? "Stopped and teardown confirmed." : "AION could not confirm teardown. Check the provider console yourself."); }
    if (verb === "gpu-decide") { await api("gpu.decide", { id, approve: value === "true" }); toast(value === "true" ? "Approved exactly that proposal. AION cannot raise it." : "Denied. Nothing was rented."); }
    // One bounded check per press. Every one of them re-reads the stored stop conditions first, so
    // pressing this on a session that has run out of money stops the machine rather than waiting.
    if (verb === "gpu-poll") { const status = await api("gpu.poll", { id }); toast(`${status.label}: ${status.detail}`); }
    if (verb === "gpu-discover") { const found = await api("gpu.discover", { filter: {} }); toast(found.recommendations.length ? found.recommendations.map((r) => r.tier + ": " + r.why).join(" | ") : "Nothing eligible was found, so AION recommends nothing."); return; }
    if (verb === "research-approve") await api("research.approve", { id });
    if (verb === "research-run") { const job = await api("research.run", { id }); toast(`${job.findings.length} finding(s) from ${job.sources.length} source(s). None of them is a fact yet.`); }
    if (verb === "project-step") { await api("project.step", { id, step }); }
    if (verb === "project-approve") { await api("project.approve", { id, stage, note: "Approved from the Command Center." }); toast(`You approved the ${stage} stage.`); }
    if (verb === "lesson-outcome") { await api("lesson.outcome", { id, outcome: { result } }); }
    if (verb === "lesson-disable") { await api("lesson.enable", { id, enabled: false }); toast("Lesson turned off. It is kept so the history is intact."); }
    if (verb === "coach") { const output = await api("coach", { kind, input: { customerId: id, onDate: today() } }); coachPanel = { for: id ?? null, output }; render(); return; }
    if (verb === "followup-done") { await api("customer.followup.complete", { id, followUpId: followup, outcome: "Completed from the floor." }); }
    if (verb === "appt-status") { await api("customer.appointment.status", { id, appointmentId: appt, status }); }
    if (verb === "customer-archive") { await api("customer.archive", { id, archived: archived === "true" }); openCustomer = null; }
    if (verb === "sales-routine") { await api("sales.routine.create", { templateId: template }); toast("Routine created. Enable it when you want it to run."); }
    if (verb === "import-queue-process") {
      const done = await api("import.queue.process", {});
      toast(done.status === "completed" ? `Import done: +${done.itemsImported || 0} (skip ${done.itemsSkipped || 0})` : `Import ${done.status}: ${done.lastError || ""}`);
    }
    if (action === "onboarding") await api("onboarding.complete");
    if (verb === "task") await api("task.transition", { id, state, reason: "Command Center" });
    if (verb === "routine") await api("routine.run", { id });
    if (verb === "routine-enabled") await api("routine.update", { id, change: { enabled: enabled === "true" } });
    if (verb === "tick") { const result = await api("scheduler.tick"); toast(`${result.due} routine(s) were due.`); }
    if (verb === "memory-toggle") await api("memory.enable", { id, enabled: enabled === "true" });
    if (verb === "memory-accept") await api("memory.accept", { id });
    if (verb === "memory-delete") await api("memory.delete", { id });
    if (verb === "memory-export") { download("aion-memories.json", (await api("memory.export")).export); toast("Memories exported to your browser downloads."); return; }
    if (verb === "state-export") { download("aion-local-export.json", (await api("state.export")).export); toast("Complete local export written. It is plaintext — store it carefully."); return; }
    if (verb === "pair-code-clear") { pairingCode = null; render(); return; }
    if (verb === "device-revoke") { const result = await api("device.revoke", { id }); toast(`Device revoked; ${result.sessionsEnded} session(s) ended. Your data is untouched.`); }
    if (verb === "device-revoke-all") { const result = await api("device.revoke.all"); toast(`Signed out ${result.devices} device(s). Your data is untouched.`); }
    if (verb === "developer-health") { const result = await api("developer.health"); toast(`${result.bridges.filter((b) => b.available).length} bridge(s) installed, ${result.bridges.filter((b) => b.account === "signed-in").length} signed in. No paid call was made.`); }
    if (verb === "plan-accept") await api("plan.accept", { id });
    if (verb === "plan-convert") { const tasks = await api("plan.convert", { id }); toast(`${tasks.length} task(s) created.`); }
    if (verb === "approve") await api("approval.decide", { id, approve: value === "true" });
    if (verb === "execute") { await api("action.execute", { id }); toast("Approved action executed once."); }
    if (verb === "action-cancel") await api("action.cancel", { id });
    if (verb === "chat-cancel") { const cancelled = await api("chat.cancel", { id }); toast(cancelled ? "Request cancelled." : "No request was in flight."); }
    if (verb === "conversation-state") await api("conversation.update", { id, change: { state } });
    if (verb === "conversation-memory") await api("conversation.update", { id, change: { memoryContextEnabled: enabled === "true" } });
    if (verb === "conversation-delete") await api("conversation.delete", { id });
    if (verb === "import-cancel") await api("import.cancel", { id });
    if (verb === "import-dashboard-refresh") {
      const dash = await api("import.dashboard", {});
      if (model.state) model.state._importDashboard = dash;
      toast(`Import dashboard: ${dash.documents || 0} docs · review ${dash.reviewOpen || 0}`);
      render();
      return;
    }
    if (verb === "import-review-accept") {
      await api("import.review.resolve", { id, decision: "accepted" });
      toast("Review item accepted.");
    }
    if (verb === "import-review-reject") {
      await api("import.review.resolve", { id, decision: "rejected" });
      toast("Review item rejected.");
    }
    if (verb === "lan-discover") {
      const lan = await api("network.lan.discover", {});
      toast(lan.phoneUrl ? `LAN: ${lan.preferred?.address} · ${lan.phoneUrl}` : "No private LAN IPv4 found.");
      await load();
      return;
    }
    if (verb === "lan-use-suggested") {
      const ip = button.dataset.ip;
      if (!ip) throw new Error("No suggested IP.");
      await api("settings.update", { settings: { remoteAccess: { enabled: true, bindAddress: ip, sessionDays: model.remoteAccess?.sessionDays ?? 30 } } });
      toast(`Bind address set to ${ip}. Restart AION for the private listener to bind.`);
      await load();
      return;
    }
    await load();
  } catch (error) { toast(error.message); }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const d = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  try {
    if (kind === "conversation") await api("conversation.create", { title: d.title });
    if (kind === "conversation-rename") await api("conversation.update", { id: d.id, change: { title: d.title } });
    if (kind === "assistant-prompt") {
      const result = await api("assistant.prompt", { text: d.text });
      window.__aionLastAssistant = result;
      toast(result.intent ? `Intent: ${result.intent}` : "Assistant replied.");
      form.reset();
      await load();
      render();
      return;
    }
    if (kind === "document-upload") {
      const fileInput = form.querySelector('input[type="file"]');
      const file = fileInput?.files?.[0];
      if (!file) throw new Error("Choose a file to upload.");
      if (file.size > 6 * 1024 * 1024) throw new Error("File exceeds 6 MB limit.");
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const contentBase64 = btoa(binary);
      const tags = String(d.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const doc = await api("crm.document.upload", {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        relationshipId: d.relationshipId || null,
        tags,
        summary: d.summary || undefined,
      });
      toast(`Stored ${doc.filename} (${doc.byteLength} bytes)${doc.tags?.length ? ` · ${doc.tags.join(", ")}` : ""}`);
      form.reset();
      await load();
      return;
    }
    if (kind === "folder-import") {
      const tags = String(d.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const result = await api("crm.document.importFolder", { path: d.path, tags });
      const st = result.stats || {};
      toast(`Recursive import: ${result.imported?.length ?? 0} stored · ${st.duplicatesSkipped || 0} dup · ${st.reviewItems || 0} review · ${st.errors || 0} err${result.truncated ? " (truncated)" : ""}`);
      form.reset();
      await load();
      return;
    }
    if (kind === "csv-contacts") {
      const result = await api("import.csv.contacts", { csvText: d.csvText, sourceLabel: d.sourceLabel || "owner-csv" });
      toast(`CSV import: ${result.created} created, ${result.skipped} skipped.`);
      form.reset();
      await load();
      return;
    }
    if (kind === "import-queue") {
      await api("import.queue.add", { path: d.path, kind: d.kind, associateWith: d.associateWith, label: d.path });
      toast("Import source queued.");
      form.reset();
      await load();
      return;
    }
    if (kind === "workspace-brand") {
      const channels = String(d.channels || "").split(",").map((x) => x.trim()).filter(Boolean);
      await api("workspace.create", {
        workspace: {
          label: d.label,
          kind: "business",
          purpose: "Owner-created brand/business workspace",
          brand: {
            name: d.label,
            positioning: d.positioning || "",
            audience: d.audience || "",
            channels,
            valueProposition: "",
            notes: "",
          },
        },
      });
      toast(`Brand workspace created: ${d.label}`);
      form.reset();
      await load();
      return;
    }
    if (kind === "owner-profile") {
      await api("owner.profile.update", { displayName: d.displayName, summary: d.summary });
      toast("Owner profile saved.");
      await load();
      return;
    }
    if (kind === "owner-fact") {
      await api("owner.knowledge.add", {
        category: d.category,
        title: d.title,
        content: d.content,
        confidence: Number(d.confidence || 90),
        sourceRef: "owner.ui",
      });
      toast("Knowledge fact added.");
      form.reset();
      await load();
      return;
    }
    if (kind === "brand-collaborator") {
      await api("brand.collaborator.add", {
        name: d.name,
        role: d.role,
        brandWorkspaceId: d.brandWorkspaceId || null,
        brandResponsibility: d.brandResponsibility,
        notes: d.notes,
      });
      toast(`Collaborator recorded: ${d.name}`);
      form.reset();
      await load();
      return;
    }
    if (kind === "message") { form.reset(); await sendStreamed(d.id, d.content); return; }
    if (kind === "task") await api("task.create", { task: { title: d.title, description: d.description, priority: d.priority, tags: d.tags.split(",").map((x) => x.trim()).filter(Boolean) } });
    if (kind === "task-edit") await api("task.update", { id: d.id, change: { title: d.title, description: d.description } });
    if (kind === "routine") await api("routine.create", { routine: { name: d.name, instructions: d.instructions, intervalMinutes: Number(d.intervalMinutes) } });
    if (kind === "routine-interval") await api("routine.update", { id: d.id, change: { intervalMinutes: Number(d.intervalMinutes) } });
    if (kind === "memory") await api("memory.create", { memory: { content: d.content, category: d.category } });
    if (kind === "memory-correct") await api("memory.correct", { id: d.id, content: d.content, reason: d.reason });
    if (kind === "memory-search") { const found = await api("memory.search", { query: d.query }); toast(`${found.length} enabled memory record(s) matched.`); return; }
    if (kind === "plan") await api("plan.create", { goal: d.goal, steps: d.steps.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((title) => ({ title })) });
    if (kind === "action") await api("action.propose", { capabilityId: "aion.local.echo.v1", input: { text: d.text } });
    if (kind === "developer-task") await api("action.propose", { capabilityId: "aion.developer.task.v1", input: { instruction: d.instruction, mode: d.mode === "workspace-write" ? "workspace-write" : "read-only" } });
    if (kind === "pair") {
      const response = await fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: d.code }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSessionToken(data.result.token);
      toast(`Paired as "${data.result.label}".`);
      await load();
      return;
    }
    if (kind === "relationship") {
      const created = await api("relationship.create", { relationship: { displayName: d.displayName, relationshipType: d.relationshipType, organisation: d.organisation, role: d.role } });
      openCustomer = created.id; toast(`Added to ${model.state.settings.workspaceLabels?.[model.state.settings.activeWorkspace] ?? "this workspace"}.`);
    }
    if (kind === "brain-settings") {
      await api("brain.settings", { change: { mode: d.mode, primaryEndpointId: d.primaryEndpointId, offlineMode: form.offlineMode.checked, remoteFallbackEnabled: form.remoteFallbackEnabled.checked } });
      toast(form.offlineMode.checked ? "Offline mode is on. No inference leaves this computer." : "Brain policy saved.");
    }
    if (kind === "brain-endpoint") {
      await api("brain.endpoint.add", { endpoint: {
        label: d.label, runtime: d.runtime, location: d.location, baseUrl: d.baseUrl, model: d.model,
        hostLabel: d.hostLabel, credentialEnvironmentVariable: d.credentialEnvironmentVariable,
        capabilities: {
          contextTokens: Number(d.contextTokens || 8192),
          ...Object.fromEntries(["reasoning", "code", "structuredJson", "toolProposal", "vision", "embeddings"].map((f) => [f, form[f].checked])),
        },
      } });
      toast("Endpoint added. AION stores the name of the credential variable, never its value.");
    }
    if (kind === "opportunity") {
      await api("opportunity.create", { opportunity: {
        title: d.title, problem: d.problem, targetCustomer: d.targetCustomer,
        problemSeverity: Number(d.problemSeverity), reachability: Number(d.reachability),
        ownerAdvantage: Number(d.ownerAdvantage), effort: Number(d.effort),
      } });
      toast("Opportunity opened. It scores zero until something is actually established about it.");
    }
    if (kind === "opportunity-link") {
      const [linkKind, linkId] = String(d.ref).split(":");
      await api(linkKind === "plan" ? "opportunity.plan.link" : "opportunity.task.link", { id: d.id, ...(linkKind === "plan" ? { planId: linkId } : { taskId: linkId }) });
      assessment = null;
      toast("Linked. Product Studio holds a reference; the " + linkKind + " keeps its own history.");
    }
    if (kind === "claim") {
      await api("opportunity.claim", { id: d.id, claim: { class: d.class, statement: d.statement, supportedBy: d.supportedBy.split(",").map((x) => x.trim()).filter(Boolean) } });
      toast(`Recorded a ${d.class}. Its class is stored, so a guess is never later quoted as a finding.`);
    }
    if (kind === "research") {
      await api("research.propose", { job: {
        question: d.question, scope: d.scope,
        seedReferences: d.seedReferences.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        limits: { maxSources: Number(d.maxSources || 0), maxCostCents: Number(d.maxCostCents || 0) },
      } });
      toast("Research job proposed. Nothing runs until you approve it.");
    }
    if (kind === "url-check") { const verdict = await api("research.check-url", { url: d.url }); toast(verdict.reason); return; }
    if (kind === "project") { await api("project.create", { project: { title: d.title, summary: d.summary } }); toast("Project opened at the idea stage."); }
    if (kind === "project-advance") { await api("project.advance", { id: d.id, stage: d.stage, reason: d.reason }); toast(`Moved to ${d.stage}.`); }
    if (kind === "lesson") {
      await api("lesson.record", { lesson: { statement: d.statement, guidance: d.guidance, supportedBy: d.supportedBy.split(",").map((x) => x.trim()).filter(Boolean) } });
      toast("Lesson recorded.");
    }
    if (kind === "prospect") {
      const created = await api("customer.create", { customer: { displayName: d.displayName, source: d.source, communicationPreference: d.communicationPreference, interests: d.interest ? [{ kind: "vehicle", description: d.interest }] : [] } });
      openSheet = null; openCustomer = created.id; toast("Prospect added.");
    }
    if (kind === "note") { await api("customer.interaction", { id: d.id, interaction: { kind: d.kind, summary: d.summary } }); openSheet = null; toast("Noted."); }
    if (kind === "followup") { await api("customer.followup", { id: d.id, followUp: { dueAt: localToIso(d.dueAt), channel: d.channel, reason: d.reason } }); openSheet = null; toast("Follow-up scheduled."); }
    if (kind === "appointment") { await api("customer.appointment", { id: d.id, appointment: { at: localToIso(d.at), kind: d.kind, location: d.location } }); openSheet = null; toast("Appointment booked."); }
    if (kind === "stage") { await api("customer.lifecycle", { id: d.id, lifecycle: d.lifecycle, summary: d.summary }); openSheet = null; toast("Stage updated; every earlier state stays in the timeline."); }
    if (kind === "customer-edit") { await api("customer.update", { id: d.id, change: { displayName: d.displayName, notes: d.notes, nextAction: d.nextAction } }); toast("Saved."); }
    if (kind === "metrics") {
      const counts = {};
      for (const key of ["newLeads", "calls", "contacts", "appointmentsSet", "appointmentsShown", "sales", "followUpsCompleted"]) counts[key] = Number(d[key] ?? 0);
      await api("sales.metrics", { date: d.date, counts }); toast("Your day is recorded. These are your own counts.");
    }
    if (kind === "remote-access") {
      await api("settings.update", { settings: { remoteAccess: { enabled: form.enabled.checked, bindAddress: d.bindAddress, sessionDays: Number(d.sessionDays) } } });
      toast(form.enabled.checked ? "Private phone access is on. Restart AION for the bind address to take effect." : "Private phone access is off and every device session has ended.");
    }
    if (kind === "pair-code") { pairingCode = await api("device.pair.code", { label: d.label }); toast("Code created. It works once and expires in ten minutes."); }
    if (kind === "verify") { await api("action.propose", { capabilityId: "aion.verify.run.v1", input: { operationId: d.operationId } }); toast("Verification proposed. Approve it in Approvals, then execute — AION runs it, not a model."); }
    if (kind === "verify-analyse") { await api("verify.analyse", { id: d.id, question: d.question }); toast("Read-only analysis proposed. Approve it in Approvals to send the evidence to the developer agent."); }
    if (kind === "import") await api("import.dry-run", { platform: d.platform, root: d.root, path: d.path });
    if (kind === "import-execute") await api("import.execute", { id: d.id, root: d.root, path: d.path });
    if (kind === "backup") { const result = await api("backup.create", { destination: d.destination, passphrase: d.passphrase }); toast(`Backup written and verified (${result.bytes} bytes).`); }
    if (kind === "backup-verify") { await api("backup.verify", { destination: d.destination, passphrase: d.passphrase }); toast("Backup decrypted, authenticated, and restored successfully."); }
    if (kind === "career") {
      const result = await api("career.run", { command: d.command, root: d.root, value: d.value, sourceType: d.sourceType, dryRun: d.dryRun === "on" });
      await load();
      const output = document.querySelector("#careerOutput");
      if (output) output.textContent = result.output || "The command produced no output.";
      toast(`Career ${d.command} completed.`);
      return;
    }
    if (kind === "settings") {
      await api("settings.update", { settings: {
        providerId: d.providerId, model: d.model,
        remoteDisclosureAccepted: form.remoteDisclosureAccepted.checked,
        memoryContextEnabled: form.memoryContextEnabled.checked,
        schedulerEnabled: form.schedulerEnabled.checked,
        externalActionsRequireApproval: form.externalActionsRequireApproval.checked,
        credentialEnvironmentVariable: d.credentialEnvironmentVariable,
        developerBridgeId: d.developerBridgeId ?? "",
        importRoots: d.importRoots.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        exportRoot: d.exportRoot,
        privacy: { includeMemoryByDefault: form.includeMemoryByDefault.checked, retainActivityDays: Number(d.retainActivityDays) },
      } });
    }
    if (!["settings", "customer-edit", "metrics"].includes(kind)) form.reset();
    await load();
    toast("Saved.");
  } catch (error) { toast(error.message); }
});

load().catch((error) => toast(error.message));
