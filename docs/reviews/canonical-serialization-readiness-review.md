# Canonical Serialization Readiness Review

Review subject: ACJ-1 profile and ADR-008  
Reviewer role: Principal Architect / CTO design authority  
First review: 2026-08-06 — APPROVE WITH CHANGES  
Second review: 2026-08-06, after corrections — **APPROVE**  
Decision scope: Architecture readiness only. No implementation authorization is requested,
granted, or implied.

Posture: this review attempted to **reject** the design in both passes. Nothing below is
written to justify a conclusion already reached, and the second pass re-examined every
dimension rather than only the three corrected findings.

## Executive summary

ACJ-1 is a strict subset of RFC 8785 JCS with the value domain constrained so JCS's
encoding rules are exact rather than merely deterministic. The central move — removing
numeric ambiguity from the *value domain* instead of patching it in the encoder — was
correct in the first pass and remains the strongest part of the design.

The first pass raised three blocking findings: an unpriced constraint on ADR-007, two threat
controls resting on a component nobody owned, and a domain-separation argument resting on an
unwritten grammar. All three are resolved. None was resolved by deletion; each was resolved
by making a decision that had previously been implicit.

The design is now accepted. It is **not** implementable, and the corrections made that
clearer rather than less clear: naming `CanonicalContractValidatorV1` converted a hidden
assumption into a visible, unimplemented dependency, and the threat model now labels every
control as specified or structural, with none implemented.

Recommendation: **APPROVE**.

# Part 1 — Disposition of blocking findings

## B-1 — The float prohibition was decided without the evidence to decide it

**Original finding.** ACJ-1 §8 barred binary floats in canonical positions. The design
argued this merely sharpened ADR-007's existing "deterministic, finite, JSON-compatible"
requirement. That argument held for `finite` — NaN and infinity were already excluded — but
binary floats are finite, JSON-compatible, and deterministic under JCS, so §8 was a genuinely
new constraint on every future domain schema. It was adopted against exactly one worked
example (provenance `confidence`), with no domain schema in existence to test it, and the
directive prohibits modifying the Object Model to fit a serialization format.

**Correction applied.** The prohibition is now recorded as a deliberate architectural
decision with four distinct pieces:

1. **Scope narrowed to one of four value contexts.** Domain, transport, and storage
   representations are explicitly unconstrained; only the canonical integrity context is
   restricted. Continuous quantities remain expressible in AION.
2. **Rationale stated as format-independent.** The constraint would apply to any format
   chosen for integrity purposes, so it is not a JSON artefact.
3. **The universal decimal choice is deferred**, not made. Three strategies remain
   permitted per field; no evidence exists to pick one.
4. **A mandatory review trigger** fires at the first continuous-quantity schema, requiring
   nine evidence items before that schema is approved.

**Documents and sections changed.**

| Document | Section |
|---|---|
| `contracts/canonical-serialization.md` | §8 rewritten — rationale, four value contexts, permitted strategies, review trigger, ADR-007 boundary |
| `decisions/ADR-008-canonical-serialization.md` | Decision item 2; §Costs; §Required subordinate decisions 1; §Review triggers |
| `decisions/CTO-DECISION-003-canonical-serialization.md` | §Binary Floating-Point Decision; §Rationale |
| `sprints/sprint-2.6-canonical-serialization/specification.md` | §Relationship to ADR-007 |
| `sprints/sprint-2.6-canonical-serialization/risks.md` | CS-001 downgraded to *Controlled* |

**Remaining risk.** The constraint has still never been tested against a real domain schema,
because none exists. Every schema author modelling money, probability, measurement, or score
now owes a precision, scale, range, and rounding decision, and CS-002 remains valid: a wrong
scale produces wrong data that canonicalizes perfectly. The format removes encoding
ambiguity, never modelling error.

**Why it is no longer blocking.** The finding was never that the constraint is wrong — it is
probably right. The finding was that it was being *adopted silently* against inadequate
evidence. It is now adopted explicitly, scoped to the narrowest context that achieves the
goal, with the universal decimal choice deferred until evidence exists and a named trigger
that forces re-examination. An architecture decision taken deliberately, with its cost
stated and a mechanism to revisit it, is a decision. That is what was missing.

## B-2 — Two threat controls depended on a validation boundary that did not exist

**Original finding.** §4 required NFC and delegated enforcement to a "validation boundary"
that no approved contract defined. Threat 4 listed that boundary as its control; threat 1's
control began "validation precedes canonicalization." No document specified where validation
occurred, what rejected non-NFC input, or what prevented direct canonicalizer invocation.
The risk register recorded this as risk; the threat model presented it as control. Those are
different claims and the stronger one was unsupported.

**Correction applied.** `CanonicalContractValidatorV1` is now a named, language-neutral
contract responsibility with: eleven enumerated validation concerns; seven requirements
(runs first, fails closed, stable non-enumerating errors, never silently rewrites, never
treats a normalized invalid value as equivalent, separate from auth/persistence/transport/
business validation, replaceable); nine explicit canonicalizer prohibitions; and a normative
processing sequence.

The threat model now carries a **control status vocabulary** — *specified* versus
*structural* — states plainly that **no control is implemented**, and marks
validator-dependent controls as "specified — depends on validator."

**Documents and sections changed.**

| Document | Section |
|---|---|
| `contracts/canonical-serialization.md` | New §0 (validation boundary, sequence, requirements, canonicalizer obligations, status); §4 rewritten; §33 gains `unvalidated-input` |
| `security/canonical-serialization-threat-model.md` | New §Control status vocabulary; threats 1, 2, 4 restated; §Residual risks; §Residual decisions |
| `decisions/ADR-008-canonical-serialization.md` | Decision item 3; §Costs |
| `decisions/CTO-DECISION-003-canonical-serialization.md` | §Validation Boundary Decision; §Rationale |
| `sprints/sprint-2.6-canonical-serialization/risks.md` | CS-003, CS-004 updated; CS-004a added |

**Remaining risk.** Substantial and now clearly visible: the validator does not exist and is
not authorized. Threats 1, 2, and 4 have no runtime defence. A non-NFC string, a duplicate
key, or a float reaching a canonical position today would have nothing to reject it. CS-003
and CS-004 are downgraded from Critical to High because the responsibility is *assigned*
rather than homeless — not because the exposure shrank.

**Why it is no longer blocking.** The finding was a truthfulness defect, not a design gap:
the threat model claimed controls it did not have. It now states exactly what exists
(nothing runtime), what is structural (framing injectivity, value-domain exclusions), and
what is specified pending an unimplemented component. A threat model that accurately reports
zero implemented controls is correct; one that implies controls are in place is not. The
correction also added a defence the first pass did not request — CS-004a, against a
*repairing* validator, which is the most likely way an implementer would get this wrong.

## B-3 — Digest-input framing was under-specified for multi-byte labels

**Original finding.** §23 defined `domain_label ‖ 0x00 ‖ profile_id ‖ 0x00 ‖ canonical_bytes`
and argued injectivity from the premise that `0x00` cannot occur inside a label or profile
identifier. No grammar was given — labels were "registered ASCII string" in prose, with an
example and nothing normative constraining character set or length. A registry that later
admitted a null byte or a UTF-8 label would silently break the injectivity argument the
entire domain-separation control rested on.

**Correction applied.** Delimiter framing is replaced by **AION Frame v1**: seven
length-prefixed fields — frame version, purpose, profile, contract family, contract version,
context, canonical payload. All thirteen required specification items are resolved: fixed-width
big-endian unsigned lengths (varints rejected because non-minimal encodings would break
injectivity), maximum field lengths, zero-length rules, UTF-8/NFC, an ASCII identifier
grammar, fixed field count making omission and duplication impossible, fail-closed unknown
versions, named truncation/overflow/trailing-byte rejections, exact payload boundary, no
redundant total-length prefix, and six registered purposes.

The injectivity argument is now a left-inverse proof that depends on **no property of field
contents**. Seven adversarial cases are worked, including the boundary-shifting collision
`("ab","c")` vs `("a","bc")` that delimiter framing admits.

**Documents and sections changed.**

| Document | Section |
|---|---|
| `contracts/canonical-serialization.md` | §23 fully replaced; §21–§22, §35, §38, §39, §40 updated to reference frame fields; §33 gains five framing rejections |
| `security/canonical-serialization-threat-model.md` | Threats 6, 7, 8, 10 restated; 8a added |
| `decisions/ADR-008-canonical-serialization.md` | Decision item 4; §Costs; §Review triggers |
| `decisions/CTO-DECISION-003-canonical-serialization.md` | §Domain-Separation Framing Decision; §Rationale |
| `sprints/sprint-2.6-canonical-serialization/risks.md` | CS-008 downgraded; CS-008a, CS-008b added |

**Remaining risk.** Low. The residual is implementation error — a parser that trusts a
declared length without bounds-checking, or performs length arithmetic in a wrapping width.
Both are named rejections with required fixtures. CS-008a covers reversion to delimiter
framing, which now requires a new frame version and fails closed for old readers.

**Why it is no longer blocking.** Injectivity no longer rests on an unwritten grammar. It
rests on a decoding function that is a deterministic left inverse of encoding, which holds
for arbitrary field contents including NUL bytes, Unicode, and empty strings. The ASCII
identifier grammar and zero-length rules now exist, but injectivity does not depend on them
— they serve anti-homoglyph and semantic purposes. That is the correct structure: a security
property should not be contingent on a registry policy that can be widened later.

# Part 2 — Full re-evaluation

Every dimension re-examined, not only the corrected ones.

## 1. Necessity

**Confirmed, on the same narrow ground.** The justification is DG-3 sequencing: fixtures must
carry expected digests, a digest cannot be authored before the rule that produces it, and a
regenerated fixture's expected value *is* the definition of correctness, so regeneration bugs
are undetectable without an independent cross-check. Deferral duplicates work and degrades
evidence.

The first pass criticised ADR-008 for listing export verification and migration proof as
co-equal justifications when neither system exists. That criticism stands and was not
addressed. It is cosmetic — the conclusion is right, the supporting list is padded — and is
recorded as NB-1.

## 2. Scope

**Correct, and the previously under-drawn edge is now closed.** The seven
non-responsibilities are stated identically in the ADR, contract, and specification. §4's gap
— requiring NFC while disclaiming enforcement — is resolved by §0, which claims the
responsibility explicitly rather than leaving it to an unnamed boundary.

Scope did not creep during correction. §0 defines a validator responsibility; it does not
define business validation, and requirement 6 says so.

## 3. Storage independence

**Preserved.** No storage engine, encoding, or layout is mandated. §8's four-context table
makes this explicit for the first time: storage values are unconstrained, so a store may hold
IEEE 754 doubles, decimals, or anything else provided the canonical form is reproducible on
demand.

The one residual coupling is honest and unchanged: §17 pushes binary out of envelopes into
content-addressed references, which constrains how large artifacts are modelled. That is a
consequence of choosing a text format, disclosed rather than hidden.

## 4. Transport independence

**Preserved.** Transport values are explicitly unconstrained. §24's media type applies only
where canonical bytes are transported *as* a canonical form. CS-026 continues to track the
real risk — teams adopting ACJ-1 as a wire format because it is well-specified — which is a
governance problem, not a contract defect.

## 5. Numeric exactness

**Achieved, at a stated cost.** Integers restricted to ±(2^53 − 1) means a JCS implementation
backed by double arithmetic cannot lose precision, so the subset relationship holds on the
axis where it is hardest to hold. Rejecting `-0` rather than folding it remains right:
folding maps two inputs to one output.

This is now *structural* rather than *specified* — the ambiguous cases cannot be expressed in
the value domain, so no runtime check is required to exclude them. Threat 5 is relabelled
accordingly. That is a genuine strengthening: a structural control cannot be forgotten by an
implementer.

## 6. Unicode behaviour

**Specified, unimplemented, and now labelled as such.** NFC required, verified at §0,
canonicalization never normalizes. Lone surrogates and invalid scalar values rejected.

Confusables remain out of reach and are stated so. One improvement the first pass did not
request: §23 rule 6 restricts *frame* identifiers to ASCII, so a Cyrillic homoglyph cannot
impersonate a Latin character in a purpose or profile name. Payload and schema identifiers
remain exposed, and the threat model now says which is which rather than treating threat 3 as
uniformly unsolvable.

## 7. Validation ownership

**Resolved — this is the largest improvement in the second pass.** Validation had no owner;
it now has a named contract responsibility with enumerated concerns, requirements, and
prohibitions, plus a normative sequence.

The prohibition list is the part that matters most. Every entry — repair Unicode, remove
duplicate keys, coerce numbers, infer timestamps, fill absent members, remove unknown
members, reorder arrays, reinterpret identifiers, upgrade versions — describes a
"helpful" behaviour an implementer would plausibly add. Each maps two distinct inputs to one
output, which is precisely the failure a digest exists to detect. Enumerating them is worth
more than the abstract rule.

## 8. Domain-separation injectivity

**Resolved, and the proof structure is now sound.** Injectivity follows from decoding being a
left inverse of encoding, independent of field contents. The seven adversarial cases are
worked concretely rather than asserted.

Rule 12's rejection of a redundant total-length prefix is correct reasoning that could
easily have gone the other way: a total length looks like defence in depth but creates a
disagreement case with no principled resolution. Trailing-byte rejection achieves the same
protection with no ambiguity.

Rule 1's rejection of varints is likewise correct and non-obvious — varints are the natural
choice for compactness, and non-minimal encodings would silently break injectivity.

## 9. Algorithm agility

**Real for algorithms; honestly re-described for profiles and for immutable records.**

Algorithm agility is genuine: registry resolution, fail-closed on unknown identifiers, no
default inference, concrete retirement path.

The first pass found profile "agility" overstated. §37 now separates the cases and concedes
the hard one directly: Version and Event Objects are immutable by ADR-007 invariant and
**cannot** be re-digested; Destroyed content cannot be re-digested at all. The contract no
longer promises re-hashing it cannot deliver, and states that an archival verifier for a
weakened algorithm is a liability rather than agility — retained, scoped to historical
verification, never selectable for new digests.

This is a case where the correction made the design look *worse* and the documentation
better. That is the right trade.

## 10. Migration feasibility

**Feasible and correctly priced.** Retained descriptors avoid an eager sweep for
verification. Not changing Object revision on profile migration remains exactly right —
content did not change, so revision must not advance.

ADR-008 §Costs now states plainly that any operation needing a uniform current profile pays
the full re-canonicalization cost across every retained Object, Version, Event, and export.
On a local-first device with long history this may be the most expensive operation the
platform performs. Naming it is the correction; it was previously implied to be cheap.

## 11. Cross-runtime reproducibility

**Specified, never demonstrated.** Conformance requires byte-for-byte agreement across the
full fixture set including every rejection, cross-checked against an unmodified third-party
JCS implementation as a standing requirement.

No implementation exists, so nothing has been demonstrated. CTO-DECISION-003's verification
section states this explicitly: the passing test suite covers the Kernel only and exercises
no canonical serialization. This is the single largest gap between what is specified and what
is known.

## 12. Fixture readiness

**Ready, and improved.** Fifteen classes defined; each future fixture carries source value,
expected canonical bytes, expected framed digest input and digest, expected validation
outcome, applicable versions, and rationale.

Framing fixtures are now required alongside value fixtures, covering each §23 adversarial
case. Rejection fixtures remain mandatory — CS-028's point stands, that an over-permissive
implementation passes an acceptance-only suite because it never encounters the values it
would mishandle.

DG-3 is correctly unblocked for *authoring* only. Nothing has been generated.

## 13. Security residuals

**Three, all disclosed.**

- **No control is implemented.** The threat model's new vocabulary makes this the first thing
  a reader learns. Structural controls hold as design properties; specified controls defend
  nothing today.
- **The validator gap.** Threats 1, 2, and 4 depend entirely on an unauthorized component.
- **A digest proves no authenticity.** Unchanged and correctly stated. §39 constrains any
  future signature to cover the AION Frame with a signature purpose, so the design cannot be
  reopened later by a signature over raw bytes.

Threat 3 (confusables) is now split accurately: structural for frame identifiers, unsolvable
for payload and schema identifiers.

## 14. Performance and streaming

**Unchanged and honest.** Full streaming is not achievable — member sorting requires all
members before any byte is emitted — and the contract says so rather than implying otherwise.
Bounded-buffer is the accurate description; §29–§31 limits bound the buffer.

Framing adds 28 bytes of fixed overhead per digest input, newly stated in ADR-008 §Costs.
Negligible, and correctly presented as the price of content-independent injectivity.

Digest recomputation cost per mutation remains unmeasured and is a real input to the storage
decision. Unchanged from the first pass; DG-4 owns it.

## 15. Long-term maintainability

**Good, with one durable concern.**

Strengths: the subset relationship keeps independent JCS implementations available as
cross-checks; output stays human-readable, which matters most in ten years when the work is
forensic; profile and algorithm are both versioned; CS-024 requires preserving profile
specifications, archival verifiers, and fixtures alongside release snapshots.

The durable concern is CS-024 itself. Ten-year verifiability depends on retaining working
verifiers for every profile and algorithm ever used, and that retention is an operational
commitment no tooling currently enforces. The backup strategy protects the repository; it
does not yet guarantee a runnable verifier for a profile retired years earlier.

# Non-blocking findings

| ID | Finding | Status |
|---|---|---|
| NB-1 | Necessity rests on DG-3 alone; export and migration justifications describe systems that do not exist | Open, cosmetic |
| NB-2 | Profile "agility" is migration that is possible and expensive | **Addressed** — priced in ADR-008 §Costs |
| NB-3 | Algorithm retirement undefined for immutable Version/Event Objects, impossible for Destroyed content | **Addressed** — §37 states it directly and defers the policy |
| NB-4 | §29–§31 limit values asserted without derivation | **Addressed** — labelled provisional pending DG-4 |
| NB-5 | Deterministic CBOR's advantages understated in the rejection | Open. The review trigger exists; a fair comparison would state size and streaming benefits explicitly |
| NB-6 | §9 permits scaled integers *or* decimal strings; two mechanisms for one need | **Superseded** — CTO-DECISION-003 deliberately defers the universal choice pending domain evidence. Retaining both is now the decision, not an oversight |
| NB-7 | §14's three-digit precision asserted without rationale; microsecond sources truncate silently | Open. Should state that truncation is intended and lossy |
| NB-8 | CS-024 ten-year verifier retention is an operational commitment no tooling enforces | New, open |

None blocks acceptance. NB-7 is worth resolving before the first timestamp fixture is
authored.

# Acceptance gate

Assessed against all ten criteria in the directive.

| # | Criterion | Status |
|---:|---|---|
| 1 | B-1 resolved as a deliberate contract decision | **Met** — scoped, rationalised, deferred where evidence is absent, with a mandatory review trigger |
| 2 | B-2 has an explicit validation boundary | **Met** — `CanonicalContractValidatorV1` named with responsibility, requirements, exclusions, and sequence |
| 3 | B-3 uses injective length-prefixed framing | **Met** — AION Frame v1; all thirteen items resolved; injectivity independent of field content |
| 4 | Readiness review recommends APPROVE or confirms mandatory changes incorporated | **Met** — this review returns APPROVE |
| 5 | No document claims authenticity, confidentiality, authorization, trust, or freshness | **Met** — denied in the ADR, contract §39, and the threat model's opening section |
| 6 | No storage or transport format mandated | **Met** — §8 four-context table makes the independence explicit |
| 7 | Universal Object Model unchanged except for necessary profile references | **Met** — only change is the `integrity` row referencing ACJ-1; envelope, profiles, and invariants untouched |
| 8 | Object Contract remains Pre-stable | **Met** — unchanged in every status header |
| 9 | DG-3 fixtures remain unimplemented | **Met** — none generated; unblocked for authoring only |
| 10 | Implementation freeze remains active | **Met** — restated in ADR-008 §Approval effect and CTO-DECISION-003 §Authorization Boundary |

All ten satisfied. No construction-blocking contradiction remains.

# Recommendation

# APPROVE

The three blocking findings are resolved, and none was resolved by deletion. Each was
resolved by making a decision that had previously been implicit: the float constraint is now
scoped and deliberate rather than silent; validation has an owner rather than a citation;
injectivity rests on a proof rather than an unwritten grammar.

The design is correct for its purpose and its limits are stated accurately. Most notably, the
corrections increased the visible unimplemented surface rather than reducing it — the threat
model now declares zero implemented controls, and §37 concedes that immutable records cannot
be re-digested at all. Documentation that makes a design look harder is usually documentation
that has become truthful.

**What this does not establish.** No implementation exists. Cross-runtime byte agreement, the
property that would actually validate ACJ-1, has never been demonstrated and cannot be until
fixtures and two implementations exist. Approval accepts an architecture, not a working
mechanism.

ADR-008 is **Accepted**. DG-2 is closed. DG-3 is unblocked for design and fixture authoring
only. DG-1 and DG-4 remain open. The Universal Object Contract remains pre-stable. The
implementation freeze remains in effect.

This review authorizes nothing. It is evidence for
[CTO-DECISION-003](../decisions/CTO-DECISION-003-canonical-serialization.md).
