/**
 * Role routing, version ordering, and argv that must not become a shell.
 *
 * Discovery of which binary to launch lives in `executor-discovery.ts`. Argv construction
 * lives in `executor-adapters.ts`. This module keeps the two pure tables those paths share,
 * and the one argv-safety check `executeRun` applies to every token.
 */
import { CONTROL_BYTES } from "./control-bytes.js";
import { inspectHostPath } from "./host-path.js";

export type ExecutorNameV1 = "claude" | "grok" | "local";

/**
 * Compare two version strings numerically, segment by segment.
 *
 * Returns null when they cannot be ordered — which is a real answer, not a failure. Two installs
 * whose versions are incomparable must not be silently resolved in favour of whichever the
 * filesystem happened to list first.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const match = String(v ?? "").match(/(\d+(?:\.\d+)*)/);
    if (!match) return null;
    return match[1]!.split(".").map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

export type ExecutorRoleV1 =
  | "IMPLEMENT"
  | "REPAIR"
  | "INTEGRATE"
  | "DEPLOY"
  | "INDEPENDENT_ACCEPTANCE"
  | "ADVERSARIAL_REVIEW"
  | "RESEARCH"
  | "PRE_INTEGRATION_REHEARSAL"
  | "POST_CLEANUP_RECHECK"
  | "GIT_VERIFY"
  | "BUILD"
  | "TEST"
  | "HEALTH"
  | "SAFE_PROJECT_SCRIPT";

/**
 * Which executor does what, decided in a table.
 *
 * No model is consulted to make this choice. Asking one to route every ordinary run would add
 * latency, cost and a failure mode, to answer a question whose answer is fixed.
 */
export const ROUTING: Readonly<Record<ExecutorRoleV1, ExecutorNameV1>> = {
  IMPLEMENT: "claude",
  REPAIR: "claude",
  INTEGRATE: "claude",
  DEPLOY: "claude",
  INDEPENDENT_ACCEPTANCE: "grok",
  ADVERSARIAL_REVIEW: "grok",
  RESEARCH: "grok",
  PRE_INTEGRATION_REHEARSAL: "grok",
  POST_CLEANUP_RECHECK: "grok",
  GIT_VERIFY: "local",
  BUILD: "local",
  TEST: "local",
  HEALTH: "local",
  SAFE_PROJECT_SCRIPT: "local",
};

/**
 * Exhaustive partition of {@link ExecutorRoleV1}. Adding a role without
 * classifying it fails typecheck. WRITE_ROLES and NON_WRITING_ROLES are
 * derived from this table so they cannot drift from each other.
 */
export const ROLE_KIND = {
  IMPLEMENT: "WRITE",
  REPAIR: "WRITE",
  INTEGRATE: "WRITE",
  DEPLOY: "WRITE",
  INDEPENDENT_ACCEPTANCE: "NON_WRITING",
  ADVERSARIAL_REVIEW: "NON_WRITING",
  RESEARCH: "NON_WRITING",
  PRE_INTEGRATION_REHEARSAL: "NON_WRITING",
  POST_CLEANUP_RECHECK: "NON_WRITING",
  GIT_VERIFY: "LOCAL",
  BUILD: "LOCAL",
  TEST: "LOCAL",
  HEALTH: "LOCAL",
  SAFE_PROJECT_SCRIPT: "LOCAL",
} as const satisfies Record<ExecutorRoleV1, "WRITE" | "NON_WRITING" | "LOCAL">;

function rolesOfKind(kind: (typeof ROLE_KIND)[ExecutorRoleV1]): ReadonlySet<ExecutorRoleV1> {
  return new Set(
    (Object.keys(ROLE_KIND) as ExecutorRoleV1[]).filter((role) => ROLE_KIND[role] === kind),
  );
}

export const WRITE_ROLES: ReadonlySet<ExecutorRoleV1> = rolesOfKind("WRITE");
export const NON_WRITING_ROLES: ReadonlySet<ExecutorRoleV1> = rolesOfKind("NON_WRITING");
export const LOCAL_ROLES: ReadonlySet<ExecutorRoleV1> = rolesOfKind("LOCAL");

export function isExecutorRole(value: unknown): value is ExecutorRoleV1 {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROUTING, value);
}

export function routeRole(role: ExecutorRoleV1): ExecutorNameV1 {
  return ROUTING[role];
}

/**
 * Refuse argv that carries shell syntax.
 *
 * Belt and braces: the Director spawns with `shell: false`, so metacharacters are inert. This exists
 * so that a future call site which reintroduces a shell cannot also quietly reintroduce injection —
 * the argv would already have been rejected here.
 *
 * `=>` is the JS arrow that `node -e` scripts use (and that p2-e2e actually emits). It is matched
 * as a unit and removed before the redirect check, so a lone `>` stays a metacharacter. A lookbehind
 * on `=` would treat every `>` after `=` the same way; the exception is the arrow, not the `=`.
 *
 * Tokens that already name one fixed host place are exempt from `& $` — those are legal NTFS
 * name characters (`R&D`, `\\host\C$`). `< > |` and newlines are not legal names and stay refused.
 * `;` is a command separator; no argv this Director emits contains one, so a token that
 * parses as a host path and contains `;` is refused like any other token.
 */
const SHELL_METACHARACTERS = /[;&|`$<\n\r]|\$\(|&&|\|\|/;
const PATH_ILLEGAL_SHELL = /[;|<>\n\r]/;

export function argvIsSafe(argv: readonly string[]): { safe: boolean; offending: string | null } {
  for (const token of argv) {
    if (CONTROL_BYTES.test(token)) return { safe: false, offending: String(token) };
    if (tokenCarriesShellMetacharacters(String(token))) return { safe: false, offending: String(token) };
  }
  return { safe: true, offending: null };
}

function tokenCarriesShellMetacharacters(token: string): boolean {
  if (CONTROL_BYTES.test(token)) return true;
  // Consume `=>` as one token so a leftover `>` is still a redirect.
  const withoutArrows = token.replace(/=>/g, "");
  // Multi-character operators and `;` are never legal in argv. Test them on
  // every token before the host-path exemption, which exists only for `&`, `$`.
  if (/\$\(|&&|\|\|/.test(withoutArrows) || withoutArrows.includes("`") || withoutArrows.includes(";")) {
    return true;
  }
  if (inspectHostPath(token).identifiable) {
    return PATH_ILLEGAL_SHELL.test(withoutArrows);
  }
  return SHELL_METACHARACTERS.test(withoutArrows) || withoutArrows.includes(">");
}
