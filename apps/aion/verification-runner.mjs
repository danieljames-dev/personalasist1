/**
 * Real verification evidence for a milestone the app just ran.
 *
 * This is the piece whose absence stopped the chain. `advanceRoadmap` calls `deps.verify(milestone)`
 * and passes what comes back to `evaluateVerification`, which fails a milestone whose required steps
 * have no explicit passing evidence. The app used to supply `() => []`, so every milestone reached
 * `VALIDATION_FAILED` — correct behaviour on an honest rule, and a chain that could never finish.
 *
 * ## The one rule
 *
 * A check produces `PASS` only from something observed. It has no branch that concludes success from
 * the absence of a failure, and it never invents evidence for a step it does not know how to check —
 * an unrecognised step name yields *no row*, which `evaluateVerification` reports as missing and
 * fails on. That asymmetry is deliberate: a runner that guessed would quietly convert "we did not
 * look" into "it passed", which is the exact defect the whole verification design exists to prevent.
 *
 * ## What it is allowed to do
 *
 * Read the durable MVA job record, read the artifact that job wrote, and ask git for HEAD. Nothing
 * else — no writes, no network, no shell. A verifier with side effects cannot be trusted to describe
 * the state it just changed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { jobRecordPath, parseJobRecord } from "../../packages/director/dist/index.js";

/** The job id `createMvaDispatcher` gives a roadmap milestone. Derived, never guessed. */
export function jobIdForMilestone(milestoneId) {
  return `roadmap-${milestoneId}`;
}

function loadJobRecord(jobStoreRoot, milestoneId) {
  try {
    return parseJobRecord(readFileSync(jobRecordPath(jobStoreRoot, jobIdForMilestone(milestoneId)), "utf8"));
  } catch {
    return null;
  }
}

function headSha(repositoryRoot) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function pass(step, detail) {
  return { step, result: "PASS", detail };
}

function fail(step, detail) {
  return { step, result: "FAIL", detail };
}

/**
 * The closed set of verification steps this runner can actually perform.
 *
 * Each entry answers one question about durable state. A milestone whose plan names a step outside
 * this table gets no evidence for it and therefore cannot complete — which is the honest outcome
 * when nothing in the process knows how to check the thing that was promised.
 */
export const VERIFICATION_STEPS_V1 = Object.freeze({
  /**
   * The durable job record and the filesystem tell the same story.
   *
   * This is the step name the port seeds by default, and it means what it says: a record exists, it
   * reached a terminal success, every artifact it claims is present on disk, and it is not still
   * holding a lease. A record that says SUCCEEDED while its artifact is missing is precisely the
   * disagreement this check exists to catch.
   */
  "durable state reconciled": (context) => {
    const step = "durable state reconciled";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    if (record.status !== "SUCCEEDED") return fail(step, `job ended in ${record.status}`);
    if (record.artifacts.length === 0) return fail(step, "job reported success without naming an artifact");
    const absent = record.artifacts.filter((path) => !existsSync(path));
    if (absent.length > 0) return fail(step, `record names ${absent.length} artifact(s) that are not on disk`);
    if (!record.leaseReleased) return fail(step, "the job still holds its lease");
    if (record.failureReason !== null) return fail(step, `record carries a failure reason: ${record.failureReason}`);
    return pass(step, `record and ${record.artifacts.length} artifact(s) agree`);
  },

  "dispatch artifact validated": (context) => {
    const step = "dispatch artifact validated";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    if (record.status !== "SUCCEEDED") return fail(step, `job ended in ${record.status}`);
    const artifact = record.artifacts[record.artifacts.length - 1] ?? null;
    if (artifact === null) return fail(step, "job reported success without naming an artifact");
    if (!existsSync(artifact)) return fail(step, `artifact is named but absent: ${artifact}`);
    let contents = "";
    try {
      contents = readFileSync(artifact, "utf8");
    } catch (error) {
      return fail(step, `artifact is unreadable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!contents.includes(`JOB_ID = ${record.jobId}`)) {
      return fail(step, "artifact does not name this job");
    }
    if (!record.verificationEvidence.includes("artifact-validated")) {
      return fail(step, "dispatch did not record artifact validation");
    }
    return pass(step, `artifact validated at ${artifact}`);
  },

  /**
   * The anti-masquerade check: the provider the bridge selected must be the provider the artifact
   * says executed. If those ever disagree, the run happened somewhere other than it claims.
   */
  "executor matches selected provider": (context) => {
    const step = "executor matches selected provider";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    const provider = record.activeProvider;
    if (provider === null) return fail(step, "no provider was recorded for this job");
    if (!context.registeredProviders.includes(provider)) {
      return fail(step, `provider ${provider} has no registered executor in this process`);
    }
    const artifact = record.artifacts[record.artifacts.length - 1] ?? null;
    if (artifact === null || !existsSync(artifact)) return fail(step, "no artifact to check the executor against");
    let contents = "";
    try {
      contents = readFileSync(artifact, "utf8");
    } catch (error) {
      return fail(step, `artifact is unreadable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (!contents.includes(`EXECUTOR = ${provider}`)) {
      return fail(step, `artifact does not name ${provider} as the executor`);
    }
    return pass(step, `${provider} was selected and ${provider} wrote the artifact`);
  },

  "no external effect": (context) => {
    const step = "no external effect";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    if (record.externalEffectState !== "NONE") {
      return fail(step, `job reported external effect state ${record.externalEffectState}`);
    }
    const offending = record.attempts.filter((attempt) => attempt.externalEffectState !== "NONE");
    if (offending.length > 0) {
      return fail(step, `${offending.length} attempt(s) reported an external effect`);
    }
    return pass(step, "no attempt reported an external effect");
  },

  "zero spend": (context) => {
    const step = "zero spend";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    const spent = record.attempts.reduce((total, attempt) => total + (attempt.cost ?? 0), 0);
    if (spent !== 0) return fail(step, `attempts reported ${spent} USD`);
    return pass(step, "every attempt reported zero cost");
  },

  "writer released": (context) => {
    const step = "writer released";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    if (!record.leaseReleased) return fail(step, "the job still holds its lease");
    if (record.writer.liveness !== "STOPPED") return fail(step, `writer liveness is ${record.writer.liveness}`);
    return pass(step, "lease released and writer stopped");
  },

  /**
   * A harmless milestone must not have moved the repository. Comparing HEAD to the sha the job
   * started from is the cheapest true statement available; it does not prove the worktree is clean,
   * and this check does not claim that.
   */
  "repository head unchanged": (context) => {
    const step = "repository head unchanged";
    const record = context.record;
    if (record === null) return fail(step, "no durable job record exists for this milestone");
    const head = headSha(context.repositoryRoot);
    if (head === null) return fail(step, "git HEAD could not be read");
    if (record.startingSha !== head) {
      return fail(step, `HEAD moved from ${record.startingSha} to ${head}`);
    }
    return pass(step, `HEAD is still ${head}`);
  },
});

/** Step names this runner can produce evidence for. Anything else fails closed by omission. */
export const VERIFIABLE_STEP_NAMES_V1 = Object.freeze(Object.keys(VERIFICATION_STEPS_V1));

/**
 * Build the verification function the orchestrator calls after a milestone runs.
 *
 * Returns evidence only for steps in the table above. The unknown-step case is not an error and not
 * a warning here — it is silence, and silence is what the verifier turns into a failed milestone.
 */
export function createVerificationRunner(options) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") {
    throw new Error("verification runner needs a repositoryRoot");
  }
  const jobStoreRoot = options.jobStoreRoot;
  if (typeof jobStoreRoot !== "string" || jobStoreRoot.trim() === "") {
    throw new Error("verification runner needs a jobStoreRoot");
  }
  const registeredProviders = options.registeredProviders ?? [];

  return function verify(milestone) {
    const record = loadJobRecord(jobStoreRoot, milestone.milestoneId);
    const context = { record, repositoryRoot, registeredProviders };
    const evidence = [];
    for (const planStep of milestone.verificationPlan.steps) {
      const check = VERIFICATION_STEPS_V1[planStep.name];
      if (check === undefined) continue;
      evidence.push(check(context));
    }
    return evidence;
  };
}
