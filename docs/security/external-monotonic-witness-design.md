# External Monotonic Witness — Design Note (R6.3)

**Status:** Design only. **Not implemented** in R6.3.  
**Scope:** Detect complete signed-anchor rollback that local ledger enumeration cannot see.  
**Related:** IA-28 local tip enumeration; Owner Authority V2 residual limitation.

## Problem statement

Local authority verification inspects **surviving on-disk evidence**:

- `current.json` epoch/digest/anchorId
- every present ledger file under `ledger/`
- contiguous epochs `1..N`
- chain digests, Ed25519 signatures, `ownerKeyId`, `previousRecordDigest`

That is sufficient to refuse:

- stale current while any higher ledger epoch still exists
- ledger gaps (e.g. epochs `1,3`)
- Claude’s IA-28 attack (delete immediate successor, keep a higher epoch, roll current back)

It is **not** sufficient when an attacker with local filesystem control performs a
**complete anchor rollback**:

1. delete ledger records `2..N`
2. rewrite `current.json` to a previously valid epoch-1 tip
3. leave a cryptographically perfect, internally consistent older chain

Local verification then correctly reports the older tip as valid. There is no
remaining local evidence that epochs `2..N` ever existed. This limitation is
intentional and documented; R6.3 does **not** claim to solve it.

## Design goals for a future witness

1. **Detect complete signed-anchor rollback** after the fact (or prevent WRITER
   acceptance under rollback).
2. **Fail closed** when the witness is unavailable, untrusted, or disagrees.
3. **Remain external** to the mutable portable anchor (same principle as the
   trusted Owner verification key).
4. **Not grant WRITER** by itself — only constrain which signed tip may be accepted.
5. **Minimize online dependency** where practical for a local-first system.
6. **Avoid false confidence** from software-only counters on the same host.

## Candidate designs

### A. TPM-backed monotonic counter / NV index

**Idea:** On each successful Owner-signed authority transition, increment a TPM
NV monotonic counter (or write a TPM-sealed epoch/digest tuple). At verify time,
require `tip.epoch >= tpmCounter` and preferably bind `recordDigest`.

| Pros | Cons |
|---|---|
| Hardware-rooted; hard to roll back without TPM owner compromise | Platform-specific (Windows TPM stack, PCR policy, owner auth) |
| Works offline after provisioning | Desktop must have ready TPM; migration/export is non-trivial |
| Natural fit for “this machine’s” authority | Cloning disk does not clone TPM NV; re-provisioning needs Owner ceremony |
| No network | Attestation policy and recovery paths are complex |

**Fit:** Strong for single-machine primary hosts once TPM readiness is verified.

### B. Remote append-only witness log

**Idea:** After each signed transition, append `{anchorId, epoch, recordDigest,
ownerKeyId, issuedAt, signature}` to an append-only remote log (e.g. transparency
log, WORM object store, or signed log service). Verify requires remote max epoch
for `anchorId` to equal local tip.

| Pros | Cons |
|---|---|
| Survives full local disk rewrite | Requires network at verify (or cached last-seen with careful staleness rules) |
| Independent storage domain | Availability and trust in the log operator |
| Multi-device visibility | Privacy: metadata leakage of authority events |
| Natural audit trail | Must not become a second writer authority |

**Fit:** Strong when multi-host cutover and auditability matter.

### C. Hardware security key / smartcard counter

**Idea:** Owner signs transitions only through a hardware key that also maintains
an internal monotonic application counter, or returns a signed counter ticket
bound to `recordDigest`.

| Pros | Cons |
|---|---|
| Owner-held; portable across machines | Requires hardware present for every transition |
| Strong phishing resistance if combined with user presence | Operational friction; lost-key recovery |
| Clear human ceremony | Counter backup/export is a new design surface |

**Fit:** Excellent for high-assurance Owner ceremonies; heavier for routine use.

### D. Independent signed checkpoint service

**Idea:** A small online service stores the latest Owner-signed checkpoint
`{anchorId, epoch, recordDigest}` and serves it for verify. Only the Owner
signing key may advance the checkpoint.

| Pros | Cons |
|---|---|
| Simple protocol | Service availability becomes a dependency |
| Easy to reason about | Must not accept unsigned or V1/manifest claims |
| Can sit beside existing trust material | Needs authn, rate limits, and backup of service state |

**Fit:** Pragmatic mid-term if a private Owner-controlled endpoint exists.

### E. Second offline medium (air-gapped witness file on external media)

**Idea:** After each transition, write an Owner-signed witness receipt to
Owner-controlled external media not left with the primary host.

| Pros | Cons |
|---|---|
| No always-on network | Easy to skip operationally |
| Simple cryptography | Incomplete if media is absent at verify |
| Cheap | Not continuous monitoring |

**Fit:** Useful as a human backup, weak as sole automated control.

## Comparison (summary)

| Design | Rollback detection | Offline | Hardware | Ops burden | Multi-host |
|---|---|---|---|---|---|
| A TPM NV counter | Strong on that host | Yes | TPM | Medium–High | Weak (per machine) |
| B Remote append-only log | Strong | Partial | No | Medium | Strong |
| C Hardware key counter | Strong | Yes* | Yes | High | Strong with key |
| D Signed checkpoint service | Strong | No | No | Medium | Strong |
| E External media receipt | Medium | Yes | No | High (human) | Medium |

\*offline after key present

## Recommendation (for a future authorized milestone)

**Primary recommendation: A (TPM-backed monotonic NV counter) as the on-host
gate, with B (remote append-only witness) as an optional multi-host / audit
complement.**

Rationale for AION’s current trajectory:

1. Desktop is the intended future primary candidate; R6.3 already measures TPM,
   BitLocker, Secure Boot, and VBS ground truth before real authority init.
2. Complete-anchor rollback is a **local admin / disk rewrite** threat. A TPM NV
   counter that only advances on Owner-signed transitions raises the bar above
   “delete later ledger files.”
3. The trusted Owner key is already external to the anchor; a TPM counter is a
   second external monotonic dimension that still does not self-authorize WRITER.
4. Remote log (B) should remain optional until multi-machine cutover needs
   independent audit; it must never replace Owner signatures.

**Not recommended as sole control:** E (easy to skip), pure software counters on
the same volume as the anchor (same rollback domain), or any design that treats
migration manifests / Markdown / private state as authority.

## Non-goals (explicit)

- Do not implement the witness in R6.3.
- Do not claim IA-28 closed complete-anchor rollback.
- Do not let a witness grant WRITER without valid Owner-signed tip + local SI bind.
- Do not couple production AION start or real key creation to this note.

## Acceptance sketch (future implementation milestone)

When authorized later, a minimal A-path would:

1. Provision TPM NV index under Owner ceremony (not agent self-init).
2. On offline signed append: require TPM increment + seal of `{epoch, recordDigest}`.
3. On every `loadValidatedTip` / `assertWritable`: read TPM counter; refuse if
   `tip.epoch < tpmEpoch` or digest mismatch for equal epoch.
4. Fail closed if TPM unavailable after provisioning.
5. Document recovery when hardware is replaced (Owner re-ceremony only).

Until that milestone exists, operators must treat **complete signed-anchor
rollback** as an accepted residual risk controlled by host hardening (BitLocker,
Secure Boot, VBS, physical access) and operational discipline—not by local ledger
enumeration alone.
