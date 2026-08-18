/**
 * AION Personal Context — what AION is allowed to know about the Owner, and how sure it is.
 *
 * The pipeline, in the order a fact travels it:
 *
 * 1. {@link registerContextSource} writes an approved source into the registry. Nothing outside the
 *    registry is readable, and enrollment is data rather than code.
 * 2. {@link syncSource} walks that source inside a boundary that resolves through the filesystem
 *    (`path-boundary`), fingerprints it, and skips it when nothing changed.
 * 3. `extraction` turns declarations into facts and refuses to turn prose into guesses.
 * 4. `freshness` decides how current each claim is from the claim's own dates, never from `mtime`.
 * 5. {@link reconcileFacts} links supersessions and records conflicts without ever overwriting.
 * 6. The store persists sources, facts and receipts as plain local JSON.
 * 7. {@link getContextForJob} hands one eligible provider the smallest sufficient subset, with
 *    provenance, freshness, conflict warnings, and an itemised account of what was withheld.
 *
 * Nothing here grants authority. {@link authorityFromPersonalContext} is the only answer to "does
 * this fact let me act", and it is always no.
 */

export * from "./authority.js";
export * from "./contracts.js";
export * from "./disclosure.js";
export * from "./enrollment.js";
export * from "./enrollment-defaults.js";
export * from "./extraction.js";
export * from "./freshness.js";
export * from "./git-identity.js";
export * from "./hash.js";
export * from "./node-fs.js";
export * from "./owner-entry.js";
export * from "./path-boundary.js";
export * from "./receipts.js";
export * from "./report.js";
export * from "./reconcile.js";
export * from "./retrieval.js";
export * from "./store.js";
export * from "./sync.js";
