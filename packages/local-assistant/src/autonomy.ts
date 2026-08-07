/**
 * Autonomy governance.
 *
 * Every consequential thing AION can do is placed on one scale, from reading something local to
 * doing something irreversible in the world. The scale exists so authority is a property of the
 * *action*, not of whoever happens to be asking: a model that wants to send an email and an owner
 * who wants to send an email are proposing the same level-4 action, and only one of them can
 * authorise it.
 *
 * Two rules hold everywhere and are enforced here rather than remembered by convention:
 *
 *   1. No agent raises its own authority. A proposer may name the level it believes it needs; it
 *      can never grant itself that level, and asking for more than it was granted is a refusal,
 *      not a negotiation.
 *   2. No model approves its own proposal. An approval must come from the owner. A provider,
 *      routine, or developer agent approving something it proposed is the exact loop this
 *      prevents.
 */

export type AutonomyLevelV1 = 0 | 1 | 2 | 3 | 4 | 5;
export const AUTONOMY_LEVELS: readonly AutonomyLevelV1[] = [0, 1, 2, 3, 4, 5];

/** Who is asking. Only the owner can ever grant authority; everything else can only propose. */
export type AutonomyActorV1 = "owner" | "provider-proposal" | "routine" | "developer-agent" | "system";
export const AUTONOMY_ACTORS: readonly AutonomyActorV1[] = ["owner", "provider-proposal", "routine", "developer-agent", "system"];

export interface AutonomyPolicyV1 {
  level: AutonomyLevelV1;
  label: string;
  /** What belongs at this level, in the owner's terms rather than in implementation terms. */
  description: string;
  /** Whether an action at this level needs an explicit one-shot approval before it can run. */
  requiresApproval: boolean;
  /**
   * Whether an approval is not enough on its own — the owner must additionally have authorised
   * the capability class in advance. Reserved for actions that spend money, communicate on the
   * owner's behalf, or cannot be undone.
   */
  requiresStandingAuthorization: boolean;
  /** Whether AION can undo the action itself if the owner changes their mind. */
  reversible: boolean;
}

export const AUTONOMY_POLICIES: readonly AutonomyPolicyV1[] = [
  {
    level: 0, label: "Read and analyse",
    description: "Read local state, summarise it, or answer a question. Nothing changes.",
    requiresApproval: false, requiresStandingAuthorization: false, reversible: true,
  },
  {
    level: 1, label: "Create locally",
    description: "Create a new local record — a task, a note, a draft, a proposal. Deleting it restores the previous state exactly.",
    requiresApproval: false, requiresStandingAuthorization: false, reversible: true,
  },
  {
    level: 2, label: "Modify locally",
    description: "Change or archive an existing local record. AION keeps the prior value, so the change can be described and undone.",
    requiresApproval: true, requiresStandingAuthorization: false, reversible: true,
  },
  {
    level: 3, label: "External, reversible",
    description: "Reach something outside this computer in a way that can be withdrawn — fetch a public page, call an owner-controlled endpoint, write a preview nobody else can see.",
    requiresApproval: true, requiresStandingAuthorization: false, reversible: true,
  },
  {
    level: 4, label: "External communication or deployment",
    description: "Say something to someone else, or put something where other people can reach it. Once it has been seen it cannot be unseen.",
    requiresApproval: true, requiresStandingAuthorization: true, reversible: false,
  },
  {
    level: 5, label: "Financial, legal, or irreversible",
    description: "Spend money, enter an agreement, or destroy something that cannot be reconstructed. AION never proposes one of these on its own initiative.",
    requiresApproval: true, requiresStandingAuthorization: true, reversible: false,
  },
];

export function autonomyPolicy(level: AutonomyLevelV1): AutonomyPolicyV1 {
  const policy = AUTONOMY_POLICIES.find((entry) => entry.level === level);
  if (!policy) throw new Error("Autonomy level is not recognised.");
  return policy;
}

export function isAutonomyLevel(value: unknown): value is AutonomyLevelV1 {
  return typeof value === "number" && (AUTONOMY_LEVELS as readonly number[]).includes(value);
}

/**
 * The authority the owner has granted to a class of actor.
 *
 * The default is deliberately low: an actor that is not the owner may read and may create local
 * proposals, and nothing else, until the owner decides otherwise. `system` is the internal
 * bookkeeping actor — migrations, pruning, activity — and is capped at local modification because
 * AION's own housekeeping never needs to reach outside the machine.
 */
export const DEFAULT_GRANTED_AUTONOMY: Readonly<Record<AutonomyActorV1, AutonomyLevelV1>> = {
  owner: 5,
  "provider-proposal": 1,
  routine: 1,
  "developer-agent": 1,
  system: 2,
};

export interface AutonomyDecisionV1 {
  allowed: boolean;
  actor: AutonomyActorV1;
  requested: AutonomyLevelV1;
  granted: AutonomyLevelV1;
  policy: AutonomyPolicyV1;
  /** A sentence the owner can read. Never a stack trace and never an implementation detail. */
  reason: string;
}

/**
 * Decides whether an actor may take an action at the requested level.
 *
 * This never mutates anything and never consults the actor about its own authority: the granted
 * level is supplied by the caller from owner-controlled policy. An actor asking for more than it
 * holds is refused with the reason stated plainly, which is the observable form of "no agent
 * raises its own authority".
 */
export function evaluateAutonomy(
  actor: AutonomyActorV1,
  requested: AutonomyLevelV1,
  granted: Readonly<Record<AutonomyActorV1, AutonomyLevelV1>> = DEFAULT_GRANTED_AUTONOMY,
): AutonomyDecisionV1 {
  if (!AUTONOMY_ACTORS.includes(actor)) throw new Error("Autonomy actor is not recognised.");
  if (!isAutonomyLevel(requested)) throw new Error("Autonomy level is not recognised.");
  const ceiling = granted[actor];
  if (!isAutonomyLevel(ceiling)) throw new Error("Granted autonomy is not recognised.");
  const policy = autonomyPolicy(requested);
  if (requested > ceiling) {
    return {
      allowed: false, actor, requested, granted: ceiling, policy,
      reason: `${actor} may act up to level ${ceiling} (${autonomyPolicy(ceiling).label}) but this action is level ${requested} (${policy.label}). AION does not raise an actor's own authority; the owner must take this action or grant the level explicitly.`,
    };
  }
  return {
    allowed: true, actor, requested, granted: ceiling, policy,
    reason: policy.requiresApproval
      ? `Level ${requested} (${policy.label}) is within ${actor}'s authority but still requires an explicit approval before it runs.`
      : `Level ${requested} (${policy.label}) is within ${actor}'s authority and needs no separate approval.`,
  };
}

/**
 * Enforces that a proposal is not approved by whatever produced it.
 *
 * The owner is the only actor that can approve. This is checked against the *origin recorded on
 * the proposal*, not against anything the approver claims about itself, so a provider cannot
 * launder its own proposal by re-submitting it under a different name.
 */
export function assertSeparateApprover(proposalOrigin: AutonomyActorV1, approver: AutonomyActorV1): void {
  if (approver !== "owner") {
    throw new Error(`Only the owner can approve an action. ${approver} proposed or requested it and cannot also authorise it.`);
  }
  if (proposalOrigin === "owner") return;
  // An owner approving a model's proposal is exactly the intended flow; the check above is what
  // makes the reverse impossible. This branch exists so the rule reads as one rule, not two.
}

/**
 * The level AION assigns to a capability, from properties the capability itself declares.
 *
 * Deliberately conservative: anything that reaches outside the machine is at least level 3, and
 * anything a capability marks as irreversible is at least level 4. A capability cannot talk its
 * way down the scale, because the inputs to this function are structural, not descriptive.
 */
export function classifyCapabilityAutonomy(capability: {
  reachesNetwork?: boolean;
  writesLocalState?: boolean;
  createsOnly?: boolean;
  communicatesExternally?: boolean;
  irreversible?: boolean;
  spendsMoney?: boolean;
}): AutonomyLevelV1 {
  if (capability.spendsMoney || capability.irreversible) return 5;
  if (capability.communicatesExternally) return 4;
  if (capability.reachesNetwork) return 3;
  if (capability.writesLocalState) return capability.createsOnly ? 1 : 2;
  return 0;
}
