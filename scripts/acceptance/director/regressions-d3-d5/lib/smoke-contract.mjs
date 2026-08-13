/**
 * D5 real-smoke success is a conjunction. Exit 0 is never enough.
 * Claude not-logged-in is UNAVAILABLE, not mission corruption.
 */
export const SMOKE_CONJUNCTION = Object.freeze([
  "executableStarted",
  "cwdValidatedIndependently",
  "shellFalseArgv",
  "promptIsData",
  "durableRunIntent",
  "boundedLogs",
  "processTreeTerminated",
  "handoffStructural",
  "handoffSemanticIds",
  "artifactsInsideRunRoot",
  "gitBeforeAfterAgree",
  "noUnauthorizedFiles",
  "spendUsdZero",
]);

export function classifyExecutorAvailability(probe) {
  if (!probe?.executablePath) return "UNAVAILABLE";
  const text = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  if (/not logged in|please run \/login/i.test(text)) return "UNAVAILABLE";
  if (probe.exitCode === 0 && probe.started) return "AVAILABLE";
  if (probe.started && probe.exitCode !== 0) return "UNAVAILABLE";
  return "UNAVAILABLE";
}

export function evaluateSmoke(input) {
  const reasons = [];
  if (!input.executableStarted) reasons.push("executable-did-not-start");
  if (!input.cwdValidated) reasons.push("cwd-not-validated");
  if (input.shell !== false) reasons.push("shell-not-false");
  if (!input.promptIsData) reasons.push("prompt-not-data");
  if (!input.durableRunIntent) reasons.push("missing-run-intent");
  if (!input.boundedLogs) reasons.push("logs-unbounded");
  if (!input.processTreeTerminated) reasons.push("process-tree-alive");
  if (!input.handoffStructural) reasons.push("handoff-structural-fail");
  if (!input.handoffSemanticIds) reasons.push("handoff-id-mismatch");
  if (!input.artifactsInsideRunRoot) reasons.push("artifact-outside-run-root");
  if (!input.gitAgrees) reasons.push("git-disagrees");
  if (input.unauthorizedFiles) reasons.push("unauthorized-files");
  if (input.spendUsd !== 0) reasons.push("spend-nonzero");
  if (input.exitCode === 0 && reasons.length) reasons.push("exit-zero-insufficient");
  if (input.loginRequired) reasons.push("executor-unavailable-not-corruption");
  return {
    ok: reasons.length === 0,
    reasons,
    conjunction: SMOKE_CONJUNCTION,
    availability: classifyExecutorAvailability(input.probe || {}),
  };
}

export function grokArgv({ promptFile, cwd }) {
  return [
    "--prompt-file", promptFile,
    "--cwd", cwd,
    "--output-format", "text",
    "--permission-mode", "dontAsk",
    "--max-turns", "1",
  ];
}

export function grokArgvDefective({ promptFile, cwd }) {
  return ["-p", "--prompt-file", promptFile, "--cwd", cwd];
}

export function grokArgvLegal(argv) {
  const p = argv.indexOf("-p");
  const pf = argv.indexOf("--prompt-file");
  if (p >= 0 && pf >= 0) return false;
  if (p >= 0 && (argv[p + 1] == null || String(argv[p + 1]).startsWith("-"))) return false;
  return pf >= 0;
}
