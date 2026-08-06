# ADR-009: Contract fixture corpus

- Status: Proposed
- Date: 2026-08-06
- Decision owner: CTO
- Implementation status: **Frozen.** No fixture, loader, or harness may be built.
- Authorized by: [CTO-DECISION-004](CTO-DECISION-004-sprint-2.7-authorization.md)
- Targets gate: DG-3 in the
  [Sprint 2.5 acceptance criteria](../sprints/sprint-2.5/acceptance-criteria.md) —
  **specification only; DG-3 remains open**
- Depends on: [ADR-007](ADR-007-universal-object-model.md) (Accepted),
  [ADR-008](ADR-008-canonical-serialization.md) (Accepted)

## Context

ACJ-1 §40 states that fixtures are the only proof of conformance, and the Universal Object
Contract's stability gate requires representative fixtures before it can be designated
stable v1. DG-3 is therefore the gate between an accepted architecture and a contract
anyone can depend on.

Nothing exists yet: no fixture, no loader, no harness, and no second implementation. What is
missing is not effort but a **specification** — the shape a fixture takes, what it may and
may not assert, how it is identified and versioned, and what evidence would actually close
DG-3.

Two facts discovered during this sprint determine most of the design, and both were verified
in this repository rather than assumed. They are recorded in
[contract-fixture-corpus.md §0](../contracts/contract-fixture-corpus.md#0-two-facts-that-determine-this-design).

## Decision

Adopt the **AFX-1 contract fixture corpus profile**. The load-bearing decisions:

1. **Authoritative bytes are carried inline as lowercase hexadecimal. Sidecar files are
   prohibited.** This repository's `.gitattributes` (`* text=auto eol=lf`) with
   `core.autocrlf=true` and `core.safecrlf` unset causes Git to destroy `CR` bytes in any
   sidecar at commit time, silently — verified: `printf 'a\r\nb'` and `printf 'a\nb'` hash
   identically through `git hash-object --path=…`. The fixture proving ACJ-1 §27 is exactly
   the file Git would rewrite into a different, passing test. Marking sidecars `binary`
   prevents that but implies `-diff`, making every golden-byte change unreviewable.
   Additionally, ACJ-1 §33 requires rejection fixtures for lone surrogates and invalid UTF-8
   (`ED A0 80`), byte sequences with no JSON string representation — hex is the only in-band
   encoding that can carry them at all. base64url is rejected because its decode is
   non-injective, which is disqualifying in a corpus that *defines* byte-exactness.

2. **A corpus checksum is not an ACJ-1 digest.** Byte evidence carries a `checksum` over the
   decoded bytes for corruption detection. It is deliberately not called `digest`, because
   ACJ-1 §23 makes computing a digest over bare canonical bytes — unframed — a contract
   violation. A corpus field that looked like a digest but was computed unframed would teach
   implementers precisely the mistake the contract forbids. Expected ACJ-1 digests appear
   only in `expectedDigest`, always over a full AION Frame, always carrying their frame
   fields.

3. **Contradiction is unrepresentable, not merely forbidden.** The record is a closed
   discriminated union on exactly one `expectation` member. A record cannot claim both
   acceptance and rejection because there is nowhere to put the second claim. A rejection
   fixture cannot carry expected bytes from stages it never reaches, because those members
   are prohibited in the `reject` variant. This argument deliberately does **not** rest on
   ACJ-1 §19 duplicate-member rejection, since §19 is enforced by
   `CanonicalContractValidatorV1`, which is specified but unimplemented — the corpus loader
   performs its own duplicate-key rejection independently.

4. **Two entry points, chosen by what the case can express.** Entry-B (S0, bytes
   authoritative) is *mandatory* wherever a parsed host-language value destroys the fact
   under test — duplicate members being the decisive case, since JS objects and Python dicts
   silently collapse them. Entry-V (S2, structured value authoritative) covers cases fully
   expressible after parsing. Any case JSON cannot represent unambiguously must be Entry-B.
   This is a routing rule, not a preference.

5. **Timestamp truncation floors toward negative infinity, not toward zero.** ACJ-1 §14
   permits four-digit years, so pre-epoch instants are representable, and for a negative
   epoch offset truncating toward zero moves the instant **forward** — the exact outcome
   CTO-DECISION-004 prohibits. `precisionLoss` carries source and canonical instants as exact
   integers so a harness asserts `canonicalInstant ≤ sourceInstant` directly; string
   truncation cannot detect a forward move.

6. **Expected values carry provenance, and coverage ratchets.** An expected digest that is
   wrong makes a correct implementation fail and a matching wrong implementation pass, so
   every acceptance fixture declares how its expected value was obtained — and a value
   produced by the implementation under test is circular and rejected. Every fixture carries
   `coversRules` anchors, and a release asserts monotonic non-decrease of per-class and
   per-rule counts against the prior manifest.

7. **The corpus must prove it ran.** `node --test` with zero matching files exits 0. A
   corpus with no fixtures, a manifest resolving to nothing, or a harness filter matching
   nothing would report green and be indistinguishable from success. Every run asserts
   executed-count equals manifest-count, that it exceeds zero, that ratchet floors are met,
   and that every rejection fixture rejected at exactly its declared stage — not earlier.

8. **Fixture-ID-major layout with a normative manifest.** One self-contained directory per
   fixture, path a pure function of the ID, exactly one normative file. Class, stage, and
   coverage area are manifest metadata, never directory structure. Harnesses must not
   discover fixtures by globbing — a globbing harness silently loses a deleted or misnamed
   fixture and reports green.

## Alternatives considered

### Sidecar binary files for authoritative bytes

Rejected on verified evidence, not preference. See decision 1. The `binary` attribute fixes
normalization but destroys reviewability of the one artifact ACJ-1 calls the only proof of
conformance. Sidecars also collide with `core.ignorecase=true` (case-distinct names
collide), `core.symlinks=false` (blocks indirection), and `.editorconfig`'s
`insert_final_newline` (appends `0x0A`, violating ACJ-1 §28). Prohibiting them makes path
traversal, absolute-path injection, symlink and Windows-junction abuse, and missing-sidecar
handling *unrepresentable* rather than merely forbidden.

### base64 or base64url for byte evidence

Rejected. RFC 4648 §3.5 permits non-canonical trailing bits, so two distinct strings can
decode to identical bytes, and Node's `Buffer.from(s,'base64url')` silently accepts them. A
non-injective encoding cannot underpin a corpus that defines byte-exactness. It is also not
byte-aligned, so a one-byte edit shifts every subsequent character and destroys diff
locality. base64url remains correct for ACJ-1 §17 in-band content.

### Artifact-kind corpus layout

Rejected. Scattering one fixture's artifacts across `expected-canonical/`,
`expected-frames/`, `expected-digests/`, and `rejection/` means reviewing one change
requires correlating six diffs, and a partial edit is easy to miss.

### A flat fixture record with prose rules forbidding contradictions

Rejected. Prose rules are enforced only if someone implements the check. A closed
discriminated union makes the contradiction unrepresentable in the format itself.

### Deferring the corpus specification until an implementation exists

Rejected for the same reason DG-2 preceded DG-3: a fixture authored before its schema exists
must be re-authored afterwards, and a regenerated fixture's expected value *is* the
definition of correctness, so regeneration bugs are undetectable without an independent
cross-check.

### Generating the first ten fixtures now

Rejected — and explicitly unauthorized by CTO-DECISION-004. The readiness review found
material defects that would have been baked into any fixture authored against the
unreconciled design.

## Consequences

### Benefits

- Authoritative bytes survive Git, Windows editors, PowerShell, and `.editorconfig`
  untouched, because they are never stored as bytes.
- Whole classes of corpus attack — path traversal, symlink abuse, sidecar substitution —
  are structurally impossible rather than defended against.
- A fixture cannot express a contradiction, so review effort goes to whether the assertion
  is *right* rather than whether it is *coherent*.
- Vacuous passes are caught by construction, closing the failure mode where an empty corpus
  reports green at the gate meant to prevent exactly that.
- Coverage cannot silently regress.

### Costs

- Byte evidence is unreadable without decoding. A reviewer cannot eyeball
  `00000001310000001561696f6e…` and see a frame; tooling or patience is required. This is
  the direct price of the Git finding, and it is not small.
- Hex doubles the size of every byte artifact versus raw, and is 1.5× base64url.
- The 4096-byte literal cap forces a second mechanism — generator recipes — with its own
  closed constructor set to specify and review.
- Every fixture author must supply `coversRules` and `expectedValueProvenance`, which is
  real friction on every addition.
- Migration produces paired fixtures, so the corpus grows on every profile change and old
  fixtures are never deleted.

### Constraints

- No fixture may contain personal or owner data. No exception path.
- A value produced by the implementation under test may never be its own expected value.
- One runtime testing itself proves self-consistency only, and must never be reported as
  cross-runtime agreement.
- DG-3 closure requires evidence this ADR specifies but does not produce.

## Relationship to accepted contracts

ADR-007 and ADR-008 are unchanged. AFX-1 tests them; it does not amend them. Where the
corpus needed something the contracts did not state — expected-value provenance, the
pre-epoch truncation direction, the non-vacuity requirement — that is recorded here and in
the fixture contract, not by modifying ACJ-1 or the Object contract.

One correction to ADR-008 was made during this sprint: its §Costs stated framing adds 28
bytes of fixed overhead. Six `u32` plus one `u64` is 32 bytes. Corrected.

The Universal Object Contract remains **pre-stable**. DG-3 remains **open**.

## Required subordinate decisions

1. The required-rule inventory — which ACJ-1 and Object-contract anchors a complete corpus
   must cover, and the initial ratchet floor.
2. The generator-recipe constructor set beyond the initial four.
3. The second runtime, and how independence is verified rather than asserted.
4. Error-category granularity at S0, where two JSON parsers will not naturally agree on
   taxonomy.
5. Whether `illustrative` fixtures live in the same tree as `normative` ones.

## Review triggers

- DG-4 fixing the ACJ-1 §29–§31 limits, which unblocks boundary fixtures.
- The decimal representation decision landing, which unblocks scaled-integer fixtures.
- ACJ-1 advancing to `acj-2`, which requires paired migration fixtures for every existing
  acceptance fixture.
- A digest algorithm being added or retired.
- Any proposal to admit sidecar files, or to relax the personal-data prohibition.
- The first attempt to author a fixture revealing the record cannot express a required case.

## Approval effect

ADR-009 is **Proposed** and is not accepted by this directive.

Acceptance would authorize the fixture contract, the corpus organization, and the
subordinate decisions above. It would **not** authorize creating any normative fixture, any
loader, any harness, any implementation, or closure of DG-3 — and would not lift the
implementation freeze.
