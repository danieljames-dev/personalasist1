import {
  type AgentRoleV1,
  type OperationClassV1,
  type GitPermissionV1,
  type HostPermissionV1,
  DelegatedOperatorError,
  isAgentRoleV1,
} from "./contracts.js";

export interface RoleProfileV1 {
  readonly role: AgentRoleV1;
  readonly mayEver: ReadonlySet<OperationClassV1>;
  readonly structuralDenies: ReadonlySet<OperationClassV1>;
  readonly defaultGit: readonly GitPermissionV1[];
  readonly defaultHost: readonly HostPermissionV1[];
}

const GROK_MAY: readonly OperationClassV1[] = [
  "repo.read",
  "repo.edit",
  "test.run",
  "npm.run",
  "node.run",
  "docker.test",
  "git.status",
  "git.diff",
  "git.stage",
  "git.commit_forward",
  "git.push_canonical",
  "powershell.read",
  "powershell.repo_operation",
  "temp.create",
  "temp.delete_owned",
  "handoff.write",
  "host.read",
  "host.reboot",
];

const CLAUDE_MAY: readonly OperationClassV1[] = [
  "repo.read",
  "test.run",
  "npm.run",
  "node.run",
  "docker.test",
  "git.status",
  "git.diff",
  "powershell.read",
  "temp.create",
  "temp.delete_owned",
  "handoff.write",
  "host.read",
];

const CLAUDE_DENY: readonly OperationClassV1[] = [
  "repo.edit",
  "git.stage",
  "git.commit_forward",
  "git.push_canonical",
  "powershell.repo_operation",
  "host.reboot",
];

export const ROLE_PROFILES_V1: Readonly<Record<AgentRoleV1, RoleProfileV1>> = {
  GROK_BUILD: {
    role: "GROK_BUILD",
    mayEver: new Set(GROK_MAY),
    structuralDenies: new Set(),
    defaultGit: ["read", "stage", "commit_forward", "push_canonical"],
    defaultHost: ["elevated_readonly_security", "planned_reboot", "none"],
  },
  CLAUDE_AUDITOR: {
    role: "CLAUDE_AUDITOR",
    mayEver: new Set(CLAUDE_MAY),
    structuralDenies: new Set(CLAUDE_DENY),
    defaultGit: ["read", "none"],
    defaultHost: ["elevated_readonly_security", "none"],
  },
};

export function requireRole(role: unknown): AgentRoleV1 {
  if (!isAgentRoleV1(role)) {
    throw new DelegatedOperatorError("unknown-role", "Unknown agent role refuses closed.");
  }
  return role;
}

export function roleAllowsOperation(role: AgentRoleV1, operation: OperationClassV1): boolean {
  const profile = ROLE_PROFILES_V1[role];
  if (profile.structuralDenies.has(operation)) return false;
  return profile.mayEver.has(operation);
}

/** Builder-write operations that require exclusive write ownership. */
export const BUILDER_WRITE_OPERATIONS: ReadonlySet<OperationClassV1> = new Set([
  "repo.edit",
  "git.stage",
  "git.commit_forward",
  "git.push_canonical",
  "powershell.repo_operation",
]);
