# Contract Fixture Corpus Readiness Review

Review subject: AFX-1 fixture corpus profile and ADR-009  
Reviewer role: Principal Architect / CTO design authority  
Date: 2026-08-06  
Decision scope: Architecture readiness only. No implementation authorization is requested,
granted, or implied. **ADR-009 remains Proposed regardless of this recommendation.**

Posture: this review attempts to **reject** the design.

## Method, and an honest account of it

Six design questions — byte evidence, the fixture record, stages and source authority,
identifiers and versioning, corpus organization, and threats — were analysed independently,
each conclusion then attacked by two adversarial reviewers on correctness and on
security/longevity. Twelve of twelve adversarial passes returned **refuted**. Three
whole-design red teams — an architect, a security reviewer, and an implementer who would
have to build a loader twice — then reviewed the assembled result.

**All three red teams returned REJECT.**

That verdict must be reported accurately, because its cause matters. The red teams were not
rejecting a direction; they were rejecting an *unreconciled bundle*. Six independent analyses
had produced five mutually incompatible specifications of the same object: four corpus roots,
five fixture-ID grammars, four stage vocabularies, and three `.gitattributes` mandates that
were literal opposites. The implementer's summary is the fairest statement of it: "there is
no single artifact here to build against."

The design now recorded in
[contract-fixture-corpus.md](../contracts/contract-fixture-corpus.md) and
[ADR-009](../decisions/ADR-009-contract-fixture-corpus.md) is a **reconciliation**, not the
bundle the red teams saw. Where the analyses conflicted, one answer was chosen and the others
recorded as rejected alternatives. Where the adversarial passes found real defects, those
defects were fixed rather than argued away — including two that were verified by execution.

This review assesses the reconciled design. It does not inherit the red teams' verdict, and
it does not discard their findings.

## Findings carried in from adversarial review

Four survived and changed the design.

**Sidecar files destroy the evidence they carry.** Verified by execution in this repository,
not reasoned about:

```
$ printf 'a\r\nb' | git hash-object --path=test/fixtures/x.bin --stdin
0a207c060e61f3b88eaee0a8cd0696f46fb155eb
$ printf 'a\nb'   | git hash-object --path=test/fixtures/x.bin --stdin
0a207c060e61f3b88eaee0a8cd0696f46fb155eb
```

`git check-attr` confirms `* text=auto eol=lf` matches `.bin`, `.acj`, and `.json`.
`core.safecrlf` is unset, so there is no warning. The fixture that would prove ACJ-1 §27 —
that `\r\n` is not normalized to `\n` — is exactly the file Git silently rewrites into a
different, passing test. **Sidecars are now prohibited.**

**A corpus checksum over bare bytes would have violated ACJ-1 §23.** The original byte-evidence
proposal carried a `digest` computed over decoded bytes. ACJ-1 §23 declares a digest over bare
canonical bytes a contract violation. A corpus field that looked like a digest but was computed
unframed would have taught implementers precisely the mistake the contract forbids. It is now
`checksum`, contractually non-substitutable for an ACJ-1 digest.

**The timestamp truncation proof was invalid.** The claim that truncating the fractional
component is safe rested on the premise that it is "a non-negative addend to a non-negative
epoch offset". ACJ-1 §14 permits any four-digit year, so pre-epoch instants are representable,
and for a negative epoch offset truncation toward zero moves the instant **forward** — the
exact outcome CTO-DECISION-004 prohibits. The rule is now floor toward negative infinity, with
exact integer instants in `precisionLoss` so a harness can assert `canonicalInstant ≤
sourceInstant` directly, and at least one pre-epoch fixture is required.

**ADR-008 contained an arithmetic error I introduced.** Its §Costs stated framing adds 28 bytes
of fixed overhead. Six `u32` plus one `u64` is 24 + 8 = **32**. Corrected in ADR-008.

## Part 1 — the twenty required questions

### 1. Can one fixture record safely cover all stages?

**Yes, but only because it is a closed discriminated union.** A flat record with prose rules
could not: nothing would stop a Stage-0 rejection fixture carrying an expected digest, and
the rule forbidding it would be enforced only if someone implemented the check.

The `expectation` tag selects the permitted field set, so `reject` structurally prohibits
`expectedCanonicalBytes`, `expectedFrameBytes`, and `expectedDigest`. A single record covering
all stages is safe precisely because most stages' fields are unrepresentable in most records.

### 2. Must raw-byte and structured-value fixtures remain separate?

**Yes, and this is not a stylistic split.** A JavaScript object or Python dict silently
collapses `{"a":1,"a":2}`. A parsed value is therefore not evidence for ACJ-1 §19 — the fact
under test is destroyed before the assertion is made. The same applies to invalid UTF-8, lone
surrogates, BOMs, `1.0` versus `1`, `-0`, and line-ending cases.

The routing rule — any case JSON cannot represent unambiguously must be Entry-B — is correct
and load-bearing. The bootstrapping problem it creates is solved honestly: Entry-B fixtures
carry hex, so the corpus file never has to contain what it is describing.

### 3. Are inline bytes or sidecars less error-prone?

**Inline, decisively, on verified evidence.** See the findings above. This is the one question
in the review that was settled by execution rather than argument.

The cost is real and is not minimised: hex is unreadable by eye. A reviewer cannot look at
`00000001310000001561696f6e…` and see a frame. FX-019 records this as an accepted cost, and the
`hex`/`length`/`checksum` triple-agreement is a partial mitigation, not a fix.

### 4. Is the corpus coupled to Git?

**It is coupled to Git's hazards, and the design removes the coupling rather than accommodating
it.** Hex inside a JSON string is unaffected by text conversion, `core.autocrlf`, editor BOM
insertion, `.editorconfig`'s `insert_final_newline`, PowerShell's ANSI default, or
`core.ignorecase`.

Residual coupling is limited to distribution: releases are pinned by version and checksum and
verified offline, so a consumer never depends on Git to establish integrity.

### 5. Are fixture IDs stable enough?

**Yes.** `AFX-<FAMILY>-<NNNNNN>` from an append-only ledger, independent of path, test name,
language, and commit hash. Bounded semantics — a family prefix only — is the right compromise:
reviewers cite these in prose, so fully opaque IDs would be hostile, but full semantics rot
when the thing they name changes.

The load-bearing rule is that identity is the **assertion tuple**, so changing what a fixture
asserts requires a new ID. Without that, an expected-value substitution looks like an edit.

### 6. Are version categories conflated?

**No.** Seven categories, each with what changes it and what it does **not** govern. The
matrix form matters: the failure mode here is not omitting a category but assuming one implies
another — that a profile bump implies a record-schema bump, or that a corpus release version
says something about a fixture's identity. Stating the negative space prevents that.

### 7. Are rejection fixtures sufficiently expressive?

**Yes, with one unresolved dependency.** Rejection stage, error category, forbidden output
bytes, and the prohibition on producing a digest are all expressible, and the
reject-earlier-is-a-failure rule closes the reject-everything loophole.

The dependency is question 8.

### 8. Are stable error codes over-specified at parser level?

**Yes — and this is a blocking finding.** Two JSON parsers in two languages will not naturally
agree on error taxonomy. Node's parser, Python's `json`, and a hand-written parser will
disagree about whether a lone surrogate is an encoding error or a string error, and about
whether trailing content is detected before or after the value completes.

Requiring a matching stable error category at S0 makes conformance unachievable for reasons
that have nothing to do with ACJ-1. The contract currently requires matching categories
"wherever ACJ-1 §33 requires one" — but §33 was written for the validator (S2), not for a JSON
parser. See **B-1**.

### 9. Does the schema permit contradictory expected outputs?

**No, structurally** — one `expectation` member, tagged, with a closed field set per variant.

The original argument for this rested on ACJ-1 §19 rejecting duplicate members, and the
adversarial pass correctly refuted it: §19 is enforced by `CanonicalContractValidatorV1`, which
ACJ-1 §0 declares specified-but-unimplemented. The reconciled design does not rely on it — the
loader performs its own duplicate-key rejection independently. That is the correct fix, and it
is now stated as a normative loader obligation rather than an assumption.

### 10. Does exact byte comparison survive Windows line-ending behaviour?

**Yes for storage; unproven for comparison.** Storage survives because hex is unaffected by any
line-ending transformation. Comparison survives only if the harness compares bytes — and a
harness that decodes to strings first will silently pass mismatched line endings, BOMs, and
normalization differences, which are exactly the defects the corpus exists to catch.

The contract states the requirement. Nothing enforces it, because no harness exists. FX-005
records it as Critical, correctly.

### 11. Can fixtures be consumed by multiple languages?

**Yes.** JSON plus lowercase hex plus integer lengths is about as portable as a format gets.
No language-specific types, no floats (ACJ-1 §8 already forbids them), no parsed dates —
`precisionLoss` carries exact integers precisely so no locale-dependent date parsing enters
the loader.

The one portability hazard is uppercase hex from .NET `BitConverter.ToString` and PowerShell
`'{0:X2}'`, which the contract rejects rather than case-folds. That is consistent with ACJ-1
§16 and is the right call: folding would map two inputs to one.

### 12. Could private data enter the corpus?

**Structurally, nothing prevents it.** A hard prohibition plus a `sourceProvenance` field
restricted to synthetic or cited derivation is a *process* control, and process controls fail
quietly.

The exposure is severe and asymmetric: the corpus is public-by-intent, so anything that enters
is compromised on commit, and rewriting history does not revoke a copied secret. FX-017 and
FX-018 are both Critical.

This does not block approval — no structural control is available for "is this string
synthetic?" — but it must not be described as handled. See **NB-1**.

### 13. Are migration fixtures adequate?

**Yes, and the pairing rule is the strongest part of the versioning design.** ACJ-1 advances to
`acj-2` on any §1–§20 or §23 change. Every existing acceptance fixture retains its `acj-1`
bytes *under `acj-1`* and gains a paired new-ID fixture under `acj-2`; the old fixture is never
edited and never deleted.

This is what makes historical digests in retained backups and exports verifiable years later,
and it follows directly from ACJ-1 §36's retained-descriptor approach. A migration producing no
pairs is incomplete by definition.

### 14. Can corpus releases be independently verified?

**Yes.** Pinned by version and checksum, verified offline, no network dependency in the
verification path, with the required-rule inventory and per-class counts carried in the release
so the ratchet is checkable against the prior manifest rather than against a claim.

### 15. Would the planned ten initial fixtures provide meaningful evidence?

**No — and this is a blocking finding.** Ten fixtures cannot cover forty coverage areas, and
the ten most obvious candidates are all acceptance fixtures for the Object profiles, which is
exactly the acceptance-only corpus FX-007 identifies as insufficient.

More importantly, **three coverage areas cannot be authored at all right now**: maximum-member
rejection is blocked on DG-4, invalid decimal representation is blocked on the decimal
decision, and cross-runtime agreement is blocked on there being no second runtime. Authoring
ten fixtures now means authoring them against provisional limits and an unsettled S0 error
taxonomy. See **B-2**.

### 16. Is timestamp truncation represented at the correct boundary?

**Yes.** Conversion sits before canonical validation, the validator rejects excess precision
rather than truncating it, and the canonicalizer never touches it. That placement is what keeps
the canonicalizer non-repairing, which is the property every other ACJ-1 rule depends on.

The pre-epoch defect was real and is fixed. Requiring at least one pre-epoch fixture is
essential — it is the only case where the naive implementation is wrong, so a corpus without it
would certify the bug.

### 17. Does the corpus create false confidence without independent implementations?

**Yes, and this is the design's central risk.** Three mechanisms exist — `expectedValueProvenance`
forbidding circular derivation, independence verified by dependency inspection, and the
prohibition on reporting a single-runtime run as cross-runtime agreement — and **all three are
process controls**.

The structural backstop is non-vacuity (FX-001): a run must prove it executed the fixtures it
claims. That catches an empty corpus. It does not catch a full corpus of wrong expected values.

The contract says plainly that passing means two implementations agree on cases someone thought
to write down. That honesty is the mitigation, and it is not sufficient on its own. See **NB-2**.

### 18. Are DG-4 limits incorrectly treated as finalized?

**No.** ACJ-1 §29–§31 values are marked provisional, coverage area 26 is marked BLOCKED, and
area 25 is flagged as partly dependent. This is the correct handling — a boundary fixture
authored against a provisional limit becomes wrong the moment DG-4 lands, and worse, becomes
*evidence* that the wrong limit was right.

### 19. Is fixture schema complexity excessive?

**Borderline, and honestly so.** Roughly thirty fields with a conditional-requirement matrix is
a lot for a test fixture. The complexity buys one thing: contradictions are unrepresentable
rather than forbidden, which is worth it for the artifact that defines correctness.

But the implementer red team's objection stands in reduced form: this must be re-examined after
the first ten fixtures are authored, because a schema that is right in theory and painful in
practice will be quietly circumvented. FX-025 records it. See **NB-3**.

### 20. Can the design survive ten years of contract evolution?

**Probably, with one gap.** Paired migration fixtures, append-only IDs, seven distinct version
categories, and retained old-profile evidence all point the right way.

The gap is loader survivability. ACJ-1 §36 requires archival *verifiers* for retired profiles;
AFX-1 requires `fixtureSchemaVersion` on every record but does not yet require archival
*loaders* for retired fixture-schema versions. A ten-year-old release whose schema no loader
understands is unreadable evidence. FX-030 records it; the contract should require it. See
**NB-4**.

## Part 2 — blocking findings

### B-1 — S0 error-category matching is unachievable as specified

**Evidence.** The cross-runtime evidence contract requires "matching stable error category
wherever ACJ-1 §33 requires one." §33's categories — `unsupported-value-kind`,
`invalid-string`, `duplicate-member`, `limit-exceeded` — were written for
`CanonicalContractValidatorV1`, which operates at S2 on an already-parsed value. At S0 the
actor is a JSON parser, and two parsers in two languages will not agree on whether a lone
surrogate is an encoding failure or a string failure, or on whether trailing content is
detected before or after the value completes.

**Concrete failure.** Implementation A (Node) reports a lone surrogate as an encoding error at
byte level; implementation B (Python, `strict=True`) reports it as a string decoding error.
Both correctly reject. Both correctly reject at S0. The conformance run fails on category
mismatch, and the corpus reports a defect that does not exist.

**Required change.** Separate the requirement by stage. At **S2 and later**, matching stable
error categories are required. At **S0**, require only matching *rejection* and matching
*stage* — not matching category — until an S0 taxonomy is agreed as a subordinate decision.
The contract already lists S0 granularity as a residual decision; the evidence contract must
be brought into line with that rather than assuming it is settled.

### B-2 — the first ten fixtures cannot yet be meaningful

**Evidence.** Forty coverage areas; three BLOCKED (maximum-member on DG-4, invalid decimal on
the decimal decision, cross-runtime on no second runtime); one more (maximum-depth) dependent
on limits ACJ-1 itself marks provisional. S0 error granularity unsettled per B-1. No second
runtime, so no fixture's expected value can be established by cross-implementation agreement —
leaving only hand derivation, which FX-002 identifies as the corpus's weakest link.

**Concrete failure.** Ten fixtures are authored now. They are necessarily acceptance fixtures
with hand-derived expected values, verified by no independent implementation. DG-3 is later
reported as making progress. In fact the corpus certifies one person's arithmetic, and the
first genuinely independent implementation discovers the expected digests are wrong — after
they have been treated as the definition of correctness.

**Required change.** Do not authorize the first ten fixtures on ADR-009's acceptance. Sequence
them behind: B-1 resolved; the required-rule inventory and ratchet floor set; and either a
second runtime selected or an explicit, recorded acceptance that the initial corpus carries
hand-derived values pending cross-implementation confirmation. The prohibition on the first ten
fixtures in CTO-DECISION-004 was correct and should not be lifted by accepting ADR-009.

### B-3 — the corpus has no structural defence against a wrong expected value

**Evidence.** `expectedValueProvenance` requires an author to *declare* how a value was
obtained. Nothing verifies the declaration. A fixture claiming `hand-derived-from-spec` with a
wrong digest is structurally indistinguishable from one with a right digest, and the corpus
will then fail every correct implementation and pass any implementation that shares the error.

**Concrete failure.** An author computes an expected digest over canonical bytes without the
AION Frame — the exact ACJ-1 §23 violation the `checksum`/`digest` split was introduced to
prevent. The value is well-formed, the provenance is honestly declared, and the fixture is
wrong. Any implementation that also forgets the frame passes.

**Required change.** Require every `accept` fixture whose `terminalStage ≥ S5` to carry the
**full framed digest input** as `expectedFrameBytes`, not merely the digest. A reviewer or tool
can then recompute the digest from the recorded frame bytes and detect an unframed or
mis-framed derivation without a second implementation. This converts B-3 from a pure process
control into a checkable one. It does not catch a wrong *frame*, but it catches the specific
error the contract most fears.

## Part 3 — non-blocking findings

| ID | Finding |
|---|---|
| NB-1 | Private-data exclusion is a process control with no structural backstop. It must be described as such, not as handled. Consider requiring a reviewer distinct from the author on any fixture whose `sourceProvenance` is not `synthetic` |
| NB-2 | The three false-confidence controls are all process controls; non-vacuity is the only structural backstop and it catches only an empty corpus. State this limitation in the corpus contract, not only in the risk register |
| NB-3 | Fixture schema complexity must be re-examined after the first ten fixtures. A schema that is correct but painful will be circumvented |
| NB-4 | Archival **loaders** for retired `fixtureSchemaVersion`s are not required, though archival verifiers for retired profiles are (ACJ-1 §36). A ten-year-old release no loader understands is unreadable evidence |
| NB-5 | The 4096-byte literal cap is asserted without derivation. It is a reasonable order of magnitude; label it provisional alongside DG-4's limits |
| NB-6 | `illustrative` fixtures sharing a tree with `normative` ones is listed as a residual decision but has a security dimension (threat 33) — decide it before the corpus exists, not after |
| NB-7 | Hex unreviewability (FX-019) has no mitigation beyond triple-agreement. A decode helper would help reviewers, but it is tooling and therefore currently unauthorized — note the gap rather than leaving it implicit |

## Part 4 — consistency audit

| # | Check | Result |
|---:|---|---|
| 1 | ADR-007 remains Accepted | **Confirmed** |
| 2 | ADR-008 remains Accepted | **Confirmed** |
| 3 | DG-2 remains closed | **Confirmed** |
| 4 | DG-3 remains open | **Confirmed** — specification does not close it |
| 5 | DG-4 remains open | **Confirmed**; limits marked provisional, dependent coverage marked BLOCKED |
| 6 | Object Contract remains Pre-stable | **Confirmed** |
| 7 | No normative fixture created | **Confirmed** — none exists |
| 8 | No production code modified | **Confirmed** |
| 9 | Canonicalizer remains unimplemented | **Confirmed** |
| 10 | `CanonicalContractValidatorV1` remains unimplemented | **Confirmed**, and the design explicitly does not rely on it |
| 11 | Timestamp truncation before validation, never in the canonicalizer | **Confirmed** |
| 12 | Higher precision not silently discarded | **Confirmed** — declared, and the validator rejects rather than truncates |
| 13 | Rejection fixtures first-class | **Confirmed** |
| 14 | Duplicate-member cases remain raw-byte fixtures | **Confirmed** — Entry-B mandatory |
| 15 | No host-language dictionary treated as proof of member uniqueness | **Confirmed** — stated normatively, loader does its own check |
| 16 | No storage or transport technology selected | **Confirmed** |
| 17 | No personal or owner data authorized | **Confirmed** — hard prohibition, no exception path |
| 18 | No implementation freeze lifted | **Confirmed** |

## Recommendation

# APPROVE WITH CHANGES

The direction is sound and should be preserved. Its best properties are the ones that make
whole failure classes unrepresentable rather than defended — prohibited sidecars, a closed
expectation union, manifest-driven enumeration rather than globbing — and its most valuable
contribution is naming the vacuous-pass failure mode, where an empty corpus reports green at
the exact gate meant to prevent that, before anyone could stumble into it.

Three changes are required before ADR-009 could be accepted: **B-1** separate S0 from S2 in
the error-category requirement; **B-2** do not authorize the first ten fixtures on ADR-009's
acceptance, and sequence them behind the gates they depend on; **B-3** require the full framed
digest input alongside any expected digest, so a wrong derivation is checkable without a second
implementation.

Three independent red teams returned REJECT on the unreconciled bundle of six analyses. That
verdict was about incoherence between five competing specifications, and it was correct. The
reconciled design is one specification, and the defects those reviews found — including two
verified by execution — are fixed rather than argued away. That is why this review reaches a
different conclusion, and the earlier verdict is recorded here rather than discarded so the
difference is auditable.

**What this does not establish.** No fixture exists. No loader exists. No harness exists. No
second implementation exists. Cross-runtime agreement — the only thing that would make this
corpus evidence rather than intention — has never been demonstrated and cannot be until far
more than this sprint is done.

**ADR-009 remains Proposed.** DG-3 remains **open**. DG-1 and DG-4 remain open. The Universal
Object Contract remains **pre-stable**. The implementation freeze remains in effect.

This review authorizes nothing. It is evidence for a Founder/CTO decision.
