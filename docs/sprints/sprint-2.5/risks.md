# Sprint 2.5 Universal Object Model Risks

Status: **Accepted** as the standing risk register, 2026-08-06  
Implementation: **Frozen**

## Review posture

This document attempts to break the design before construction. Severity reflects
potential effect on owner control, data integrity, replaceability, or ten-year
maintainability. Likelihood remains qualitative until representative workloads and
contract fixtures exist.

## Risk register

| ID | Risk | Severity | Design weakness / failure scenario | Recommendation |
|---|---|---:|---|---|
| OBJ-001 | God Object envelope | Critical | Every future concern becomes a mandatory field, coupling all domains | Admit base fields only when universal, bounded, stable, and vendor-neutral; prefer Relationships/facets |
| OBJ-002 | Generic CRUD bypass | Critical | A universal update path writes Task/Memory/Workflow data without domain rules | Prohibit public generic mutation; require domain-owned commands |
| OBJ-003 | Recursive system Objects | Critical | Event/Version creation recursively creates events/versions forever | Explicit immutable Event/Version profiles with no meta-history/event generation |
| OBJ-004 | Relationship dual truth | Critical | Endpoint arrays and canonical edges disagree | Relationship Objects are sole truth; no authoritative endpoint arrays |
| OBJ-005 | Unbounded snapshot growth | High | History/events/relationships/provenance make reads and writes grow forever | Compact envelope; paginated external collections; bounded summaries only |
| OBJ-006 | Write amplification | High | Each change creates snapshot, version, events, outbox, hashes | Benchmark representative workloads; minimize payloads; retain one aggregate boundary |
| OBJ-007 | Hidden storage coupling | Critical | Atomic contract assumes one database transaction model | Specify portable aggregate capability/crash semantics; reject nonconforming adapters |
| OBJ-008 | Identity bootstrap cycle | Critical | First Owner must be an Object, but Object requires existing Owner/Actor | Approve explicit bootstrap ADR before persistence |
| OBJ-009 | Authorization vacuum | Critical | Ownership/reference is treated as access permission before Policy exists | Fail closed; pure/in-memory scope only until authorization seam approved |
| OBJ-010 | Schema registry becomes code execution | Critical | Plugin validator/migration runs arbitrary code | Declarative schemas where possible; signing, review, sandbox, limits, revocation |
| OBJ-011 | Namespace collision | High | Plugin/domain claims another type or relationship identity | Controlled namespace ownership and immutable schema identity |
| OBJ-012 | Schema evolution failure | Critical | New release cannot read old owner data | Dual-version readers, explicit migration graph, golden fixtures, archival readers |
| OBJ-013 | Lossy migration presented as reversible | High | Rollback cannot recover removed data | Declare loss/reversibility; backup/export; owner approval; never overclaim |
| OBJ-014 | Integrity ambiguity | High | Languages hash different representations | Versioned canonical serialization and algorithm-agile descriptor |
| OBJ-015 | Hash mistaken for authenticity | High | Attacker changes content and recomputes digest | Separate signing/trust design; digest is integrity evidence only |
| OBJ-016 | Relationship inference | Critical | Query reveals existence/type of inaccessible target | Independent edge/endpoint authorization and non-enumerating responses |
| OBJ-017 | Cardinality race | High | Concurrent edge creation violates uniqueness/max cardinality | Portable atomic constraint/idempotency protocol and conformance scenarios |
| OBJ-018 | Graph cycle denial of service | High | Expensive traversal/cycle validation exhausts local resources | Descriptor-specific bounded checks, quotas, async verification where safe |
| OBJ-019 | Cross-owner leakage | Critical | Relationship/export traverses another owner's private data | Fail closed, explicit future policy, scoped traversal, independent endpoint access |
| OBJ-020 | Permission reference becomes authority | Critical | Presence of a reference bypasses policy | Contractually non-authoritative; external signed decision evidence required |
| OBJ-021 | Provenance bloat | Medium | Detailed assertion history fills every envelope | Bounded summary; detailed Provenance Objects/type data where needed |
| OBJ-022 | Provenance laundering | High | Derived claim marked owner-authored or source removed | Immutable source categories, Actor, versions, derivation Relationships |
| OBJ-023 | Event data leakage | Critical | Full private Objects copied into broad event streams/logs | Minimal change summaries; authorized retrieval; payload classification |
| OBJ-024 | Event used as command/authority | Critical | Consumer performs consequential action solely because event arrived | Events are facts only; consumer re-resolves state, policy, and approval |
| OBJ-025 | Event delivery gap | High | Commit succeeds but consumers never learn | Durable outbox/equivalent, retry, health signal, replay/reconciliation |
| OBJ-026 | Duplicate event side effects | High | At-least-once delivery repeats external action | Stable Event ID and mandatory idempotent consumer design |
| OBJ-027 | Global ordering assumption | High | Consumers misorder changes across Objects | Promise order only by subject revision; use correlation/causation/workflow |
| OBJ-028 | Delete is not destruction | Critical | Owner believes data erased while backups/vectors retain it | Separate states; inventory, retention, derived-store cleanup, verification |
| OBJ-029 | Backup resurrection | Critical | Restore revives deleted/destroyed records | Restore reconciliation and deletion/destruction replay before cutover |
| OBJ-030 | Merge destroys provenance | High | Sources overwritten into one target with no trace | Preserve source histories and exact revision `DerivedFrom` Relationships |
| OBJ-031 | Split copies authority | High | Successors inherit owner/permission implicitly | Independently validate ownership, policy, provenance, and schema per successor |
| OBJ-032 | Import overwrites truth | Critical | Crafted package replaces canonical Object/revision | Collision protocol, manifest/integrity/trust validation, no silent overwrite |
| OBJ-033 | Export is incomplete/locked in | Critical | Owner cannot reconstruct data without original vendor | Open versioned manifests, schemas, artifacts, relationships, unknown extensions |
| OBJ-034 | Large media bloats Objects | High | Image/video/audio bytes copied through snapshots/events | Content/artifact Object/reference with streaming and content hashes |
| OBJ-035 | Vector data becomes canonical | High | Provider-specific embeddings prevent replacement/deletion | Treat vectors/indexes as rebuildable projections with source revision lineage |
| OBJ-036 | Planner persistence explosion | High | Every transient thought/candidate becomes an Object | Explicit materialization boundary; retain only owner-relevant durable artifacts |
| OBJ-037 | Capability/Object registry overlap | Medium | Two registries conflict on schemas/discovery | Object registry validates durable data; Capability registry discovers actions |
| OBJ-038 | Workflow/Object state confusion | High | Universal Active/Archived replaces workflow execution state | Separate record lifecycle from domain state explicitly |
| OBJ-039 | Plugin removal orphans data | High | Owner loses ability to read/export plugin Objects | Preserve raw schema/data; fallback export; no execution required for reading |
| OBJ-040 | Single-owner migration cost | High | Multi-owner future changes every field/index/event | Isolate `ownership` value contract; define migration seam; avoid person assumptions |
| OBJ-041 | Operational logs become audit | High | Mutable/redacted logs treated as authoritative history | Separate protected Audit Objects/reference from telemetry |
| OBJ-042 | Local-device performance failure | High | High churn, long history, or large graph exceeds owner hardware | Workload budgets, pagination, compaction/archival policy, measured adapter selection |
| OBJ-043 | Resource exhaustion via JSON | High | Deep/large metadata or schemas consume memory/CPU | Hard depth/size/count limits, cancellation, deadlines, quotas |
| OBJ-044 | Framework/language leakage | Medium | Contract encodes runtime cancellation/types/serialization | Normative semantic contracts with language mappings outside core |
| OBJ-045 | Over-standardization | High | Domain teams cannot model necessary invariants | Keep data schemas/domain commands owned; add relationship subtypes, not base fields |
| OBJ-046 | Under-standardization | High | “Object-compatible” types diverge semantically | Conformance fixtures, registry governance, acceptance review, stable failure categories |
| OBJ-047 | Ten-year reader loss | Critical | Old backups/exports cannot be opened after toolchain changes | Preserve schemas, readers, migration tools/specs, release snapshots, open formats |
| OBJ-048 | Premature v1 freeze | High | Unvalidated field shape immediately requires breaking v2 | Validate representative fixtures before stable designation |

## Scalability challenges

### High-degree relationships

Projects, People, Knowledge, and Memory may have millions of edges over time. Endpoint
snapshots cannot carry edge IDs. Relationship queries require bounded cursor pagination,
stable ordering, selective indexes, and rebuildable graph projections.

### High-churn entities

Workflow runs, conversations, and task activity may create frequent Versions and
Events. The design must measure write amplification, retention, archival, recovery,
and export before selecting storage or declaring performance budgets.

### Large artifacts

Images, video, audio, repositories, and documents can exceed ordinary Object limits.
The Object holds durable artifact identity, ownership, provenance, media metadata, and
content integrity while storage-neutral artifact contracts handle bytes/streaming.

### Bulk migration

Ten-year schema evolution implies mixed versions and interrupted migrations. Readers
must coexist across supported versions; startup-blocking full migrations are not a safe
default.

## Migration risks

- Changing Object contract touches every persistent type.
- Relationship descriptor changes can invalidate existing cardinality/cycle assumptions.
- Ownership evolution can affect all queries/events/exports.
- Canonicalization changes can invalidate hashes without content change.
- Plugin schemas may disappear before data migrates.
- Destructive migrations may conflict with retained backups and exports.

Mitigation requires new-major coexistence, immutable schema identity, explicit migration
graphs, checkpoints, backups, golden fixtures, information-loss declarations, archival
readers, and owner-visible impact.

## Security challenges

The highest security risks are authorization confusion, cross-owner inference,
malicious plugin/schema execution, mass assignment, event exfiltration, migration/import
tampering, and incomplete deletion. The separate threat model defines controls. No
persistent/external implementation is safe until Identity bootstrap and authorization
seams are approved.

## Improvements required before implementation

1. Approve ADR-007 and resolve or explicitly bound all subordinate blocking decisions.
2. Define canonical serialization, UUID profile, and algorithm-agile integrity.
3. Define first Owner/Actor and bootstrap authorization ceremonies.
4. Define exact bounded resource limits and namespace governance.
5. Define portable aggregate/outbox crash and recovery semantics.
6. Define delete/destroy behavior across authoritative data, projections, exports under
   AION control, and backup retention.
7. Validate representative Object fixtures across every profile and major subsystem.
8. Measure high-churn, high-degree, large-artifact, migration, export, and restore
   reference workloads before storage selection.

## Architecture recommendation

The revised Universal Object Model is coherent enough for CTO review and substantially
addresses the previous Architecture Readiness Review. It remains **not ready for
implementation** until subordinate blocking decisions and representative fixtures are
approved.

ADR-007 was accepted on 2026-08-06 as an architecture-boundary decision. That acceptance
did not change this recommendation: the design is approved, the implementation is not.
OBJ-008 (identity bootstrap), OBJ-014 (integrity ambiguity), OBJ-048 (premature v1
freeze), and OBJ-043 (resource exhaustion via JSON) are now tracked as enforceable
deferred gates DG-1 through DG-4 in the
[acceptance criteria](acceptance-criteria.md). Every other entry in this register remains
open and unmitigated.

