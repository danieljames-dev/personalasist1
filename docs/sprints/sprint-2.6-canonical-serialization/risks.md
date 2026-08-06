# Sprint 2.6 Canonical Serialization Risks

Status: **Accepted** as the standing risk register, 2026-08-06  
Implementation: **Frozen**

CS-003, CS-004, and CS-008 were addressed by the B-2 and B-3 corrections and are updated
in place below. Every other entry remains open and unmitigated. ADR-008's acceptance closed
DG-2; it did not retire this register.

## Review posture

This register attempts to break ACJ-1 before anything is built. Severity reflects effect on
integrity correctness, owner data recoverability, replaceability, or ten-year
survivability. Likelihood stays qualitative until two independent implementations and a
fixture set exist.

## Risk register

| ID | Risk | Severity | Failure scenario | Recommendation |
|---|---|---:|---|---|
| CS-001 | Float prohibition blocks a real domain | Critical | A domain needs genuine continuous quantities — embedding vectors, measurements, model scores — and cannot express them without floats | **Controlled.** The prohibition is scoped to canonical integrity positions only; domain, transport, and storage representations are unconstrained (§8). Vectors are derived projections outside canonical envelopes. The mandatory continuous-quantity review trigger, with nine required evidence items, is the designated point at which the constraint is re-tested against a real schema rather than against argument |
| CS-002 | Decimal modelling error | High | Wrong declared scale or ambiguous rounding produces wrong data that canonicalizes perfectly | Scale and rounding declared per field with fixtures; ACJ-1 removes encoding ambiguity, never modelling error |
| CS-003 | NFC rule never enforced | Critical → **High** | Nothing enforces NFC; non-NFC strings become contract values and hash inconsistently | **Partially addressed.** `CanonicalContractValidatorV1` (§0) now owns NFC verification with a stable rejection outcome. The responsibility is specified but unimplemented, so the risk persists in full until it exists — it is now assigned rather than homeless |
| CS-004 | Canonicalizer bypassed | Critical → **High** | A caller invokes the canonicalizer directly on unvalidated input, skipping NFC and identifier rules | **Partially addressed.** §0 states the canonicalizer accepts only validated values and enumerates nine prohibited repairs; `unvalidated-input` is a named rejection (§33). Enforcement still requires the unimplemented validator |
| CS-004a | Validator implemented as a repairer | High | An implementation "helpfully" normalizes non-NFC input or drops duplicate keys, mapping two inputs to one output and hiding a producer bug | §0 requirements 4 and 5 forbid silent rewriting and forbid treating a normalized invalid value as equivalent; conformance requires agreement on rejections, not only on acceptances |
| CS-005 | JCS subset relationship silently broken | Critical | A later amendment makes ACJ-1 output that stock JCS would not produce; cross-checking becomes invalid | Cross-check against an unmodified third-party JCS implementation is a standing conformance requirement, not a one-time check |
| CS-006 | Code-unit vs code-point sort divergence | High | An implementation sorts by code point; keys outside the Basic Multilingual Plane order differently and digests diverge | Explicit UTF-16 code unit rule plus mandatory astral-plane fixtures |
| CS-007 | Duplicate-key parser differential | Critical | Validator and consumer disagree on which duplicate wins | Reject duplicates; rejection is fixture-tested |
| CS-008 | Frame omitted as an optimisation | Critical → **Medium** | Implementation hashes bare canonical bytes; cross-protocol digest reuse becomes possible | **Addressed.** `missing-frame` is a named rejection (§33) with a required rejection fixture. Residual risk is an implementation that skips framing entirely, which conformance fixtures detect |
| CS-008a | Delimiter framing reintroduced | Critical | A future profile or implementation reverts to separator-based framing, restoring boundary-shifting collisions | **Addressed structurally.** §23 rejects delimiter-only framing by name and states the injectivity argument does not depend on any byte being absent. Reversion requires a new frame version and fails closed for old readers |
| CS-008b | Frame parsing attack | High | Crafted lengths cause truncated reads, integer overflow, or trailing-byte smuggling | **Addressed.** `frame-truncated`, `frame-length-overflow`, `frame-trailing-bytes`, `unknown-frame-version` are named deterministic rejections; length arithmetic must use a non-wrapping width (§23 rules 8–11) |
| CS-009 | Algorithm downgrade | Critical | Verifier accepts a descriptor naming a weak or withdrawn algorithm | Registry resolution; unknown or retired identifiers fail closed; no default inference |
| CS-010 | Digest mistaken for authenticity | Critical | Owner or operator believes a matching digest proves origin | Stated in the contract, the threat model, and the ADR. Signing is a separate decision and its absence is explicit |
| CS-011 | Signature designed later without domain separation | High | A future signature covers raw bytes, reopening cross-protocol attacks | Signature boundary fixed now: signatures cover the domain-separated digest input |
| CS-012 | Timestamp precision drift | High | A producer emits six fractional digits; digests diverge for one instant | Exactly three digits, mandatory `Z`, fixtures for every rejected variant |
| CS-013 | Canonicalization denial of service | High | Adversarial nesting or member count exhausts memory or CPU during bounded-buffer sorting | Hard limits on depth, members, array length, string size, total size; deterministic rejection |
| CS-014 | Streaming assumed | Medium | A consumer assumes canonical output can stream; member sorting makes it impossible | Stated plainly as bounded-buffer; large content excluded from envelopes |
| CS-015 | Base64url inflation | Medium | Binary embedded in envelopes inflates about one third and bloats every digest and export | Content-addressed artifact references; only reference and digest enter the envelope |
| CS-016 | Profile migration invalidates history | Critical | `acj-2` recomputation makes `acj-1` digests unverifiable; retained backups and exports fail verification | Both descriptors retained; archival verifiers preserved; migration never changes Object revision |
| CS-017 | Limits collide with DG-4 | High | DG-4 permits an envelope larger than the canonicalizer accepts; valid Objects become uncanonicalizable | Stated ordering: DG-4 limits must be ≤ canonicalizer limits, verified when DG-4 is specified |
| CS-018 | Malicious or wrong fixtures | Critical | A fixture with an incorrect expected digest certifies a broken implementation as conforming | Fixtures under change control, cross-checked against an independent implementation, rejection cases mandatory |
| CS-019 | Rejection messages leak content | High | Error text echoes the offending value, turning an error channel into a disclosure channel | Errors name category and location only |
| CS-020 | Comparison timing leak | Medium | Early-exit digest comparison leaks a prefix where an attacker can submit candidates and observe outcomes | Constant-time comparison wherever an untrusted party influences input and observes the result |
| CS-021 | Unknown-member handling diverges | High | One implementation drops unknown members before digesting; digests disagree and ADR-007 round-trip guarantees break | Unknown members are content: preserved, canonicalized, digest-covered, never interpreted |
| CS-022 | Null-versus-absent conflation | High | A schema permits both for one meaning; two encodings, two digests, one logical value | Schemas declare exactly one form per field; a schema permitting both is invalid |
| CS-023 | Identifier repair | High | A canonicalizer lowercases or trims an identifier, making two distinct inputs collide and hiding a producer bug | Reject, never repair |
| CS-024 | Ten-year verifier loss | Critical | Toolchain change makes an old profile unimplementable; retained exports and backups become unverifiable | Preserve profile specifications, archival verifiers, and fixtures alongside release snapshots |
| CS-025 | Premature contract freeze | High | ACJ-1 is declared stable before two implementations agree, forcing an immediate `acj-2` | Stability requires cross-runtime byte agreement across the full fixture set including rejections |
| CS-026 | Scope creep into transport or storage | Medium | Teams adopt ACJ-1 as the wire or storage format, coupling systems to a format designed for hashing | Non-responsibilities stated in the ADR, contract, and specification |
| CS-027 | Unicode confusables assumed handled | High | Reviewers believe canonicalization defends against homoglyph type or key names | Explicitly out of reach; identifier grammar and namespace ownership carry that load |
| CS-028 | Over-permissive implementation passes | High | An implementation accepts floats or duplicates but never encounters them, so acceptance-only fixtures pass it | Rejection fixtures mandatory; conformance requires agreement on rejections |

## Scalability challenges

**Bounded-buffer canonicalization.** Member sorting requires every member of an object
before any byte is emitted, so a conforming implementation holds a whole document in
memory. The §29–§31 limits bound this; they do not remove it. Envelope size, not artifact
size, is the constrained dimension — large content stays outside via content-addressed
references.

**Digest recomputation cost.** Every committed mutation canonicalizes and digests the new
snapshot. Combined with the Version and Event Objects each commit produces, this multiplies
per-mutation CPU. Unmeasured until DG-4 benchmarks exist; a real input to the storage
decision.

**Profile migration cost.** Migrating profiles re-canonicalizes and re-digests every
retained Object, Version, Event, and export. On a local-first device with long history this
may be the most expensive operation the platform ever performs, which is why both
descriptors are retained rather than forcing an eager sweep.

## Migration risks

- A canonicalization change invalidates every stored digest without any content change.
- Retained backups and exports carry old-profile digests indefinitely.
- A withdrawn digest algorithm requires re-digesting content that may no longer be mutable.
- Fixtures authored under one profile must be regenerated, and their expected values are
  the definition of correctness — a regeneration bug is undetectable without cross-checking.

Mitigation requires immutable profile identifiers, retained descriptors, archival
verifiers, explicit migration events, and independent cross-implementation verification.

## Security challenges

Highest risks are parser differentials, domain-label omission, algorithm downgrade,
signature wrapping if signatures are designed without the domain-separation constraint, and
the standing misconception that a digest proves authenticity. The threat model defines
controls; none is verified until two implementations agree on the fixture set.

## Improvements required before implementation

DG-2 closed on 2026-08-06. These remain outstanding and block later work, not DG-2.

1. Decide the exact decimal representation at the continuous-quantity review trigger.
2. Fix the registered digest algorithm set and the add/retire process.
3. Decide algorithm retirement over immutable Version and Event Objects, and over
   Destroyed content that cannot be re-digested.
4. Fix the boundary between canonicalizer limits and DG-4 business limits; current values
   are provisional.
5. Decide where constant-time digest comparison is mandatory.
6. Decide the signature and trust architecture.
7. Produce two independent implementations that agree byte-for-byte on the fixture set,
   including rejections, cross-checked against an unmodified JCS implementation.

## Architecture recommendation

ACJ-1 resolves the numeric ambiguity that made unconstrained JCS unsuitable for an
integrity mechanism, assigns validation to a named boundary, and frames digest inputs
injectively without depending on any byte being absent. The architecture is **accepted**.

It remains **not ready for implementation**. Every control that depends on
`CanonicalContractValidatorV1` is specified rather than active, no implementation exists,
and cross-runtime agreement has never been demonstrated. The float prohibition was accepted
deliberately, with a review trigger, rather than absorbed by default — but it has still
never been tested against a real domain schema, because none exists.
