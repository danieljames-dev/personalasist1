# Career Evidence Import and Recovery Boundary

Status: Sprint 3 Phase 7 reference implementation

Phase 7 reuses `FileObjectRepositoryV1` below an explicit `private/object-store` root. It does not
add a database, transaction manager, lock directory, or parallel object store. Every Object
revision remains immutable, integrity checked, atomically installed in its own same-directory
revision path, and protected by expected revision/no-overwrite behavior.

Cross-Object filesystem commits are not database-atomic. Import therefore uses a durable
CareerSource record as the operation record:

1. create or verify a deterministic source ID with `pending` outcome;
2. create-or-verify each deterministic CareerFact and derived-from RelationshipObject;
3. append source `success` only after every required record exists;
4. on a post-source failure, best-effort append `partial` with completed counts and a safe reason;
5. retry the same operation ID/content, reuse exact valid records, create only missing records, and
   append success; different content under the same operation ID conflicts.

No partial catalogue is reported as accepted, no valid history is deleted as compensation, and a
completed operation with missing/conflicting evidence fails closed without silent repair. Profile
build uses the same pending/partial/success pattern. For rebuild retry it reads the caller's
expected historical revision to identify removed membership, then deterministically completes or
ends relationships. Conflict marking can be partially durable across several facts; its stable
group and per-fact expected revisions make retry explicit and do not choose a winner.

Residual risks are exact: process or power loss can leave a truthful pending/partial multi-Object
operation; unrelated writers can cause revision conflicts; directory durability inherits the
reference filesystem adapter and host filesystem; and complete cross-Object isolation is absent.
These limits keep DG-4b Open and prevent a production-storage claim.
