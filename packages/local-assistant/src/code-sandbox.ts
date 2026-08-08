/**
 * CodeSandboxPortV1 — domain port only.
 *
 * The domain package must never implement eval, new Function, node:vm, or ambient child-process
 * execution for model code. The sandbox adapter lives outside pure domain composition and is
 * supplied only to evaluation. Ordinary Chat never resolves this port.
 */

export type CodeGradingModeV1 = "behavioural" | "structural";

export interface CodeSandboxCapabilityV1 {
  /**
   * behavioural — Docker engine available and pinned runner image present.
   * structural — engine missing, image missing, or sandbox otherwise unavailable; code cases use
   * structural-only checks and must say so.
   */
  mode: CodeGradingModeV1;
  available: boolean;
  detail: string;
  /** Immutable digest when behavioural mode is available. */
  imageDigest: string | null;
  /** Owner/development action when the image is the only missing piece. */
  ownerAction: string | null;
}

export interface CodeSandboxRunRequestV1 {
  /** Candidate source. Synthetic benchmark cases only. */
  code: string;
  /** Expression or harness snippet that must return a truthy result for success. */
  testExpression: string;
  /** Parent-enforced wall-clock deadline in milliseconds. */
  deadlineMs: number;
  signal: AbortSignal;
}

export interface CodeSandboxRunResultV1 {
  ok: boolean;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  detail: string;
  /** Always behavioural when a run was attempted through the sandbox. */
  mode: "behavioural";
}

/**
 * Domain port. Implementations exist only in evaluator composition (Docker adapter).
 * Nothing outside evaluation composition may resolve or use this port.
 */
export interface CodeSandboxPortV1 {
  capability(): Promise<CodeSandboxCapabilityV1>;
  run(request: CodeSandboxRunRequestV1): Promise<CodeSandboxRunResultV1>;
}

/**
 * Structural-only fallback used when behavioural isolation is unavailable.
 * No execution of model code — keyword/shape checks only, recorded as structural mode.
 */
export function structuralCodeCheck(code: string, requirements: { mustContain: readonly string[] }): { passed: boolean; detail: string; mode: "structural" } {
  const lower = code.toLocaleLowerCase();
  const missing = requirements.mustContain.filter((item) => !lower.includes(item.toLocaleLowerCase()));
  if (missing.length) {
    return { passed: false, detail: `structural only: missing ${missing.join(", ")}`, mode: "structural" };
  }
  // Keyword presence is weak evidence and is labelled as such.
  return { passed: true, detail: "structural only: required tokens present (not behaviourally executed)", mode: "structural" };
}

/** The only authorized runner image family for behavioural grading. */
export const CODE_SANDBOX_RUNNER_IMAGE_NAME = "docker.io/library/node";
/**
 * Immutable digest pinned after registry resolution for node:22-alpine.
 * Future behavioural grading must use this digest, not a floating tag.
 */
export const CODE_SANDBOX_RUNNER_DIGEST = "sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
export const CODE_SANDBOX_RUNNER_IMAGE = `${CODE_SANDBOX_RUNNER_IMAGE_NAME}@${CODE_SANDBOX_RUNNER_DIGEST}`;
