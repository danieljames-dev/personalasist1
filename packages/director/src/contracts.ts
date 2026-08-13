/**
 * The small shared vocabulary of the Director.
 *
 * Deliberately tiny. The Director borrows nothing from the assistant's contracts because the two
 * own different things — one orchestrates engineering work, the other holds the Owner's business
 * records — and a shared type between them would be the first step towards a shared write path.
 */

/** An ISO-8601 instant in UTC. Every durable record carries one. */
export type IsoTimestamp = string;

/** An opaque identifier. Never parsed, never given meaning by its shape. */
export type OpaqueId = string;

/**
 * Where the Director's live state lives.
 *
 * Not inside any Git worktree, and that is the whole point: a branch switch, a `git clean`, or a
 * worktree prune must never be able to erase mission continuity. The repository holds code,
 * schemas, default policy and tests; the host holds what is actually happening.
 */
export const DEFAULT_DIRECTOR_ROOT = "C:\\AION\\director";

/** Environment override, for an Owner who later moves the host root. */
export const DIRECTOR_ROOT_ENV = "AION_DIRECTOR_ROOT";

/**
 * The one address the Director answers on.
 *
 * Loopback only. A phone reaches it through the Command Center's authenticated same-origin bridge,
 * never directly, and the Director does not implement pairing of its own — the Command Center hop
 * *is* the authorization boundary, so weakening Director auth because "the phone is already paired"
 * would remove the boundary rather than reuse it.
 */
export const DIRECTOR_BIND_HOST = "127.0.0.1";
export const DIRECTOR_BIND_PORT = 31417;

/**
 * The invariant that keeps the two halves apart.
 *
 * The Director orchestrates engineering work. It may read a production SHA, a listening port or a
 * health endpoint. It may never open the Owner's business state for write — that belongs to the
 * assistant runtime alone, and a single shared writer is how a mission crash would corrupt a
 * customer record.
 */
export const DIRECTOR_BUSINESS_STATE_WRITER = false as const;
