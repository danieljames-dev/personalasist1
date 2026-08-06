# Canonical Serialization Threat Model

Status: **Accepted** alongside
[ADR-008](../decisions/ADR-008-canonical-serialization.md), 2026-08-06  
Scope: ACJ-1 profile, validation boundary, and frame construction only  
Implementation: Not authorized; freeze in effect

## Control status vocabulary

Every control below is one of two things, and the distinction is load-bearing:

- **Specified** — defined in a contract, with no implementation. It constrains what a
  future implementation must do. It defends nothing today.
- **Structural** — a property of the design itself that holds without runtime code, such
  as framing injectivity or the exclusion of a value kind from the domain.

There are **no implemented controls**. Nothing in this threat model is running.

Controls that depend on `CanonicalContractValidatorV1`
([contract §0](../contracts/canonical-serialization.md#0-validation-boundary--canonicalcontractvalidatorv1))
are marked **specified — depends on validator**. That component does not exist.

## What canonical serialization does not provide

Stated first, because most failures in this area come from assuming otherwise.

ACJ-1 provides **integrity evidence**: it detects that content differs from content whose
digest was recorded, by a party who could not also rewrite the digest.

It provides **no authenticity** — a digest names no producer. **No confidentiality** — the
canonical form is plaintext. **No trust** — a valid digest says nothing about whether the
content should be believed. **No authorization** — possessing or recomputing a digest
grants nothing. **No freshness** — a digest cannot distinguish current content from a
correctly-digested replay of old content.

An attacker who can modify stored content can usually recompute the stored digest. Digests
are only meaningful where the digest is protected by something the content is not:
transport, storage separation, signing, or an append-only witness.

## Assets

Canonical byte sequences; digest values and descriptors; domain labels; the profile and
algorithm registries; fixtures and their expected outputs; the validation boundary that
enforces NFC and the value domain.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Producer to canonicalizer | Input is untrusted. Validation precedes canonicalization and rejects rather than repairs |
| Canonicalizer to digest | Bytes are trusted only within one profile. Cross-profile comparison is a violation |
| Digest to verifier | A matching digest proves byte equality and nothing more |
| Fixture to implementation | Fixtures are supply-chain input; a malicious fixture can certify a broken implementation |
| Profile/algorithm registry | Registry entries are security-relevant configuration, not data |

## Threats and required controls

| # | Threat | Attack or failure | Required control |
|---:|---|---|---|
| 1 | **Parser differential** | Validator and consumer parse the same bytes differently; one sees safe content, the other acts on different content | Single strict value domain (§1) and a named validation boundary that rejects rather than repairs (§0). **Specified — depends on validator.** Structural element: the value domain is closed, so an ambiguous kind cannot enter by design |
| 2 | **Duplicate keys** | `{"owner":"a","owner":"b"}` — one parser takes first, another takes last; validation and action disagree | Duplicate members rejected outright (§19); the canonicalizer is forbidden from removing them (§0). **Specified — depends on validator** |
| 3 | **Unicode confusables** | Visually identical type names, keys, or identifiers using different scripts (Cyrillic `а` for Latin `a`) pass human review as equal | **Not solvable here.** Canonicalization makes two different strings hash differently, which is correct and useless against a human reading two identical-looking names. Identifier grammar and namespace ownership carry this load. *Partially structural* for framing only: §23 rule 6 restricts frame identifiers to ASCII, so a security label cannot be homoglyphed. Payload and schema identifiers remain exposed |
| 4 | **Normalization mismatch** | NFC and NFD forms of one string hash differently while rendering identically | NFC is required (§4) and verified by the validation boundary. The canonicalizer never normalizes, so the rule cannot be satisfied by repair. **Specified — depends on validator.** No runtime control exists today; a non-NFC string reaching a canonical position would produce a divergent digest with nothing to stop it |
| 5 | **Numeric ambiguity** | `1.0` vs `1`, `1e2` vs `100`, precision loss above 2^53, `-0` vs `0` | **Structural.** Integers only, in a range exactly representable as doubles (§6–§7); binary floats, exponents, and `-0` excluded from the value domain (§8, §10); decimals as declared-scale integers or bounded strings (§9). The ambiguous cases cannot be expressed, so no runtime check is needed to exclude them |
| 6 | **Hash confusion** | A digest computed for one purpose is accepted for another — an event digest passed as an Object digest | **Structural.** `Purpose` is a mandatory registered frame field (§23), and framing is injective regardless of content. A frame built for `aion.event.integrity` cannot equal one built for `aion.object.integrity` |
| 7 | **Cross-protocol attack** | Content valid in two contexts produces one digest that both accept | **Structural.** Purpose, profile, contract family, contract version, and context each occupy a distinct length-prefixed frame field (§21–§23). Boundary-shifting collisions of the form `("ab","c")` vs `("a","bc")` are not constructible |
| 8 | **Frame omission** | Implementation "optimises" by hashing canonical bytes directly, silently reopening #6 and #7 | `missing-frame` is a named rejection category (§33) and a required rejection fixture. Omission is a conformance failure, not a performance choice. **Specified** |
| 8a | **Frame parsing attack** | Crafted lengths cause truncated reads, integer overflow, or trailing-byte smuggling | `frame-truncated`, `frame-length-overflow`, `frame-trailing-bytes`, and `unknown-frame-version` are named deterministic rejections; length arithmetic must use a width that cannot wrap (§23 rules 8–11). **Specified** |
| 9 | **Algorithm downgrade** | Attacker presents a descriptor naming a weak or withdrawn algorithm and the verifier complies | Algorithm resolved through a registry; unknown or retired identifiers fail closed (§37). A verifier never infers `sha-256` from an absent or unrecognised field |
| 10 | **Signature wrapping** | Signature covers a subset or a re-serialization of what the verifier interprets | Signatures cover the §23 AION Frame with a signature `Purpose` — not raw bytes, not a parsed object (§39). Full signature design is deferred, and this constraint is fixed now so it cannot be designed away later |
| 11 | **Canonicalization denial of service** | Adversarial input forces pathological sorting, allocation, or recursion | Hard limits on depth, member count, array length, string size, total size (§29–§31); deterministic rejection, never truncation |
| 12 | **Excessive nesting** | Deeply nested structure exhausts the stack during recursive descent | Depth limit 64, enforced during parse rather than after |
| 13 | **Oversized values** | Multi-gigabyte string or document exhausts memory, worsened by bounded-buffer sorting | String and total-size limits; large content excluded from envelopes via content-addressed references (§17) |
| 14 | **Malicious fixtures** | A crafted fixture certifies a non-conforming implementation as conforming, or a fixture's "expected" digest encodes a weakness | Fixtures are reviewed artifacts under change control, cross-checked against an independent JCS implementation, and must include rejection cases. A fixture set that only tests acceptance cannot detect an over-permissive implementation |
| 15 | **Ambiguous timestamp interpretation** | `…:19Z`, `…:19.0Z`, `…:19.000Z` denote one instant, three digests; local offsets or leap seconds admit more | Exactly three fractional digits, mandatory `Z`, UTC only, leap seconds rejected (§14–§15) |
| 16 | **Schema substitution** | Identical bytes reinterpreted under a different schema; digest still matches | Schema identity and version bound into the domain label (§21–§23) |
| 17 | **Version confusion** | Digest produced under `acj-1` compared against one produced under `acj-2` | Profile identifier in every descriptor; cross-profile comparison prohibited; unknown profile fails closed (§35) |
| 18 | **Digest comparison timing** | Byte-by-byte early-exit comparison leaks a prefix, enabling incremental forgery where an attacker can submit candidates and observe outcomes | Constant-time comparison for any digest an untrusted party can influence and whose result they can observe. For purely local integrity checks the risk is low, but the requirement is stated so implementations do not have to rediscover it |

## Residual risks accepted

- **No control here is implemented.** Every entry above is specified or structural.
  Structural controls hold as design properties; specified controls defend nothing until
  `CanonicalContractValidatorV1` and a canonicalizer exist. Both are unauthorized.
- **The validator gap is the largest residual.** Threats 1, 2, and 4 depend entirely on a
  component that does not exist. Until it does, a non-NFC string, a duplicate key, or a
  float could reach a canonical position with nothing to reject it.
- **Unicode confusables (#3) are not solved here.** ACJ-1 makes two different strings hash
  differently, which is correct, but it cannot make a human notice that two strings look
  identical. Frame identifiers are ASCII-restricted; payload and schema identifiers are
  not, and namespace ownership carries that load.
- **A digest without a signature proves nothing about origin.** Until the signature
  decision exists, integrity is only as strong as the protection around the stored digest.
- **Bounded-buffer canonicalization** means a conforming implementation must hold a whole
  document in memory. The limits bound it; they do not eliminate it.
- **The float prohibition shifts risk to schema authors.** A schema that models a
  fractional quantity incorrectly — wrong scale, ambiguous rounding — produces wrong data
  that canonicalizes perfectly. ACJ-1 removes encoding ambiguity, not modelling error.

## Verification requirements before release

- Byte-for-byte agreement between at least two independent implementations across the full
  fixture set, including every rejection case.
- Cross-check of accepted values against an unmodified third-party JCS implementation, to
  confirm the subset relationship actually holds.
- Property tests over key ordering with characters outside the Basic Multilingual Plane,
  which is where code-unit versus code-point sorting diverges.
- Fuzzing for depth, size, duplicate keys, invalid UTF-8, lone surrogates, and non-NFC
  input, asserting deterministic rejection rather than crash or acceptance.
- Proof that no rejection message echoes input content.
- Proof that digest verification never falls back to a default algorithm or profile.

No test implementation is authorized by this threat model.

## Residual decisions carried past DG-2 closure

DG-2 closed on 2026-08-06 with ADR-008's acceptance: a canonicalization profile, a
validation boundary, and an injective framing contract now exist. The following are
**not** closed by that, and each blocks specific later work rather than DG-2 itself.

1. Exact decimal representation, decided at the contract §8 continuous-quantity trigger.
2. Registered digest algorithm set and the add/retire process.
3. Signature and trust architecture, including key rotation against retained digests.
4. Algorithm retirement over immutable Version and Event Objects, and over Destroyed
   content that cannot be re-digested at all.
5. Boundary between canonicalizer limits (§29–§31) and DG-4 business limits; the current
   values are provisional pending DG-4 measurement.
6. Whether constant-time comparison is mandatory everywhere or only where an untrusted
   party influences input and observes the outcome.

Implementing `CanonicalContractValidatorV1` is implementation, not a residual decision,
and remains unauthorized.
