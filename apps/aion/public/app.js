// AION Command Center UI. Same-origin only; no hosted dependency, analytics, or telemetry.
const areas = ["Sales", "Chat", "Tasks", "Routines", "Memory", "Planner", "Approvals", "Verify", "Activity", "Career", "Imports", "Settings"];
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
  return `<h1>Chat</h1><p class="lead">Offline by default. Memory context is explicit per conversation, and the model can only propose actions or memories.</p>
<p class="hint">With the offline provider, <code>propose: check the local echo</code> and <code>remember: preferred timezone: UTC</code> exercise approvals and unconfirmed memories. <code>developer: review the repository and tell me what tests are failing</code> prepares a <em>read-only</em> developer-agent task for your approval — nothing runs until you approve it, and the agent may not modify anything.</p>
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
  return `<h1>Routines</h1><p class="lead">Schedules run only while AION is open. No Windows service or startup task is installed.</p>
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

function importsArea(s) {
  return `<h1>Import Center</h1><p class="lead">Explicit path, exact SHA-256 digests, duplicate detection, and preserved provenance. A dry run always comes first, originals are never modified, and AION never scans your drives.</p>
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
  return `<div class="card"><h2>Private phone access</h2>
<p>${esc(r.summary)}</p>
<p class="meta">AION binds <code>${esc(r.boundAddress ?? "127.0.0.1")}</code>. It never opens a public port, never creates a tunnel, and never changes your router. Reaching AION over a private network is not enough on its own: a device must also be paired.</p>
<p class="meta">Private network: ${r.privateNetwork.available ? `${esc(r.privateNetwork.tool)} ${esc(r.privateNetwork.version ?? "")} detected` : "not configured"} — ${esc(r.privateNetwork.detail)}</p>
<form data-form="remote-access">
<label><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}> Allow paired devices to reach AION</label>
<label>Bind address (loopback or a private range only)<input name="bindAddress" value="${esc(r.bindAddress)}" maxlength="60"></label>
<label>Sign a device out after (days)<input name="sessionDays" type="number" min="1" max="365" value="${r.sessionDays}"></label>
<button>Save access settings</button></form>
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
  if (area === "Chat") return chatArea(s);
  if (area === "Tasks") return tasksArea(s);
  if (area === "Routines") return routinesArea(s);
  if (area === "Memory") return memoryArea(s);
  if (area === "Planner") return plannerArea(s);
  if (area === "Sales") return salesArea(s);
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
  const { area: target, action, do: verb, id, state, enabled, value, workspace, tab, sheet: sheetName, kind, followup, appt, status, template, archived } = button.dataset;
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
    if (verb === "coach") { const output = await api("coach", { kind, input: { customerId: id, onDate: today() } }); coachPanel = { for: id ?? null, output }; render(); return; }
    if (verb === "followup-done") { await api("customer.followup.complete", { id, followUpId: followup, outcome: "Completed from the floor." }); }
    if (verb === "appt-status") { await api("customer.appointment.status", { id, appointmentId: appt, status }); }
    if (verb === "customer-archive") { await api("customer.archive", { id, archived: archived === "true" }); openCustomer = null; }
    if (verb === "sales-routine") { await api("sales.routine.create", { templateId: template }); toast("Routine created. Enable it when you want it to run."); }
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
