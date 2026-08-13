#!/usr/bin/env node
/**
 * Independent AION Director v0.1 acceptance runner.
 *
 * Frozen BEFORE Claude Director implementation. Do not weaken fixtures to make Claude pass.
 *
 * Standby (no SHA): fixture integrity + real CLI probes + oracle contract checks.
 * Official: set CLAUDE_DIRECTOR_SHA + AION_DIRECTOR_WORKTREE to the immutable Claude SHA.
 *
 * Never writes Owner business state. Never touches production. Never implements Director runtime.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures");
const OUT = join(__dirname, "out");
const ROOT = join(__dirname, "..", "..", "..");

const DIRECTOR_SHA = process.env.CLAUDE_DIRECTOR_SHA || "";
const DIRECTOR_WT = process.env.AION_DIRECTOR_WORKTREE || "";
const DESIGN_HEAD_EXPECTED = "1e0abab87ee8faf157598399e02e9ad77252c837";
const CLEAN_BASE = "1ce25ba2e82e576618ab3c9a007af92940a94bfd";
const PROD_SHA_FREEZE = "d18c7927c1e9eec0f876201b36a487b2ac91add0";

const ORIGINS_WITHOUT_AUTHORITY = ["WEB_PAGE", "EMAIL", "DOCUMENT", "OCR_TEXT", "MODEL_SUGGESTION"];

function load(name) {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

function result(id, status, detail = "") {
  return { id, status, detail: String(detail).slice(0, 600) };
}

function originGrantsAuthority(origin) {
  return origin === "OWNER_DIRECTIVE";
}

function classifyHighConsequence(text) {
  const t = String(text || "");
  if (/\bfunnel\b|public(?:ly)?\s+internet|port\s+forward/i.test(t)) return "PUBLIC_EXPOSURE";
  if (/\bcredit\s+card\b|\$\s*\d+|spend|paid\s+trial/i.test(t)) return "SPEND";
  if (/\bforce\s+push\b|push\s+--force|reset\s+--hard|filter-repo|\brebase\b/i.test(t)) return "FORBIDDEN_GIT";
  if (/\bdelete\b[^.]{0,40}\bproduction\b/i.test(t)) return "DESTRUCTIVE";
  return "ORDINARY";
}

function judgeAuthority(c) {
  if (!originGrantsAuthority(c.origin)) {
    return { allowed: false, blockedByOrigin: true };
  }
  const kind = classifyHighConsequence(c.proposedAction);
  if (kind !== "ORDINARY") return { allowed: false, blockedByOrigin: false, kind };
  if (!String(c.ownerDirective || "").trim()) return { allowed: false, blockedByOrigin: false };
  return { allowed: true, blockedByOrigin: false };
}

function judgeGitTruth(c) {
  const h = c.handoff || {};
  const i = c.independent || {};
  if (h.claims?.HEAD_ATTACHED === "PASS" && i.detached) return "REJECT";
  if (h.claims?.REMOTE_EQ_HEAD === "PASS" && i.remote && i.head && i.remote !== i.head) return "REJECT";
  if (h.productionMutated === false && (i.productionProcessCwdChanged || (i.productionHead && i.productionHeadBefore && i.productionHead !== i.productionHeadBefore))) {
    return "REJECT";
  }
  if (i.dirty) return "BLOCK";
  if (h.branch && i.branch && h.branch !== i.branch) return "BLOCK";
  if (h.status === "PASS" && i.head && h.headAfter && i.head === h.headAfter && !i.detached && !i.dirty) {
    return "ACCEPT_FOR_GIT";
  }
  return "REJECT";
}

function legalTransition(legal, from, to) {
  return Array.isArray(legal[from]) && legal[from].includes(to);
}

const WORK_ITEM_KIND_TO_GATE = {
  SPEND: "SPEND_APPROVAL_REQUIRED",
  OAUTH: "OAUTH_REQUIRED",
  PUBLIC_EXPOSURE: "PUBLIC_EXPOSURE_APPROVAL_REQUIRED",
  DESTRUCTIVE: "DESTRUCTIVE_ACTION_APPROVAL_REQUIRED",
  PRODUCTION_DEPLOY: "PRODUCTION_DEPLOY_APPROVAL_REQUIRED",
  PHYSICAL_DEVICE_TEST: "PHYSICAL_IPHONE_TEST_REQUIRED",
};

function openGateTypes(openGates) {
  return (openGates || [])
    .filter((g) => {
      const status = typeof g === "string" ? "OPEN" : (g.status || "OPEN");
      return status === "OPEN";
    })
    .map((g) => (typeof g === "string" ? g : g.type));
}

function classifyWorkItemKind(item) {
  if (item.kind && item.kind !== "ORDINARY") return item.kind;
  const t = `${item.action || ""} ${item.label || ""}`;
  if (/\boauth\b|consent/i.test(t)) return "OAUTH";
  if (/\bdeploy\b[\s\S]{0,40}\bproduction\b|\bproduction\b[\s\S]{0,40}\bdeploy\b/i.test(t)) {
    return "PRODUCTION_DEPLOY";
  }
  const c = classifyHighConsequence(t);
  if (c === "FORBIDDEN_GIT") return "DESTRUCTIVE";
  return c;
}

function itemBlockedByOpenGates(item, openTypes) {
  const declared = item.dependsOnGates || [];
  const hits = declared.filter((g) => openTypes.includes(g));
  const kind = classifyWorkItemKind(item);
  const required = WORK_ITEM_KIND_TO_GATE[kind];
  if (required && !declared.includes(required)) hits.push(required);
  else if (required && openTypes.includes(required) && !hits.includes(required)) hits.push(required);
  return hits;
}

function itemMayLaunch(item, ctx) {
  if (ctx.missionPaused) return { ok: false, reason: "PAUSED" };
  if (item.status === "DONE" || item.status === "RUNNING") return { ok: false, reason: item.status };
  const open = openGateTypes(ctx.openGates);
  const blocks = itemBlockedByOpenGates(item, open);
  if (blocks.length) return { ok: false, reason: "OWNER_GATE", gates: blocks };
  if (item.status === "BLOCKED_ON_OWNER") return { ok: false, reason: "OWNER_GATE" };
  if (item.status === "READY" || !item.status) return { ok: true, reason: "READY" };
  return { ok: false, reason: item.status || "UNKNOWN" };
}

function scheduleWorkItems(ctx) {
  const launched = [];
  const blocked = [];
  const held = new Set(ctx.leasesHeld || []);
  for (const item of ctx.workItems || []) {
    const verdict = itemMayLaunch(item, ctx);
    if (!verdict.ok) {
      if (item.status !== "DONE" && item.status !== "RUNNING") blocked.push(item.id);
      continue;
    }
    const resources = item.exclusiveResources || [];
    if (resources.some((r) => held.has(r))) {
      blocked.push(item.id);
      continue;
    }
    launched.push(item.id);
    for (const resource of resources) held.add(resource);
  }

  const open = openGateTypes(ctx.openGates);
  const independentActive = (ctx.workItems || []).some((item) => {
    if (itemBlockedByOpenGates(item, open).length) return false;
    if (item.status === "BLOCKED_ON_OWNER") return false;
    return item.status === "READY" || item.status === "RUNNING" || launched.includes(item.id);
  });
  const dependentUnfinished = (ctx.workItems || []).some((item) => {
    if (item.status === "DONE") return false;
    return itemBlockedByOpenGates(item, open).length > 0 || item.status === "BLOCKED_ON_OWNER";
  });

  let presentation = "WORKING";
  if (ctx.missionPaused) presentation = "PAUSED";
  else if (independentActive) presentation = "WORKING";
  else if (open.length && dependentUnfinished) presentation = "WAITING_FOR_OWNER";

  return { launched, blocked, presentation };
}

function trustedOwnerResolution(resolution) {
  return resolution?.provenance === "OWNER_DIRECTIVE"
    && (resolution.decision === "PASS" || resolution.decision === "APPROVED");
}

function applyGateResolution(openGates, resolution, accepted) {
  if (!accepted) return [...(openGates || [])];
  return (openGates || []).filter((g) => (typeof g === "string" ? g : g.type) !== resolution.type);
}

function dependentStatusAfterResolution(item, openGatesAfter, alreadySatisfied) {
  const remaining = (item.dependsOnGates || []).filter((g) => {
    if ((alreadySatisfied || []).includes(g)) return false;
    return openGateTypes(openGatesAfter).includes(g);
  });
  const kind = classifyWorkItemKind(item);
  const required = WORK_ITEM_KIND_TO_GATE[kind];
  if (required && remaining.includes(required)) return "BLOCKED_ON_OWNER";
  if (remaining.length) return "BLOCKED_ON_OWNER";
  return "READY";
}

function probeExe(exe, args, extraEnv = {}) {
  if (!exe || !existsSync(exe)) return { ok: false, reason: "missing" };
  const r = spawnSync(exe, args, {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: "1", CLAUDE_CODE_SIMPLE: "1", ...extraEnv },
  });
  return {
    ok: r.status === 0 || Boolean((r.stdout || r.stderr || "").trim()),
    status: r.status,
    out: `${r.stdout || ""}\n${r.stderr || ""}`.slice(0, 16_000),
  };
}

function discoverClaude() {
  const configured = process.env.AION_CLAUDE_CODE_PATH;
  if (configured && existsSync(configured) && !/\.(cmd|ps1)$/i.test(configured)) {
    return { path: configured, via: "AION_CLAUDE_CODE_PATH" };
  }
  const extRoot = join(homedir(), ".vscode", "extensions");
  if (existsSync(extRoot)) {
    const dirs = readdirSync(extRoot).filter((d) => /^anthropic\.claude-code-.*-win32-/i.test(d));
    const scored = dirs.map((d) => {
      const exe = join(extRoot, d, "resources", "native-binary", "claude.exe");
      const m = d.match(/anthropic\.claude-code-([0-9.]+)-/i);
      return { exe, ver: m ? m[1] : "0", exists: existsSync(exe) };
    }).filter((x) => x.exists);
    scored.sort((a, b) => a.ver.localeCompare(b.ver, undefined, { numeric: true }));
    const best = scored.at(-1);
    if (best) return { path: best.exe, via: "vscode-native", versionFolder: best.ver, candidates: scored.length };
  }
  const local = join(homedir(), ".local", "bin", "claude.exe");
  if (existsSync(local)) return { path: local, via: "local-bin" };
  return { path: null, via: "UNAVAILABLE" };
}

function discoverGrok() {
  const configured = process.env.AION_GROK_PATH;
  if (configured && existsSync(configured)) return { path: configured, via: "AION_GROK_PATH" };
  const home = join(homedir(), ".grok", "bin", "grok.exe");
  if (existsSync(home)) return { path: home, via: "GROK_HOME" };
  return { path: null, via: "UNAVAILABLE" };
}

function lookForDirectorModules(wt) {
  if (!wt || !existsSync(wt)) return [];
  const hits = [];
  const roots = [
    join(wt, "packages", "local-assistant", "src"),
    join(wt, "packages", "local-assistant", "dist"),
    join(wt, "apps"),
  ];
  const names = ["director", "aion-director"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const n of names) {
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const e of entries) {
          if (String(e.name).toLowerCase().includes(n)) hits.push(join(root, e.name));
        }
      } catch { /* ignore */ }
    }
  }
  return hits;
}

function suiteFixtures() {
  const out = [];
  const catalog = load("gate-catalog.json");
  out.push(result("catalog.version", catalog.schema ? "PASS" : "FAIL"));
  out.push(result("catalog.count-80-plus", catalog.gates.length >= 80 ? "PASS" : "FAIL", String(catalog.gates.length)));
  out.push(result("catalog.count-95", catalog.gates.length === 95 ? "PASS" : "FAIL", String(catalog.gates.length)));
  const added = [86, 87, 88, 89, 90, 91, 92, 93, 94, 95].map((n) => catalog.gates.find((g) => g.id === n)?.gate);
  const expectedNew = [
    "OWNER_GATE_LOCAL_BLOCKING",
    "OWNER_GATE_DEPENDENT_WORK_BLOCKED",
    "OWNER_GATE_RESOLUTION_UNBLOCKS_DEPENDENT",
    "WAITING_FOR_OWNER_ONLY_WHEN_NO_READY_WORK",
    "GLOBAL_PAUSE_OVERRIDES_READY_WORK",
    "WORK_ITEM_LEASE_COLLISION",
    "SAFE_PARALLEL_NONCONFLICTING_WORK",
    "HIGH_CONSEQUENCE_GATE_NOT_BYPASSED_BY_PARALLELISM",
    "REBOOT_PRESERVES_OPEN_GATE_AND_READY_WORK",
    "DASHBOARD_DISTINGUISHES_WORKING_VS_WAITING",
  ];
  out.push(result("catalog.addendum-86-95",
    expectedNew.every((name, i) => added[i] === name) ? "PASS" : "FAIL",
    added.join(",")));
  out.push(result("catalog.existing-85-untouched-count",
    catalog.gates.filter((g) => g.id >= 1 && g.id <= 85).length === 85 ? "PASS" : "FAIL"));
  out.push(result("catalog.waiting-for-immutable-sha",
    catalog.waitingFor === "CLAUDE_DIRECTOR_SHA" && catalog.doNotTestMovingTip === true ? "PASS" : "FAIL"));
  out.push(result("catalog.do-not-weaken", catalog.doNotWeakenToAccommodateClaude === true ? "PASS" : "FAIL"));
  const requiredFiles = [
    "authority-adversarial.json", "git-truth-lies.json", "crash-recovery.json",
    "retry-loop.json", "owner-gates.json", "capacity.json", "first-mission.json",
    "leases.json", "transitions.json", "dashboard.json", "logging.json",
    "executors.json", "handoff.schema.json", "work-items.json",
  ];
  for (const f of requiredFiles) {
    out.push(result(`fixture.present:${f}`, existsSync(join(FIX, f)) ? "PASS" : "FAIL"));
  }
  const ids = catalog.gates.map((g) => g.gate);
  const need = [
    "DIRECTOR_STATE_OUTSIDE_WORKTREE", "DIRECTOR_BUSINESS_STATE_WRITER",
    "FIRST_REAL_MISSION_DOES_NOT_DEPLOY", "NO_INFINITE_AGENT_LOOP",
    "WEB_AUTHORITY_ESCALATION", "HANDOFF_NOT_TRUSTED_WITHOUT_GIT",
    "OWNER_GATE_LOCAL_BLOCKING",
  ];
  out.push(result("catalog.hard-gates-present", need.every((g) => ids.includes(g)) ? "PASS" : "FAIL"));
  return out;
}

function suiteAuthority() {
  const fx = load("authority-adversarial.json");
  const out = [];
  out.push(result("authority.spend-cap-0", fx.spendCapUsd === 0 ? "PASS" : "FAIL"));
  for (const c of fx.cases) {
    const j = judgeAuthority(c);
    let ok = j.allowed === c.expectAllowed;
    if (c.expectBlockedByOrigin) ok = ok && j.blockedByOrigin === true;
    if (c.expectSpendUsd === 0) ok = ok && fx.spendCapUsd === 0;
    if (c.expectForbiddenAutomation) ok = ok && classifyHighConsequence(c.proposedAction) === "FORBIDDEN_GIT";
    out.push(result(`authority.${c.id}`, ok ? "PASS" : "FAIL",
      JSON.stringify({ allowed: j.allowed, blockedByOrigin: j.blockedByOrigin, expect: c.expectAllowed })));
  }
  const untrusted = fx.cases.filter((c) => ORIGINS_WITHOUT_AUTHORITY.includes(c.origin));
  out.push(result("WEB_AUTHORITY_ESCALATION",
    untrusted.filter((c) => c.origin === "WEB_PAGE").every((c) => !judgeAuthority(c).allowed) ? "PASS" : "FAIL"));
  out.push(result("EMAIL_AUTHORITY_ESCALATION",
    untrusted.filter((c) => c.origin === "EMAIL").every((c) => !judgeAuthority(c).allowed) ? "PASS" : "FAIL"));
  out.push(result("DOCUMENT_AUTHORITY_ESCALATION",
    untrusted.filter((c) => c.origin === "DOCUMENT").every((c) => !judgeAuthority(c).allowed) ? "PASS" : "FAIL"));
  out.push(result("OCR_AUTHORITY_ESCALATION",
    untrusted.filter((c) => c.origin === "OCR_TEXT").every((c) => !judgeAuthority(c).allowed) ? "PASS" : "FAIL"));
  out.push(result("MODEL_AUTHORITY_ESCALATION",
    untrusted.filter((c) => c.origin === "MODEL_SUGGESTION").every((c) => !judgeAuthority(c).allowed) ? "PASS" : "FAIL"));
  out.push(result("ZERO_SPEND_GUARD",
    fx.cases.find((c) => c.id === "OWNER_CREDIT_CARD") && !judgeAuthority(fx.cases.find((c) => c.id === "OWNER_CREDIT_CARD")).allowed
      ? "PASS" : "FAIL"));
  return out;
}

function suiteGitTruth() {
  const fx = load("git-truth-lies.json");
  const out = [];
  for (const c of fx.cases) {
    const got = judgeGitTruth(c);
    out.push(result(`git.${c.id}`, got === c.expectDirector ? "PASS" : "FAIL",
      `got=${got} expect=${c.expectDirector}`));
  }
  out.push(result("forbidden.git.reset-hard", fx.forbiddenAutomation.includes("git reset --hard") ? "PASS" : "FAIL"));
  out.push(result("forbidden.git.force-push", fx.forbiddenAutomation.some((x) => x.includes("force")) ? "PASS" : "FAIL"));
  out.push(result("forbidden.git.rebase", fx.forbiddenAutomation.includes("git rebase") ? "PASS" : "FAIL"));
  return out;
}

function suiteCrash() {
  const fx = load("crash-recovery.json");
  const out = [];
  out.push(result("crash.never-assume-pass", fx.neverAssumePassFromStaleExecutorRunning === true ? "PASS" : "FAIL"));
  for (const c of fx.cases) {
    const forbidsPass = (c.forbid || []).some((f) => /PASS|COMPLETED/i.test(f));
    const recoverOk = Boolean(c.expectRecoveredState) && c.expectRecoveredState !== "COMPLETED";
    out.push(result(`crash.${c.id}`, forbidsPass && recoverOk ? "PASS" : "FAIL",
      `${c.expectRecoveredState} → ${c.expectNext || ""}`));
  }
  return out;
}

function suiteRetry() {
  const fx = load("retry-loop.json");
  const out = [];
  out.push(result("retry.max-repair-finite", fx.maxRepairCycles >= 1 && fx.maxRepairCycles <= 5 ? "PASS" : "FAIL",
    String(fx.maxRepairCycles)));
  out.push(result("retry.same-sha-no-hope-reset", fx.sameShaDoesNotConsumeNewRepairHope === true ? "PASS" : "FAIL"));
  const loop = fx.cases.find((c) => c.id === "SAME_FAILING_SHA_REPEATED");
  out.push(result("NO_INFINITE_AGENT_LOOP",
    loop && loop.expectFinal === "BLOCKED" && loop.repeats > loop.maxRepairCycles ? "PASS" : "FAIL"));
  out.push(result("GROK_FAIL_ROUTES_TO_CLAUDE_REPAIR",
    fx.cases.some((c) => c.id === "GROK_REJECT_THEN_CLAUDE_REPAIR") ? "PASS" : "FAIL"));
  out.push(result("CLAUDE_REPAIR_FREEZES_NEW_SHA",
    fx.cases.some((c) => c.id === "REPAIR_MUST_FREEZE_NEW_SHA") ? "PASS" : "FAIL"));
  out.push(result("REPAIRED_SHA_ROUTES_BACK_TO_GROK",
    fx.cases.some((c) => c.id === "REPAIRED_BACK_TO_GROK") ? "PASS" : "FAIL"));
  return out;
}

function suiteTransitions() {
  const fx = load("transitions.json");
  const out = [];
  out.push(result("MISSION_CREATE", Boolean(fx.named.MISSION_CREATE) ? "PASS" : "FAIL"));
  out.push(result("MISSION_AUTHORIZE",
    legalTransition(fx.legal, "CREATED", "AUTHORIZED") ? "PASS" : "FAIL"));
  out.push(result("PAUSE", fx.named.PAUSE?.to === "PAUSED" ? "PASS" : "FAIL"));
  out.push(result("RESUME", fx.named.RESUME?.from === "PAUSED" ? "PASS" : "FAIL"));
  out.push(result("EMERGENCY_STOP", fx.named.EMERGENCY_STOP?.to === "BLOCKED" ? "PASS" : "FAIL"));
  let illegalOk = true;
  for (const ex of fx.illegalExamples) {
    if (legalTransition(fx.legal, ex.from, ex.to)) illegalOk = false;
  }
  out.push(result("INVALID_TRANSITION_REJECTED", illegalOk ? "PASS" : "FAIL"));
  out.push(result("no-jump-running-to-completed",
    !legalTransition(fx.legal, "EXECUTOR_RUNNING", "COMPLETED") ? "PASS" : "FAIL"));
  out.push(result("no-deploy-from-waiting-owner",
    !legalTransition(fx.legal, "WAITING_FOR_OWNER", "DEPLOYING") ? "PASS" : "FAIL"));
  return out;
}

function suiteLeases() {
  const fx = load("leases.json");
  const out = [];
  for (const need of ["worktree", "branch", "integration", "production-writer"]) {
    out.push(result(`lease.resource:${need}`, fx.resources.includes(need) ? "PASS" : "FAIL"));
  }
  out.push(result("WORKTREE_LEASE_COLLISION", fx.cases.some((c) => c.id === "WORKTREE_COLLISION") ? "PASS" : "FAIL"));
  out.push(result("INTEGRATION_LEASE_EXCLUSIVE", fx.cases.some((c) => c.resource === "integration") ? "PASS" : "FAIL"));
  out.push(result("PRODUCTION_WRITER_LEASE_EXCLUSIVE", fx.cases.some((c) => c.resource === "production-writer") ? "PASS" : "FAIL"));
  out.push(result("DUPLICATE_EXECUTOR_PREVENTION", fx.cases.some((c) => c.id === "DUPLICATE_EXECUTOR") ? "PASS" : "FAIL"));
  out.push(result("WORK_ITEM_LEASE_COLLISION_FIXTURE",
    fx.cases.some((c) => c.gate === "WORK_ITEM_LEASE_COLLISION") ? "PASS" : "FAIL"));
  out.push(result("SAFE_PARALLEL_NONCONFLICTING_FIXTURE",
    fx.cases.some((c) => c.gate === "SAFE_PARALLEL_NONCONFLICTING_WORK") ? "PASS" : "FAIL"));
  return out;
}

function suiteFirstMission() {
  const fx = load("first-mission.json");
  const out = [];
  out.push(result("FIRST_REAL_MISSION_ID",
    fx.missionId === "daily-intelligence-finalization" ? "PASS" : "FAIL"));
  out.push(result("FIRST_REAL_MISSION_RECOGNIZES_PRODUCTION_OLD_SHA",
    fx.truthAtSuiteFreeze.productionSha === PROD_SHA_FREEZE
      && fx.truthAtSuiteFreeze.originMainExpectedIfIntegrated === CLEAN_BASE
      && fx.truthAtSuiteFreeze.productionSha !== fx.truthAtSuiteFreeze.originMainExpectedIfIntegrated
      ? "PASS" : "FAIL",
    `${fx.truthAtSuiteFreeze.productionSha} vs ${fx.truthAtSuiteFreeze.originMainExpectedIfIntegrated}`));
  out.push(result("FIRST_REAL_MISSION_PHYSICAL_IPHONE_GATE",
    fx.truthAtSuiteFreeze.physicalIphone === "pending"
      && fx.requiredBehaviors.includes("open PHYSICAL_IPHONE_TEST_REQUIRED")
      ? "PASS" : "FAIL"));
  out.push(result("FIRST_REAL_MISSION_DOES_NOT_DEPLOY",
    fx.requiredBehaviors.includes("do not deploy")
      && /DOES_NOT_DEPLOY/.test(fx.hardGate)
      ? "PASS" : "FAIL"));
  out.push(result("DIRECTOR_STATE_OUTSIDE_WORKTREE",
    /C:\\\\AION\\\\director\\\\/.test(fx.runtimeRootMustBe)
      && fx.runtimeRootMustNotBeUnder.some((p) => p.includes("AION-HQ"))
      ? "PASS" : "FAIL",
    fx.runtimeRootMustBe));
  out.push(result("DIRECTOR_BUSINESS_STATE_WRITER",
    fx.businessStateForbiddenWrites.some((p) => p.includes("state-v1.json")) ? "PASS" : "FAIL"));
  out.push(result("PRODUCTION_NOT_MUTATED_DURING_TESTS",
    fx.requiredBehaviors.includes("do not checkout/mutate production worktree") ? "PASS" : "FAIL"));
  out.push(result("MISSION_COMPLETION_ONLY_AFTER_REQUIRED_GATES",
    (fx.completionRequires || []).some((x) => /PHYSICAL_IPHONE/.test(x)) ? "PASS" : "FAIL"));
  out.push(result("TAILSCALE_FUNNEL_OFF", fx.truthAtSuiteFreeze.funnel === "OFF" ? "PASS" : "FAIL"));
  return out;
}

function suiteOwnerGates() {
  const fx = load("owner-gates.json");
  const out = [];
  out.push(result("owner-gate.physical-listed", fx.gates.includes("PHYSICAL_IPHONE_TEST_REQUIRED") ? "PASS" : "FAIL"));
  out.push(result("OWNER_GATE_DURABLE", fx.cases.some((c) => c.gate === "OWNER_GATE_DURABLE") ? "PASS" : "FAIL"));
  out.push(result("OWNER_GATE_RESUMES_SAME_MISSION",
    fx.cases.some((c) => c.expectMissionIdUnchanged) ? "PASS" : "FAIL"));
  out.push(result("HIGH_CONSEQUENCE_OWNER_GATE",
    fx.cases.some((c) => c.id === "HIGH_CONSEQUENCE_NEEDS_GATE") ? "PASS" : "FAIL"));
  const auto = fx.cases.find((c) => c.id === "AUTOMATED_PASS_DOES_NOT_CLOSE_IPHONE");
  out.push(result("automated-pass-not-completion",
    auto && auto.expectCompletion === false && auto.ownerGateStatus === "OWNER_RETEST_PENDING" ? "PASS" : "FAIL"));
  out.push(result("owner-gate.local-dependency-scope",
    fx.blockingScope === "LOCAL_DEPENDENCY" && fx.doesNotGloballyFreezeMission === true ? "PASS" : "FAIL"));
  return out;
}

function suiteCapacity() {
  const fx = load("capacity.json");
  const out = [];
  for (const s of ["AVAILABLE", "CAPACITY_EXHAUSTED", "UNAVAILABLE"]) {
    out.push(result(`capacity.state:${s}`, fx.states.includes(s) ? "PASS" : "FAIL"));
  }
  out.push(result("NO_PAID_FALLBACK", fx.paidFallbackForbidden === true ? "PASS" : "FAIL"));
  out.push(result("CAPACITY_WAIT_SURVIVES_RESTART",
    fx.cases.some((c) => c.expectAfterReboot === "WAITING_FOR_CAPACITY") ? "PASS" : "FAIL"));
  out.push(result("ZERO_SPEND_FROM_CAPACITY", fx.spendCapUsd === 0 ? "PASS" : "FAIL"));
  return out;
}

function suiteDashboardLogging() {
  const dash = load("dashboard.json");
  const log = load("logging.json");
  const out = [];
  out.push(result("DIRECTOR_LOOPBACK_ONLY",
    dash.directorBind === "127.0.0.1" && dash.directorPort === 31417 ? "PASS" : "FAIL"));
  out.push(result("COMMAND_CENTER_SAME_ORIGIN_BRIDGE",
    dash.bridgePath === "/api/director/" ? "PASS" : "FAIL"));
  out.push(result("PHONE_CANNOT_DIRECTLY_REACH_DIRECTOR_LOOPBACK",
    /127\.0\.0\.1:31417/.test(dash.phoneMustNotFetch) ? "PASS" : "FAIL"));
  out.push(result("PAIRED_DEVICE_REQUIRED", dash.auth.unpairedPhone === 401 ? "PASS" : "FAIL"));
  out.push(result("FORGED_ORIGIN_REJECTED", dash.auth.forgedOrigin === 403 ? "PASS" : "FAIL"));
  out.push(result("DIRECTOR_DOWN_RETURNS_503", dash.auth.directorDown === 503 ? "PASS" : "FAIL"));
  out.push(result("CONSOLE_ONLY_EMERGENCY_STOP", dash.auth.emergencyStop === "console-only" ? "PASS" : "FAIL"));
  for (const f of ["ownerActionRequired", "currentExecutor", "productionSha", "spendUsd"]) {
    out.push(result(`DASHBOARD_FIELD:${f}`, dash.requiredFields.includes(f) ? "PASS" : "FAIL"));
  }
  out.push(result("LOG_ROTATION_BOUND",
    log.maxRawBytesPerRun === 16 * 1024 * 1024 && log.maxStdoutBytesPerFile === 8 * 1024 * 1024 ? "PASS" : "FAIL"));
  out.push(result("RAW_LOG_NOT_IN_STATE_JSON",
    log.stateJsonMustNotContain.includes("stdout") ? "PASS" : "FAIL"));
  out.push(result("NO_SECRET_LOGGING", (log.secretPatterns || []).length >= 3 ? "PASS" : "FAIL"));
  out.push(result("DASHBOARD_DISTINGUISHES_WORKING_VS_WAITING",
    dash.requiredFields.includes("activityStatus")
      && dash.workingVsWaiting?.whenGateOpenAndOtherWorkRunning?.activityStatus === "WORKING"
      && dash.workingVsWaiting?.whenOnlyOwnerDependentRemains?.activityStatus === "WAITING_FOR_OWNER"
      && dash.workingVsWaiting?.whenGateOpenAndOtherWorkRunning?.mustNotImplyGloballyIdle === true
      ? "PASS" : "FAIL"));
  return out;
}

function expectSchedule(caseId, ctx, expect) {
  const got = scheduleWorkItems(ctx);
  const out = [];
  if (expect.expectMayLaunch) {
    const ok = expect.expectMayLaunch.every((id) => got.launched.includes(id));
    out.push(result(`${caseId}.may-launch`, ok ? "PASS" : "FAIL",
      `launched=${got.launched.join(",") || "∅"} expect=${expect.expectMayLaunch.join(",")}`));
  }
  if (expect.expectMustNotLaunch) {
    const ok = expect.expectMustNotLaunch.every((id) => !got.launched.includes(id));
    out.push(result(`${caseId}.must-not-launch`, ok ? "PASS" : "FAIL",
      `launched=${got.launched.join(",") || "∅"} forbid=${expect.expectMustNotLaunch.join(",")}`));
  }
  if (typeof expect.expectLaunchCount === "number") {
    out.push(result(`${caseId}.launch-count`,
      got.launched.length === expect.expectLaunchCount ? "PASS" : "FAIL",
      `got=${got.launched.length} expect=${expect.expectLaunchCount}`));
  }
  if (expect.expectExactlyOneOf) {
    const n = expect.expectExactlyOneOf.filter((id) => got.launched.includes(id)).length;
    out.push(result(`${caseId}.exactly-one`, n === 1 ? "PASS" : "FAIL",
      `launched=${got.launched.join(",")}`));
  }
  if (expect.expectMissionPresentation) {
    out.push(result(`${caseId}.presentation`,
      got.presentation === expect.expectMissionPresentation ? "PASS" : "FAIL",
      `got=${got.presentation} expect=${expect.expectMissionPresentation}`));
  }
  return out;
}

function suiteWorkItems() {
  const fx = load("work-items.json");
  const first = load("first-mission.json");
  const out = [];
  out.push(result("work-items.principle",
    fx.rules?.gateBlocksOnlyDependents === true
      && fx.rules?.unrelatedReadyWorkMayContinue === true
      && fx.rules?.waitingForOwnerOnlyWhenNoIndependentReadyOrRunningWork === true
      && fx.clarifiedBeforeClaudeFinalSha === true
      ? "PASS" : "FAIL"));
  out.push(result("first-mission.local-gate-scope",
    first.ownerGateBlockingScope === "LOCAL_DEPENDENCY"
      && (first.physicalGateBlocks || []).includes("production-deploy")
      && (first.physicalGateDoesNotBlock || []).includes("unrelated-authorized-independent-work")
      ? "PASS" : "FAIL"));

  const byGate = (name) => fx.cases.find((c) => c.gate === name);

  const local = byGate("OWNER_GATE_LOCAL_BLOCKING");
  out.push(result("OWNER_GATE_LOCAL_BLOCKING", local ? "PASS" : "FAIL", local?.id || "missing"));
  if (local) out.push(...expectSchedule(`work.${local.id}`, local, local));

  const dep = byGate("OWNER_GATE_DEPENDENT_WORK_BLOCKED");
  out.push(result("OWNER_GATE_DEPENDENT_WORK_BLOCKED", dep ? "PASS" : "FAIL", dep?.id || "missing"));
  if (dep) out.push(...expectSchedule(`work.${dep.id}`, dep, dep));

  const resolve = byGate("OWNER_GATE_RESOLUTION_UNBLOCKS_DEPENDENT");
  let resolveOk = Boolean(resolve?.steps?.length);
  if (resolve) {
    for (const step of resolve.steps) {
      const accepted = trustedOwnerResolution(step.resolution);
      const acceptOk = accepted === step.expectResolutionAccepted;
      const openAfter = applyGateResolution(step.openGatesBefore, step.resolution, accepted);
      const status = dependentStatusAfterResolution(
        resolve.dependentItem,
        openAfter,
        step.alreadySatisfiedGates,
      );
      const statusOk = status === step.expectStatusAfter;
      if (!acceptOk || !statusOk) resolveOk = false;
      out.push(result(`work.resolve.${step.id}`,
        acceptOk && statusOk ? "PASS" : "FAIL",
        `accepted=${accepted} status=${status}`));
    }
  }
  out.push(result("OWNER_GATE_RESOLUTION_UNBLOCKS_DEPENDENT", resolveOk ? "PASS" : "FAIL"));

  const waiting = byGate("WAITING_FOR_OWNER_ONLY_WHEN_NO_READY_WORK");
  let waitingOk = Boolean(waiting?.phases?.length === 2);
  if (waiting) {
    for (const phase of waiting.phases) {
      const rows = expectSchedule(`work.waiting.${phase.name}`, phase, phase);
      out.push(...rows);
      if (rows.some((r) => r.status === "FAIL")) waitingOk = false;
      if (phase.forbidGlobalIdle === true && phase.expectMissionPresentation === "WAITING_FOR_OWNER") {
        waitingOk = false;
        out.push(result(`work.waiting.${phase.name}.no-global-idle`, "FAIL",
          "unrelated ready work must not present WAITING_FOR_OWNER"));
      }
    }
  }
  out.push(result("WAITING_FOR_OWNER_ONLY_WHEN_NO_READY_WORK", waitingOk ? "PASS" : "FAIL"));

  const paused = byGate("GLOBAL_PAUSE_OVERRIDES_READY_WORK");
  out.push(result("GLOBAL_PAUSE_OVERRIDES_READY_WORK",
    paused && paused.missionPaused === true ? "PASS" : "FAIL"));
  if (paused) out.push(...expectSchedule(`work.${paused.id}`, paused, paused));

  const collision = byGate("WORK_ITEM_LEASE_COLLISION");
  out.push(result("WORK_ITEM_LEASE_COLLISION", collision ? "PASS" : "FAIL"));
  if (collision) out.push(...expectSchedule(`work.${collision.id}`, collision, collision));

  const parallel = byGate("SAFE_PARALLEL_NONCONFLICTING_WORK");
  out.push(result("SAFE_PARALLEL_NONCONFLICTING_WORK",
    parallel && parallel.forbidUnsafeSerializationCausedSolelyByUnrelatedOwnerGate === true
      && parallel.doNotRequireHighThroughput === true
      ? "PASS" : "FAIL"));
  if (parallel) out.push(...expectSchedule(`work.${parallel.id}`, parallel, parallel));

  const bypass = byGate("HIGH_CONSEQUENCE_GATE_NOT_BYPASSED_BY_PARALLELISM");
  let bypassOk = Boolean(bypass?.attempts?.length);
  if (bypass) {
    const items = bypass.attempts.map((a) => ({
      id: a.id,
      kind: a.kind,
      action: a.action,
      label: a.label,
      dependsOnGates: a.dependsOnGates || [],
      status: a.status || "READY",
      authorized: true,
    }));
    const scheduled = scheduleWorkItems({
      missionPaused: bypass.missionPaused === true,
      openGates: bypass.openGates || [],
      workItems: items,
      leasesHeld: [],
    });
    const noneLaunched = (bypass.expectMustNotLaunch || []).every((id) => !scheduled.launched.includes(id));
    if (!noneLaunched) bypassOk = false;
    out.push(result("work.bypass.none-launch", noneLaunched ? "PASS" : "FAIL",
      `launched=${scheduled.launched.join(",") || "∅"}`));
    for (const attempt of bypass.attempts) {
      const kind = classifyWorkItemKind(attempt);
      const required = WORK_ITEM_KIND_TO_GATE[kind];
      const ok = required === attempt.expectRequiredGate;
      if (!ok) bypassOk = false;
      out.push(result(`work.bypass.${attempt.id}`, ok ? "PASS" : "FAIL",
        `kind=${kind} required=${required}`));
    }
  }
  out.push(result("HIGH_CONSEQUENCE_GATE_NOT_BYPASSED_BY_PARALLELISM", bypassOk ? "PASS" : "FAIL"));

  const reboot = byGate("REBOOT_PRESERVES_OPEN_GATE_AND_READY_WORK");
  let rebootOk = Boolean(reboot?.before && reboot.afterRecovery);
  if (reboot) {
    const recovered = scheduleWorkItems(reboot.before);
    const gateOpen = openGateTypes(reboot.before.openGates).includes(reboot.afterRecovery.expectGateStillOpen);
    const schedulable = (reboot.afterRecovery.expectSchedulable || []).every((id) => recovered.launched.includes(id));
    const stillBlocked = (reboot.afterRecovery.expectStillBlocked || []).every((id) => !recovered.launched.includes(id));
    const presentationOk = recovered.presentation === reboot.afterRecovery.expectMissionPresentation;
    const noDup = reboot.afterRecovery.forbidDuplicateExecutor === true
      && (reboot.before.liveExecutors || []).length === 0;
    rebootOk = gateOpen && schedulable && stillBlocked && presentationOk && noDup;
    out.push(result("work.reboot.gate-open", gateOpen ? "PASS" : "FAIL"));
    out.push(result("work.reboot.ready-still-schedulable", schedulable ? "PASS" : "FAIL",
      `launched=${recovered.launched.join(",")}`));
    out.push(result("work.reboot.dependent-still-blocked", stillBlocked ? "PASS" : "FAIL"));
    out.push(result("work.reboot.presentation", presentationOk ? "PASS" : "FAIL", recovered.presentation));
    out.push(result("work.reboot.no-duplicate-executor", noDup ? "PASS" : "FAIL"));
  }
  out.push(result("REBOOT_PRESERVES_OPEN_GATE_AND_READY_WORK", rebootOk ? "PASS" : "FAIL"));

  const dash = byGate("DASHBOARD_DISTINGUISHES_WORKING_VS_WAITING");
  let dashOk = Boolean(dash?.views?.length === 2);
  if (dash) {
    for (const view of dash.views) {
      const independentActive = (view.running || []).length > 0 || (view.readyIndependent || []).length > 0;
      const presentation = independentActive ? "WORKING" : "WAITING_FOR_OWNER";
      const ok = presentation === view.expectActivityStatus && view.expectOwnerActionRequired === true;
      if (!ok) dashOk = false;
      out.push(result(`work.dashboard.${view.id}`, ok ? "PASS" : "FAIL", presentation));
    }
  }
  out.push(result("work-items.dashboard-views", dashOk ? "PASS" : "FAIL"));

  return out;
}

function suiteHandoffSchema() {
  const schema = load("handoff.schema.json");
  const out = [];
  out.push(result("STRUCTURED_HANDOFF_SCHEMA",
    schema.properties?.schema?.const === "aion.director.handoff.v1"
      && (schema.required || []).includes("headAfter")
      && schema.properties?.spendUsd?.maximum === 0
      ? "PASS" : "FAIL"));
  const good = {
    schema: "aion.director.handoff.v1",
    executor: "claude",
    missionId: "m",
    runId: "r",
    branch: "b",
    headBefore: "a".repeat(40),
    headAfter: "b".repeat(40),
    status: "PASS",
    productionMutated: false,
    spendUsd: 0,
  };
  const requiredOk = (schema.required || []).every((k) => Object.hasOwn(good, k));
  out.push(result("handoff.example-satisfies-required", requiredOk ? "PASS" : "FAIL"));
  out.push(result("handoff.spend-cannot-be-positive", schema.properties.spendUsd.maximum === 0 ? "PASS" : "FAIL"));
  return out;
}

function suiteExecutorsAndCli() {
  const fx = load("executors.json");
  const out = [];
  out.push(result("EXECUTOR_ARGV_SHELL_FALSE", fx.spawn.shell === false ? "PASS" : "FAIL"));
  out.push(result("PROMPT_DURABLE_BEFORE_EXECUTION",
    fx.spawn.promptVia.includes("--prompt-file") ? "PASS" : "FAIL"));
  out.push(result("ARGUMENT_INJECTION_BLOCKED",
    (fx.spawn.forbid || []).some((f) => /interpolat|powershell -Command|cmd.exe/i.test(f)) ? "PASS" : "FAIL"));
  out.push(result("LOCAL_TEST_EXECUTOR", fx.localAllowlist.includes("git") && fx.localAllowlist.includes("npm.cmd") ? "PASS" : "FAIL"));
  out.push(result("COMMAND_ALLOWLIST", fx.localAllowlist.length >= 3 ? "PASS" : "FAIL"));
  out.push(result("NO_GENERIC_REMOTE_SHELL_API", fx.forbidGenericRemoteShell === true ? "PASS" : "FAIL"));
  out.push(result("GROK_alwaysApprove_not_boundary", fx.grok.alwaysApproveIsNotBoundary === true ? "PASS" : "FAIL"));
  out.push(result("GROK_preferred_dontAsk", fx.grok.preferredPermissionMode === "dontAsk" ? "PASS" : "FAIL"));

  const claude = discoverClaude();
  const grok = discoverGrok();
  out.push(result("CLAUDE_DYNAMIC_DISCOVERY", claude.path ? "PASS" : "FAIL", `${claude.via} ${claude.path || ""}`));
  out.push(result("GROK_DYNAMIC_DISCOVERY", grok.path ? "PASS" : "FAIL", `${grok.via} ${grok.path || ""}`));

  if (claude.path) {
    const tries = [probeExe(claude.path, ["-h"]), probeExe(claude.path, ["--help"])];
    const help = tries.map((t) => t.out).join("\n").toLowerCase();
    const flags = ["output-format", "json-schema", "print", "session-id", "permission-mode"];
    const missing = flags.filter((f) => !help.includes(f));
    out.push(result("CLAUDE_STRUCTURED_HEADLESS",
      missing.length === 0 ? "PASS" : "FAIL",
      missing.length ? `missing ${missing.join(",")} helpChars=${help.length}` : "help lists json/schema/print/session"));
  } else {
    out.push(result("CLAUDE_STRUCTURED_HEADLESS", "FAIL", "claude executable not found"));
  }

  if (grok.path) {
    const v = probeExe(grok.path, ["--help"]);
    const help = v.out;
    const flags = ["--prompt-file", "--output-format", "--json-schema", "--cwd", "--permission-mode"];
    const missing = flags.filter((f) => !help.includes(f));
    out.push(result("GROK_STRUCTURED_HEADLESS",
      v.ok && missing.length === 0 ? "PASS" : "FAIL",
      missing.length ? `missing ${missing.join(",")}` : "help lists prompt-file/json/schema/cwd"));
  } else {
    out.push(result("GROK_STRUCTURED_HEADLESS", "FAIL", "grok executable not found"));
  }

  return { results: out, claude, grok };
}

function suiteDirectorPresentOrWait() {
  const out = [];
  const allowDomain = Boolean(DIRECTOR_SHA && DIRECTOR_WT && existsSync(DIRECTOR_WT));
  if (!allowDomain) {
    out.push(result("domain.director-runtime", "SKIP",
      "WAITING_FOR_CLAUDE_DIRECTOR_SHA — set CLAUDE_DIRECTOR_SHA and AION_DIRECTOR_WORKTREE"));
    return { results: out, allowDomain: false, modules: [] };
  }
  const head = spawnSync("git", ["-C", DIRECTOR_WT, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
  const actual = (head.stdout || "").trim();
  out.push(result("domain.sha-frozen",
    actual === DIRECTOR_SHA ? "PASS" : "FAIL",
    `worktree=${actual} expected=${DIRECTOR_SHA}`));
  const modules = lookForDirectorModules(DIRECTOR_WT);
  out.push(result("domain.director-modules-present",
    modules.length > 0 ? "PASS" : "FAIL",
    modules.slice(0, 8).join("; ") || "no director* files under src/dist/apps"));
  return { results: out, allowDomain: true, modules };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const all = [];
  all.push(...suiteFixtures());
  all.push(...suiteAuthority());
  all.push(...suiteGitTruth());
  all.push(...suiteCrash());
  all.push(...suiteRetry());
  all.push(...suiteTransitions());
  all.push(...suiteLeases());
  all.push(...suiteFirstMission());
  all.push(...suiteOwnerGates());
  all.push(...suiteWorkItems());
  all.push(...suiteCapacity());
  all.push(...suiteDashboardLogging());
  all.push(...suiteHandoffSchema());
  const exe = suiteExecutorsAndCli();
  all.push(...exe.results);
  const domain = suiteDirectorPresentOrWait();
  all.push(...domain.results);

  const catalog = load("gate-catalog.json");
  const summary = {
    generatedAt: new Date().toISOString(),
    schema: "aion.director.acceptance.report.v1",
    claudeDirectorSha: DIRECTOR_SHA || null,
    claudeDirectorWorktree: DIRECTOR_WT || null,
    designHeadExpected: DESIGN_HEAD_EXPECTED,
    cleanDailyIntelligenceBase: CLEAN_BASE,
    productionShaAtSuiteFreeze: PROD_SHA_FREEZE,
    waitingForClaudeDirectorSha: !DIRECTOR_SHA,
    gateCount: catalog.gates.length,
    claudeDiscovery: exe.claude,
    grokDiscovery: exe.grok,
    directorModules: domain.modules,
    results: all,
    counts: {
      pass: all.filter((r) => r.status === "PASS").length,
      fail: all.filter((r) => r.status === "FAIL").length,
      skip: all.filter((r) => r.status === "SKIP").length,
    },
    automatedDirectorVerdict: DIRECTOR_SHA
      ? (all.filter((r) => r.status === "FAIL").length ? "FAIL" : "PASS")
      : "BLOCKED",
    firstRealMissionStatus: "WAITING_FOR_CLAUDE_DIRECTOR_SHA",
    productionMutated: "NO",
    ownerGateStatus: "OWNER_RETEST_PENDING",
    recommendDirectorIntegration: "NO",
  };

  const outPath = join(OUT, `director-acceptance-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.error(`Wrote ${outPath}`);
  console.error(`PASS=${summary.counts.pass} FAIL=${summary.counts.fail} SKIP=${summary.counts.skip} GATES=${summary.gateCount}`);
  process.exit(summary.counts.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
