/**
 * Minimum durable run record. Continuation must not require a hidden chat.
 */
export const RUN_RECORD_SCHEMA = "aion.director.run.v1";

export function newRunRecord(input) {
  return {
    schema: RUN_RECORD_SCHEMA,
    runId: input.runId,
    workItemId: input.workItemId,
    missionId: input.missionId,
    executor: input.executor,
    role: input.role,
    executablePath: input.executablePath,
    executableVersion: input.executableVersion || null,
    argv: input.argv,
    promptPath: input.promptPath,
    promptSha256: input.promptSha256 || null,
    cwd: input.cwd,
    resourceKey: input.resourceKey,
    runNonce: input.runNonce,
    startedAt: input.startedAt || null,
    finishedAt: null,
    exitCode: null,
    terminationReason: null,
    processIdentity: null,
    stdoutLog: input.stdoutLog || null,
    stderrLog: input.stderrLog || null,
    handoffPath: null,
    gitBeforePath: input.gitBeforePath || null,
    gitAfterPath: null,
    secretsPresent: false,
  };
}

export function redactLine(line) {
  return String(line)
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{10,}/g, "[REDACTED]")
    .replace(/tskey-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(authorization|api[_-]?key|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED-PEM]");
}

export function runRecordAnswers(record, liveProcess) {
  return {
    supposedToRun: Boolean(record?.executablePath && record?.argv),
    started: Boolean(record?.startedAt && record?.processIdentity),
    stillRunning: Boolean(liveProcess?.alive && liveProcess?.identityMatch),
    targetTree: record?.cwd || null,
    gitObserved: Boolean(record?.gitBeforePath || record?.gitAfterPath),
    handoffPresent: Boolean(record?.handoffPath),
  };
}
