# Canonical Serialization Contract — ACJ-1

Status: **Accepted** normative contract, 2026-08-06  
Profile identifier: `acj-1` — the approved canonicalization profile  
Authority: [ADR-008](../decisions/ADR-008-canonical-serialization.md) (Accepted) and
[CTO-DECISION-003](../decisions/CTO-DECISION-003-canonical-serialization.md)  
Base: strict subset of [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)  
Stability: `acj-1` names a **profile family**, not a frozen implementation. The profile is
approved; no implementation exists and cross-runtime agreement has never been demonstrated.
Advances to `acj-2` on any change to §1–§20 or §23.  
Implementation: **Not implemented**; authorized only prospectively within the bounded Sprint 3.0 slice

## Responsibility

Define a deterministic, language-neutral byte representation for AION contract values
where exact equality, hashing, signing, integrity verification, portable fixtures, export,
or cross-runtime conformance requires one.

Not a storage format, transport mandate, presentation format, compression format,
encryption format, object mapper, or replacement for versioned schemas.

## Conformance

An implementation conforms when, for every value in the ACJ-1 value domain, it produces
byte-identical output to every other conforming implementation, rejects every value
outside the domain with the specified deterministic error, and passes the published
fixture set.

**Subset guarantee:** every ACJ-1 output is valid RFC 8785 output. An implementation may
be a thin validating wrapper over a stock JCS library. It may not be a fork of the JCS
algorithm.

## 0. Validation boundary — `CanonicalContractValidatorV1`

Canonicalization is not a validating operation. A separate, explicitly named
language-neutral responsibility runs first and decides whether a value may be
canonicalized at all.

### Processing sequence

```text
Contract Value
    |
    v
Schema and Profile Resolution
    |
    v
CanonicalContractValidatorV1
    |
    v
Validated Canonical-Domain Value
    |
    v
Canonical Serializer
    |
    v
Canonical Bytes
    |
    v
Domain-Separated Digest or Signature Input   (§23)
```

This sequence is normative and is **not implemented** by this contract.

### Validator responsibility

`CanonicalContractValidatorV1` has one responsibility: determine whether a contract value
satisfies

- its versioned schema;
- its canonicalization profile;
- Unicode requirements (§4);
- numeric constraints (§6–§11);
- member and key constraints (§18–§20);
- depth and size constraints assigned to the profile (§29–§31);
- identifier and timestamp normalization rules (§14–§16);
- duplicate-member prohibitions (§19);
- forbidden value classes (§1, §8);
- applicable contract invariants.

### Validator requirements

1. Runs **before** canonicalization.
2. **Fails closed.** An unresolvable schema, unknown profile, or unrecognised value kind
   is a rejection, never a pass-through.
3. Returns stable, **non-enumerating** error codes — an error must not confirm the
   existence of anything the caller could not otherwise observe.
4. **Never silently rewrites** an invalid value.
5. **Never normalizes an invalid value and then treats the normalized result as
   equivalent**, unless a future profile explicitly defines that normalization as part of
   the contract transformation.
6. Remains separate from authentication, authorization, persistence, transport, and
   business validation. It answers "is this canonicalizable under this schema and
   profile?" — never "is this true, permitted, or wanted?"
7. Is replaceable and language-neutral at the contract level.

### Canonicalizer obligations

The canonicalizer accepts **only** values already validated against a named schema and a
named canonicalization profile. It must not:

- repair Unicode;
- remove duplicate keys;
- coerce numbers;
- infer timestamps;
- fill absent members;
- remove unknown members;
- reorder semantically ordered arrays;
- reinterpret identifiers; or
- silently upgrade contract versions.

Every one of these is a *repair*, and a repairing canonicalizer maps two distinct inputs
to one output — which hides a producer bug and defeats the purpose of a digest.

### Status of this boundary

`CanonicalContractValidatorV1` is a **specified contract responsibility with no
implementation**. Controls in the threat model that depend on it are specified controls,
not runtime controls, until it exists. Implementing it is not authorized.

## 1. Value domain

Exactly six value kinds are canonicalizable. Anything else is rejected.

| Kind | Admitted | Notes |
|---|---|---|
| Null | `null` | Distinct from absent — see §12 |
| Boolean | `true`, `false` | §13 |
| Integer | JSON number, no fraction, no exponent | §6–§7 |
| String | JSON string | §4, §5 |
| Array | Ordered sequence | §3 |
| Object | Unordered member set | §2 |

Explicitly **not** in the domain: binary floating point, `NaN`, `±Infinity`, `-0`,
undefined, functions, dates as native types, binary as native type, comments, cyclic
references, and any host-language type not reduced to the six kinds above.

## 2. Object member ordering

Members are sorted by ascending **UTF-16 code unit** sequence of the member name, per
RFC 8785 §3.2.3. This is not lexicographic Unicode ordering and not locale collation;
implementations that sort by code point will diverge on characters outside the Basic
Multilingual Plane and are non-conforming.

Member ordering is **never** any of the following:

- the host language's default string sort;
- Unicode code-point order;
- locale-sensitive or culture-sensitive collation;
- byte order of the UTF-8 encoding.

A runtime whose native string ordering is **not** UTF-16 code-unit order MUST supply an
explicit comparator producing the required order. Encoding each key to UTF-16 big-endian
and comparing the resulting byte sequences is sufficient and is the recommended
formulation.

### Worked example — non-normative

Measured in both runtimes on 2026-08-06; see
[benchmark evidence](../benchmarks/resource-limits-evidence.md).

| Key | Code point(s) | UTF-16 code units |
|---|---|---|
| `a` | U+0061 | `0061` |
| `` (private use) | U+E000 | `E000` |
| `￿` | U+FFFF | `FFFF` |
| `𐀀` (supplementary) | U+10000 | `D800 DC00` — a surrogate pair |

**Required order (UTF-16 code units):** `a`, `𐀀`, ``, `￿`

**Code-point order (non-conformant):** `a`, ``, `￿`, `𐀀`

U+10000 is the *highest* code point of the four, but its UTF-16 representation begins
`D800`, which is *lower* than `E000` and `FFFF`. Any implementation ordering by code point
places it last; the contract requires it second.

**Why this matters per runtime.** JavaScript strings are UTF-16 and its relational
operators compare code units, so `Array.prototype.sort()` with no comparator is conformant
by default — verified. Python's `str` ordering is by code point, so `sorted()` is
**non-conformant** for supplementary-plane keys — verified: Python produced
`a, U+E000, U+FFFF, U+10000` where the contract requires `a, U+10000, U+E000, U+FFFF`.
A conformant Python implementation must sort on `s.encode('utf-16-be')`, which was measured
at roughly 11× the cost of the default sort and allocates one UTF-16 copy per key.

Two independent implementations sorting "correctly" by their own defaults would therefore
produce **different canonical bytes and different digests** for the same value. This is the
clearest known cross-runtime hazard in the contract, and it is invisible in any test whose
keys are entirely within the Basic Multilingual Plane.

A normative fixture covering this case is **required** and is recorded in the AFX-1 coverage
matrix. None is authored here — normative fixtures remain unauthorized.

> **Status of this subsection.** Clarification only. The ordering rule, the exclusion of
> code-point sorting, and the Basic Multilingual Plane divergence were all stated in this
> section as accepted. No accepted semantics are changed; the worked example and the
> explicit-comparator requirement make the existing rule checkable.

## 3. Array ordering

Array order is **semantic and preserved exactly**. A canonicalizer never sorts, dedupes,
or reorders an array. Where a schema requires order-independence, the schema declares a
canonical sort key and the *producer* sorts before canonicalization; the canonicalizer
does not infer it.

## 4. Unicode normalization

Canonical strings must satisfy **NFC**.

`CanonicalContractValidatorV1` (§0) verifies NFC. Non-NFC input fails with a stable
outcome. **Canonicalization does not silently normalize it** — that would fork JCS and,
worse, would map two distinct inputs to one output. A future profile may define
normalization as an explicit contract transformation; `acj-1` does not.

Without this rule, `café` in NFC and in NFD are different contract values producing
different digests, and the difference is invisible on screen. That is precisely why the
check belongs at a boundary that rejects rather than at a serializer that repairs.

Lone surrogates, unpaired surrogates, and code points that are not valid Unicode scalar
values are rejected.

**Enforcement status:** specified, not implemented. The validator does not exist, so this
control is a contract requirement rather than an active runtime defence.

## 5. String encoding and escaping

- Output encoding is **UTF-8**, no byte-order mark.
- Escaping follows RFC 8785 §3.2.2.2: only `"` `\` and control points below U+0020 are
  escaped; the short forms `\b \t \n \f \r \" \\` are used where defined; all other
  control points use lowercase `\u00xx`.
- No other character is ever escaped. `/` is not escaped. Non-ASCII is emitted literally
  as UTF-8, never as `\u` sequences.

## 6. Number representation

Integers only. Serialized as the shortest decimal form with no leading zeros, no `+`, no
exponent, no fractional part, and `-` only for negative values.

`0` is the only representation of zero. **`-0` is rejected**, not folded, because folding
would make two distinct inputs produce one output and hide a producer bug.

## 7. Integer range

The admitted range is **−(2^53 − 1) … 2^53 − 1** inclusive — the range in which every
integer is exactly representable as an IEEE 754 double, so a JCS implementation backed by
double arithmetic cannot lose precision.

This is an AION contract boundary, not a description of host-language capability. A conforming
implementation MUST validate the source numeric token/value and MUST NOT trust success from its
host parser. JavaScript MUST reject a precision-lost out-of-range integer; Python and runtimes
with larger exact integers MUST reject the same value despite preserving it. The same source
contract value therefore receives the same AION result across runtimes. Rejection is
`integer-out-of-range` at the canonical validation boundary and occurs before canonical bytes,
AION Frame bytes, or digest output are produced. A future normative cross-runtime fixture is
required; none is created or authorized here.

Integers outside that range are represented as **strings** with a schema-declared radix
(decimal by default) and are validated against a declared minimum and maximum. The schema,
not the canonicalizer, gives them numeric meaning.

## 8. Floating point

**IEEE 754 binary floating-point values are prohibited in canonical contract positions.**

This is a deliberate architectural constraint recorded by
[CTO-DECISION-003](../decisions/CTO-DECISION-003-canonical-serialization.md), not an
incidental consequence of selecting a JSON-based profile. It would apply to any format
chosen for integrity purposes.

Rationale: binary floating-point representations can differ across runtimes; JSON number
parsing can silently lose precision; and integrity, hashing, signing, fixture comparison,
and conformance all require exact reproducible values. Silent precision loss inside an
integrity mechanism is unacceptable.

### Four value contexts

The prohibition is scoped to one of four contexts. Conflating them is the usual source of
confusion about this rule.

| Context | Definition | Binary floats |
|---|---|---|
| **Domain value** | A quantity as the owning domain conceptually models it | Permitted as a concept — a probability *is* continuous |
| **Transport value** | A representation in transit between components | Unconstrained by this contract |
| **Storage value** | A representation at rest in a storage engine | Unconstrained by this contract |
| **Canonical integrity value** | The representation that enters canonicalization, hashing, signing, fixtures, or export verification | **Prohibited** |

Continuous quantities are permitted in AION. Their **canonical contract representation**
must be exact and explicitly versioned.

Binary floats may exist freely inside local implementation calculations. They must not
cross a canonical contract boundary without conversion to an approved exact
representation, and the conversion — including its rounding rule — is part of the schema,
not an implementation detail.

### Permitted exact-representation strategies

Per §9, a schema selects one of:

- a bounded canonical decimal string;
- a scaled integer with an explicit declared unit and scale;
- a future versioned exact-decimal contract type, once one exists.

**No universal decimal representation is selected.** CTO-DECISION-003 defers that choice
until sufficient domain evidence exists; picking one now would be guessing against zero
real schemas.

### Mandatory review trigger

When the first production or candidate domain schema models a continuous quantity —
money, probability, measurement, score, geographic coordinate, scientific value, or
statistical output — the schema owner must supply, before that schema is approved:

1. required precision;
2. required scale;
3. permitted range;
4. rounding rule;
5. unit semantics;
6. overflow behaviour;
7. comparison semantics;
8. conversion evidence from the domain representation;
9. cross-runtime fixtures.

That review determines whether the exact representations in §9 remain adequate, or
whether a versioned exact-decimal contract type is required. It is the designated moment
at which this constraint is re-tested against reality rather than argument.

### Boundary with ADR-007

The Universal Object Model is **not** modified to accommodate a numeric encoding. This
rule constrains what may enter a canonical position; it does not change the Object
envelope, its profiles, or its invariants.

## 9. Decimal representation

A fractional quantity is either:

- a **scaled integer** with a schema-declared scale — `confidence: 875` at scale 3 meaning
  0.875 — which keeps it in the integer domain and is preferred; or
- a **decimal string** matching `-?(0|[1-9][0-9]*)(\.[0-9]+)?` with schema-declared
  precision and scale, no exponent, no trailing zeros beyond the declared scale, and no
  leading `+`.

Exactly one form is permitted per field, fixed by the schema. A field must not accept both.

## 10. Negative zero

Rejected. See §6.

## 11. NaN and infinity

Rejected. They have no JSON representation, no total ordering, and no meaningful digest.
A value that could be non-finite must be modelled as an explicit union — for example
`{"kind":"unmeasured"}` versus `{"kind":"value","scaled":875}` — so the absence is data
rather than a sentinel.

## 12. Null versus absent

**Distinct, and both are canonicalizable.** An absent member is not emitted; a `null`
member is emitted as `null`. They produce different bytes and different digests.

Because two encodings must never represent one logical value, a schema declares, per
field, whether the field is required, optional-and-omitted-when-unset, or
optional-and-explicitly-null. A schema that permits both omission and `null` for the same
meaning is invalid.

## 13. Boolean

`true` and `false` literals. No numeric, string, or truthy coercion.

## 14. Timestamps

RFC 3339 UTC strings with a mandatory `Z` designator and **exactly three fractional
digits**, always present: `2026-08-06T05:20:19.000Z`.

Fixed precision is required because `…:19Z`, `…:19.0Z`, and `…:19.000Z` denote one instant
but produce three digests. Leap seconds are rejected. Year is exactly four digits.

### Higher-precision sources — conversion is explicit and lossy

Recorded by [CTO-DECISION-004](../decisions/CTO-DECISION-004-sprint-2.7-authorization.md),
resolving readiness finding NB-7. The syntax and UTC rules above are unchanged; this states
what happens to a source that carries more precision than the canonical position admits.

A microsecond or nanosecond source timestamp is **not directly representable** in a
canonical position. Converting it is:

- **explicit** — a declared conversion step, never an implicit coercion;
- **intentional** — the producer chooses it;
- **potentially lossy** — and must be treated as such;
- **performed before canonical contract validation**; and
- **never performed silently by the canonicalizer.**

When a source timestamp carries precision beyond three fractional digits:

1. Excess fractional digits are **truncated, never rounded.**
2. Truncation **must not move the represented instant forward.** Truncation is therefore
   toward **negative infinity (floor)**, never toward zero. The two coincide only at or
   after the epoch; §14 permits any four-digit year, so pre-epoch instants are representable
   and truncating a negative epoch offset toward zero would move the instant forward.
3. The conversion boundary **must declare that precision was lost.**
4. The original source representation and its precision **must remain available through
   provenance** when operationally, legally, scientifically, or historically material.
5. The resulting three-digit value is then validated normally.
6. `CanonicalContractValidatorV1` **rejects** canonical-position timestamp values carrying
   excess fractional digits. It does not truncate them.
7. The canonicalizer **never** truncates, rounds, repairs, normalizes, or infers timestamp
   precision.

Rounding is prohibited because it can move an instant forward past an event that has not
occurred, and because two implementations rounding half-to-even versus half-away-from-zero
would produce different digests for one source value. Truncation is deterministic in every
runtime.

This mirrors §15: a producer holding a local time converts before the value becomes a
contract value, and the original offset survives as a separate declared field if it carries
meaning. Precision is handled the same way — converted at the producer, declared as lost,
preserved in provenance where it matters.

## 15. Time zone

UTC only. `Z`, never `+00:00`, never a local offset. A producer holding a local time
converts before the value becomes a contract value; the original offset, if it carries
meaning, is a separate declared field.

## 16. Identifier normalization

- UUIDs: canonical lowercase hyphenated form, RFC 9562. Uppercase, braces, and URN prefix
  are rejected rather than folded.
- Namespaced type and relationship identifiers: NFC, case-sensitive, rejected if they do
  not match the declared grammar.
- No identifier is trimmed, lowercased, or otherwise repaired by the canonicalizer.
  Repair hides producer bugs and makes two inputs collide.

## 17. Binary data

**base64url without padding** (RFC 4648 §5), as a string, inside a declared wrapper so a
binary field is never confused with a text field:

```json
{"$b64u": "3q2-7w"}
```

Base64url encoding inflates size by about one third. Large artifacts must **not** be
embedded — they use content-addressed artifact references, and only the reference and its
digest enter the canonical envelope.

## 18. Map and dictionary keys

Keys are strings only. No integer, boolean, null, or composite keys. Keys must be NFC,
non-empty, and must not contain unpaired surrogates. A schema may further restrict a
key grammar; the canonicalizer enforces only the universal rules.

## 19. Duplicate members

**Rejected.** Not last-wins, not first-wins, not merged.

Duplicate-key handling is the classic parser-differential vulnerability: two parsers
disagree about which value survives, one validates and the other acts on different data.
Rejection is the only safe rule.

## 20. Unknown members

**Preserved and canonicalized.** Unknown members are content: ADR-007 requires unknown
valid extensions to survive round trips, and a digest that excluded them would not cover
the data actually stored.

Unknown members are never executed, interpreted, or given semantics. They must satisfy
every universal rule in this contract — a canonicalizer does not relax validation for data
it does not recognise.

## 21–22. Schema and contract-family inclusion

The digest input includes the contract family and the contract/schema version. This is not
decoration: without it, the same bytes under two different schemas produce the same digest,
and a schema-substitution attack becomes free. Inclusion is via dedicated **frame fields**
(§23), not by injecting fields into the value — the value stays exactly what the schema
says it is.

## 23. Domain separation — AION Frame v1

A digest or signature is **never** computed over bare canonical bytes. It is computed over
a framed input.

Delimiter-only framing is **rejected**. Its safety rests on the claim that a separator
byte never occurs inside any field — a claim that depends on a grammar that can later be
widened, and that fails silently when it is. Framing here is length-prefixed and does not
depend on any byte being absent from any field.

### Structure

```text
AionFrame :=
    u32(len(FrameVersion))     || FrameVersion
    u32(len(Purpose))          || Purpose
    u32(len(ProfileId))        || ProfileId
    u32(len(ContractFamily))   || ContractFamily
    u32(len(ContractVersion))  || ContractVersion
    u32(len(Context))          || Context
    u64(len(CanonicalPayload)) || CanonicalPayload
```

Exactly seven fields, always in this order.

### Framing rules

| # | Rule | Value |
|---:|---|---|
| 1 | Length integer encoding | Fixed-width unsigned. `u32` for the six textual fields, `u64` for the payload. **Not** variable-length — a varint admits non-minimal encodings, and two encodings of one length would break injectivity |
| 2 | Byte order | Big-endian (network byte order), for all length fields |
| 3 | Maximum field length | 1024 bytes for each textual field; 16 MiB for `CanonicalPayload`, matching §31 |
| 4 | Zero-length fields | Permitted **only** for `Context`. The other six must be non-empty. A zero length is still unambiguous, so this is a semantic rule, not an injectivity requirement |
| 5 | Text encoding | UTF-8, no BOM, NFC, for all six textual fields |
| 6 | Identifier grammar | `[A-Za-z0-9][A-Za-z0-9._:+-]*` — ASCII only. Framing identifiers deliberately exclude non-ASCII so homoglyph substitution cannot occur in a security label |
| 7 | Duplicate or omitted fields | Impossible by construction: the frame is a fixed seven-field sequence. A field cannot be repeated or omitted. Absence is a parse failure, never a default |
| 8 | Unknown `FrameVersion` | **Fail closed.** Never guessed, never treated as v1 |
| 9 | Truncation | Input shorter than a declared length → reject `frame-truncated` |
| 10 | Overflow | A declared length exceeding its maximum, or exceeding the remaining input, → reject `frame-length-overflow`. Length arithmetic must be performed in a width that cannot wrap |
| 11 | Payload boundary | The payload begins immediately after its `u64` length and extends exactly that many bytes. Bytes remaining after the payload → reject `frame-trailing-bytes` |
| 12 | Total-length prefix | **Not required.** Each field is individually length-prefixed and the field count is fixed, so the total is derivable. A redundant total would introduce a disagreement case with no correct resolution. Trailing-byte rejection (rule 11) provides the same protection without that failure mode |
| 13 | Registered purposes | See below |

### Registered purposes

`Purpose` separates uses that must never share a digest:

| Purpose | Use |
|---|---|
| `aion.object.integrity` | Entity and Relationship snapshot integrity |
| `aion.event.integrity` | Event Object integrity |
| `aion.export.integrity` | Export package and manifest integrity |
| `aion.fixture.digest` | Conformance fixture expected digests |
| `aion.release.artifact` | Release archive and build evidence |
| `aion.signature` | Reserved. Signature design is out of scope (§39) |

A digest produced under one purpose must never be accepted under another. Adding a purpose
is a registry change; reusing one is a contract violation.

### Injectivity

The framing is injective: two distinct field sequences never produce the same framed byte
sequence.

Decoding is a deterministic left inverse of encoding. Given a frame, a parser reads a
fixed-width length, then exactly that many bytes, seven times, with no search and no
lookahead. It therefore recovers exactly the field tuple that was encoded. A function with
a left inverse is injective, so distinct tuples must produce distinct byte strings.

Critically, this argument depends on **no** property of the field contents — not on a byte
being absent, not on a grammar, not on an encoding. Rules 4 and 6 exist for semantic and
anti-homoglyph reasons; injectivity does not rest on them.

### Adversarial examples

Each case is unambiguous under this framing.

**Boundary shifting** — the classic delimiter failure. With a delimiter that can be
omitted or escaped, `("ab","c")` and `("a","bc")` can both render as `abc`. Length-prefixed:

```text
("ab","c") -> 00000002 "ab" 00000001 "c"
("a","bc") -> 00000001 "a"  00000002 "bc"
```

Different byte sequences. No collision is constructible.

**NUL bytes.** A payload containing `0x00` is length-delimited, so it cannot terminate a
field early. Under the previous `0x00`-separated design this was the entire attack.

**Delimiter-like text.** `Context = "aion.object.integrity.v1:org.aion.task:3"` is just
bytes with a length. It cannot be misread as additional fields.

**Unicode payloads.** Canonical payloads are arbitrary UTF-8 including astral-plane
characters; the `u64` length governs the boundary. Framing identifiers stay ASCII (rule 6),
so a Cyrillic `а` cannot impersonate a Latin `a` in a purpose or profile name.

**Empty strings.** `Context = ""` encodes as `00000000` with no bytes. It is distinct from
any non-empty context and cannot be confused with an omitted field, because fields cannot
be omitted (rule 7).

**Embedded profile names.** `Purpose = "aion.object.integrity"` with `ProfileId = "acj-1"`
is distinct from any single field containing `"aion.object.integrityacj-1"`, because the
two are separated by their own lengths rather than by a discoverable marker.

**Version-looking strings.** `ContractVersion = "1"` and a `Context` beginning `"1"` occupy
different framed positions. Position is fixed by the field order, not inferred from content.

### Prohibition

Computing a digest or signature over bare canonical bytes, or over any framing other than
this one, is a contract violation — not an optimisation. It is exactly what makes
cross-protocol digest reuse possible.

Framing defines the bytes only. It performs no hashing and no signing, and this contract
implements neither.

## 24. Content type and profile identifiers

- Profile: `acj-1`. Advances to `acj-2` on any change to §1–§20.
- Media type for a canonical document: `application/json` with parameter
  `profile="acj-1"`. The profile parameter is required wherever the bytes are transported
  or stored as a canonical form.

## 25–27. Whitespace, escaping, newlines

No whitespace anywhere: no indentation, no space after `:` or `,`, no leading or trailing
whitespace. No trailing newline — a canonical document is exactly its bytes, and a
trailing `\n` changes the digest.

Escaping is §5 and nothing more. Literal newlines inside strings are escaped as `\n`;
`\r\n` is **not** normalized to `\n` — that would silently alter content. A producer that
wants normalized line endings normalizes before the value becomes a contract value.

## 28. Canonical byte encoding

UTF-8, no BOM, no trailing newline. The canonical form is a byte string, not a text
string: comparison, hashing, and storage operate on bytes. An implementation that
round-trips through a host string type must guarantee the byte sequence is unchanged.

## 29–31. Canonicalizer limits

These are **safety limits on the canonicalizer**, distinct from the business limits owned
by DG-4. DG-4 limits must be less than or equal to these; a value the Object contract
permits must always be canonicalizable.

| Limit | Value | Purpose |
|---|---:|---|
| Maximum nesting depth | 64 | Bounds recursion and stack exhaustion |
| Maximum members per object | 4096 | Bounds sort cost |
| Maximum array elements | 65536 | Bounds traversal |
| Maximum string length | 1 MiB encoded | Bounds allocation |
| Maximum total canonical size | 16 MiB | Bounds whole-document cost |

Exceeding any limit is a deterministic rejection, never a truncation.

## 32. Streaming

Full streaming is **not** achievable: member sorting requires all members of an object to
be known before any is emitted. ACJ-1 is therefore bounded-buffer, not streaming, and the
§29–§31 limits exist partly to bound that buffer.

Digest computation over the produced bytes may stream. Large content stays outside the
envelope (§17), so the bounded-buffer property is not a practical constraint on artifact
size — only on envelope size.

## 33. Deterministic error behaviour

Rejection is part of the contract. Two conforming implementations reject the same input
for the same stated reason. Error categories:

| Category | Cause |
|---|---|
| `unsupported-value-kind` | Float, NaN, Infinity, `-0`, or a non-domain type |
| `integer-out-of-range` | Outside ±(2^53 − 1) |
| `invalid-string` | Non-NFC, lone surrogate, or invalid scalar value |
| `duplicate-member` | Repeated member name |
| `invalid-key` | Non-string, empty, or malformed key |
| `limit-exceeded` | §29–§31 |
| `invalid-timestamp` | Wrong precision, offset, or leap second — including a canonical-position value carrying more than three fractional digits, which is rejected and never truncated (§14) |
| `invalid-identifier` | Identifier fails §16 |
| `unvalidated-input` | Canonicalization attempted on a value not validated against a named schema and profile (§0) |
| `missing-frame` | Digest or signature attempted without AION Frame domain separation (§23) |
| `unknown-frame-version` | `FrameVersion` not recognised — fails closed |
| `frame-truncated` | Input shorter than a declared field length |
| `frame-length-overflow` | Declared length exceeds its maximum or the remaining input |
| `frame-trailing-bytes` | Bytes remain after the declared payload |
| `unregistered-purpose` | `Purpose` is not a registered value |

Errors name the category and the location. They must not echo the offending content, which
would turn an error channel into a disclosure channel.

## 34. Cross-runtime reproducibility

Two implementations conform only when they agree byte-for-byte on the full fixture set,
including every rejection case. Agreement on accepted values alone is insufficient: an
implementation that accepts a float and produces plausible bytes is non-conforming even if
it never sees one in practice.

## 35. Forward and backward compatibility

- Adding a member changes the canonical bytes and therefore the digest. This is correct:
  the content changed.
- A reader encountering an unknown profile identifier **fails closed**. It never guesses.
- A digest is only ever compared against a digest computed under the same frame version,
  purpose, profile, and algorithm. Comparing across any of them is a contract violation.
- Retained digests remain valid indefinitely under the profile that produced them. A new
  profile never invalidates an old digest; it produces a different one.

## 36. Profile migration

Migrating from `acj-N` to `acj-N+1` re-canonicalizes and recomputes digests. Both
descriptors are retained during the migration window so historical verification remains
possible.

A profile migration **does not** change content, so it must not change any Object's
revision. It is recorded as a profile-migration event carrying old and new integrity
descriptors. Any implementation that cannot verify an old digest under the old profile
must retain an archival verifier rather than declaring old data unverifiable.

## 37. Algorithm agility

The digest algorithm is named in the descriptor and resolved through a registry. `sha-256`
is the initial registered algorithm and is **not** a contract constant.

Adding an algorithm is additive. An unknown algorithm identifier fails closed — it is never
treated as "probably sha-256".

### Retirement over immutable and destroyed records

Retiring an algorithm requires a deprecation window and re-digesting of retained content
**where re-digesting is possible**. It is not always possible, and this contract does not
claim otherwise:

- **Mutable Entity and Relationship Objects** can be re-digested on their next committed
  revision, or by an explicit migration.
- **Version and Event Objects are immutable by ADR-007 invariant.** They cannot be
  re-digested without violating that invariant. A retired algorithm protecting them
  requires a retained **archival verifier**; their digests are never recomputed.
- **Destroyed content cannot be re-digested at all**, because the content no longer
  exists. Only the destruction certificate's own digest remains within reach.

An archival verifier for a weakened algorithm is a liability, not agility: it must be
retained, scoped strictly to historical verification, and must never be selectable for new
digests. Retirement policy must state, per algorithm, what happens to immutable records
already protected by it. Deciding that policy is a subordinate decision, not something this
contract resolves.

## 38. Digest descriptor

```json
{
  "frameVersion": "1",
  "purpose": "aion.object.integrity",
  "canonicalizationProfile": "acj-1",
  "algorithm": "sha-256",
  "digest": "371654f3…",
  "contractFamily": "aion.object",
  "contractVersion": "1",
  "schemaId": "…",
  "schemaVersion": 3,
  "context": "org.aion.task:3"
}
```

Every field is required except `context`, which may be empty (§23 rule 4). `digest` is
lowercase hex.

The descriptor carries every input needed to **reconstruct the frame and reproduce
verification**: frame version, purpose, profile, contract family, contract version, and
context are exactly the six textual frame fields, and the payload is the canonical form of
the content being verified. A verifier never has to infer a missing field, and never
substitutes a default for one.

This descriptor replaces the fixed `{contentHash, algorithm: "sha-256"}` shape of the
superseded API contract.

## 39. Signature descriptor boundary

Out of scope. ACJ-1 defines only **what bytes a signature would cover**: the §23 AION
Frame, with `Purpose` set to a signature purpose, not the raw canonical bytes. A signature
therefore inherits the same injective domain separation as a digest, and a signature over
one purpose can never be replayed as a signature over another.

A signature descriptor — key identity, algorithm, trust root, validity, revocation — is a
separate future decision. Until it exists:

> A digest detects accidental or unauthorized modification by a party who cannot also
> rewrite the digest. It proves nothing about who produced the content. An attacker who
> can change stored content can normally recompute a stored digest.

## 40. Fixture requirements

Fixtures are the only proof of conformance. Each must carry the source contract value, the
expected canonical byte sequence, the expected framed digest input and digest under at
least one registered algorithm, the expected validation outcome, the applicable contract
and profile version, and a rationale for why the case exists.

Framing fixtures are required alongside value fixtures: the adversarial cases in §23 —
boundary shifting, NUL bytes, delimiter-like text, empty context, embedded profile names,
version-looking strings — must each have a fixture proving the framed bytes are distinct.

Rejection fixtures are as important as acceptance fixtures — an implementation that
accepts what it must reject is non-conforming. The full plan is in the
[Sprint 2.6 specification](../sprints/sprint-2.6-canonical-serialization/specification.md).

Fixtures are **not** produced by this contract. DG-3 remains blocked until ADR-008 is
accepted.
