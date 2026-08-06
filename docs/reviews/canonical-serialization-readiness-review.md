# Canonical Serialization Readiness Review

Review subject: ACJ-1 profile and ADR-008  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-06  
Decision scope: Architecture readiness only. No implementation authorization is requested,
granted, or implied.

Posture: this review attempts to **reject** the proposed design. Nothing below is written
to justify a conclusion already reached.

## Executive summary

ACJ-1 is a strict subset of RFC 8785 JCS with the value domain constrained so JCS's
encoding rules are exact rather than merely deterministic. The central move — removing
numeric ambiguity from the *value domain* instead of patching it in the encoder — is
correct and is the strongest part of the design. It keeps stock JCS implementations usable
as cross-checks, keeps output human-readable for forensic work, and eliminates silent
precision loss inside an integrity mechanism.

The design is not ready to accept unchanged. Three problems are material, one of them
against the directive's own constraint on ADR-007.

Recommendation: **APPROVE WITH CHANGES**.

## 1. Is canonical serialization actually necessary?

**Yes — but the honest answer is narrower than the ADR implies.**

Testing the null option seriously: nothing is implemented, the freeze is in effect, and no
digest has ever been computed. Deferral costs nothing operationally today.

It fails on sequencing, not on urgency. DG-3 fixtures must carry expected digests, and a
digest cannot be authored before the rule that produces it. Every fixture written before
the rule exists must be rewritten afterwards, and a rewritten fixture's expected value *is*
the definition of correctness — so regeneration bugs are undetectable without an
independent cross-check. Deferring duplicates the work and degrades the evidence.

The weaker claim in ADR-008 §Context — that canonicalization blocks export verification and
migration proof — is true but not yet load-bearing, since neither exists. The necessity
argument rests on DG-3 alone, and that is sufficient. The ADR would be more honest if it
said so rather than listing four consequences of equal apparent weight.

**Not a blocking finding.** The conclusion is right.

## 2. Is the scope too broad?

**No. If anything it is drawn slightly too narrow in one place.**

The seven non-responsibilities are stated identically in the ADR, the contract, and the
specification, which is the correct level of repetition for a rule teams will be tempted to
violate. The temptation is real: a deterministic, well-specified format is exactly what
someone will reach for as a wire format, coupling systems to a format optimised for
hashing. CS-026 records this.

The under-drawn edge is §4. ACJ-1 requires NFC but explicitly does not enforce it,
delegating enforcement to a "validation boundary" that **does not exist in any approved
contract**. The rule is stated in a document that disclaims responsibility for it, and no
other document claims it. See finding B-2.

## 3. Does it create transport or storage coupling?

**No.** Storage engines and transports may use any representation provided the canonical
form is reproducible on demand. The contract does not require canonical bytes to be stored,
and §24's media type applies only where canonical bytes are transported *as* a canonical
form.

One residual coupling is real and acknowledged: §17 pushes binary out of envelopes into
content-addressed references, which constrains how large artifacts are modelled. That is a
consequence of choosing a text format, correctly disclosed rather than hidden.

## 4. Are the numeric rules portable?

**Yes, and this is the design's best decision — but it is also its largest unpriced cost.**

Restricting integers to ±(2^53 − 1) means a JCS implementation backed by double arithmetic
cannot lose precision, so the subset relationship holds on the axis where it is hardest to
hold. Rejecting `-0` rather than folding it is right: folding maps two inputs to one output
and hides a producer bug.

The cost is §8. Prohibiting binary floats is a genuine constraint on every future domain
schema, and the ADR's cost section names only provenance `confidence`. It is not the only
case, and it is not the hardest. Model scores, measured quantities, financial rates, and
any statistical output are all naturally continuous. The design's answer — declared-scale
integers — works, but it pushes a modelling decision onto every schema author, and CS-002
correctly notes that a wrong scale produces wrong data that canonicalizes perfectly.

This is defensible. It is not yet *decided*, because the evidence to decide it does not
exist. See finding B-1.

## 5. Is an existing standard sufficient?

**No, and the analysis reaching that conclusion is sound.**

Unconstrained JCS is insufficient for the specific reason given: IEEE 754 double semantics
are deterministic but lossy, and lossiness inside an integrity mechanism is the one
property that cannot be traded away. This is a real technical objection, not a preference.

Deterministic CBOR is dismissed on debuggability and profile ambiguity. Both are true —
canonical CBOR and core deterministic encoding do differ — but the rejection understates
CBOR's advantages: exact big integers with no string encoding, native byte strings with no
base64 inflation, and genuine streaming. Over ten years, if payload size or streaming
becomes a measured constraint, CBOR is the better format and ACJ-1 will have to migrate.
The ADR records this as a review trigger, which is the right handling.

Protobuf's rejection is correct and needs no defence: its own specification declines to
promise deterministic serialization.

The two rejections that could have been lazy — "roll our own" and "schema-specific
encoders" — are both rejected for the right reason, that they multiply the surface where
JCS has already litigated the edge cases.

## 6. Is algorithm agility real or nominal?

**Real for algorithms. Nominal for profiles, and that gap is not acknowledged.**

Algorithm agility is genuine: the algorithm is named in the descriptor, resolved through a
registry, unknown identifiers fail closed, and no default is inferred. §37's retirement
path — deprecation window, re-digesting, archival verifier — is concrete.

Profile agility is weaker than it appears. §36 says migration re-canonicalizes and
recomputes digests while retaining both descriptors, and that a profile migration does not
change Object revision. That last rule is correct and important. But CS-016 and the risk
register's own scalability section concede that migrating profiles means re-canonicalizing
and re-digesting *every retained Object, Version, Event, and export*, which on a
local-first device with long history may be the most expensive operation the platform ever
performs. Retaining both descriptors avoids an eager sweep for verification, but any
operation that needs a uniform current profile still pays the full cost.

Calling this "agility" without pricing it is optimistic. It is closer to "migration is
possible and expensive."

## 7. Is migration possible?

**Yes, with one unresolved case.**

The retained-descriptor approach is right, and not changing Object revision on profile
migration is exactly correct — content did not change, so revision must not advance.

The unresolved case is a **withdrawn digest algorithm applied to immutable content**.
§37 requires re-digesting retained content when an algorithm is retired. But Version and
Event Objects are immutable by contract invariant, and Destroyed content cannot be
re-digested at all. The design does not say what happens when the algorithm protecting an
immutable record is withdrawn. The archival-verifier escape hatch covers *verification*,
but it means retaining a verifier for a broken algorithm indefinitely, which is a different
thing from agility.

Not blocking — it is a subordinate decision — but it must be named rather than discovered.

## 8. Does the design support deterministic fixtures?

**Yes. This is the requirement it meets most completely.**

All fifteen fixture classes are defined; each future fixture must carry source value,
expected canonical bytes, expected digest, expected validation outcome, applicable versions,
and rationale. Two choices deserve credit:

- **Rejection fixtures are mandatory.** CS-028 identifies the failure this prevents: an
  over-permissive implementation that accepts floats or duplicate keys passes an
  acceptance-only suite because it never encounters them in the happy path.
- **Cross-checking against an unmodified third-party JCS implementation** is a standing
  requirement, not a one-time check. This is what makes the subset claim falsifiable rather
  than aspirational.

Class 8's astral-plane key-ordering cases are the right target: UTF-16 code unit versus code
point ordering diverges only outside the Basic Multilingual Plane, so an implementation
sorting by code point passes every BMP-only fixture.

## 9. Do security failures remain?

**Yes, three — two disclosed, one under-disclosed.**

Disclosed and correctly handled:

- **A digest proves no authenticity.** Stated in the ADR, the contract, and the threat
  model. §39 fixes the signature boundary now — signatures cover the domain-separated
  digest input — so a future signature design cannot reopen cross-protocol attacks by
  covering raw bytes. Constraining a future decision from the current one is the right
  move.
- **Unicode confusables are out of reach.** Threat 3 says so plainly instead of claiming a
  control. Canonicalization makes two different strings hash differently, which is correct
  and useless against a human reading two identical-looking type names.

Under-disclosed: the **validation boundary does not exist**. Threats 4 (normalization
mismatch) and 1 (parser differential) both have controls that live outside this contract,
in a validation step no approved document defines. CS-003 and CS-004 record the risk, but
the threat model presents the controls as present. They are specified, not available. See
finding B-2.

## 10. Are measurable limits prematurely mixed into DG-2?

**No — and the separation is the cleanest reasoning in the design.**

§29–§31 are canonicalizer safety limits: bounds on recursion, allocation, and sort cost
needed to make rejection deterministic rather than a crash. DG-4 owns business limits: what
the Object contract permits an owner to store. These are different questions with different
owners.

The stated ordering — DG-4 limits must be ≤ canonicalizer limits — is the correct
invariant, because the alternative is an Object the contract permits but that cannot be
canonicalized, and therefore cannot carry an integrity descriptor. CS-017 tracks it.

The specific numbers (depth 64, 4096 members, 1 MiB strings, 16 MiB total) are asserted
without derivation. For DoS bounds that is acceptable — they need to be *some* finite
value — but they should be labelled as provisional pending DG-4 measurement rather than
presented as settled.

## Blocking findings

### B-1 — The float prohibition is decided without the evidence to decide it

§8 constrains every future domain schema, and the directive states that the Object Model
must not be modified to fit a serialization format. The design's position is that ADR-007
already required values to be "deterministic, finite, JSON-compatible," so ACJ-1 narrows an
ambiguity rather than adding a constraint. That argument is sound for `finite` — NaN and
infinity were already excluded — but it does **not** cover binary floats, which are
finite, JSON-compatible, and deterministic under JCS. §8 is a new constraint.

It is probably the right constraint. But it is being adopted against exactly one worked
example — provenance `confidence` — and no domain schema exists to test it. Memory
confidence, model scores, and Invoice rates are all plausible counter-cases, and CS-001
escalates only if a canonical float need is *proven*, which cannot happen while no domain
is specified.

**Required change:** record §8 as an explicit, owner-acknowledged constraint on ADR-007
with its cost stated, rather than as a neutral refinement. Either accept it deliberately
with a review trigger tied to the first domain schema that models a continuous quantity, or
defer §8 to the decimal decision already listed as subordinate. Adopting it silently is the
one outcome that should not happen.

### B-2 — Two threat controls depend on a validation boundary that does not exist

§4 requires NFC and explicitly delegates enforcement to a validation boundary, which no
approved contract defines. Threat 4 lists that boundary as its control. Threat 1's control
likewise begins "validation precedes canonicalization."

No approved document specifies where validation occurs, what rejects non-NFC input, or what
prevents a caller from invoking the canonicalizer directly. CS-003 and CS-004 record this
as risk; the threat model presents it as control. Those are different claims, and the
stronger one is not supported.

**Required change:** either specify the validation boundary in this contract, or restate
threats 1 and 4 as **open** with the boundary named as a precondition for DG-2 closure.
The current text reads as though the controls are in place.

### B-3 — Digest-input framing is under-specified for multi-byte labels

§23 defines `domain_label ‖ 0x00 ‖ profile_id ‖ 0x00 ‖ canonical_bytes` and argues that
because `0x00` cannot occur inside a label or profile identifier, no two distinct triples
collide.

The reasoning holds only if the label grammar actually excludes `0x00`, and no grammar is
given — labels are described as "registered ASCII string" in prose, with an example, and
nothing normative constrains their character set or length. A registry that later admits a
label containing a null byte, or a UTF-8 label, silently breaks the injectivity argument
that the whole domain-separation control rests on.

**Required change:** give the domain label a normative grammar — permitted character set,
maximum length, registration rule — or switch to length-prefixed framing, which is
injective without depending on a character exclusion.

## Non-blocking findings

| ID | Finding |
|---|---|
| NB-1 | The necessity argument rests on DG-3 alone; export and migration justifications describe systems that do not exist. State the real reason (§1) |
| NB-2 | Profile "agility" is migration that is possible and expensive. Price it rather than implying it is cheap (§6) |
| NB-3 | Algorithm retirement is undefined for immutable Version and Event Objects and impossible for Destroyed content. Name it as a subordinate decision (§7) |
| NB-4 | §29–§31 limit values are asserted without derivation. Label provisional pending DG-4 measurement (§10) |
| NB-5 | Deterministic CBOR's advantages are understated in the rejection. The review trigger exists, but a fair comparison would state size and streaming benefits explicitly (§5) |
| NB-6 | §9 permits scaled integers *or* decimal strings, fixed per field by schema. Two mechanisms for one need is a future inconsistency; prefer scaled integers as the default and require justification for the string form |
| NB-7 | §14's three-digit precision is asserted without rationale. Microsecond-precision sources will truncate silently — state that truncation is intended and lossy |

## Conclusions against the required questions

| Question | Answer |
|---|---|
| Is canonical serialization necessary? | Yes, on DG-3 sequencing. Other justifications are premature |
| Is the scope too broad? | No; §4 is drawn slightly too narrow (B-2) |
| Transport or storage coupling? | No. Binary-reference constraint disclosed |
| Are numeric rules portable? | Yes. The constraint they impose is unpriced (B-1) |
| Is an existing standard sufficient? | No. JCS lossiness is a real disqualifier |
| Is algorithm agility real? | Real for algorithms; migration-shaped for profiles |
| Is migration possible? | Yes, except for withdrawn algorithms over immutable content |
| Deterministic fixtures supported? | Yes — the most complete part of the design |
| Do security failures remain? | Yes: no authenticity, confusables out of reach, validation boundary absent |
| Are limits prematurely mixed into DG-2? | No. The separation and its ordering are correct |

## Recommendation

# APPROVE WITH CHANGES

The direction is sound and should be preserved. Constraining the value domain so that JCS
becomes exact is the right answer to a real problem, and it is better than the obvious
alternatives for reasons that survive scrutiny.

Three changes are required before acceptance: price and explicitly accept the float
constraint on ADR-007 (B-1); stop presenting the validation boundary as an existing control
(B-2); and give the domain label a normative grammar or length-prefixed framing (B-3).

**ADR-008 remains Proposed.** DG-2 remains open. DG-3 fixtures remain blocked. The
Universal Object Contract remains pre-stable. The implementation freeze remains in effect.

This review authorizes nothing. It is evidence for a Founder/CTO decision.
