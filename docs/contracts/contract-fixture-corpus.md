# Contract Fixture Corpus — AFX-1

Status: **Proposed** normative contract  
Corpus profile identifier: `afx-1`  
Authority: [ADR-009](../decisions/ADR-009-contract-fixture-corpus.md) (Proposed)  
Subject under test: [ACJ-1](canonical-serialization.md) and
[Universal Object Contract v1](object-contract-v1.md)  
Implementation: **Not authorized.** No fixture, loader, or harness exists or may be built.

## Responsibility

Provide stable, versioned, language-neutral evidence that independent AION implementations
interpret, validate, canonicalize, frame, and digest contract values **identically**.

It is **not** production data, a database, an object store, a transport format, a logging
format, a snapshot of private owner data, an implementation test framework, a replacement
for schemas, proof that an implementation is secure, or proof that an implementation is
authorized for production.

**All fixture content is synthetic or intentionally approved non-sensitive material.** No
fixture may contain personal data copied from the Founder, email, laptop, private GitHub
content, résumé, phone, calendar, or any connected source. This is a hard prohibition with
no exception path.

## 0. Two facts that determine this design

Both were verified in this repository, not assumed.

### Git silently destroys authoritative bytes in any sidecar file

`.gitattributes` carries `* text=auto eol=lf`; `core.autocrlf=true`; `core.safecrlf` is
unset. Under those settings:

```
$ printf 'a\r\nb' | git hash-object --path=test/fixtures/x.bin --stdin
0a207c060e61f3b88eaee0a8cd0696f46fb155eb
$ printf 'a\nb'   | git hash-object --path=test/fixtures/x.bin --stdin
0a207c060e61f3b88eaee0a8cd0696f46fb155eb
```

Identical. The `CR` is destroyed in the object database at commit time, permanently, with
**no warning** because `core.safecrlf` is unset. `git check-attr` confirms `text=auto`
matches `.bin`, `.acj`, and `.json` alike.

The fixture that proves ACJ-1 §27 — that `\r\n` is **not** normalized to `\n` — is exactly
the file Git would rewrite into a different, passing test. A corpus whose authoritative
bytes live in sidecars cannot state that rule.

`-text` or `binary` in `.gitattributes` does prevent normalization, and gitattributes is
consulted before `core.autocrlf` so it survives clones with different settings. But
`binary` implies `-diff`, rendering every golden-byte change as "Binary files differ" — no
review possible on what ACJ-1 §40 calls the only proof of conformance. Additionally
`core.ignorecase=true` makes case-distinct sidecar names collide, `core.symlinks=false`
blocks indirection, and `.editorconfig`'s `insert_final_newline = true` appends `0x0A`,
violating ACJ-1 §28's "no trailing newline".

**Sidecars are prohibited. Bytes are carried inline.**

### Some required bytes cannot be a JSON string at all

ACJ-1 §33 requires `invalid-string` rejection fixtures for lone surrogates and invalid
UTF-8 — for example `ED A0 80`. Those byte sequences have no JSON string representation.
Hex is the only in-band encoding that can carry them, so using hex uniformly for every byte
class costs nothing extra and buys one rule instead of two.

## 1. Byte evidence — `HexBytesV1`

Every authoritative byte sequence — raw input bytes, canonical bytes, framed bytes — is
carried inline as lowercase hexadecimal in a `HexBytesV1` object with exactly three members:

```json
{ "hex": "00000001310000001561696f6e2e…", "length": 137,
  "checksum": { "algorithm": "sha-256", "value": "371654f3…" } }
```

| Rule | Requirement |
|---|---|
| Encoding | Transmission order. Byte index 0 is the first two characters. **Never** interpreted as a big integer; leading `00` bytes are significant — every AION Frame begins `00 00 00 01` |
| Endianness | None applied. ACJ-1 §23's big-endian order is already present in the byte sequence and reproduced verbatim |
| Alphabet | Exactly `[0-9a-f]`. Uppercase is **rejected, never case-folded** — mirroring ACJ-1 §16. .NET `BitConverter.ToString` and PowerShell `'{0:X2}'` emit uppercase, so this is a real hazard |
| Length | Even. Odd length is `fixture-invalid-hex` |
| Separators | None. No `0x` prefix, no `\x`, no space, `-`, `:`, `_`, no internal whitespace |
| Wrapping | A single unwrapped JSON string on one line. No chunk arrays, no join rule — a join rule is a second parser with its own bugs |
| Empty | `""` denotes the zero-byte sequence. Legal, and **distinct from an absent member**, consistent with ACJ-1 §12 and §23 rule 4 |

### `checksum` is a corpus integrity checksum, not an ACJ-1 digest

`checksum` is computed over the **decoded bytes** and exists solely to detect corpus
corruption. It is deliberately **not** named `digest`, because ACJ-1 §23 declares that
computing a digest over bare canonical bytes — without an AION Frame — is a contract
violation. A corpus field that looked like an ACJ-1 digest but was computed unframed would
teach implementers the exact mistake the contract forbids.

- `checksum` MUST NOT be compared against, derived from, or substituted for any ACJ-1
  digest.
- An expected ACJ-1 digest appears **only** in an `expectedDigest` member, is always
  computed over a full AION Frame, and always carries its frame fields.
- `algorithm` is named explicitly and resolved through ACJ-1 §37; it is never assumed to be
  `sha-256`, and an unknown identifier fails closed.

`hex`, `length`, and `checksum` are three independent encodings of one fact and MUST all
agree on load. Any single-character corruption of `hex` fails at least two. Mismatches are
`fixture-length-mismatch` / `fixture-checksum-mismatch` — hard errors, never warnings.

### Prohibitions

- **Sidecar files are prohibited.** No fixture may reference an external file containing
  authoritative bytes, by path or by any other means. The corpus tree contains only `.json`
  files and the manifest; any other file is a corpus violation. This eliminates path
  traversal, absolute-path injection, symlink and Windows-junction abuse, case-collision,
  and missing-sidecar handling as *unrepresentable* rather than merely forbidden.
- **base64 and base64url are prohibited for byte evidence.** Their decode is non-injective
  — RFC 4648 §3.5 non-canonical trailing bits mean two distinct strings can decode to
  identical bytes, and Node's `Buffer.from(s,'base64url')` silently accepts them. A corpus
  that *defines* byte-exactness cannot use a non-injective encoding. base64url remains
  correct for ACJ-1 §17 in-band binary content; keeping the meta-layer hex keeps the two
  visually distinguishable.

### Oversize sources use generator recipes, not literals

A source byte sequence exceeding 4096 bytes MUST NOT be a literal. It is expressed as a
**generator recipe** using a closed, non-Turing-complete constructor set with integer-only
arguments — initially exactly `repeatCodePoint`, `repeatMember`, `nestArray`, `nestObject`
— plus the expected outcome. No template language, no expression evaluation, no
interpolation, no user-supplied code. Adding a constructor is a contract amendment, not a
corpus edit. A literal above the cap is `fixture-oversize-literal`.

ACJ-1 §29–§31 limit fixtures (depth 64, 4096 members, 65536 elements, 1 MiB string, 16 MiB
total) MUST be recipes. Their assertion is the rejection category `limit-exceeded`, not a
byte string, so they need no literal bytes and no sidecar. DG-4a now fixes those
canonical-processing limits, but the fixtures still cannot be authored until a separate
authorization permits normative fixture creation — see §9.

### The fixture file itself

UTF-8, no BOM, LF line endings, exactly one trailing LF. This governs the *fixture file*,
not canonical bytes; ACJ-1 §28's no-trailing-newline rule applies to the bytes encoded in
`hex`, which are unaffected by the file's own formatting. That separation is the entire
reason inline hex is safe where sidecars are not.

## 2. Processing stages

| Stage | Consumes | Produces | Fixture evidence |
|---|---|---|---|
| **S0** Raw input bytes | bytes | parse outcome | Malformed encoding, malformed JSON, duplicate members, invalid escapes, BOM, invalid UTF-8, trailing content, illegal number syntax, excessive raw size |
| **S1** Parsed contract value | parse result | resolved value | Schema and profile resolution, permitted value types, unknown/required members, identifier syntax, timestamp syntax, numeric constraints, Unicode requirements, canonical-position restrictions |
| **S2** Canonical validation | resolved value | validated value or rejection | `CanonicalContractValidatorV1` outcomes and ACJ-1 §33 error categories |

### Where error-code conformance begins

Recorded by [CTO-DECISION-005](../decisions/CTO-DECISION-005-fixture-corpus-architecture.md),
resolving readiness finding B-1. **Parser diagnostics and AION contract errors are different
things and are conformed to differently.**

**At S0, required cross-runtime agreement is limited to:**

1. the input is rejected;
2. rejection occurs at S0;
3. parsing does not produce a usable contract value;
4. no canonical bytes are produced;
5. no AION Frame is produced;
6. no digest is produced.

Implementations are **not** required to emit an identical parser-specific error category at
S0. Standards-compliant parsers legitimately use different diagnostic taxonomies for
malformed UTF-8, duplicate members, malformed escapes, malformed numbers, and trailing
content. Requiring identical diagnostics would couple the corpus to particular parser
libraries and runtime languages, and would report a defect where none exists.

An S0 fixture records `targetStage: S0` and `expectation: reject`. It **may** carry
`diagnosticHint` — a free-text note for human review. `diagnosticHint` is **non-normative**,
is never compared across runtimes, and never participates in a conformance verdict. A
harness that fails a run on `diagnosticHint` mismatch is non-conforming.

**At S1**, only those error categories explicitly owned by an accepted AION
schema-resolution or profile-resolution contract are normative. Where AION owns no
semantics, S0 rules apply.

**At S2 and later**, stable AION error categories are fully normative, because
`CanonicalContractValidatorV1` applies AION-defined validation semantics rather than a
parser's.

Stable parser error codes MUST NOT be invented merely to make implementations appear
uniform. Uniformity purchased that way is fictional: it would be satisfied by a mapping
table, not by agreement.
| **S3** Canonical serialization | validated value | canonical bytes | Exact canonical byte output |
| **S4** Frame construction | canonical bytes + frame fields | framed bytes | Exact framed bytes, field boundaries, length prefixes |
| **S5** Digest calculation | framed bytes | digest | Exact digest under a registered algorithm |
| **S6** Cross-runtime conformance | everything above | agreement report | **Reserved.** No harness exists or is authorized |

### `targetStage` and `terminalStage`

Every fixture declares `entryStage`, `targetStage`, and `terminalStage`.

- `entryStage` is where the fixture's authoritative artifact enters: **S0** (bytes
  authoritative) or **S2** (structured value authoritative). No other entry point exists.
- `targetStage` is the stage whose behaviour the fixture asserts.
- `terminalStage` is where processing is expected to stop.

Invariants:

- `entryStage ≤ targetStage ≤ terminalStage`.
- For an **acceptance** fixture, `terminalStage == targetStage` and every stage from
  `entryStage` through `targetStage` must succeed.
- For a **rejection** fixture, `terminalStage` is the stage that rejects, and the fixture
  **MUST NOT** carry expected outputs from any later stage. A fixture rejecting at S0 has
  no canonical bytes, no framed bytes, and no digest — the record cannot express them.
- Rejecting **earlier** than `terminalStage` is a conformance failure, not a pass. An
  implementation that rejects everything must not score perfectly on a rejection corpus.

## 3. Raw bytes versus structured values

### Why the split is mandatory, not stylistic

A parsed host-language value **cannot represent** several cases the corpus must cover. The
decisive example is duplicate members: JavaScript objects and Python dicts silently collapse
`{"a":1,"a":2}` to one key. A parsed value is therefore *not evidence* for ACJ-1 §19 — the
collapse has already destroyed the fact under test.

**Entry-B (S0, bytes authoritative)** is mandatory for:

- duplicate object members (§19);
- malformed or invalid UTF-8, lone surrogates (`ED A0 80`);
- invalid escape sequences;
- byte-order marks;
- whitespace, line-ending, and trailing-content cases (§25–§27);
- illegal number syntax that a permissive parser would normalize — `1.0`, `1e2`, `-0`,
  leading zeros (§6, §10);
- non-NFC strings, where the distinction survives parsing but is invisible in review;
- parser-differential inputs generally;
- excessive raw size.

**Entry-V (S2, structured value authoritative)** is correct for cases fully expressible
after parsing: wrong identifier kind, prohibited binary float as a value-domain violation,
timestamp with excess precision, unknown contract member, out-of-range integer, incorrect
lifecycle value.

### The bootstrapping constraint, stated plainly

The corpus file is itself JSON, so a loader parsing it is subject to the same limits it is
testing. This is not solved by cleverness; it is solved by never requiring the corpus format
to express what it cannot:

- An Entry-B fixture's authoritative artifact is `HexBytesV1`. The loader decodes hex to
  bytes and hands **bytes** to the implementation under test. The corpus JSON never has to
  contain a duplicate member, invalid UTF-8, or a lone surrogate — it contains a hex string
  describing one.
- An Entry-V fixture's structured value is expressed in the corpus JSON directly, and is
  therefore restricted to what JSON can unambiguously represent. Any case JSON cannot
  represent unambiguously **must** be Entry-B. This is a hard routing rule, not a
  preference.
- A fixture MUST declare exactly one authoritative artifact. Carrying both bytes and a
  structured value for the same fixture is `fixture-ambiguous-source`.

## 4. The fixture record

### Contradictions are unrepresentable, not merely forbidden

The record is a **closed discriminated union** on a single mandatory `expectation` member
whose tag selects the permitted field set. Because there is exactly one `expectation`
member, a record cannot claim both acceptance and rejection — not because a rule forbids it
but because there is nowhere to put the second claim.

> This structural argument deliberately does **not** rely on ACJ-1 §19's duplicate-member
> rejection. §19 is enforced by `CanonicalContractValidatorV1`, which ACJ-1 §0 declares
> specified-but-unimplemented. A corpus loader MUST perform its own duplicate-key rejection
> on fixture files, independently, and MUST NOT assume the host JSON parser does so. A
> host parser that silently keeps the last duplicate would let a tampered fixture carry two
> `expectation` members while appearing valid.

### Field matrix

| Field | Requirement |
|---|---|
| `fixtureSchemaVersion` | Always required |
| `fixtureId` | Always required. §5 grammar |
| `fixtureClass` | Always required. §6 |
| `title`, `purpose`, `rationale` | Always required. Prose; never load-bearing |
| `status` | Always required: `normative` or `illustrative` |
| `entryStage`, `targetStage`, `terminalStage` | Always required. §2 invariants enforced on load |
| `subjectBinding` | Always required: contract family, contract/schema version, canonicalization profile, and — when `targetStage ≥ S4` — frame version and operation purpose |
| `digestAlgorithm` | Required iff `targetStage ≥ S5`. **Prohibited** otherwise |
| `sourceBytes` | Required iff `entryStage == S0`. `HexBytesV1`. **Prohibited** iff `entryStage == S2` |
| `sourceValue` | Required iff `entryStage == S2`. **Prohibited** iff `entryStage == S0` |
| `sourceProvenance` | Always required: `synthetic`, `derived-from-spec-example`, or `derived-from-external-standard`, with citation for the latter two |
| `expectation` | Always required. Exactly one. Tagged union below |
| `expectedCanonicalBytes` | Permitted **only** inside an `accept` expectation with `terminalStage ≥ S3`. `HexBytesV1` |
| `expectedFrameBytes` | **Required** inside an `accept` expectation with `terminalStage ≥ S4`. `HexBytesV1`. §4.1 |
| `expectedDigestInput` | **Required** inside an `accept` expectation with `terminalStage ≥ S5`. `HexBytesV1`. §4.1 |
| `expectedDigest` | Permitted **only** inside an `accept` expectation with `terminalStage ≥ S5`, and **only** alongside `expectedDigestInput`. Carries algorithm and all six frame fields |
| `expectedErrorCategory` | Required inside a `reject` expectation. Must be an ACJ-1 §33 category. **Prohibited** in `accept` |
| `rejectionStage` | Required inside a `reject` expectation. Must equal `terminalStage` |
| `precisionLoss` | Required iff the fixture exercises timestamp conversion. §7 |
| `relation` | Required iff `fixtureClass` is `equivalence` or `non-equivalence`. Names the paired `fixtureId` and the asserted relationship |
| `coversRules` | Always required. Non-empty array of stable ACJ-1 / Object-contract section anchors. §8 |
| `expectedValueProvenance` | Always required for any `accept` expectation. §8 |
| `securityRelevance` | Optional metadata |
| `tags` | Optional metadata |
| `author`, `reviewStatus`, `createdDate` | Always required. Governance metadata |
| `supersedes`, `supersededBy` | Optional; §5 rules |

### Expectation variants

```text
expectation := accept { … }   |   reject { expectedErrorCategory, rejectionStage }
```

- `accept` requires exactly the expected-output members permitted by its `terminalStage`,
  and **prohibits** every member beyond it. An `accept` with `terminalStage = S3` that
  carries `expectedDigest` is `fixture-stage-overreach`.
- `reject` **prohibits** `expectedCanonicalBytes`, `expectedFrameBytes`, and
  `expectedDigest` unconditionally. A rejection fixture never asserts bytes it never
  produces.
- No fixture may carry two expectations, two error categories, or two terminal stages.

## 4.1 Digest evidence — a digest is never recorded alone

Recorded by [CTO-DECISION-005](../decisions/CTO-DECISION-005-fixture-corpus-architecture.md),
resolving readiness finding B-3.

A final digest value, on its own, cannot reveal **incorrect field ordering, incorrect length
prefixes, missing domain-separation fields, a wrong purpose, a wrong profile, a
payload-boundary mistake, or — the error the contract most fears — accidental hashing of
canonical bytes without framing.** All of those produce a well-formed digest of the wrong
input. A fixture recording only the output certifies the mistake.

Every digest-bearing fixture MUST therefore carry, or unambiguously reference, all eleven:

1. source contract value **or** authoritative source bytes;
2. expected canonical bytes;
3. expected AION Frame v1 bytes;
4. expected **complete framed digest input bytes**;
5. digest algorithm identifier;
6. expected digest bytes;
7. applicable canonicalization profile;
8. contract family and version;
9. frame version;
10. domain-separation purpose;
11. domain context where applicable.

`expectedDigestInput` is **mandatory**, not optional. The fixture record structurally
prohibits an `accept` expectation with `terminalStage ≥ S5` from omitting it: `expectedDigest`
is permitted only alongside `expectedDigestInput`, so a digest without its input is
unrepresentable rather than merely discouraged.

This makes the derivation **independently auditable**: a reviewer or tool recomputes
`digest(expectedDigestInput)` and compares it to `expectedDigest`, then re-derives the frame
from the recorded frame fields and compares it to `expectedDigestInput`. Neither check
requires a second implementation, which is why B-3 could be resolved before one exists.

### Five artifacts, five names, never interchanged

| Name | What it is | Never |
|---|---|---|
| **canonical bytes** | ACJ-1 §28 output for the value | Never digested directly — ACJ-1 §23 forbids it |
| **frame bytes** | The AION Frame v1 byte sequence, ACJ-1 §23 | Never confused with the payload it contains |
| **framed digest input** | The exact byte sequence fed to the digest function | Never a subset or re-serialization of the frame |
| **digest output** | The digest value, lowercase hex | Never recorded without its input |
| **corpus checksum** | Non-security integrity check over a corpus artifact (§1) | **Never called a digest**, never compared to one, never substituted for one |

> **Normative clarification.** Under ACJ-1 §23 the framed digest input **is** the AION Frame
> v1 byte sequence — the digest is computed over the frame, not over some further wrapping of
> it. `expectedFrameBytes` and `expectedDigestInput` therefore carry identical bytes for
> `acj-1` and `FrameVersion` 1. Both fields are required anyway, and a conforming loader MUST
> verify they are byte-identical. Recording them separately makes the identity checkable
> rather than assumed, and leaves room for a future frame version where a digest covers
> something other than the bare frame. A mismatch is `fixture-frame-digest-input-mismatch`.

## 5. Identifiers and versioning

### Fixture identifier

`AFX-<FAMILY>-<NNNNNN>` — e.g. `AFX-ACJ-000417`. `FAMILY` comes from a closed additive
registry (`ACJ` canonicalization, `FRM` framing, `OBJ` Object envelope, `TSP` timestamp,
`MIG` migration). The serial is minted from an append-only per-family ledger.

Identifiers are **never** derived from content, file path, test name, runtime language, or
Git commit hash, and are never reused after withdrawal. Bounded semantics — a family prefix
— are permitted because reviewers must cite these in prose; full semantics are rejected
because they rot when the thing they describe changes.

### A new ID is required when the assertion changes

Identity is the **assertion tuple**: `(authoritative source, subjectBinding, expectation)`.

- Changing any element of that tuple requires a **new fixture ID**. The old fixture is
  withdrawn with `supersededBy`, and is retained as regression evidence.
- Everything outside the tuple — `title`, `purpose`, `rationale`, `tags`,
  `securityRelevance` — may be corrected **in place** as a content revision.
- `status` and `reviewStatus` sit outside the tuple but are **governance-controlled**:
  demoting `normative` → `illustrative` is a withdrawal and requires the same review as a
  supersession. Without that rule, one token silently deletes a test while the suite stays
  green.

### Seven distinct version categories — never conflated

| Version | Meaning | Changed by | Does **not** govern |
|---|---|---|---|
| `fixtureSchemaVersion` | Shape of the fixture record | A change to §4 | Any fixture's content |
| Fixture content revision | Non-assertion edits to one fixture | A prose or metadata correction | The assertion |
| Contract/schema version under test | Which Object schema the fixture targets | A new domain schema version | Canonicalization |
| Canonicalization profile version | `acj-1`, `acj-2`, … | ACJ-1 §1–§20 or §23 changing | The fixture record shape |
| Framing version | AION Frame `FrameVersion` | A framing change | Canonical bytes |
| Digest algorithm identifier | `sha-256`, … | Registry addition or retirement | Canonical or framed bytes |
| Corpus release version | A published, checksummed corpus snapshot | A release | Any individual fixture's identity |

### Profile migration produces paired fixtures

ACJ-1 advances to `acj-2` on any change to §1–§20 or §23. Every existing `accept` fixture
whose `expectedCanonicalBytes` or `expectedFrameBytes` were produced under `acj-1` retains
those bytes **under `acj-1`** and gains a **paired new-ID fixture** under `acj-2`. The old
fixture is not edited and not deleted: it remains the evidence that `acj-1` behaved as
specified, which is required to verify historical digests and retained exports. Migration
fixtures therefore always come in pairs, and a migration that produces no pairs is
incomplete by definition.

## 6. Fixture classes

| Class | Purpose |
|---|---|
| **Acceptance** | A valid value produces exactly these bytes/digest |
| **Rejection** | An invalid input is rejected at exactly this stage with exactly this category |
| **Boundary** | Behaviour immediately either side of a declared limit |
| **Equivalence** | Two distinct source forms that MUST produce identical canonical bytes |
| **Non-equivalence** | Two source forms that MUST NOT collide — null vs absent, NFC vs NFD, distinct frames |
| **Migration** | Paired old-profile / new-profile behaviour |
| **Parser-differential** | Inputs where two parsers plausibly disagree; always Entry-B |
| **Profile-version** | Unknown or unsupported profile fails closed |
| **Algorithm-agility** | Unknown, retired, or substituted algorithm fails closed |
| **Adversarial** | Inputs constructed to make a broken implementation look correct |

### Rejection fixtures are first-class

An acceptance-only corpus is **insufficient**: an over-permissive implementation passes
every positive fixture while accepting invalid input. Every rejection fixture identifies its
rejection stage, its stable expected error category, whether parsing must fail before schema
resolution, that no output bytes are permitted, and that no digest may be produced.

A corpus release in which any coverage area lacks a rejection fixture is **incomplete** and
MUST fail its completeness check.

## 7. Timestamp fixtures

### NF-1 exact-integer cross-runtime fixture — required, not created

The future normative corpus MUST include the same source integer outside
`−(2^53 − 1) … 2^53 − 1` for a JavaScript implementation and at least one runtime that preserves
larger integers. Both MUST reject it at the AION canonical validation boundary with
`integer-out-of-range`; neither may produce canonical bytes, frame bytes, or a digest. The fixture
must prove that parser success and host numeric capability do not redefine the AION contract.
This requirement does not authorize a fixture, loader, harness, or fixtures directory.

Recorded per [CTO-DECISION-004](../decisions/CTO-DECISION-004-sprint-2.7-authorization.md),
resolving NB-7. See [ACJ-1 §14](canonical-serialization.md#14-timestamps).

Required future fixture categories:

1. exact three-digit canonical precision — accepted;
2. higher-precision source converted **before** validation — accepted, with declared loss;
3. explicit precision-loss declaration present and correct;
4. truncation rather than rounding;
5. truncation that does **not** move the represented instant forward;
6. excess fractional digits **rejected** at S2 with `invalid-timestamp`;
7. offset and syntax forms prohibited by §14–§15 rejected;
8. original source precision retained through provenance where required.

The corpus schema distinguishes: source timestamp; transformed canonical contract timestamp;
conversion rule; whether precision was lost; original precision; expected validator result.

### The pre-epoch hazard

ACJ-1 §14 permits any four-digit year, so instants **before 1970** are representable. For a
negative epoch offset, truncating the fractional component *toward zero* moves the instant
**forward** — the exact outcome CTO-DECISION-004 prohibits.

The normative rule is therefore **truncation toward negative infinity (floor)**, not toward
zero. The two coincide only at or after the epoch. `precisionLoss` MUST carry the source and
canonical instants as exact integer fields so a harness can assert
`canonicalInstant ≤ sourceInstant` directly, rather than inferring it from string
concatenation — string truncation cannot detect a forward move in the pre-epoch case.

The corpus MUST include at least one pre-epoch precision fixture. Its absence would leave
the only case where the naive implementation is wrong untested.

**The canonicalizer is never described as performing this conversion.** No timestamp fixture
is generated by this contract.

## 8. Provenance of expected values, and coverage ratchet

### Expected values need provenance too

`sourceProvenance` constrains where a fixture's *input* came from. Nothing yet constrained
where its *expected output* came from — and the expected output is what the corpus asserts.
A hand-computed digest that is wrong makes a correct implementation fail and a matching
wrong implementation pass.

Every `accept` expectation MUST carry `expectedValueProvenance` naming how the expected
bytes or digest were obtained: `hand-derived-from-spec` (with the reasoning recorded),
`third-party-tool` (naming tool and version), or `cross-implementation-agreement` (naming
both implementations). A value produced by the AION implementation under test **cannot** be
its own expected value — that is circular and MUST be rejected in review.

### Coverage must ratchet

`fixtureClass` alone is satisfiable by one fixture per class, and nothing would link a
record to the rule surface it exercises. Removing the only fixture covering a load-bearing
rule would be undetectable.

Every fixture therefore carries `coversRules`: a non-empty array of stable contract-section
anchors. A required-rule inventory is published alongside this contract, and a corpus
release MUST assert a **monotonic non-decrease**: the count of executed fixtures per class
and per covered rule may not fall below the previous release's, enforced against the prior
manifest.

## 9. Corpus organization

### Fixture-ID-major, one directory per fixture

```text
fixtures/
    manifest/            normative manifest + required-rule inventory
    cases/<family>/<fixtureId>/fixture.acj.json     exactly one normative file
    releases/            checksummed release snapshots
    schemas/             fixture-record schema, versioned
```

Artifact-kind layout — separate `expected-canonical/`, `expected-frames/`,
`expected-digests/` directories — is **rejected**. It scatters one fixture's artifacts
across six directories, so reviewing a single change means correlating six diffs, and a
partial edit is easy to miss. Fixture-ID-major keeps one assertion in one reviewable file.
Class, stage, and coverage area are **metadata indexed by the manifest**, never directory
structure, so a fixture can be reclassified without moving a file and breaking its path.

Directory path is a pure function of `fixtureId`. Nothing else determines it.

### Manifest

The manifest is normative and enumerates every fixture explicitly. **Harnesses MUST NOT
discover fixtures by directory globbing** — a globbing harness silently loses a fixture that
was deleted or misnamed, and reports green. The manifest carries, in deterministic order:
fixture ID, path, class, stages, covered rules, status, and a checksum of the fixture file.

Duplicate IDs are a hard error. A manifest entry with no file, or a file with no manifest
entry, is a hard error.

### Releases

A release pins the corpus by version and checksum, is offline-verifiable without network
access, and carries the required-rule inventory and per-class counts used for the ratchet.

## 10. Non-vacuity — the corpus must prove it ran

`node --test` with zero matching test files **exits 0**. A corpus with no fixtures, a
manifest that resolves to nothing, or a harness whose filter matches nothing would report
green and be indistinguishable from complete success. This is the single most dangerous
failure mode of a fixture corpus, because it converts absence of evidence into apparent
conformance at the exact gate that exists to prevent that.

Every conformance run MUST therefore assert:

1. the number of fixtures **executed** equals the number the pinned manifest declares;
2. that number is greater than zero;
3. per-class and per-rule counts meet or exceed the ratchet floor;
4. every rejection fixture rejected at exactly its declared stage — not earlier;
5. the run fails loudly if any of the above cannot be established.

A run that cannot establish these is a **failure**, not a pass.

## 11. Cross-runtime conformance evidence

Required before DG-3 can close. Each is a testable condition, not an aspiration.

1. **Two independent implementations**, in two runtime languages or independently authored.
2. Neither uses the other as its encoder, its oracle, or its reference — verified by
   dependency inspection, not by assertion.
3. Exact **canonical-byte** agreement across all acceptance fixtures.
4. Exact **framed-byte** agreement.
5. Exact **digest** agreement.
6. **Matching rejection stage** for every rejection fixture.
7. **Matching stable error category** wherever ACJ-1 §33 requires one.
8. Corpus release pinned **by version and checksum**.
9. Reproducible on a **clean environment** from the pinned release.
10. Evidence captured in **machine-readable and human-readable** form.
11. Comparison performed on **bytes, not text**. A harness that decodes to strings before
    comparing will silently pass mismatched line endings, BOMs, and normalization
    differences — the exact defects the corpus exists to catch.

No second runtime is selected here. No harness is designed or implemented beyond this
evidence contract.

## 11.1 Normative-fixture authorization gate

Recorded by [CTO-DECISION-005](../decisions/CTO-DECISION-005-fixture-corpus-architecture.md),
resolving readiness finding B-2. **Acceptance of ADR-009 authorizes this architecture. It
does not authorize creating a single normative fixture.**

### Candidate versus normative

| | Candidate fixture | Normative fixture |
|---|---|---|
| Purpose | Exercises the schema; probes whether a case is expressible | Defines what correct means |
| Expected values | May be hand-derived and unconfirmed | Must be independently reproduced |
| Lives in | A clearly marked candidate set, never a conformance release | A checksummed conformance release |
| Conformance | **Never** consulted for a conformance verdict | Authoritative |
| Authorization | Blocked during Sprint 2.8; permitted only when separately directed | Blocked until the gate below is met |

A candidate fixture is **promoted** to normative only when its expected result has been
**independently reproduced**. The absence of a second runtime does not prevent *drafting* a
candidate; it absolutely prevents *promoting* one.

### The gate — all seven required

Authorization for the first normative fixture corpus remains blocked until:

1. **DG-4 measurable limits are accepted** where required by fixture boundaries.
2. The **expected-value derivation and verification process** is approved.
3. **A normative fixture cannot become the sole oracle for its own correctness.**
4. **Digest-bearing fixtures have independently checkable canonical bytes, frame bytes, and
   framed digest input** — satisfied structurally by §4.1.
5. The initial corpus plan **distinguishes candidate from normative released fixtures**.
6. The applicable **decimal or exact continuous-quantity decision exists** before fixtures
   covering that value class are made normative.
7. **Cross-runtime confirmation requirements are defined** before a corpus release is
   labelled conformant.

Condition 3 is the load-bearing one. A fixture whose expected value was produced by the only
implementation that will ever be tested against it proves nothing — it records that the
implementation agrees with itself. Nothing structural can detect this; it is why conditions
2, 3, and 7 exist together.

## 12. What this corpus does not prove

- Not implementation **security**.
- Not **authorization** for production.
- Not a replacement for **threat modelling**.
- Not a replacement for **independent implementations** — one runtime testing itself proves
  only self-consistency.
- Not a replacement for **production monitoring**.

Passing every fixture means two implementations agree on the cases someone thought to write
down. It says nothing about the cases nobody thought of.
