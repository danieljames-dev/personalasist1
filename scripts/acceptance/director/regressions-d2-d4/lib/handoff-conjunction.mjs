/**
 * Work-item success is a conjunction. Exit 0 is not success.
 */
export const SUCCESS_CONJUNCTION = Object.freeze([
  "processExited",
  "exitCodeKnown",
  "handoffPresent",
  "handoffParses",
  "handoffMatchesWorkItem",
  "handoffMatchesRun",
  "artifactsInsideRunRoot",
  "gitTruthAgrees",
  "productionClaimAgrees",
  "spendClaimIsZero",
]);

function isSha(s) {
  return typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);
}

export function evaluateHandoffSuccess(input) {
  const reasons = [];
  const h = input.handoff;
  if (input.stillRunning) reasons.push("process-still-running");
  if (input.exitCode === undefined || input.exitCode === null) reasons.push("exit-code-unknown");
  if (!h) reasons.push("handoff-missing");
  if (h && input.parseOk === false) reasons.push("handoff-malformed");
  if (h && input.expectedWorkItemId && h.workItemId && h.workItemId !== input.expectedWorkItemId) {
    reasons.push("handoff-wrong-work-item");
  }
  if (h && input.expectedMissionId && h.missionId && h.missionId !== input.expectedMissionId) {
    reasons.push("handoff-wrong-mission");
  }
  if (h && input.expectedRunId && h.runId && h.runId !== input.expectedRunId) {
    reasons.push("handoff-wrong-run");
  }
  if (typeof input.exitCode === "number" && input.exitCode !== 0) reasons.push("exit-nonzero");
  if (h && Array.isArray(h.artifacts) && input.runRoot) {
    for (const a of h.artifacts) {
      const s = String(a);
      if (s.includes("\0") || s.includes("..") || /^(CON|PRN|AUX|NUL)(?:\.|$)/i.test(s)) {
        reasons.push("artifact-illegal-path");
      }
      const root = String(input.runRoot).replace(/\//g, "\\").toLowerCase();
      const cand = s.replace(/\//g, "\\").toLowerCase();
      if (/^[a-z]:\\/.test(cand) && !cand.startsWith(`${root}\\`) && cand !== root) {
        reasons.push("artifact-outside-run-root");
      }
    }
  }
  if (input.git) {
    if (h?.headAfter && input.git.head && h.headAfter !== input.git.head) reasons.push("git-head-mismatch");
    if (h?.branch && input.git.branch && h.branch !== input.git.branch) reasons.push("git-branch-mismatch");
    if (h?.headAfter && input.git.headExists === false) reasons.push("claimed-commit-missing");
    if (input.git.dirty === true && h?.clean === true) reasons.push("clean-claim-while-dirty");
    if (input.git.detached && h?.headAttached === true) reasons.push("detached-claimed-attached");
  }
  if (h && typeof h.spendUsd === "number" && h.spendUsd > 0) reasons.push("spend-nonzero");
  if (h && h.productionMutated === false && input.productionActuallyMutated === true) {
    reasons.push("production-lie");
  }
  if (input.truncatedJson) reasons.push("truncated-json");
  if (input.multipleJsonObjects) reasons.push("multiple-json-objects");

  const ok = reasons.length === 0
    && input.exitCode === 0
    && Boolean(h)
    && input.parseOk !== false
    && !input.stillRunning;
  return { ok, reasons, conjunction: SUCCESS_CONJUNCTION };
}

export function parseMaybeHandoff(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "not-text" };
  const text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, reason: "no-object" };
  const body = text.slice(start, end + 1);
  if (/}\s*{/.test(text)) return { ok: false, reason: "multiple-json-objects", multipleJsonObjects: true };
  const extra = text.slice(end + 1).trim();
  if (extra.startsWith("{")) return { ok: false, reason: "multiple-json-objects", multipleJsonObjects: true };
  try {
    return { ok: true, value: JSON.parse(body), hadPrefixNoise: start > 0 };
  } catch (error) {
    return { ok: false, reason: "truncated-or-malformed", message: error.message, truncatedJson: /end of JSON|Unterminated/i.test(error.message) };
  }
}

export function isFullSha(s) {
  return isSha(s);
}
