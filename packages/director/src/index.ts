/**
 * AION Director — mission orchestration for engineering work.
 *
 * The Director runs long jobs that outlive any one conversation: hand work to an executor, verify
 * what came back against the repository rather than against its own report, stop at the points a
 * person must decide, and survive a reboot with enough state that a later process knows what to do.
 *
 * It does not touch the Owner's business records. That boundary is the reason the two halves can
 * share a machine safely, and it is asserted rather than assumed.
 */
export * from "./contracts.js";
export * from "./mission.js";
export * from "./gates.js";
export * from "./git-truth.js";
export * from "./handoff.js";
export * from "./leases.js";
