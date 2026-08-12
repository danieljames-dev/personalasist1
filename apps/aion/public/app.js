// AION Command Center UI. Same-origin only; no hosted dependency, analytics, or telemetry.
const areas = ["Home", "Chat", "Customers", "Tasks", "Capture", "Intake", "Inventory Walk", "Knowledge", "Sales", "People", "Brain", "Studio", "Research", "Projects", "Learning", "Routines", "Memory", "Planner", "Approvals", "Verify", "Activity", "Career", "Imports", "Mobile", "Settings"];
/** Primary phone bottom bar (5 slots). More opens a sheet for Capture / Intake / Inventory / Knowledge. */
const mobilePrimaryAreas = ["Home", "Chat", "Customers", "Tasks", "More"];
const mobileMoreAreas = new Set(["Capture", "Intake", "Inventory Walk", "Knowledge", "Mobile", "Settings", "Sales", "People", "Imports"]);
let model = null;
let area = "Home";
let streaming = "";
let openConversation = null;
/** Held in memory only, shown once, never persisted. */
let pairingCode = null;
const isPhoneViewport = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 700px)").matches;
const isDeviceViewer = () => model?.viewer === "device";
/** Paired phone over Tailscale/LAN must use phone layout even if Safari "desktop site" widens the viewport. */
const usePhoneChrome = () => isDeviceViewer() || isPhoneViewport();

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Nothing from another workspace is ever rendered. Work material never appears in Personal. */
const scoped = (items) => (items ?? []).filter((item) => (item.workspace ?? "personal") === (model.state.settings.activeWorkspace ?? "personal"));
/** A datetime-local field carries no zone; treat it as this device's time and store UTC. */
const localToIso = (value) => value ? new Date(value).toISOString() : "";
const short = (value, length = 16) => `${String(value ?? "").slice(0, length)}…`;

/** Canonical session key (shared with /phone). Legacy aion.sessionToken still read. */
const SESSION_KEY = "aion.session";
const SESSION_KEY_LEGACY = "aion.sessionToken";
/** A paired phone keeps its token here. The console never has one and never needs one. */
const sessionToken = () => {
  try {
    return localStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY_LEGACY) || "";
  } catch { return ""; }
};
const setSessionToken = (value) => {
  try {
    if (value) {
      localStorage.setItem(SESSION_KEY, value);
      localStorage.setItem(SESSION_KEY_LEGACY, value);
    } else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY_LEGACY);
    }
  } catch { /* private mode */ }
};
/** Bearer material travels in a header, never in a URL where it would reach logs and history. */
function authHeaders() { const token = sessionToken(); return token ? { authorization: `Bearer ${token}` } : {}; }

/** Only true "not paired / revoked / access off" should wipe the token — not origin/host glitches. */
function isUnpairedAuthError(status, message) {
  const m = String(message || "").toLowerCase();
  if (status === 401) return /not paired|pair it|invalid|expired|revoked|unauthor/i.test(m) || !m;
  if (status === 403) return /access is turned off|private phone access|revoked/i.test(m);
  return false;
}

async function api(type, payload = {}) {
  // `type` is written last on purpose: a payload field can never displace the action being called.
  const response = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ ...payload, type }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.result;
}
async function load() {
  const response = await fetch("/api/state", { headers: authHeaders() });
  if (response.status === 401 || response.status === 403) {
    const errBody = await response.json().catch(() => ({}));
    const errMsg = errBody.error || "This device is not paired.";
    // Origin/host mismatch must NOT destroy a still-valid token (re-pair friction on photo upload).
    if (isUnpairedAuthError(response.status, errMsg)) {
      setSessionToken("");
      renderPairing(errMsg);
      return;
    }
    // Keep token; show a recoverable error shell instead of pairing
    document.body.innerHTML = `<main class="shell" style="padding:1.5rem;max-width:28rem;margin:auto"><h1>AION</h1><p class="err">${esc(errMsg)}</p><p class="meta">Session kept. Open the Tailscale or LAN URL you paired on (same origin), then reload.</p><button onclick="location.reload()">Reload</button></main>`;
    return;
  }
  model = await response.json();
  render();
}

/** The only screen an unpaired phone ever sees. It shows no owner data of any kind. */
function renderPairing(message) {
  const phoneUi = isPhoneViewport() || true; // unpaired requests from non-loopback are phones
  document.body.classList.add("aion-phone-mode");
  const phoneShell = document.getElementById("aionPhoneShell");
  const desktopShell = document.getElementById("aionDesktopShell");
  if (phoneShell) phoneShell.hidden = false;
  if (desktopShell) desktopShell.hidden = true;
  const html = `<div class="sales"><h1>Pair this device</h1>
<p class="lead">${esc(message)}</p>
<p class="hint">On the computer running AION, open <b>Mobile</b> / Settings, turn on private phone access, and create a pairing code. Codes last ten minutes and work once.</p>
<form data-form="pair" class="quick-form"><label>Pairing code<input name="code" required maxlength="20" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCDE-FGHIJ"></label><button>Pair</button></form></div>`;
  const phoneContent = document.getElementById("aionPhoneContent");
  if (phoneContent) phoneContent.innerHTML = html;
  const desktopContent = document.querySelector("#content");
  if (desktopContent) { desktopContent.hidden = false; desktopContent.innerHTML = html; }
  void phoneUi;
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

function homeArea(s) {
  const brief = window.__aionLastBriefing;
  const ws = s.settings?.activeWorkspace ?? "personal";
  const wsLabel = (typeof currentContextLabel === "function" ? currentContextLabel() : null) || s.settings?.workspaceLabels?.[ws] || ws;
  const exec = s.executive || {};
  const commits = (exec.commitments || []).filter((c) => c.status === "overdue" || c.status === "due_soon").slice(0, 4);
  const opps = (exec.opportunities || []).slice(0, 3);
  return `<div class="sales home-mobile"><h1>Home</h1>
<p class="lead">Context: <b>${esc(wsLabel)}</b>. Owner must do · AION handling · commitments.</p>
<div class="tap-grid quick">
<button type="button" data-do="briefing-refresh">What needs me?</button>
<button type="button" data-area-jump="Capture">Capture</button>
<button type="button" data-area-jump="Customers">Customers</button>
<button type="button" data-area-jump="Inventory Walk">Inventory Walk</button>
<button type="button" data-do="attention-board">Attention</button>
<button type="button" data-do="executive-cycle">Run cycle</button>
<button type="button" data-do="eod-wrap">Wrap day</button>
</div>
<div class="card next"><h2>Executive briefing</h2>
${brief ? `<pre class="msg assistant" style="white-space:pre-wrap;max-height:28vh;overflow:auto">${esc(brief)}</pre>` : `<p class="meta">Tap <b>What needs me?</b> for OWNER MUST DO / AION HANDLING.</p>`}
</div>
${commits.length ? `<div class="card warnbox"><h2>Commitments</h2>${commits.map((c) => `<p class="meta"><b>${esc(c.status)}</b> ${esc(c.committedBy)}→${esc(c.committedTo)}: ${esc((c.statement || "").slice(0, 80))}</p>`).join("")}</div>` : ""}
${opps.length ? `<div class="card"><h2>Opportunities</h2>${opps.map((o) => `<p class="meta">${esc(o.title)}</p>`).join("")}</div>` : ""}
<div class="card"><h2>Ask</h2>
<form data-form="assistant-prompt" class="quick-form"><label>Prompt<textarea name="text" required maxlength="10000" placeholder="What needs me?" rows="2" style="font-size:16px"></textarea></label>
<div class="actions"><button type="submit">Ask</button>
<button type="button" data-do="voice-prompt">Voice</button></div></form>
${window.__aionLastAssistant ? `<div class="thread"><p class="msg assistant">${esc((window.__aionLastAssistant.reply || "").slice(0, 400))}</p></div>` : ""}
</div>
<p class="meta"><a href="/phone">Photo intake</a></p></div>`;
}

function chatArea(s) {
  const phone = usePhoneChrome();
  const reply = window.__aionLastAssistant;
  // Phone-first: one prompt card + last reply. Conversations list is secondary (desktop).
  if (phone) {
    return `<div class="aion-chat-phone" id="aionChatPanel">
<h1>Chat</h1>
<p class="meta">Ask about follow-ups, customers, or “What needs me?”. Answers use stored Work CRM facts when available.</p>
${renderVoiceRecordingChip()}
${renderPendingAttachment()}
<form data-form="assistant-prompt" class="quick-form aion-chat-compose" id="aionChatForm">
<label>Message<textarea name="text" id="aionChatInput" maxlength="10000" rows="3" placeholder="Ask, attach a photo, or record audio…"></textarea></label>
<div class="actions aion-compose-actions">
<button type="button" data-do="attach-camera" title="Take photo">📷 Photo</button>
<button type="button" data-do="attach-file" title="Choose photo, file, or audio">＋ File</button>
<button type="button" data-do="voice-prompt" title="${voiceRecording ? "Stop recording" : "Record voice"}" class="${voiceRecording ? "aion-voice-active" : ""}">${voiceRecording ? "⏹" : "🎤"}</button>
<button type="submit" class="aion-send">Send</button>
</div>
${/* capture="environment" opens the camera directly on iOS; the second input is the library/file picker. */ ""}
<input type="file" id="aionCaptureInput" accept="image/*" capture="environment" hidden>
<input type="file" id="aionPickInput" accept="image/*,audio/*,.pdf,.txt,.md,.csv,.docx,.rtf,.heic,.wav,.mp3,.m4a,.webm,.ogg" hidden>
</form>
${reply ? `<div class="card next aion-chat-reply">${reply.attachmentName ? `<p class="meta">📎 ${esc(reply.attachmentName)}</p>` : ""}
<pre class="msg assistant" style="white-space:pre-wrap;margin:0;max-height:50svh;overflow:auto">${esc(reply.reply || "")}</pre>
${(reply.sources || []).length ? `<p class="meta">Sources: ${reply.sources.map((x) => esc(x.label || x.id)).join("; ")}</p>` : ""}
</div>` : `<div class="empty">Your reply will show here. Try: <b>What needs me?</b></div>`}
</div>`;
  }
  return `<h1>Chat</h1><p class="lead">Daily CRM assistant: natural language works. CRM lookup, notes, follow-ups, account summaries, email drafts (never auto-sent), plus offline chat. Answers ground in stored Work-workspace records.</p>
<div class="card"><h2>Ask AION</h2>
<p class="meta">Try: What should I follow up on? · Who do I need to call? · What should I do today? · What do we know about Jane? · What's going on with ACME? · Draft John an email · Research ACME · Remember this</p>
<form data-form="assistant-prompt"><label>Prompt<textarea name="text" required maxlength="10000" placeholder="What do we know about …" rows="3"></textarea></label>
<div class="actions"><button type="submit">Ask</button><button type="button" data-do="voice-prompt">Voice</button></div></form>
${window.__aionLastAssistant ? `<div class="thread"><p class="msg assistant">${esc(window.__aionLastAssistant.reply || "")}</p>
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
/**
 * The attachment staged in the composer, before it is sent.
 *
 * Held as one pending item rather than a queue: the Owner is standing at a car taking one photo of
 * one VIN, and a queue would raise "which of these am I asking about?" without answering it.
 */
let pendingAttachment = null;
/** Laptop microphone MediaRecorder session (explicit; never ambient/background). */
let voiceRecording = null; // { recorder, chunks, startedAt } | null

function renderPendingAttachment() {
  if (!pendingAttachment) return "";
  const { name, dataUrl, isImage, isAudio, sizeLabel, status } = pendingAttachment;
  const icon = isImage
    ? `<img src="${esc(dataUrl)}" alt="Attached photo preview">`
    : isAudio
      ? `<span class="aion-attach-doc" aria-hidden="true">🎙</span>`
      : `<span class="aion-attach-doc">📄</span>`;
  return `<div class="aion-attach-chip">
${icon}
<span class="aion-attach-meta"><b>${esc(name)}</b><small>${esc(sizeLabel)}${status ? ` · ${esc(status)}` : ""}${isAudio ? " · audio" : ""}</small></span>
<button type="button" class="aion-attach-remove" data-do="attach-remove" aria-label="Remove attachment">✕</button>
</div>`;
}

function renderVoiceRecordingChip() {
  if (!voiceRecording) return "";
  return `<div class="aion-attach-chip aion-voice-rec" role="status" aria-live="polite">
<span class="aion-attach-doc" aria-hidden="true">●</span>
<span class="aion-attach-meta"><b>Recording…</b><small>Tap 🎤 again to stop. Not continuous surveillance.</small></span>
<button type="button" class="aion-attach-remove" data-do="voice-prompt" aria-label="Stop recording">Stop</button>
</div>`;
}

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
  const inv = s.vehicleInventory || { vehicles: [] };
  const interestedVehicles = (inv.vehicles || []).filter((v) => (v.relationshipIds || []).includes(c.id));
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
<div class="card"><h2>Interested vehicles</h2>
${interestedVehicles.length ? interestedVehicles.map((v) => `<p class="meta"><b>${esc([v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id)}</b> · ${esc(v.vin || "no VIN")} · ${esc(v.presenceStatus)}</p>`).join("") : `<p class="meta">None linked yet. Owner must assert interest — AION will not invent it.</p>`}
<form data-form="vehicle-associate" class="quick-form">
<input type="hidden" name="relationshipId" value="${esc(c.id)}">
<label>Link VIN (must already be in inventory)
<input name="vin" required maxlength="20" placeholder="17-char VIN" style="font-size:16px"></label>
<button type="submit">Add interested vehicle</button>
</form>
</div>
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
    return `<h1>Customers / Sales</h1>
<div class="empty">Customers and sales live in the <b>Work</b> workspace.</div>
<div class="actions" style="margin-top:1rem">
<button type="button" data-workspace="work">Switch to Work</button>
<button type="button" data-area-jump="Home">Back to Home</button>
</div>
<p class="meta">Then use Customers for prospects, follow-ups, and notes.</p>`;
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
  const brands = (s.workspaces ?? []).filter((w) => w.kind === "business" && !w.archived && !/e2e|synthetic|fixture|test business/i.test(`${w.id} ${w.label}`));
  const ok = s.ownerKnowledge ?? { profile: { displayName: "", summary: "" }, facts: [] };
  const facts = (ok.facts ?? []).filter((f) => f.enabled !== false).slice(0, 40);
  const collabs = s.brandCollaborators ?? [];
  const cats = ["profile","employment","employer","role","skill","experience","accomplishment","project","preference","goal","product-service","sales-experience","business","brand","customer","prospect","collaborator","writing","business-role","process","other"];
  const roots = Array.isArray(s.settings?.importRoots) ? s.settings.importRoots : [];
  return `<h1>Knowledge / Import</h1>
<p class="lead">Owner profile, brand registry, and real file intake. Originals are preserved under private intake. AION never scans whole drives and never invents collaborator roles.</p>
<div class="card next"><h2>Direct select &amp; import (no path paste)</h2>
<p class="meta">Suggested: CAREER · BUSINESS · BRANDS · PROJECTS · PRODUCTS · SALES · COLLABORATORS · PERSONAL. Click folders in the desktop picker — AION registers and imports automatically.</p>
<p class="meta"><b>One Owner action:</b> run on this PC (AION must be running):</p>
<pre class="meta" style="white-space:pre-wrap">powershell -NoProfile -ExecutionPolicy Bypass -File C:\\AION-HQ\\scripts\\pick-import-folders-multi.ps1</pre>
<p class="meta">Or use the paths below only if you prefer manual root entry (not required).</p>
<p class="meta">Approved roots (${roots.length}): ${roots.length ? roots.map((r) => `<code>${esc(r)}</code>`).join(" · ") : "none yet."}</p>
<div class="actions"><button type="button" data-do="import-registry-refresh">Refresh import registry / coverage</button>
<button type="button" data-do="import-separate-e2e">Hide test/e2e workspaces from Owner view</button></div>
${window.__aionImportRegistry ? `<pre class="meta" style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(window.__aionImportRegistry)}</pre>` : ""}
<form data-form="import-root-add">
<label>Optional: approve import root by path
<input name="root" maxlength="500" placeholder="C:\\Users\\…\\Documents\\Career"></label>
<button>Save approved root</button>
</form>
<form data-form="folder-import">
<label>Import folder under an approved root (recursive, bounded)
<input name="path" required maxlength="4096" placeholder="C:\\Users\\…\\Documents\\Career\\Resume"></label>
<label>Tags<input name="tags" maxlength="500" placeholder="resume, owner-source"></label>
<button>Import folder now</button>
</form>
<form data-form="import-queue">
<label>Or queue path for on-demand processing
<input name="path" required maxlength="4096" placeholder="C:\\path\\owner-selected"></label>
<label>Kind<select name="kind"><option>folder</option><option>file</option><option>csv</option><option>json</option></select></label>
<label>Associate<select name="associateWith"><option value="none">none</option><option value="owner">owner knowledge</option><option value="business">business</option><option value="brand">brand</option><option value="customer">customer</option></select></label>
<button type="button" data-do="import-infer-ws">Preview workspace mapping</button>
<button>Queue source</button>
</form>
${window.__aionImportWs ? `<p class="meta next">Inferred workspace: <b>${esc(window.__aionImportWs.role)}</b> → ${esc(window.__aionImportWs.workspaceId || "needs review")} (${window.__aionImportWs.confidence}%) — ${esc(window.__aionImportWs.reason)}${window.__aionImportWs.needsReview ? " · REVIEW" : ""}</p>` : ""}
${(s.importSourceQueue ?? []).length ? `<div class="actions"><button data-do="import-queue-process" type="button">Process next queued source</button></div>
<p class="meta">Queue: ${(s.importSourceQueue ?? []).slice(0, 6).map((q) => `${esc(q.label)} [${esc(q.status)}]`).join("; ")}</p>` : ""}
${window.__aionImportSummary ? (() => {
  const sum = window.__aionImportSummary;
  const st = sum.lastSource?.stats || {};
  return `<div class="card next"><h2>Last import summary</h2>
<p class="meta">${esc(sum.lastSource?.label || "—")} · ${esc(sum.lastSource?.status || "")}</p>
<ul>
<li>Files discovered: <b>${st.filesDiscovered ?? "—"}</b></li>
<li>Files processed: <b>${st.filesProcessed ?? "—"}</b></li>
<li>Duplicates skipped: <b>${st.duplicatesSkipped ?? "—"}</b></li>
<li>Facts extracted: <b>${st.factsExtracted ?? "—"}</b></li>
<li>Entities associated: <b>${st.entitiesAssociated ?? "—"}</b></li>
<li>Needs review: <b>${sum.reviewOpen ?? st.reviewItems ?? 0}</b></li>
<li>Failures: <b>${st.errors ?? 0}</b>${sum.lastSource?.lastError ? ` — ${esc(sum.lastSource.lastError.slice(0, 120))}` : ""}</li>
</ul></div>`;
})() : ""}
${(() => {
  const review = (s.importReviewQueue ?? []).filter((r) => r.status === "needs-review").slice(0, 8);
  if (!review.length) return "";
  return `<div class="card warnbox"><h2>Review queue</h2>
${review.map((r) => `<article class="card"><p class="meta"><b>${esc(r.reason || "Ambiguous import")}</b></p>
<p class="meta">${esc(r.relativePath || r.sourcePath || "")}</p>
<p class="meta">${(r.candidates || []).slice(0, 4).map((c) => `${esc(c.kind)}: ${esc(c.label)} (${c.confidence}%)`).join(" · ")}</p>
<div class="actions">
<button data-do="import-review-accept" data-id="${esc(r.id)}">Accept</button>
<button data-do="import-review-reject" data-id="${esc(r.id)}" class="danger">Reject</button>
</div></article>`).join("")}
</div>`;
})()}
<p class="hint">Desktop tip: run <code>powershell -File scripts\\pick-import-folder.ps1</code> to pick a folder path, then paste it above. Browser security cannot open an arbitrary disk browser from the web UI.</p>
</div>
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
<form data-form="csv-contacts">
<label>Import contacts CSV
<textarea name="csvText" required maxlength="500000" placeholder="name,email,company&#10;Jane,jane@acme.test,Acme"></textarea></label>
<label>Source label<input name="sourceLabel" maxlength="200" value="owner-csv"></label>
<button>Import contacts from CSV</button>
</form>
<div class="card"><h2>Import dashboard</h2>
<div class="actions">
<button data-do="import-dashboard-refresh" type="button">Refresh import status</button>
<button data-do="import-readiness" type="button">Import readiness / first sources</button>
</div>
${importReadinessHtml(s)}
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

function mobileArea() {
  const r = model.remoteAccess ?? {};
  const m = r.mobile ?? {};
  const devices = model.devices ?? [];
  return `<h1>Mobile access</h1>
<p class="lead">Use AION from your phone at home (LAN) or away (private overlay such as Tailscale). No public port. Pair once.</p>
<div class="grid">
<article class="card"><h2>Desktop AION</h2><p class="meta"><b>${esc(m.desktopAion || "ONLINE")}</b></p>
<p class="meta">Local: <code>${esc(m.localAccessUrl || `http://127.0.0.1:${r.port || 31415}/`)}</code></p></article>
<article class="card"><h2>Private remote access</h2><p class="meta"><b>${esc(m.privateRemote || r.privateRemoteState || "OFF")}</b></p>
<p class="meta">${esc(r.summary || "")}</p>
${r.remoteUrl ? `<p class="meta"><b>Remote URL:</b> <a href="${esc(r.remoteUrl)}"><code>${esc(r.remoteUrl)}</code></a></p>` : `<p class="meta">No overlay URL yet — install Tailscale on desktop + phone for work cellular access.</p>`}
${r.remotePhoneUrl ? `<p class="meta"><b>Remote /phone:</b> <code>${esc(r.remotePhoneUrl)}</code></p>` : ""}
${r.localAppUrl ? `<p class="meta"><b>Home LAN URL:</b> <code>${esc(r.localAppUrl)}</code></p>` : ""}
</article>
<article class="card"><h2>Phone paired</h2><p class="meta"><b>${m.phonePaired ? "YES" : "NO"}</b>${m.phoneActiveSession ? " · session active" : ""}</p>
<p class="meta">Last connection: ${esc(m.lastPhoneConnection || "never")}</p>
<p class="meta">Last phone intake: ${esc(m.lastPhoneIntake || "never")}</p>
${devices.filter((d) => !d.revokedAt).map((d) => `<p class="meta"><b>${esc(d.label)}</b> · last ${esc(d.lastSeenAt || "—")}
<button data-do="device-revoke" data-id="${esc(d.id)}" class="danger">Revoke</button></p>`).join("") || "<p class=\"meta\">No paired phone.</p>"}
${devices.some((d) => !d.revokedAt) ? `<div class="actions"><button data-do="device-revoke-all" class="danger">Revoke all phones</button></div>` : ""}
</article>
<article class="card"><h2>Tailscale / overlay</h2>
<p class="meta">${r.tailscale?.installed ? `Installed ${esc(r.tailscale.version || "")}` : "Not installed on this desktop"}</p>
<p class="meta">${esc(r.tailscale?.detail || r.privateNetwork?.detail || "")}</p>
${r.tailscale?.ipv4 ? `<p class="meta">Overlay IPv4: <code>${esc(r.tailscale.ipv4)}</code></p>` : ""}
${r.tailscale?.dnsName ? `<p class="meta">Name: <code>${esc(r.tailscale.dnsName)}</code></p>` : ""}
</article>
</div>
${privateAccessCard()}`;
}

/** Console-only controls for bind/pair. Phones can read Mobile status but not mint codes. */
function privateAccessCard() {
  const r = model.remoteAccess ?? { enabled: false, bindAddress: "auto", sessionDays: 90, privateNetwork: { available: false, detail: "" }, summary: "" };
  const devices = model.devices ?? [];
  const suggested = r.lanDiscovery?.suggestedBind || "auto";
  const phoneUrl = r.remotePhoneUrl || r.phoneUrl || r.localPhoneUrl || "";
  const remoteUrl = r.remoteUrl || "";
  return `<div class="card"><h2>Private phone access</h2>
<p>${esc(r.summary)}</p>
<p class="meta">AION never opens a public port, never creates a tunnel, and never changes your router. Bind <code>auto</code> discovers LAN + Tailscale/overlay addresses — no manual IP to maintain. Pairing is still required.</p>
<p class="meta">Bound now: <code>${esc(r.boundAddress ?? "127.0.0.1")}</code> · remote state: <b>${esc(r.privateRemoteState || "OFF")}</b></p>
${remoteUrl ? `<p class="meta"><b>Away-from-home app URL:</b> <a href="${esc(remoteUrl)}"><code>${esc(remoteUrl)}</code></a></p>` : ""}
${phoneUrl ? `<p class="meta"><b>Phone intake URL:</b> <a href="${esc(phoneUrl)}"><code>${esc(phoneUrl)}</code></a></p>` : `<p class="meta">No phone URL yet — enable access and ensure LAN or Tailscale is up, then restart AION.</p>`}
<p class="meta">Physical LAN: ${r.lanDiscovery?.preferred ? `<code>${esc(r.lanDiscovery.preferred.address)}</code> (${esc(r.lanDiscovery.preferred.interfaceName || "")})` : "none"} · Overlay: ${r.lanDiscovery?.overlay ? `<code>${esc(r.lanDiscovery.overlay.address)}</code>` : (r.tailscale?.ipv4 ? `<code>${esc(r.tailscale.ipv4)}</code>` : "none")}</p>
${(r.lanDiscovery?.candidates || []).length ? `<details><summary>All private candidates</summary>${r.lanDiscovery.candidates.map((c) => `<p class="meta"><code>${esc(c.address)}</code> · ${esc(c.interfaceName)} · score ${c.score} · ${esc(c.reason)}</p>`).join("")}</details>` : ""}
<p class="meta">Private network tool: ${r.privateNetwork?.available ? `${esc(r.privateNetwork.tool)} ${esc(r.privateNetwork.version ?? "")} detected` : "not configured"} — ${esc(r.privateNetwork?.detail || "")}</p>
<form data-form="remote-access">
<label><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}> Allow paired devices to reach AION</label>
<label>Bind address (<code>auto</code> recommended — discovers LAN + overlay)
<input name="bindAddress" value="${esc(r.bindAddress === "127.0.0.1" ? "auto" : (r.bindAddress || "auto"))}" maxlength="60" placeholder="auto"></label>
<label>Keep phone signed in (days)<input name="sessionDays" type="number" min="1" max="365" value="${r.sessionDays || 90}"></label>
<button>Save access settings</button></form>
<div class="actions"><button data-do="lan-discover" type="button">Refresh discovery</button>
<button data-do="lan-use-suggested" data-ip="auto" type="button">Use auto discovery</button></div>
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

function connectorsCard() {
  const c = model.state?.settings?.connectors || {
    gmailClientId: "",
    gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
    metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
    metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
  };
  const g = model._gmailStatus;
  const m = model._metricoolStatus;
  return `<div class="card" id="gmail-connectors"><h2>Connectors → Gmail</h2>
<p class="meta"><b>Client Secret is entered here</b> (masked). It is saved only to this PC’s encrypted private secret store under <code>private/aion/secrets/</code> — not Git, not chat, not ordinary assistant state. Optional fallback env name: <code>AION_GMAIL_CLIENT_SECRET</code> (not required if you use this field).</p>
<p class="meta">GMAIL · METRICOOL — secrets never enter chat. Prefer: Save → Connect → Google Allow.</p>
<form data-form="connector-settings">
<label>Gmail — OAuth client id (public)
<input name="gmailClientId" maxlength="200" value="${esc(c.gmailClientId || "")}" placeholder="….apps.googleusercontent.com" autocomplete="off"></label>
<label>Gmail — OAuth client secret (local encrypted store only — never chat / never Git)
<input name="gmailClientSecret" type="password" maxlength="200" value="" placeholder="${g?.clientSecretConfigured ? "•••• saved locally — leave blank to keep" : "paste once from Google Cloud console"}" autocomplete="new-password"></label>
<label>Gmail redirect URI (loopback — must match Google Cloud Authorized redirect URI exactly)
<input name="gmailRedirectUri" maxlength="500" value="${esc(c.gmailRedirectUri || "http://127.0.0.1:31415/oauth/gmail/callback")}"></label>
<p class="meta">Required value: <code>http://127.0.0.1:31415/oauth/gmail/callback</code> — never <code>http://localhost:8080/oauth2callback</code>.</p>
<label>Metricool — env var <i>name</i> for user token (not the token value)
<input name="metricoolTokenEnvVar" maxlength="128" value="${esc(c.metricoolTokenEnvVar || "AION_METRICOOL_USER_TOKEN")}"></label>
<label>Metricool blog id env var name
<input name="metricoolBlogIdEnvVar" maxlength="128" value="${esc(c.metricoolBlogIdEnvVar || "AION_METRICOOL_BLOG_ID")}"></label>
<button type="submit">Save connector settings</button>
</form>
<div class="actions">
<button data-do="connector-gmail-status" type="button">Connect / check Gmail</button>
<button data-do="connector-gmail-sync" type="button">Sync recent Gmail</button>
<button data-do="connector-gmail-disconnect" type="button" class="danger">Disconnect Gmail</button>
<button data-do="connector-metricool-status" type="button">Connect / check Metricool</button>
</div>
${g ? `<article class="card"><h3>Gmail · ${esc(g.code)}</h3>
<p class="meta">${esc(g.message || "")}</p>
${g.ownerAction ? `<p class="meta"><b>Owner action:</b> ${esc(g.ownerAction)}</p>` : ""}
${(g.ownerSteps || []).length ? `<ol class="meta">${g.ownerSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
<p class="meta">clientId=${g.clientIdConfigured ? "yes" : "no"} · secret=${g.clientSecretConfigured ? "yes" : "no"} · refresh=${g.refreshConfigured ? "yes" : "no"} · localStore=${g.localSecretStore ? "yes" : "no"} · lastSync=${esc(g.lastSyncAt || "never")}</p>
${g.authUrl ? `<p class="meta"><a href="${esc(g.authUrl)}" target="_blank" rel="noopener"><b>Open Google consent → Allow</b></a></p>` : ""}
</article>` : `<p class="meta">Gmail status not loaded yet — press Connect / check Gmail.</p>`}
${m ? `<article class="card"><h3>Metricool · ${esc(m.code)}</h3>
<p class="meta">${esc(m.message || "")}</p>
${m.ownerAction ? `<p class="meta"><b>Owner action:</b> ${esc(m.ownerAction)}</p>` : ""}
<p class="meta">token env <code>${esc(m.userTokenEnvVar || "")}</code> · blog env <code>${esc(m.blogIdEnvVar || "")}</code> · fixtures brands=${m.fixtureBrands ?? 0} posts=${m.fixturePosts ?? 0}</p>
</article>` : `<p class="meta">Metricool status not loaded yet — press Check Metricool readiness.</p>`}
</div>`;
}

function importReadinessHtml(s) {
  const r = s._importReadiness || model._importReadiness;
  if (!r) return "";
  return `<article class="card"><h3>Gate · ${esc(r.code)} · ready=${r.ready ? "yes" : "no"} · REAL_OWNER_IMPORT_READY=${r.realOwnerImportReady ? "YES" : "NO"}</h3>
<p>${esc(r.summary)}</p>
<p class="meta">Roots ${r.stats?.approvedImportRoots ?? 0} · hashed docs ${r.stats?.documentsWithHash ?? 0} · review ${r.stats?.reviewOpen ?? 0}</p>
${(r.highestValueSourceTypes || []).length ? `<p class="meta"><b>First source types:</b> ${r.highestValueSourceTypes.map((t) => esc(t)).join(" · ")}</p>` : ""}
<ul>${(r.firstSources || []).slice(0, 5).map((src) => `<li><b>${esc(src.title)}</b> — ${esc(src.how)}</li>`).join("")}</ul>
${(r.ownerActions || []).length ? `<p class="meta"><b>Owner:</b> ${esc(r.ownerActions.join(" · "))}</p>` : ""}
</article>`;
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
  // Load Gmail status when Settings is shown so secret placeholder / Connect work without an extra click.
  if (!model._gmailStatus && !model._gmailStatusLoading) {
    model._gmailStatusLoading = true;
    api("connector.gmail.status", {}).then((st) => {
      model._gmailStatus = st;
      model._gmailStatusLoading = false;
      render();
    }).catch(() => { model._gmailStatusLoading = false; });
  }
  return `<h1>Settings</h1><p class="lead">Local privacy, provider, and data controls. <b>Gmail Client Secret</b> is entered in <a href="#gmail-connectors">Connectors → Gmail</a> below (local encrypted store) — not in the provider “credential environment-variable name” field.</p>
${connectorsCard()}
<form data-form="settings">
<label>Provider<select name="providerId">${p.map((x) => `<option value="${esc(x.id)}" ${x.id === s.settings.providerId ? "selected" : ""}>${esc(x.id)} — ${esc(x.location)}${x.available ? ", ready" : ", unavailable"}</option>`).join("")}</select></label>
<label>Model identifier<input name="model" value="${esc(s.settings.model)}" maxlength="200"></label>
<label><input type="checkbox" name="remoteDisclosureAccepted" ${s.settings.remoteDisclosureAccepted ? "checked" : ""}> I accept that a remote provider receives the conversation and any context I enable</label>
<label><input type="checkbox" name="memoryContextEnabled" ${s.settings.memoryContextEnabled ? "checked" : ""}> Memory context enabled for new conversations</label>
<label><input type="checkbox" name="includeMemoryByDefault" ${s.settings.privacy.includeMemoryByDefault ? "checked" : ""}> Include memory by default</label>
<label><input type="checkbox" name="schedulerEnabled" ${s.settings.schedulerEnabled ? "checked" : ""}> Routine scheduler enabled while AION is open</label>
<label><input type="checkbox" name="externalActionsRequireApproval" ${s.settings.externalActionsRequireApproval ? "checked" : ""}> Require an approval for every proposed action (capabilities marked always or external always require one regardless)</label>
<label>Activity retention (days)<input name="retainActivityDays" type="number" min="1" max="3650" value="${s.settings.privacy.retainActivityDays}"></label>
<label>Provider credential environment-variable <em>name</em> (not Gmail secret; never the token value)<input name="credentialEnvironmentVariable" value="${esc(s.settings.credentialEnvironmentVariable)}" maxlength="128" placeholder="AION_PROVIDER_TOKEN"></label>
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

function captureArea(s) {
  const ws = s.settings?.activeWorkspace ?? "personal";
  const wsLabel = s.settings?.workspaceLabels?.[ws] ?? ws;
  const last = window.__aionLastCapture;
  return `<div class="sales"><div class="sales-head"><h1>Capture</h1>
<p class="today"><span>Context <b>${esc(wsLabel)}</b></span></p></div>
<div class="card next"><h2>Universal capture</h2>
<p class="meta">Text or voice → note / follow-up / vehicle interest / idea. Provenance + timestamp. Confirm only when ambiguous.</p>
<form data-form="universal-capture" class="quick-form" id="captureForm">
<label>What happened?
<textarea name="text" id="captureText" required maxlength="10000" rows="4" placeholder="I just talked to Mike. He likes the Limited but wants under 50k. Follow up tomorrow." style="font-size:16px;min-height:6rem"></textarea></label>
<div class="tap-grid">
<button type="submit" style="min-height:3rem">Save capture</button>
<button type="button" data-do="capture-voice" style="min-height:3rem">Voice</button>
</div>
</form>
<div class="tap-grid quick" style="margin-top:.6rem">
<button type="button" data-do="context-personal">Personal</button>
<button type="button" data-do="context-lakeland">Lakeland Toyota</button>
<button type="button" data-do="attention-board">Attention board</button>
<button type="button" data-do="eod-wrap">Wrap my day</button>
</div>
</div>
${last ? `<div class="card"><h2>Last capture · ${esc(last.classification?.kind || "")}</h2>
<p class="meta">${esc(last.classification?.why || "")}</p>
<p class="meta">Applied: ${esc((last.applied || []).join("; ") || "—")}</p>
${last.classification?.needsConfirm ? `<p class="warn">Confirm needed — edit context or rephrase.</p>` : ""}
</div>` : ""}
<p class="hint">Voice uses browser speech recognition when available (no custom speech stack).</p>
</div>`;
}

function inventoryWalkArea(s) {
  const inv = s.vehicleInventory || { dealerships: [], vehicles: [], walks: [], observations: [], onlineListings: [] };
  const dealer = (inv.dealerships || []).find((d) => d.isCurrent) || inv.dealerships?.[0];
  const walk = (inv.walks || []).find((w) => w.state === "active");
  const lastObs = (inv.observations || []).filter((o) => !walk || o.walkId === walk.id).slice(0, 8);
  const last = window.__aionLastWalkObs;
  const summary = window.__aionWalkSummary;
  return `<div class="sales inventory-walk">
<div class="sales-head"><h1>Inventory Walk</h1>
<p class="today"><span>Dealer <b>${esc(dealer?.name || "not set")}</b></span>
<span>Online <b>${(inv.onlineListings || []).length || (inv.vehicles || []).filter((v) => v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED").length}</b></span>
<span>Walk <b>${walk ? "ACTIVE" : "idle"}</b></span></p></div>
<div class="card next">
<p class="meta">Physical Owner observation is stronger on-lot evidence than a public web listing. Online listing ≠ on the lot.</p>
<div class="tap-grid quick">
<button type="button" data-do="dealership-lakeland" class="row">Use Lakeland Toyota</button>
<button type="button" data-do="inventory-refresh" class="row">Refresh public inventory</button>
${walk
  ? `<button type="button" data-do="inventory-walk-end" class="row">End walk · summary</button>
<button type="button" data-do="inventory-walk-end-complete" class="row">End · mark area complete</button>`
  : `<button type="button" data-do="inventory-walk-start" class="row" style="min-height:3.2rem;font-size:1.05rem"><b>START WALK</b></button>`}
</div>
</div>
${last ? `<div class="card next"><h2>Last scan</h2>
<p style="font-size:1.15rem;font-weight:700;letter-spacing:.04em">${esc(last.observation?.vin || "—")}</p>
<p class="meta">${esc([last.vehicle?.year, last.vehicle?.make, last.vehicle?.model, last.vehicle?.trim].filter(Boolean).join(" ") || "Decode/refresh for YMMT")}</p>
<p class="meta">Stock <b>${esc(last.observation?.stockNumber || "—")}</b> · Online match <b>${esc(last.observation?.matchStatus || "—")}</b></p>
<p class="meta">VIN check: ${esc(last.validation?.code || "—")} ${last.validation?.valid ? "✓" : "✗"}</p>
</div>` : ""}
${window.__aionVinOcr ? `<div class="card ${window.__aionVinOcr.status === "VIN_OCR_HIGH_CONFIDENCE" ? "next" : "warnbox"}"><h2>VIN OCR · ${esc(window.__aionVinOcr.status)}</h2>
<p class="meta">${esc(window.__aionVinOcr.message || "")}</p>
${(window.__aionVinOcr.qualityFeedback || []).map((t) => `<p class="meta">• ${esc(t)}</p>`).join("")}
${window.__aionVinOcr.sticker?.stockNumber ? `<p class="meta">Stock from sticker: <b>${esc(window.__aionVinOcr.sticker.stockNumber)}</b></p>` : ""}
<p class="meta">Provider: ${esc(window.__aionVinOcr.provider || "?")}</p>
<div class="actions">
<button type="button" data-do="vin-ocr-confirm" style="min-height:3rem">Confirm VIN · SAVE</button>
<button type="button" data-do="vin-ocr-clear">Clear proposal</button>
</div></div>` : ""}
<div class="card"><h2>${walk ? "Next vehicle" : "Ready when you start"}</h2>
<form data-form="walk-observe" class="quick-form" id="walkObserveForm">
<label>VIN (large field — edit OCR proposal or type)
<input name="vin" id="walkVinInput" maxlength="20" autocapitalize="characters" autocomplete="off" value="${esc(window.__aionVinOcr?.best?.vin || "")}" placeholder="Enter or paste VIN" style="font-size:1.25rem;min-height:3.1rem;letter-spacing:.08em;font-weight:700"></label>
<label>Stock # (optional)
<input name="stockNumber" id="walkStockInput" maxlength="40" value="${esc(window.__aionVinOcr?.sticker?.stockNumber || "")}" style="font-size:16px;min-height:2.75rem"></label>
<label>Note (optional)
<input name="note" maxlength="500" style="font-size:16px"></label>
<label>VIN / stock photo — OCR then confirm
<input type="file" name="file" accept="image/*" capture="environment" style="font-size:16px"></label>
<div class="tap-grid" style="margin:.4rem 0">
<button type="button" data-do="vin-ocr-scan" style="min-height:2.9rem">Read photo (OCR)</button>
</div>
<button type="submit" style="min-height:3.2rem;width:100%;font-size:1.05rem">SAVE · NEXT VEHICLE</button>
</form>
<p class="hint">Uncertain VINs are never silently verified. High-confidence OCR still shows Confirm. Manual entry always works.</p>
</div>
${summary ? `<div class="card warnbox"><h2>Walk summary</h2>
<ul>${(summary.exceptionsFirst || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
<p class="meta">Online ${summary.onlineInventoryCount} · Observed ${summary.physicallyObservedCount} · Matched ${summary.matchedCount}</p>
<p class="meta">${esc(summary.caveat || "")}</p>
</div>` : ""}
<div class="card"><h2>This walk</h2>
${lastObs.length ? lastObs.map((o) => `<p class="meta"><b>${esc(o.vin || "?")}</b> · ${esc(o.matchStatus)} · stock ${esc(o.stockNumber || "—")}${o.note ? ` · ${esc(o.note.slice(0, 60))}` : ""}</p>`).join("") : `<p class="meta">No observations yet.</p>`}
</div>
<div class="card"><h2>Ask inventory</h2>
<form data-form="assistant-prompt" class="quick-form">
<label>Question
<input name="text" required maxlength="2000" placeholder="Do we have any 2025 Camrys?" style="font-size:16px"></label>
<button type="submit">Ask</button>
</form>
</div>
</div>`;
}

function intakeArea(s) {
  const people = scoped(s.relationships ?? []).filter((r) => !r.archivedAt);
  return `<h1>Intake</h1>
<p class="lead">Upload photos, screenshots, and files from this phone into production AION. Vision extraction is optional later — upload works now.</p>
<div class="tap-grid"><a class="row" href="/phone" style="text-decoration:none"><span class="row-main"><b>Open dedicated phone intake</b><span class="row-sub">Take photo · choose file · note</span></span></a></div>
<div class="card"><h2>Upload here</h2>
<form data-form="document-upload">
<label>Take or choose photo / file
<input type="file" name="file" required accept="image/*,.txt,.pdf,.csv,.json,.md,.docx,.png,.jpg,.jpeg,.webp" capture="environment"></label>
<label>Associate with customer (optional)
<select name="relationshipId"><option value="">— none —</option>
${people.map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`).join("")}</select></label>
<label>Note<input name="summary" maxlength="2000" placeholder="Optional note"></label>
<label>Tags<input name="tags" maxlength="500" value="phone-intake" placeholder="phone-intake, receipt"></label>
<button>Upload to AION</button>
</form></div>
<p class="meta">Recent documents: ${(s.crmDocuments ?? []).slice(0, 8).map((d) => `${esc(d.filename || d.id)} (${esc((d.tags || []).join(",") || "no tags")})`).join(" · ") || "none yet"}</p>`;
}

function page() {
  const s = model.state;
  if (area === "Home") return homeArea(s);
  if (area === "Customers" || area === "People") return area === "Customers" ? salesArea(s) : peopleArea(s);
  if (area === "Capture") return captureArea(s);
  if (area === "Intake") return intakeArea(s);
  if (area === "Inventory Walk") return inventoryWalkArea(s);
  if (area === "Mobile") return mobileArea();
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

const mobileDebugEnabled = () => {
  try { return new URLSearchParams(window.location.search).get("mobiledebug") === "1"; }
  catch { return false; }
};

function currentContextLabel() {
  const s = model?.state;
  if (!s) return "";
  const ws = s.settings?.activeWorkspace ?? "personal";
  const binding = s.executive?.context?.bindings?.find((b) => b.workspaceId === ws);
  if (binding?.label) return binding.label;
  if (ws === "work") return s.settings?.workspaceLabels?.work || "Lakeland Toyota";
  return s.settings?.workspaceLabels?.[ws] || ws;
}

function connectionBadgeText() {
  const ra = model?.remoteAccess;
  const provider = (model?.providers ?? []).find((x) => x.id === model?.state?.settings?.providerId);
  const ctx = currentContextLabel();
  if (model?.viewer === "device") {
    if (ra?.privateRemoteState === "READY" || ra?.tailscale?.ipv4) return ctx ? `● ${ctx}` : "● Private remote";
    if (ra?.enabled) return ctx ? `● ${ctx}` : "● Private";
    return ctx ? `● ${ctx}` : "● Connected";
  }
  if (ra?.privateRemoteState === "READY") return "● Tailscale ready";
  if (provider?.location === "remote") return `● Remote model (${provider.id})`;
  return "● Local desktop";
}

function fillWorkspaceSwitch(el) {
  if (!el || !model) return;
  const active = model.state.settings.activeWorkspace ?? "personal";
  const registry = (model.state.workspaces ?? []).filter((w) => !w.archived);
  el.innerHTML = registry.map((w) => `<button type="button" class="${w.id === active ? "active" : ""}" data-workspace="${esc(w.id)}">${esc(w.label)}</button>`).join("");
  el.dataset.active = active;
}

function paintPhoneNav(nav) {
  if (!nav) return;
  const primaryActive = mobileMoreAreas.has(area) ? "More" : area;
  nav.innerHTML = mobilePrimaryAreas.map((x) => {
    if (x === "More") {
      return `<button type="button" class="${primaryActive === "More" ? "active" : ""}" data-do="more-open">More</button>`;
    }
    return `<button type="button" class="${x === area ? "active" : ""}" data-area="${x}">${x}</button>`;
  }).join("");
}

function describeEl(el) {
  if (!el) return { EXISTS: false };
  const cs = window.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    EXISTS: true,
    className: el.className || "",
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    position: cs.position,
    overflow: cs.overflow,
    zIndex: cs.zIndex,
    width: Math.round(r.width),
    height: Math.round(r.height),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    parent: el.parentElement ? `${el.parentElement.tagName}.${el.parentElement.className}` : null,
    parentW: el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().width) : null,
    parentH: el.parentElement ? Math.round(el.parentElement.getBoundingClientRect().height) : null,
  };
}

function buildMobileDebugBanner(contentRoot) {
  const chatPanel = contentRoot?.querySelector?.(".aion-chat-phone, #aionChatPanel");
  const chatForm = contentRoot?.querySelector?.("form[data-form='assistant-prompt'], #aionChatForm");
  const nav = document.getElementById("aionPhoneNav");
  const vv = window.visualViewport;
  const lines = [
    "MOBILE CONTENT ROOT ALIVE",
    `activeSection=${area}`,
    `viewer=${model?.viewer ?? "?"}`,
    `onboardingComplete=${model?.state?.onboardingComplete}`,
    `inner=${window.innerWidth}x${window.innerHeight}`,
    `visualViewport=${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : "n/a"}`,
    `clientH=${document.documentElement.clientHeight} scrollH=${document.documentElement.scrollHeight} bodyScrollH=${document.body.scrollHeight}`,
    `contentRoot=${JSON.stringify(describeEl(contentRoot))}`,
    `chatPanel=${JSON.stringify(describeEl(chatPanel))}`,
    `chatForm=${JSON.stringify(describeEl(chatForm))}`,
    `mobileNav=${JSON.stringify(describeEl(nav))}`,
  ];
  return `<div class="aion-mobile-debug-banner" id="aionMobileDebugBanner">${esc(lines.join("\n"))}</div>
<p class="aion-dbg-panel" id="aionChatPanelProbe" style="padding:.5rem;margin:0 0 .75rem;background:var(--panel-2)">CHAT PANEL RENDER TEST</p>`;
}

function applyMobileDebugOutlines(contentRoot) {
  if (!mobileDebugEnabled() || !contentRoot) return;
  contentRoot.classList.add("aion-dbg-content");
  contentRoot.querySelector(".aion-chat-phone, #aionChatPanel")?.classList.add("aion-dbg-panel");
  contentRoot.querySelector("form[data-form='assistant-prompt'], #aionChatForm")?.classList.add("aion-dbg-form");
  // Log to console for remote debugging if available
  try {
    console.info("[AION mobiledebug]", {
      area,
      content: describeEl(contentRoot),
      chat: describeEl(contentRoot.querySelector(".aion-chat-phone")),
      form: describeEl(contentRoot.querySelector("form[data-form='assistant-prompt']")),
      nav: describeEl(document.getElementById("aionPhoneNav")),
    });
  } catch { /* ignore */ }
}

function renderPageHtml() {
  const onboarded = model?.state?.onboardingComplete === true;
  if (!onboarded) {
    return `<div class="empty"><h1>Welcome</h1><p>Complete onboarding on the desktop first, or tap below if you are the Owner on loopback.</p>
<button type="button" data-action="onboarding">Start offline provider</button></div>`;
  }
  try {
    const html = page();
    if (html && String(html).trim()) return html;
    return `<div class="empty">Panel empty for section <b>${esc(area)}</b>.</div>`;
  } catch (err) {
    return `<div class="empty">UI error in <b>${esc(area)}</b>: ${esc(err?.message || err)}</div>`;
  }
}

function render() {
  if (!model) return;
  const phoneUi = usePhoneChrome();
  if (!window.__aionPhoneAreaInit && phoneUi) {
    window.__aionPhoneAreaInit = true;
    area = "Chat";
  }

  document.documentElement.classList.toggle("aion-phone-mode", phoneUi);
  document.body.classList.toggle("aion-phone-mode", phoneUi);

  const phoneShell = document.getElementById("aionPhoneShell");
  const desktopShell = document.getElementById("aionDesktopShell");
  if (phoneShell) phoneShell.hidden = !phoneUi;
  if (desktopShell) desktopShell.hidden = phoneUi;

  const badgeText = connectionBadgeText();
  const badgeClass = `aion-conn-badge ${model.viewer === "device" || model.remoteAccess?.privateRemoteState === "READY" ? "private connected" : "local"}`;
  for (const id of ["providerBadge", "phoneConnBadge"]) {
    const el = document.getElementById(id);
    if (el) { el.textContent = badgeText; el.className = badgeClass; }
  }
  fillWorkspaceSwitch(document.getElementById("workspaceSwitch"));
  fillWorkspaceSwitch(document.getElementById("phoneWorkspaceSwitch"));

  let pageHtml = renderPageHtml();
  if (mobileDebugEnabled()) {
    // Banner prepended after we know the content root
  }

  if (phoneUi) {
    paintPhoneNav(document.getElementById("aionPhoneNav"));
    const contentRoot = document.getElementById("aionPhoneContent");
    if (contentRoot) {
      const debugPrefix = mobileDebugEnabled() ? buildMobileDebugBanner(null) : "";
      // Rebuild banner after paint for accurate rects — first paint includes static probe text
      contentRoot.innerHTML = (mobileDebugEnabled()
        ? `<div class="aion-mobile-debug-banner">MOBILE CONTENT ROOT ALIVE\nactiveSection=${esc(area)}\n(measuring…)</div>
<p class="aion-dbg-panel" style="padding:.5rem;margin:0 0 .75rem;background:var(--panel-2)">CHAT PANEL RENDER TEST</p>`
        : "") + pageHtml;
      // Ensure chat panel has stable ids for measurement
      const chatRoot = contentRoot.querySelector(".aion-chat-phone");
      if (chatRoot) chatRoot.id = "aionChatPanel";
      const chatForm = contentRoot.querySelector("form[data-form='assistant-prompt']");
      if (chatForm) chatForm.id = "aionChatForm";
      applyMobileDebugOutlines(contentRoot);
      if (mobileDebugEnabled()) {
        // Second pass: fill measured geometry into banner
        requestAnimationFrame(() => {
          const banner = contentRoot.querySelector("#aionMobileDebugBanner, .aion-mobile-debug-banner");
          if (banner) banner.outerHTML = buildMobileDebugBanner(contentRoot);
          applyMobileDebugOutlines(contentRoot);
        });
      }
    }
  } else {
    const nav = document.getElementById("aionAreaNav");
    if (nav) {
      nav.classList.remove("aion-mobile-nav");
      nav.innerHTML = areas.map((x) => `<button type="button" class="${x === area ? "active" : ""}" data-area="${x}">${x}</button>`).join("");
    }
    const onboarded = model.state.onboardingComplete === true;
    const onboardingEl = document.querySelector("#onboarding");
    const contentEl = document.querySelector("#content");
    if (onboardingEl) onboardingEl.hidden = onboarded;
    if (contentEl) {
      contentEl.hidden = !onboarded;
      if (onboarded) contentEl.innerHTML = pageHtml;
    }
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { area: target, areaJump, action, do: verb, id, state, enabled, value, workspace, tab, sheet: sheetName, kind, followup, appt, status, template, archived, step, stage, result, ref } = button.dataset;
  // areaJump belongs in this guard: without it every `data-area-jump` button (the whole More sheet,
  // plus the Capture/Customers/Inventory shortcuts) fell through this early return and the branch
  // that handles them below was unreachable. On the phone that reads as a menu that does nothing.
  if (!target && !areaJump && !action && !verb && !workspace) return; // a plain form submit button; the submit handler owns it
  event.preventDefault();
  try {
    if (workspace) { await api("settings.update", { settings: { activeWorkspace: workspace } }); openCustomer = null; openSheet = null; coachPanel = null; await load(); toast(`Switched to ${model.state.settings.workspaceLabels?.[workspace] ?? workspace}. Records stay in the workspace they were created in.`); return; }
    if (target) { area = target; openCustomer = null; openSheet = null; coachPanel = null; render(); return; }
    if (button.dataset.areaJump) {
      area = button.dataset.areaJump;
      openCustomer = null; openSheet = null; coachPanel = null;
      const more = document.getElementById("aionMoreSheet");
      if (more) more.hidden = true;
      render();
      return;
    }
    if (verb === "attach-camera" || verb === "attach-file") {
      // The hidden inputs live inside the chat form; opening the picker is a direct result of this
      // tap, which is what iOS Safari requires (a deferred .click() is ignored).
      const input = document.getElementById(verb === "attach-camera" ? "aionCaptureInput" : "aionPickInput");
      if (!input) { toast("Attachment control is unavailable on this screen."); return; }
      input.click();
      return;
    }
    if (verb === "attach-remove") { pendingAttachment = null; render(); return; }
    if (verb === "more-open") {
      const more = document.getElementById("aionMoreSheet");
      if (more) more.hidden = false;
      return;
    }
    if (verb === "more-close") {
      const more = document.getElementById("aionMoreSheet");
      if (more) more.hidden = true;
      return;
    }
    if (verb === "briefing-refresh") {
      const b = await api("work.briefing", {});
      window.__aionLastBriefing = b.text || b.reply || JSON.stringify(b).slice(0, 2000);
      render();
      toast("Briefing refreshed from stored facts.");
      return;
    }
    if (verb === "voice-prompt") {
      // Prefer explicit MediaRecorder (upload + local STT). Fall back to browser speech recognition
      // only for live dictation into the composer. Never continuous/ambient recording.
      if (voiceRecording?.recorder) {
        try { voiceRecording.recorder.stop(); } catch { /* */ }
        toast("Stopping recording…");
        return;
      }
      if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
              ? "audio/webm"
              : "";
          const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
          const chunks = [];
          recorder.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
          recorder.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            voiceRecording = null;
            try {
              const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
              if (!blob.size) { toast("Recording was empty."); render(); return; }
              const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
              await stageAttachment(file);
              toast("Recording staged — tap Send to transcribe and ask, or remove.");
            } catch (err) {
              toast(err.message || "Could not stage recording.");
            }
            render();
          };
          recorder.onerror = () => {
            stream.getTracks().forEach((t) => t.stop());
            voiceRecording = null;
            toast("Recording failed. Type instead.");
            render();
          };
          voiceRecording = { recorder, chunks, startedAt: Date.now() };
          recorder.start(250);
          toast("Recording… tap 🎤 again to stop. (Not continuous surveillance.)");
          render();
          return;
        } catch {
          // Fall through to SpeechRecognition if mic permission denied / unavailable.
        }
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast("Microphone capture is not available in this browser. Type instead."); return; }
      const rec = new SR();
      rec.lang = "en-US";
      rec.onresult = (ev) => {
        const text = ev.results?.[0]?.[0]?.transcript || "";
        const ta = document.getElementById("aionChatInput")
          || document.querySelector('form[data-form="assistant-prompt"] textarea[name="text"]')
          || document.querySelector('textarea[name="text"]');
        if (!ta || !text) return;
        ta.value = ta.value.trim() ? `${ta.value.trim()} ${text}` : text;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.focus();
        toast("Live dictation captured — review and tap Send.");
      };
      rec.onerror = () => toast("Voice capture failed. Type instead.");
      rec.start();
      toast("Listening (browser speech)…");
      return;
    }
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
      try { window.__aionImportSummary = await api("import.lastSummary", {}); } catch { /* ignore */ }
    }
    if (verb === "import-registry-refresh") {
      try {
        const reg = await api("import.registry", {});
        const cov = await api("import.knowledgeCoverage", {});
        window.__aionImportRegistry = `${reg.reply || ""}\n\n${cov.reply || ""}`;
        toast("Import registry + knowledge coverage refreshed.");
      } catch (e) {
        toast(String(e.message || e));
      }
      render();
      return;
    }
    if (verb === "import-separate-e2e") {
      const r = await api("import.separateTestWorkspaces", {});
      toast(`Archived ${r.archived?.length || 0} test/e2e workspace(s) from Owner view.`);
      await load();
      return;
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
    if (verb === "import-readiness") {
      const readiness = await api("import.readiness", {});
      model._importReadiness = readiness;
      if (model.state) model.state._importReadiness = readiness;
      toast(`${readiness.code}: ready=${readiness.ready}`);
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
    if (verb === "connector-gmail-status") {
      model._gmailStatus = await api("connector.gmail.status", {});
      toast(`Gmail: ${model._gmailStatus.code}`);
      if (model._gmailStatus.authUrl && model._gmailStatus.code !== "READY") {
        // Offer consent open when configured
        try {
          window.open(model._gmailStatus.authUrl, "_blank", "noopener");
        } catch { /* popup blocked */ }
      }
      render();
      return;
    }
    if (verb === "connector-gmail-sync") {
      toast("Gmail sync starting (encrypted backup first)…");
      const sync = await api("connector.gmail.sync", { maxMessages: 25 });
      toast(sync.ok ? sync.message : `Gmail sync: ${sync.message || sync.code || "failed"}`);
      model._gmailStatus = await api("connector.gmail.status", {});
      await load();
      return;
    }
    if (verb === "connector-gmail-disconnect") {
      if (!confirm("Disconnect Gmail local credentials on this PC?")) return;
      await api("connector.gmail.disconnect", {});
      model._gmailStatus = await api("connector.gmail.status", {});
      toast("Gmail disconnected (local store cleared).");
      render();
      return;
    }
    if (verb === "connector-metricool-status") {
      model._metricoolStatus = await api("connector.metricool.status", {});
      toast(`Metricool: ${model._metricoolStatus.code}`);
      render();
      return;
    }
    if (verb === "dealership-lakeland") {
      await api("dealership.ensureLakeland", { setCurrent: true, ownerWorksHere: true });
      toast("Lakeland Toyota set as current dealership (Owner-supplied).");
      await load();
      return;
    }
    if (verb === "inventory-refresh") {
      toast("Refreshing public inventory…");
      const result = await api("inventory.refresh", {});
      toast(`${result.mode}: ${result.listings?.length ?? 0} listing(s). Online ≠ on lot.`);
      await load();
      return;
    }
    if (verb === "inventory-walk-start") {
      await api("inventory.walk.start", {});
      window.__aionWalkSummary = null;
      toast("Walk started. Scan or enter VIN, then NEXT.");
      await load();
      return;
    }
    if (verb === "inventory-walk-end" || verb === "inventory-walk-end-complete") {
      const done = await api("inventory.walk.end", {
        coverageDeclaredComplete: verb === "inventory-walk-end-complete",
      });
      window.__aionWalkSummary = done.summary;
      toast(`Walk ended · ${done.summary?.physicallyObservedCount ?? 0} observed`);
      await load();
      return;
    }
    if (verb === "vin-ocr-scan") {
      const form = document.getElementById("walkObserveForm") || document.querySelector('form[data-form="walk-observe"]');
      const fileInput = form?.querySelector('input[type="file"]');
      const file = fileInput?.files?.[0];
      if (!file) throw new Error("Choose a VIN / stock photo first.");
      if (file.size > 6 * 1024 * 1024) throw new Error("Photo exceeds 6 MB.");
      toast("Reading photo…");
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const ocr = await api("vin.ocr", {
        filename: file.name || "vin.jpg",
        mimeType: file.type || "image/jpeg",
        contentBase64: btoa(binary),
      });
      window.__aionVinOcr = ocr;
      const vinInput = document.getElementById("walkVinInput");
      const stockInput = document.getElementById("walkStockInput");
      if (ocr.best?.vin && vinInput) vinInput.value = ocr.best.vin;
      if (ocr.sticker?.stockNumber && stockInput) stockInput.value = ocr.sticker.stockNumber;
      toast(ocr.message || ocr.status);
      render();
      return;
    }
    if (verb === "vin-ocr-confirm") {
      const ocr = window.__aionVinOcr;
      if (!ocr?.best?.vin) throw new Error("No VIN proposal to confirm.");
      const active = await api("inventory.walk.active", {});
      if (!active.walk) await api("inventory.walk.start", {});
      const result = await api("inventory.walk.observe", {
        vin: ocr.best.vin,
        stockNumber: ocr.sticker?.stockNumber || undefined,
        entryMethod: "photo",
        recognitionConfidence: ocr.best.confidence,
        note: `OCR ${ocr.status} via ${ocr.provider}`,
      });
      window.__aionLastWalkObs = result;
      window.__aionVinOcr = null;
      toast(`Confirmed · ${result.observation?.matchStatus || "saved"}`);
      await load();
      return;
    }
    if (verb === "vin-ocr-clear") {
      window.__aionVinOcr = null;
      render();
      return;
    }
    if (verb === "context-personal") {
      await api("context.switch", { name: "Personal" });
      toast("Context → Personal");
      await load();
      return;
    }
    if (verb === "context-lakeland") {
      await api("context.switch", { name: "Lakeland Toyota" });
      toast("Context → Lakeland Toyota (Work)");
      await load();
      return;
    }
    if (verb === "attention-board") {
      const board = await api("attention.board", {});
      window.__aionLastBriefing = (board.briefingLines || []).join("\n");
      toast("Attention board refreshed");
      await load();
      return;
    }
    if (verb === "eod-wrap") {
      const wrap = await api("executive.eod", {});
      window.__aionLastBriefing = wrap.reply;
      toast("End-of-day wrap ready");
      await load();
      return;
    }
    if (verb === "executive-cycle") {
      toast("Running executive cycle…");
      const cycle = await api("executive.cycle", {});
      window.__aionLastBriefing = [
        `Cycle ${cycle.cycleId}`,
        `Completed ${cycle.jobsCompleted}/${cycle.jobsExecuted} · Owner req ${cycle.jobsOwnerRequired}`,
        ...(cycle.aionCompleted || []).slice(0, 4),
        "Owner:",
        ...(cycle.ownerMustDo || []).slice(0, 3),
      ].join("\n");
      toast(`Cycle done · ${cycle.jobsCompleted} completed`);
      await load();
      return;
    }
    if (verb === "capture-voice") {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast("Speech recognition not available in this browser."); return; }
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const text = ev.results?.[0]?.[0]?.transcript || "";
        const ta = document.getElementById("captureText");
        if (ta) ta.value = text;
        toast("Voice captured — review and Save");
      };
      rec.onerror = () => toast("Voice capture failed");
      rec.start();
      toast("Listening…");
      return;
    }
    if (verb === "import-infer-ws") {
      const pathInput = document.querySelector('form[data-form="import-queue"] input[name="path"], form[data-form="folder-import"] input[name="path"]');
      const path = pathInput?.value?.trim();
      if (!path) throw new Error("Enter a path first.");
      const assoc = document.querySelector('form[data-form="import-queue"] select[name="associateWith"]')?.value;
      window.__aionImportWs = await api("import.inferWorkspace", { path, associateWith: assoc || undefined });
      toast(`Workspace: ${window.__aionImportWs.role}${window.__aionImportWs.needsReview ? " (review)" : ""}`);
      render();
      return;
    }
    await load();
  } catch (error) { toast(error.message); }
});

const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Read a picked file into the composer. Preview is a data URL, so nothing is stored until send. */
async function stageAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than the 6 MB limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = base64FromBytes(bytes);
  const mimeType = file.type || "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  const isAudio = mimeType.startsWith("audio/") || /\.(wav|mp3|m4a|webm|ogg|flac)$/i.test(file.name || "");
  const kb = file.size / 1024;
  pendingAttachment = {
    name: file.name || (isImage ? "photo.jpg" : isAudio ? "recording.webm" : "attachment"),
    mimeType: isAudio && !mimeType.startsWith("audio/") ? "audio/webm" : mimeType,
    base64,
    isImage,
    isAudio,
    dataUrl: isImage ? `data:${mimeType};base64,${base64}` : "",
    sizeLabel: kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`,
    status: "",
  };
}

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (input?.id !== "aionCaptureInput" && input?.id !== "aionPickInput") return;
  const file = input.files?.[0];
  input.value = ""; // let the same photo be picked twice in a row
  if (!file) return;
  try {
    await stageAttachment(file);
    render();
  } catch (error) {
    toast(error.message || "Could not read that file.");
  }
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
      const text = String(d.text || "").trim();
      const attachment = pendingAttachment;
      if (!text && !attachment) { toast("Type a message, attach a photo, or record audio."); return; }

      // Audio path: private upload + local STT + same Chat pipeline (no cellular-call claim).
      if (attachment?.isAudio) {
        pendingAttachment = { ...attachment, status: "transcribing…" };
        render();
        const result = await api("audio.voice_to_chat", {
          contentBase64: attachment.base64,
          mimeType: attachment.mimeType,
          filename: attachment.name,
          textPrefix: text || "",
        });
        const tr = result?.transcript;
        window.__aionLastAssistant = {
          ...result,
          reply: result?.reply
            || (tr?.fullText
              ? `Transcript (fallible speech text):\n${tr.fullText}`
              : tr?.message || "Could not transcribe audio."),
          attachmentName: attachment.name,
        };
        pendingAttachment = null;
        form.reset();
        await load();
        render();
        if (tr?.status === "TRANSCRIPTION_PROVIDER_REQUIRED") {
          toast("Audio stored privately; local STT engine not ready. Install faster-whisper or set AION_WHISPER_CMD.");
        }
        return;
      }

      let documentRef = null;
      if (attachment) {
        // Store the image first so the question is answered against a real stored document rather
        // than a transient upload; the reply then has something durable to cite.
        pendingAttachment = { ...attachment, status: "sending…" };
        render();
        const doc = await api("crm.document.upload", {
          filename: attachment.name,
          mimeType: attachment.mimeType,
          contentBase64: attachment.base64,
          tags: ["chat-attachment", attachment.isImage ? "photo" : "file"],
        });
        documentRef = doc?.id || doc?.sourceRef || null;
      }

      const result = await api("assistant.prompt", {
        text: text || (attachment?.isImage ? "What vehicle is this and what do we know about it?" : "What is this file?"),
        ...(documentRef ? { documentRef } : {}),
        ...(attachment?.isImage
          ? { imageBase64: attachment.base64, imageMimeType: attachment.mimeType, imageFilename: attachment.name }
          : {}),
      });
      window.__aionLastAssistant = { ...result, attachmentName: attachment ? attachment.name : null };
      pendingAttachment = null;
      // The reply itself is the feedback; an intent name is developer diagnostics, not Owner UI.
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
    if (kind === "universal-capture") {
      const result = await api("capture.universal", { text: d.text, apply: true });
      window.__aionLastCapture = result;
      toast(result.classification?.needsConfirm ? "Capture needs confirm" : `Captured · ${result.classification?.kind}`);
      form.reset();
      await load();
      return;
    }
    if (kind === "vehicle-associate") {
      const linked = await api("vehicle.associate", {
        relationshipId: d.relationshipId,
        vin: d.vin,
      });
      toast(`Linked ${linked.vin || linked.id} to customer (Owner-asserted).`);
      form.reset();
      await load();
      return;
    }
    if (kind === "walk-observe") {
      let photoDocumentIds = [];
      let ocrMeta = null;
      const fileInput = form.querySelector('input[type="file"]');
      const file = fileInput?.files?.[0];
      let vin = String(d.vin || "").trim();
      let stockNumber = String(d.stockNumber || "").trim();
      if (file) {
        if (file.size > 6 * 1024 * 1024) throw new Error("Photo exceeds 6 MB limit.");
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        const contentBase64 = btoa(binary);
        const doc = await api("crm.document.upload", {
          filename: file.name || "vin-photo.jpg",
          mimeType: file.type || "image/jpeg",
          contentBase64,
          tags: ["inventory-walk", "vin-photo", "phone-intake"],
          summary: vin ? `Walk photo for VIN ${vin}` : "Walk photo (VIN pending)",
        });
        photoDocumentIds = [doc.id];
        // If VIN empty, run OCR and require confirm rather than silent save
        if (!vin) {
          ocrMeta = await api("vin.ocr", {
            filename: file.name || "vin.jpg",
            mimeType: file.type || "image/jpeg",
            contentBase64,
          });
          window.__aionVinOcr = ocrMeta;
          if (ocrMeta.best?.vin) {
            vin = ocrMeta.best.vin;
            if (!stockNumber && ocrMeta.sticker?.stockNumber) stockNumber = ocrMeta.sticker.stockNumber;
          }
          if (ocrMeta.status !== "VIN_OCR_HIGH_CONFIDENCE" || !ocrMeta.best?.valid) {
            toast(ocrMeta.message || "VIN uncertain — confirm or edit, then SAVE.");
            render();
            return;
          }
        }
      }
      if (!vin && !photoDocumentIds.length) throw new Error("Enter a VIN or take a photo.");
      if (!vin) {
        toast("VIN uncertain — confirm or retake photo.");
        render();
        return;
      }
      const active = await api("inventory.walk.active", {});
      if (!active.walk) await api("inventory.walk.start", {});
      const conf = ocrMeta?.best?.confidence ?? (photoDocumentIds.length ? 90 : 100);
      const result = await api("inventory.walk.observe", {
        vin,
        stockNumber: stockNumber || undefined,
        note: d.note || undefined,
        photoDocumentIds,
        entryMethod: photoDocumentIds.length && d.vin ? "mixed" : photoDocumentIds.length ? "photo" : "manual",
        recognitionConfidence: conf,
      });
      window.__aionLastWalkObs = result;
      window.__aionVinOcr = null;
      if (!result.validation?.valid) {
        toast(`VIN uncertain: ${result.validation?.message || "invalid"} — confirm or retake.`);
      } else {
        toast(`${result.observation?.matchStatus || "saved"} · NEXT`);
      }
      form.reset();
      await load();
      requestAnimationFrame(() => {
        document.querySelector('form[data-form="walk-observe"] input[name="vin"]')?.focus();
      });
      return;
    }
    if (kind === "import-root-add") {
      const root = String(d.root || "").trim();
      if (!root) throw new Error("Choose an absolute folder path.");
      // Refuse whole-drive roots (C:\ / D:\ / \\server) — Owner must pick a meaningful folder.
      if (/^[A-Za-z]:[\\/]?$/u.test(root) || root === "/" || /^\\\\[^\\]+\\?$/u.test(root)) {
        throw new Error("Whole drives are not allowed. Choose a specific folder (e.g. Documents\\Career), not C:\\.");
      }
      const current = Array.isArray(model?.state?.settings?.importRoots) ? [...model.state.settings.importRoots] : [];
      const norm = root.replace(/\//g, "\\").replace(/[\\/]+$/u, "");
      if (!current.some((r) => String(r).replace(/\//g, "\\").replace(/[\\/]+$/u, "").toLowerCase() === norm.toLowerCase())) {
        current.push(norm);
      }
      await api("settings.update", { settings: { importRoots: current } });
      toast(`Approved import root saved (${current.length} total). You can import a child folder next.`);
      form.reset();
      await load();
      return;
    }
    if (kind === "folder-import") {
      const tags = String(d.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const result = await api("crm.document.importFolder", { path: d.path, tags });
      const st = result.stats || {};
      toast(`Recursive import: ${result.imported?.length ?? 0} stored · ${st.duplicatesSkipped || 0} dup · ${st.reviewItems || 0} review · ${st.errors || 0} err${result.truncated ? " (truncated)" : ""}`);
      try { window.__aionImportSummary = await api("import.lastSummary", {}); } catch { /* ignore */ }
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
    if (kind === "connector-settings") {
      const payload = {
        gmailClientId: d.gmailClientId || "",
        gmailRedirectUri: d.gmailRedirectUri || "http://127.0.0.1:31415/oauth/gmail/callback",
        metricoolTokenEnvVar: d.metricoolTokenEnvVar || "AION_METRICOOL_USER_TOKEN",
        metricoolBlogIdEnvVar: d.metricoolBlogIdEnvVar || "AION_METRICOOL_BLOG_ID",
      };
      // Optional secret — only if Owner typed a new value (masked field empty means keep)
      const secretTyped = Boolean(d.gmailClientSecret && String(d.gmailClientSecret).trim());
      if (secretTyped) {
        payload.gmailClientSecret = String(d.gmailClientSecret).trim();
      }
      const saved = await api("connector.settings.update", payload);
      model._gmailStatus = await api("connector.gmail.status", {});
      model._metricoolStatus = await api("connector.metricool.status", {});
      const idOk = model._gmailStatus?.clientIdConfigured || saved?.clientIdConfigured;
      const secOk = model._gmailStatus?.clientSecretConfigured || saved?.clientSecretStored;
      toast(
        `Gmail connectors saved. Client ID: ${idOk ? "yes" : "missing"}. Client Secret: ${secOk ? "stored on this PC only" : secretTyped ? "save failed" : "not provided this save"}. Not Git / not chat.`,
      );
      await load();
      return;
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
