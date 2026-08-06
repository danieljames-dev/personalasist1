# Sprint 2.6 Canonical Serialization Risks

Status: **Proposed** architecture challenge record  
Implementation: **Frozen**

## Review posture

This register attempts to break ACJ-1 before anything is built. Severity reflects effect on
integrity correctness, owner data recoverability, replaceability, or ten-year
survivability. Likelihood stays qualitative until two independent implementations and a
fixture set exist.

## Risk register

| ID | Risk | Severity | Failure scenario | Recommendation |
|---|---|---:|---|---|
| CS-001 | Float prohibition blocks a real domain | Critical | A domain needs genuine continuous quantities — embedding vectors, measurements, model scores — and cannot express them without floats | Vectors are derived projections outside canonical envelopes; measurements use declared-scale integers. Escalate to a profile revision if a canonical float need is proven, not by exception |
| CS-002 | Decimal modelling error | High | Wrong declared scale or ambiguous rounding produces wrong data that canonicalizes perfectly | Scale and rounding declared per field with fixtures; ACJ-1 removes encoding ambiguity, never modelling error |
| CS-003 | NFC rule never enforced | Critical | The validation contract does not exist yet, so nothing enforces NFC; non-NFC strings become contract values and hash inconsistently | Make NFC enforcement a named subordinate decision and a precondition for fixture authoring |
| CS-004 | Canonicalizer bypassed | Critical | A caller invokes the canonicalizer directly on unvalidated input, skipping NFC and identifier rules | Canonicalizer rejects what it can detect; validation is a required precondition stated in the contract and conformance-tested |
| CS-005 | JCS subset relationship silently broken | Critical | A later amendment makes ACJ-1 output that stock JCS would not produce; cross-checking becomes invalid | Cross-check against an unmodified third-party JCS implementation is a standing conformance requirement, not a one-time check |
| CS-006 | Code-unit vs code-point sort divergence | High | An implementation sorts by code point; keys outside the Basic Multilingual Plane order differently and digests diverge | Explicit UTF-16 code unit rule plus mandatory astral-plane fixtures |
| CS-007 | Duplicate-key parser differential | Critical | Validator and consumer disagree on which duplicate wins | Reject duplicates; rejection is fixture-tested |
| CS-008 | Domain label omitted as an optimisation | Critical | Implementation hashes bare bytes; cross-protocol digest reuse becomes possible | Named rejection category, required rejection fixture, conformance failure |
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

## Improvements required before DG-2 closure

1. Accept ADR-008 or record explicit bounded exceptions.
2. Fix the registered digest algorithm set and the add/retire process.
3. Decide the NFC enforcement point and its rejection behaviour.
4. Decide the decimal representation against real Memory and Invoice data.
5. Fix the boundary between canonicalizer limits and DG-4 business limits.
6. Decide where constant-time digest comparison is mandatory.
7. Produce two independent implementations that agree byte-for-byte on the fixture set,
   including rejections, cross-checked against an unmodified JCS implementation.

## Architecture recommendation

ACJ-1 is coherent enough for CTO review and resolves the numeric ambiguity that made
unconstrained JCS unsuitable for an integrity mechanism. It remains **not ready for
implementation** until the subordinate decisions above are resolved and cross-runtime
agreement is demonstrated. The float prohibition is a genuine constraint on future domain
schemas and must be accepted deliberately, not absorbed by default.
