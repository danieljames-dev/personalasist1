# Contract Fixture Corpus Threat Model

Status: **Accepted** alongside
[ADR-009](../decisions/ADR-009-contract-fixture-corpus.md), 2026-08-06  
Scope: AFX-1 corpus format, organization, and conformance evidence only  
Implementation: **Not authorized.** No fixture, loader, or harness exists.  
Normative fixtures: **Not authorized** — seven-condition gate,
[fixture contract §11.1](../contracts/contract-fixture-corpus.md#111-normative-fixture-authorization-gate)

## What a fixture corpus does not prove

Stated first, because the most dangerous property of a corpus is the confidence it creates.

A passing corpus proves that the implementations tested agree, on the cases someone thought
to write down, at the moment the run happened.

It does **not** prove implementation **security**. It does not prove **authorization** for
production. It does not replace **threat modelling**. It does not replace **independent
implementations** — one runtime testing itself proves only self-consistency. It does not
replace **production monitoring**.

The corpus is evidence of agreement, not evidence of correctness. Two implementations can
agree and both be wrong, which is exactly what happens when one was used to generate the
other's expected values.

## Control status vocabulary

- **Structural** — holds as a property of the format; no runtime code required.
- **Specified** — a contract requirement with no implementation. Defends nothing today.
- **Process** — a human or governance control.

**No control below is implemented.** No fixture, loader, or harness exists.

## Trust boundaries

| Boundary | Rule |
|---|---|
| Fixture author to corpus | Fixture content is untrusted until reviewed; an author can encode a wrong expectation as easily as a right one |
| Corpus to harness | The manifest is authoritative; the filesystem is not |
| Harness to implementation | The implementation under test is untrusted and must never be the source of an expected value |
| Corpus release to consumer | A release is untrusted until version and checksum are verified offline |
| Implementation A to implementation B | Each must be independent of the other; independence is verified by inspection, never asserted |

## Threats and required controls

| # | Threat | Attack or failure | Required control |
|---:|---|---|---|
| 1 | **Fixture tampering** | Corpus edited so a broken implementation passes | Manifest carries a checksum per fixture file; releases pinned by version and checksum; append-only IDs. **Specified** |
| 2 | **Expected-output substitution** | An expected digest or byte string is quietly replaced | Changing the assertion tuple requires a **new fixture ID**; the old fixture is retained. An in-place expectation edit is a corpus violation. **Structural** |
| 3 | **Malicious sidecar paths** | Fixture references `../../etc/...` | **Sidecars prohibited** (contract §1). Unrepresentable. **Structural** |
| 4 | **Path traversal** | Relative path escapes the corpus root | Same. No fixture may reference an external file. **Structural** |
| 5 | **Absolute-path injection** | `C:\...` or `/etc/...` in a record | Same, plus no machine-specific absolute paths anywhere. **Structural** |
| 6 | **Symlink / Windows junction abuse** | A path resolves outside the tree, or to a device | Same. Additionally `core.symlinks=false` in this repo already blocks symlink materialization. **Structural** |
| 7 | **Oversized fixture files** | A multi-gigabyte fixture exhausts the loader | 4096-byte literal cap; larger sources use closed generator recipes with integer-only arguments. **Specified** |
| 8 | **Excessive nesting** | Deeply nested fixture JSON exhausts the loader's own parser | The loader is subject to the same depth limits it tests; recipes express depth without nesting the corpus file. **Specified** |
| 9 | **Decompression bombs** | An archive expands to exhaust disk | Archives are **not** part of AFX-1. If introduced later, a decompressed-size bound and a ratio bound are required first. **Process** |
| 10 | **Parser differential attacks** | A crafted input is read differently by two parsers | Entry-B fixtures carry hex bytes, so both implementations receive **identical bytes**; the fixture is precisely the artifact that exposes the differential. **Structural** |
| 11 | **Unicode confusables** | Two visually identical fixture IDs, tags, or rule anchors | Fixture IDs restricted to `AFX-<FAMILY>-<digits>`, ASCII only. Payload confusables remain out of reach — see residuals. **Structural (IDs only)** |
| 12 | **Duplicate members hidden by host parsers** | The corpus file itself carries two `expectation` members; a host parser keeps the last, and review sees one | The loader performs **its own** duplicate-key rejection on fixture files and must not rely on the host parser or on ACJ-1 §19, which is enforced by an unimplemented validator. **Specified** |
| 13 | **Line-ending conversion** | `\r\n` becomes `\n` in an authoritative artifact | Bytes are hex inside a JSON string; the file's own line endings are irrelevant to the encoded bytes. **Structural** |
| 14 | **Git autocrlf altering authoritative bytes** | Verified in this repo: `a\r\nb` and `a\nb` hash identically through `git hash-object --path=…`, silently, because `core.safecrlf` is unset | Sidecars prohibited; hex is unaffected by text conversion. **Structural** |
| 15 | **Byte-order marks** | An editor prepends `EF BB BF` to a fixture file | A BOM in the fixture file cannot alter hex-encoded bytes. A BOM *under test* is expressed as hex. Fixture files are UTF-8 without BOM; a BOM is a load error. **Structural + Specified** |
| 16 | **Stale schema references** | A fixture targets a schema version that no longer exists | `subjectBinding` is part of the assertion tuple; changing it requires a new ID. Unresolvable bindings are a hard load error. **Specified** |
| 17 | **Stale profile references** | A fixture claims `acj-1` after `acj-2` supersedes it | Profile migration produces **paired** fixtures; the `acj-1` fixture is retained deliberately as historical evidence, not stale. **Structural** |
| 18 | **Unsupported digest algorithms** | A fixture names an algorithm the runtime lacks | Algorithm named explicitly, resolved through ACJ-1 §37, unknown identifiers **fail closed**. Never inferred. **Specified** |
| 19 | **Algorithm downgrade** | A weakened algorithm is substituted in expected values | `digestAlgorithm` is inside the assertion tuple; changing it requires a new fixture ID and review. **Structural** |
| 20 | **Digest confusion** | A corpus checksum is compared against an ACJ-1 digest, or vice versa | The corpus field is named `checksum`, never `digest`, and the contract forbids substituting one for the other. ACJ-1 digests appear only in `expectedDigest` with full frame fields. **Structural** |
| 21 | **Fixture ID collision** | Two fixtures share an ID | Append-only per-family ledger; duplicate IDs are a hard manifest error. **Specified** |
| 22 | **Duplicate fixture IDs in the manifest** | Two entries, one silently shadowed | Manifest duplicate detection is a hard error, not a warning. **Specified** |
| 23 | **Acceptance marked as rejection, or vice versa** | An inverted fixture makes broken behaviour look correct | Closed discriminated union: the `expectation` tag selects the permitted field set, so an inverted fixture is structurally malformed rather than plausible. Still requires review to catch a *deliberately* inverted but well-formed record. **Structural + Process** |
| 24 | **Omitted negative cases** | Only acceptance fixtures exist; an over-permissive implementation passes everything | Rejection fixtures are first-class; a release where any coverage area lacks one is **incomplete** and fails its completeness check. **Specified** |
| 25 | **Test harnesses ignoring failures** | Failures logged but exit code 0 | Run asserts executed-count equals manifest-count and fails loudly otherwise. **Specified** |
| 26 | **Tests comparing text rather than bytes** | Harness decodes to strings before comparing, silently passing mismatched line endings, BOMs, and normalization — the exact defects the corpus exists to catch | Comparison MUST be on bytes. This is the most likely harness bug and the hardest to notice, because the suite still goes green. **Specified** |
| 27 | **Environment-dependent encodings** | PowerShell `Set-Content` writes ANSI; a fixture is corrupted on write | Fixture files are UTF-8 no-BOM; hex is ASCII-safe under every codepage, so even a mis-encoded write cannot alter the decoded bytes. **Structural** |
| 28 | **Locale-dependent number or date handling** | A loader parses `1,5` or a localized date | The corpus carries no floats (ACJ-1 §8) and timestamps are fixed-syntax strings; instants in `precisionLoss` are exact integers, not parsed dates. **Structural** |
| 29 | **Private or owner data entering the corpus** | Résumé, email, calendar, or contact content used as a "realistic" fixture | Hard prohibition with no exception path; `sourceProvenance` must be `synthetic`, `derived-from-spec-example`, or `derived-from-external-standard` with citation. Review must reject anything else. **Specified + Process** |
| 30 | **Secrets entering fixtures** | A token used as a sample string | Same prohibition; corpus is public-by-intent, so any secret in it is compromised on commit. **Process** |
| 31 | **Corpus release rollback** | An older, weaker release is substituted | Releases pinned by version **and** checksum; the ratchet requires per-class and per-rule counts to not decrease against the prior manifest, so a rollback fails the check. **Specified** |
| 32 | **Compromised corpus distribution** | A tampered release is fetched | Offline verification against pinned checksums; no network dependency in the verification path. **Specified** |
| 33 | **Unreviewed illustrative fixtures treated as normative** | An example is promoted by accident | `status` is mandatory; demoting or promoting is governance-controlled and requires the same review as a supersession. **Specified + Process** |
| 34 | **Denial of service through corpus size** | The corpus grows until runs are unaffordable | Literal cap, recipe mechanism, and per-release counts; growth is visible in the manifest. **Specified** |
| 35 | **False confidence from one runtime testing itself** | Implementation A generates expected values; A is later "verified" against them | `expectedValueProvenance` forbids a value produced by the implementation under test; independence is verified by dependency inspection, not asserted. A single-runtime run may never be reported as cross-runtime agreement. **Specified + Process** |
| 36 | **Vacuous pass** | Empty corpus, unresolvable manifest, or a filter matching nothing — `node --test` with zero files exits 0 | Executed-count must equal manifest-count and exceed zero; ratchet floors must be met; run fails loudly if it cannot establish them. **Specified** |
| 37 | **Silent coverage deletion** | The only fixture covering a load-bearing rule is removed, or demoted to `illustrative`, and the suite stays green | `coversRules` anchors plus monotonic non-decrease against the prior manifest; `status` demotion is governance-controlled. **Specified** |
| 38 | **Wrong expected value** | A hand-computed digest is wrong; a correct implementation fails and a matching wrong one passes | `expectedValueProvenance` names how the value was obtained and forbids circular derivation. This is a **process** control and the corpus's weakest link. **Process** |
| 39 | **Rejection-everything implementation** | An implementation that rejects all input scores perfectly on a rejection corpus | Rejecting **earlier** than the declared stage is a conformance failure, and acceptance fixtures must pass. **Specified** |

## Residual risks accepted

- **Nothing is implemented.** Every control is structural, specified, or process. Structural
  controls hold as format properties; specified controls defend nothing until a loader and
  harness exist, and neither is authorized.
- **Wrong expected values are only caught by review** (threat 38). No structural mechanism
  can tell a correct digest from a plausible wrong one. This is why
  `expectedValueProvenance` and cross-implementation agreement both exist, and why neither
  alone is sufficient.
- **Unicode confusables in payloads remain out of reach.** Fixture IDs are ASCII-restricted;
  the values under test are not, and must not be — testing confusables is part of the point.
- **A deliberately inverted but well-formed fixture** passes structural checks. Only review
  catches it.
- **Two independent implementations can still share a misreading** of the specification.
  Agreement is evidence, not proof.

## Verification requirements before DG-3 closure

See [contract-fixture-corpus.md §11](../contracts/contract-fixture-corpus.md#11-cross-runtime-conformance-evidence).
Summarised: two genuinely independent implementations; neither using the other as encoder,
oracle, or reference, verified by inspection; exact canonical-byte, framed-byte, and digest
agreement; matching rejection stage and error category; corpus pinned by version and
checksum; reproducible on a clean environment; evidence machine- and human-readable;
comparison on bytes, not text.

## Residual decisions

1. The required-rule inventory and the initial ratchet floor.
2. The generator-recipe constructor set beyond the initial four.
3. The second runtime, and how independence is verified.
4. Error-category granularity at S0, where two JSON parsers will not naturally agree.
5. Whether `illustrative` fixtures share a tree with `normative` ones.
6. Whether archives are ever admitted, and the size and ratio bounds if so.

No test implementation is authorized by this threat model.
