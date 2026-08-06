# Object Filesystem Reference Threat Model

Status: Phase 5 focused review

Scope: `FileObjectRepositoryV1` only

## Trust boundaries and controls

| Threat | Control |
|---|---|
| Traversal, sibling-prefix, device, UNC, or cross-volume escape | validated opaque Object IDs, fixed derived layout, explicit absolute `private/object-store` root, and Phase 3 authorize/recheck composition |
| External symbolic-link, junction, or reparse escape | canonical nearest-existing-parent containment on every operation and immediate recheck |
| Raw Object identifier disclosure in paths | domain-separated SHA-256 storage key |
| Partial or overwritten revision | same-directory exclusive temporary file, flush/close, no-overwrite hard-link install, owner-only temporary cleanup |
| Concurrent create or append | expected revision plus final-path exclusive installation; one writer wins |
| Corrupted or substituted bytes | raw ACJ-1 parsing, exact-byte comparison, envelope/schema validation, framed SHA-256 integrity, path identity, and continuous-chain checks |
| Provenance/history loss | complete immutable envelope per revision; no in-place update or history compaction |
| Construction/import side effect | root creation and writes occur only during explicit commit |
| Authorization confusion | ownership and IDs are documented non-authoritative references; adapter has no authentication, policy, or permission behavior |

## Residual risks

- A local process with filesystem write authority can delete the store or replace multiple files;
  digest recomputation is integrity evidence, not authenticity.
- Hard-link installation and file flush do not prove directory-entry durability across every
  filesystem, controller, or sudden-power-loss behavior. A future permanent adapter needs measured
  crash/recovery evidence.
- There is no multi-Object transaction, durable Version/Event Object aggregate, outbox, graph-wide
  uniqueness/cardinality lock, encryption, or multi-process lease protocol beyond exclusive final
  revision creation.
- Local ACL, malware, hardware failure, backup retention, and secure destruction remain operating
  and future architecture concerns.
- A privileged local writer can race a validated path between recheck and filesystem use; a future
  hardened adapter may require handle-relative platform APIs in addition to the Phase 3 boundary.
- Link/junction construction can be unavailable with Windows `EPERM`; such an environment result is
  reported as a truthful skip, never as direct proof of the unavailable behavior.

These risks keep DG-4b Open and block production-readiness claims. They do not require weakening a
Phase 5 safety gate or adding a database, network service, authentication, or authorization.
