// AION Command Center UI. Same-origin only; no hosted dependency, analytics, or telemetry.
const areas = ["Chat", "Tasks", "Routines", "Memory", "Planner", "Approvals", "Verify", "Activity", "Career", "Imports", "Settings"];
let model = null;
let area = "Chat";
let streaming = "";
let openConversation = null;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (value, length = 16) => `${String(value ?? "").slice(0, length)}…`;

async function api(type, payload = {}) {
  // `type` is written last on purpose: a payload field can never displace the action being called.
  const response = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, type }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.result;
}
async function load() { model = await (await fetch("/api/state")).json(); render(); }
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
  const response = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, content }) });
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
${cards(s.conversations, (c) => `<article class="card"><h2>${esc(c.title)}</h2><p class="meta">${esc(c.state)} · ${c.messages.length} messages · memory context ${c.memoryContextEnabled ? "on" : "off"} · updated ${esc(c.updatedAt)}</p>
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
${cards(s.tasks, (t) => `<article class="card"><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p>
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
${cards(s.routines, (r) => `<article class="card"><h2>${esc(r.name)}</h2><p>${esc(r.instructions)}</p>
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
${cards(s.memories, (m) => `<article class="card ${m.conflict === "conflicting" ? "conflict" : ""}"><h2>${esc(m.category)}${m.conflict === "conflicting" ? " · conflicting" : ""}</h2><p>${esc(m.content)}</p>
<p class="meta">${esc(m.confirmation)} · ${m.enabled ? "enabled" : "disabled"} · source ${esc(m.provenance.sourceType)}/${esc(m.provenance.sourceRef)} · recorded ${esc(m.sourceTimestamp)} · ${m.corrections.length} corrections</p>
${m.conflict === "conflicting" ? `<p class="warn">Another enabled memory in this category states something different about the same subject. Both are preserved until you correct or disable one.</p>` : ""}
${m.corrections.length ? `<details><summary>Correction history</summary>${m.corrections.map((c) => `<p class="meta">${esc(c.at)}: “${esc(c.previousContent)}” → “${esc(c.correctedContent)}” (${esc(c.reason)})</p>`).join("")}</details>` : ""}
<form data-form="memory-correct"><input type="hidden" name="id" value="${esc(m.id)}"><label>Correct to<textarea name="content" required maxlength="20000">${esc(m.content)}</textarea></label><label>Reason<input name="reason" required maxlength="500"></label><button>Correct</button></form>
<div class="actions">${m.confirmation === "unconfirmed" ? `<button data-do="memory-accept" data-id="${esc(m.id)}">Confirm</button>` : ""}<button data-do="memory-toggle" data-id="${esc(m.id)}" data-enabled="${!m.enabled}">${m.enabled ? "Disable" : "Enable"}</button><button data-do="memory-delete" data-id="${esc(m.id)}" class="danger">Forget</button></div></article>`)}`;
}

function plannerArea(s) {
  return `<h1>Planner</h1><p class="lead">Plans are reviewable proposals. They carry no execution authority until you convert steps into Tasks.</p>
<form data-form="plan"><label>Goal<input name="goal" required maxlength="2000"></label><label>Steps (one per line, in order)<textarea name="steps" required maxlength="10000"></textarea></label><button>Create plan</button></form>
${cards(s.plans, (p) => `<article class="card"><h2>${esc(p.goal)}</h2><p class="meta">${esc(p.status)} · ${p.steps.length} steps · from ${esc(p.provenance.sourceType)} · ${esc(p.createdAt)}</p>
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
${cards(s.activity.slice(0, 300), (a) => `<article class="card"><h2>${esc(a.action)}</h2><p>${esc(a.summary)}</p><p class="meta">${esc(a.category)} · ${esc(a.outcome)} · ${esc(a.at)}${a.subjectRef ? ` · ${esc(short(a.subjectRef, 12))}` : ""}</p></article>`, "No activity recorded yet.")}`;
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
  document.querySelector("nav").innerHTML = areas.map((x) => `<button class="${x === area ? "active" : ""}" data-area="${x}">${x}</button>`).join("");
  document.querySelector("#onboarding").hidden = model.state.onboardingComplete;
  document.querySelector("#content").hidden = !model.state.onboardingComplete;
  document.querySelector("#content").innerHTML = page();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const { area: target, action, do: verb, id, state, enabled, value } = button.dataset;
  if (!target && !action && !verb) return; // a plain form submit button; the submit handler owns it
  event.preventDefault();
  try {
    if (target) { area = target; render(); return; }
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
    if (kind !== "settings") form.reset();
    await load();
    toast("Saved.");
  } catch (error) { toast(error.message); }
});

load().catch((error) => toast(error.message));
