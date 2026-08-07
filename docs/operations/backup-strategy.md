# Project AION Backup and Disaster Recovery Strategy

Status: **Reviewed and accepted** as operational design, 2026-08-06  
Owner: Project AION CTO  
Last reviewed: 2026-08-06

## Approved scope and standing gaps

The Founder/CTO approved:

- **Canonical remote:** `https://github.com/danieljames-dev/personalasist1.git`. The
  repository name is acknowledged legacy and may be renamed later through a separate
  migration directive.
- **External backup root:** `D:\AION-backups` on the WD easystore USB drive.
- **Backup and restore tooling** as a reviewable script slice. Scheduling is **not**
  approved.

Still gated: cloud storage, database selection, credential creation, production data
movement, scheduled jobs, and any vendor or irreversible-format decision.

**Standing gap — the 3-2-1-1-0 rule is not yet met.** One external drive is approved.
That yields two copies (workstation and `D:`) plus GitHub as a synchronized replica,
which principle 2 excludes from counting as a backup. There is currently **no off-site
copy and no offline rotated copy**. §3 requires a second drive; until one is approved and
placed off-site, single-site loss — fire, theft, flood — remains an accepted, unmitigated
risk. This gap must not be described as closed by the `D:` backup.

## Purpose

Protect AION source code, architecture records, release evidence, configuration, and
future owner-controlled data against accidental deletion, hardware failure, corruption,
ransomware, provider loss, credential loss, and operator error.

This strategy follows established practices: 3-2-1-1-0 backup discipline, encrypted
copies, least privilege, immutable/offline retention, checksums, point-in-time recovery
where supported, documented recovery objectives, and routine restore tests.

No database, vector store, cloud, backup product, or secret-management vendor is
selected by this document.

## Principles

1. Maintain at least three copies of protected data, on two storage types, with one
   off-site copy, one offline or immutable copy, and zero unverified backup errors.
2. A synchronized replica is not a backup. GitHub, local clones, database replicas,
   and vector replicas can reproduce deletion or corruption.
3. Backups are encrypted in transit and at rest using owner-controlled recovery keys.
4. Backup access is separate from normal runtime and development access.
5. Restore capability—not backup-job success—is the measure of protection.
6. Every backup is versioned, integrity-checked, monitored, and covered by retention.
7. Owner data remains portable and recoverable without a required vendor account.
8. Secrets are never committed to Git or stored in ordinary data backups.
9. Recovery favors authoritative records over derived indexes and projections.
10. Automation requires a separate specification, threat review, tests, and approval.

## Recovery objectives

Exact objectives must be validated against owner needs before production data exists.
The initial targets are:

| Data class | Target RPO | Target RTO | Authority |
|---|---:|---:|---|
| Source, architecture, and documentation | 24 hours, plus every approved push | 4 hours | GitHub `main` and protected release tags |
| Release snapshots and build evidence | One released version | 8 hours | Signed release archive set |
| Identity/Object/Memory authoritative data | 24 hours initially; move toward 1 hour with transaction-log recovery | 8 hours | Local authoritative database |
| Secrets and recovery material | Last approved rotation | 4 hours | Approved secret store and offline recovery kit |
| Vector indexes and embeddings | Rebuildable; preserve irreplaceable inputs daily | 24 hours | Canonical source Objects plus versioned embedding metadata |
| Operational telemetry | 24 hours where retained | 24 hours | Local telemetry store; not required for canonical recovery |

RPO is the maximum acceptable data-loss interval. RTO is the target time to restore a
usable service. Tighter objectives require evidence, cost analysis, and an ADR.

## Backup inventory and classification

Before a production backup job is approved, maintain an inventory containing:

- data set and accountable owner;
- canonical versus derived status;
- storage location and format;
- sensitivity classification;
- backup method and schedule;
- encryption and recovery-key custodian;
- RPO, RTO, retention, and legal constraints;
- dependencies and required restoration order;
- integrity verification method; and
- last successful restore-test evidence.

Generated dependencies, build output, caches, temporary files, and rebuildable indexes
are excluded unless their recreation time violates the approved RTO.

## Approved layout and artifact classes

The approved external backup root is `D:\AION-backups`. Each subdirectory holds one
artifact class. The classes are **not interchangeable**; conflating them is the most
common way a backup set turns out to be unrestorable.

```text
D:\AION-backups\
    repository-mirror\    AION.git — verified canonical durable-ref mirror
                           staging\ — candidate mirrors awaiting validation
                           quarantine\ — preserved superseded/failed mirrors
    working-snapshots\    dated Git bundles + retained-untracked archives
    releases\             self-contained release recovery sets (§5)
    databases\            reserved; no engine approved, no data yet
    restore-tests\        isolated timestamped clones proving restorability
    manifests\            machine-readable record of every backup run
    logs\                 run logs, including failures
```

| Class | What it is | What it is not |
|---|---|---|
| **Repository mirror** | A bare canonical mirror fetched from the approved origin using explicit branch, tag, and intentional-note refspecs. Rebuilt through staged validation and replacement. | Not a copy of every local ref and not editor/agent checkpoint storage. Not point-in-time. |
| **Git bundle** | A single immutable file capturing explicitly selected durable local branches, tags, and intentional notes. Point-in-time, offline-transportable, verifiable. | Does not contain `refs/codex/*`, remote-tracking refs, or unknown custom namespaces. Not incrementally updatable. |
| **Working snapshot** | A bundle plus an archive of explicitly declared untracked files that have no source-control guarantee. | Not a copy of the working directory. Never includes dependencies, build output, caches, `.env` files, or editor state. |
| **Release archive** | A self-contained recovery set for one approved release (§5). | Not a substitute for the mirror or bundle. |
| **Database backup** | Engine-consistent physical/logical/log backups (§7). | Not a file copy of a running database. Reserved and empty until an engine is approved. |
| **Restore test** | An isolated clone that proves a backup actually restores and verifies (§11). | Never a restore over the active working repository. |

The mirror and the bundle are both required and neither replaces the other: the mirror
gives fast recovery, the bundle gives an immutable point in time that survives an
upstream history rewrite.

### Durable-ref policy

Verified source backups use an allowlist:

- `refs/heads/*`;
- `refs/tags/*`; and
- `refs/notes/*` only when notes intentionally exist.

All other namespaces are transient unless a later recorded decision adds them to the allowlist.
Excluded examples include `refs/codex/*`, `refs/bisect/*`, `refs/rewritten/*`,
`refs/worktree/*`, remote-tracking refs, temporary merge/debug refs, editor checkpoints, and
agent turn-diff refs. Exclusion never deletes those refs from the active repository. Source
branches and release history are durable; editor recovery checkpoints are not.

The canonical mirror and local recovery bundle have different sources and roles. The mirror is
fetched from the approved GitHub origin after local `main` and `origin/main` are proven equal.
The bundle is created from the active repository's explicitly enumerated durable refs. Neither
uses `--all`. A future durable custom namespace requires a documented policy and manifest-schema
update before tooling refspecs may include it.

Mirrors are never repaired in place. A new candidate is created under `staging\`, fetched with
only durable refspecs, checked with `git fsck --full`, checked for exact `main`, checked for absent
`refs/codex/*`, and independently cloned. Only then is the prior mirror moved intact to a
timestamped `quarantine\` path and the candidate installed as `AION.git`. Quarantined mirrors and
failed manifests are evidence and are not deleted by the tooling.

### Success definition

**A backup run is recorded SUCCESS only after its restore test passes.** A run that
produces artifacts and checksums but whose restore test fails, errors, or is skipped is
recorded FAILURE, its evidence is retained, and the previous known-good backup remains
the current recovery point. Checksum verification and archive readability are necessary
but never sufficient. This applies to every automated and manual run.

### Capacity and retention on the approved drive

The approved drive is 1863 GB with 1672.7 GB free at approval. The repository is a few
megabytes of text; the §4 retention schedule — 14 nightly, 8 weekly, 12 monthly — is
therefore trivially affordable today, and no pruning is needed. Retention becomes a real
capacity question only when database, vector, or large-artifact data exists, at which
point §4 retention must be re-derived from measured sizes before automation is scheduled.
Tooling does not delete prior backups automatically.

## Windows platform requirements

The approved drive is Windows-attached, so these are operational requirements, not
suggestions.

- Format the drive **NTFS**. exFAT has no journaling and no permission model, and it
  corrupts more readily on unclean removal.
- Encrypt with **BitLocker To Go** or an equivalent authenticated-encryption volume.
  Store the recovery key in the offline recovery kit, never on the drive itself and
  never in the repository.
- Always eject through **Safely Remove Hardware** before disconnecting. Pulling a mounted
  NTFS volume mid-write can corrupt the mirror.
- Keep ordinary backup paths short, but do not use global long-path or registry changes as the
  primary correction for generated refs. Durable-ref selection prevents editor and agent ref
  paths from entering the mirror at all.
- Do not place `D:\AION-backups` inside any consumer file-sync directory. Partial
  synchronization of Git internals produces silently broken repositories.
- Do not add blanket antivirus exclusions for the backup root. Scan on write is the
  intended behaviour; a ransomware-encrypted backup that was never scanned is worthless.

## 1. Local repository protection

The developer workspace is a working copy, not the sole source of truth.

- Keep work on named branches and push approved commits frequently.
- Require clean, reviewable commits; avoid long-lived uncommitted work.
- Preserve `.git` history and never place the repository inside a consumer file-sync
  directory that may partially synchronize Git internals.
- Protect the workstation with full-disk encryption, current security updates,
  malware protection, screen locking, and a non-administrator daily account.
- Exclude `node_modules`, build output, caches, temporary files, `.env` files, secrets,
  databases, and owner-data directories from Git.
- Before destructive Git maintenance, create a verified `git bundle` or full repository
  copy on a separate device.
- Use filesystem snapshots only as a supplementary short-term recovery layer. They do
  not replace GitHub, external media, or offline backups.
- Verify repository integrity periodically with Git's object connectivity/integrity
  checks and investigate failures before creating new trusted backups.

Uncommitted work may be captured by encrypted workstation backup, but it has no durable
source-control guarantee until reviewed and committed.

## 2. GitHub as canonical source control

GitHub is the canonical collaborative source-control location for AION source,
architecture, documentation, tags, and approved history. It is not canonical storage
for owner memories, databases, secrets, or runtime content.

- Protect `main` with a ruleset requiring pull-request review, passing verification,
  resolved discussions, and prevention of force pushes and deletion.
- Require phishing-resistant multifactor authentication for privileged accounts.
- Grant least-privilege repository roles and review collaborators regularly.
- Enable secret scanning, push protection, dependency alerts, and security advisories.
- Use signed commits or signed release tags when the signing and key-recovery policy is
  approved.
- Do not depend on GitHub alone. Maintain an independent full mirror or `git bundle`
  containing all branches, tags, and Git objects.
- Back up repository settings not contained in Git: branch rules, environments,
  collaborator roles, deployment keys, webhooks, issue/PR metadata when required, and
  release metadata.
- Never treat GitHub Actions artifacts as permanent backups; copy required release
  evidence to the release archive.

Canonical source control means the approved Git history is authoritative. Independent
backups remain necessary for provider outage, account compromise, or destructive
administration.

## 3. External drive backups

Use at least two encrypted external drives in rotation:

- Drive A is connected only for the scheduled backup and verification, then safely
  ejected and disconnected.
- Drive B is stored off-site in a physically secure location and rotated on a defined
  cadence, initially monthly.
- Use a mature encrypted filesystem or encrypted backup repository with authenticated
  encryption. Do not rely only on an unencrypted archive password.
- Label media with a non-sensitive asset identifier, not project secrets or owner data.
- Record drive custodian, capacity, health, last backup, last verification, last restore
  test, and retirement date.
- Replace media on health failure or approved lifecycle limits; securely erase or
  physically destroy retired media according to data classification.
- Never leave both rotation drives connected simultaneously or permanently mounted.

Each drive should contain versioned backup sets, manifests, checksums, repository
bundles/mirrors, release snapshots, documentation, and permitted database exports—not
an ad hoc drag-and-drop copy with overwrite semantics.

## 4. Nightly backup recommendations

When automation is separately approved, run a nightly local backup window that:

1. acquires application-consistent database snapshots or uses engine-supported online
   backup mechanisms;
2. captures transaction logs required for point-in-time recovery;
3. exports portable logical database copies at the approved cadence;
4. captures vector metadata and any non-rebuildable vector data;
5. creates or updates a full Git mirror/bundle including branches and tags;
6. copies versioned documentation and release manifests;
7. encrypts the backup before it leaves the source device;
8. writes to a dedicated backup repository, not the source directory;
9. verifies checksums, repository readability, archive structure, and expected record
   counts without exposing content;
10. records a machine-readable manifest, backup ID, timestamps, versions, and errors;
11. alerts on failure, missed schedule, unexpected size change, or verification error;
12. never deletes the last known-good backup after a failed run.

Recommended initial retention:

- nightly versions for 14 days;
- weekly versions for 8 weeks;
- monthly versions for 12 months; and
- approved release snapshots for the supported life of the release plus the legal or
  governance retention period.

Retention must be revised for capacity, privacy, deletion obligations, and regulatory
requirements. Expiration must remove data from online, offline, and off-site sets
through a documented process while retaining deletion evidence.

## 5. Versioned release snapshots

Every approved release should produce a self-contained recovery set:

- signed, annotated Git tag from a protected commit;
- source archive and full Git bundle containing the release tag;
- dependency lockfiles and software bill of materials;
- build instructions, supported runtime/toolchain versions, and configuration schema;
- generated public contract schemas and compatibility fixtures;
- database and Object schema versions plus forward/rollback migration instructions;
- release notes, ADR references, threat-model status, and known limitations;
- checksums and, once approved, cryptographic signatures/attestations;
- license and third-party notices; and
- restoration and verification instructions.

Store release sets in GitHub Releases where appropriate and in at least one independent
encrypted archive. A release is not complete until its snapshot is restorable without
depending on mutable package tags or undocumented external state.

## 6. Documentation backups

Architecture, ADRs, specifications, reviews, runbooks, and operational procedures are
code-adjacent records and remain versioned in Git. Documentation outside Git must be
minimized and inventoried.

- Include all Markdown, diagrams, schemas, templates, and release documentation in the
  repository mirror/bundle and nightly backup.
- Export essential GitHub-only issue, pull-request, wiki, project, and release metadata
  when it becomes operationally important.
- Prefer text and open formats. If proprietary formats are unavoidable, include a
  durable PDF or standard-format export where practical.
- Validate internal links and ensure disaster-recovery instructions are available in
  the offline recovery kit, not only inside an unavailable system.
- Keep recovery contact and credential-location instructions separate from the public
  repository and do not place secrets in documentation backups.

## 7. Database backup strategy

No database engine is approved yet. Any selected engine must support documented,
automatable, consistent backup and restore procedures.

Use complementary backup types:

- **Physical snapshots/backups** for efficient full recovery, created through the
  database's supported consistency mechanism rather than raw copying live files.
- **Logical exports** in a documented, portable format for migration, inspection, and
  recovery from engine-specific corruption.
- **Transaction-log/WAL archives** for point-in-time recovery when required by RPO.

Database backups must include:

- engine and extension versions;
- schema/migration version;
- backup start/end time and consistency marker;
- encryption/key reference, never the key itself;
- checksums, sizes, record-count summaries, and backup ID;
- required transaction logs and restore order; and
- application release compatibility.

Perform logical exports at least nightly initially and full physical backups at least
weekly, adjusted after workload and RPO evidence. Transaction logs should be archived
continuously or frequently enough to meet the approved RPO.

Never restore directly over the only production copy. Restore into an isolated target,
verify schema, integrity, ownership, provenance, relationships, record counts, and
application compatibility, then perform an approved cutover. Encrypt temporary restore
locations and remove them securely afterward.

Replication, snapshots on the same disk/account, and file-level copies of a running
database are not sufficient backups.

## 8. Vector database backup strategy

Vector indexes are generally derived projections. Canonical source Objects, chunking
rules, embedding inputs, provenance, and model-independent configuration take priority.

Inventory and protect:

- source Object IDs and exact source revisions;
- normalized/chunked input text or deterministic reconstruction instructions;
- embedding provider capability and model/version identifier used at creation time;
- dimensions, distance metric, normalization, index algorithm, and parameters;
- vector-to-source mapping, owner, permissions, provenance, and timestamps;
- collection/index schema and application version; and
- any vectors that cannot be deterministically or economically reproduced.

Preferred recovery is to rebuild replaceable indexes from canonical owner data. When
rebuild time exceeds RTO or the original embedding capability is unavailable, use the
vector engine's supported consistent snapshot/export in addition to canonical inputs.

Do not copy live vector-store files unless the engine documents that method as
consistent. Test backup compatibility across engine versions. After restore or rebuild,
verify vector count, dimensions, source mappings, ownership filtering, representative
queries, and absence of tombstoned/deleted owner data.

Vector backups must never become an undeletable shadow copy of owner content.

## 9. Secret management

Secrets include credentials, API keys, signing keys, encryption keys, recovery codes,
database passwords, deployment tokens, and backup keys.

- Store secrets in an approved operating-system credential store, encrypted local
  vault, hardware-backed key store, or dedicated secret manager.
- Commit only secret references and safe `.env.example` templates.
- Use separate credentials for development, production, CI, and backup operations.
- Grant backup writers append/write access without routine restore/read access where
  the selected system supports separation.
- Rotate credentials on schedule and immediately after suspected compromise.
- Maintain an encrypted offline recovery kit with necessary recovery keys, account
  recovery codes, key identifiers, procedures, and custodians.
- Keep at least two controlled recovery-key copies in separate secure locations.
- Test key recovery without disclosing key material in logs or reports.
- Back up secret-store configuration and encrypted contents only through the store's
  supported export/recovery process.
- Never store an encryption key beside the backup it decrypts.

If a secret is committed, treat it as compromised: revoke/rotate it, remove it from
current files, assess historical exposure, and document the incident. Rewriting Git
history alone does not revoke a secret already copied.

## 10. Disaster recovery procedures

### Declaration and control

1. Detect and classify the incident: workstation loss, repository corruption, GitHub
   compromise/outage, database loss, ransomware, credential loss, or site disaster.
2. Name an incident commander and record a protected incident timeline.
3. Stop writes and isolate affected systems when continuing could propagate damage.
4. Preserve evidence before cleanup where compromise is suspected.
5. Revoke exposed credentials and establish a trusted recovery workstation.

### Recovery order

1. Recover owner identity, account access, recovery keys, and trusted time source.
2. Restore the approved source repository and verify signed tags/checksums/history.
3. Recreate the documented runtime/toolchain from a versioned release snapshot.
4. Restore configuration using secret references, then recover secrets separately.
5. Restore the authoritative database to an isolated environment.
6. Apply transaction logs to the selected recovery point.
7. Verify Object ownership, provenance, lifecycle, history, events, relationships, and
   schema/application compatibility.
8. Restore or rebuild vector indexes and other derived projections.
9. Run automated verification plus a defined set of owner acceptance checks.
10. Cut over only after documented approval; monitor closely and retain the previous
    recovery source until the incident is closed.

### Recovery scenarios

#### Local repository loss

Clone GitHub into a trusted location. If GitHub is unavailable or untrusted, restore
the latest verified mirror/bundle, validate refs and objects, then add a verified remote.

#### GitHub loss or compromise

Freeze pushes, revoke tokens/keys, validate the latest independent mirror against
known signed releases/checksums, create a replacement remote under approved ownership,
restore branch protections, push all refs, and rotate affected credentials.

#### Database corruption or deletion

Stop writers, preserve corrupted media/evidence, restore the last verified full backup
to isolation, apply logs to a point before corruption, run integrity and application
checks, reconcile backup manifests, and perform controlled cutover.

#### Workstation or laptop loss

Assume the device and any cached credentials are compromised, not merely absent. Revoke
Git credentials, personal access tokens, and session cookies from another trusted device.
Establish a trusted replacement workstation, restore owner account access and the offline
recovery kit, then clone the canonical remote. Recover uncommitted work only from the
latest working snapshot; work newer than that snapshot and never pushed is lost, and the
actual loss interval must be recorded. Verify the restored repository with
`npm run verify` before resuming. Re-enable BitLocker on the replacement device before
reconnecting the external drive.

#### Repository corruption

Symptoms are `git fsck` failures, unreadable objects, or a broken index. Stop writing
immediately — a further commit or garbage collection can propagate damage into backups.
Do **not** update the mirror, because updating it would carry the corruption forward.
Preserve the damaged `.git` directory as evidence. Recover in this order: clone fresh
from the canonical remote; if the remote carries the corruption, restore the newest Git
bundle whose `git bundle verify` passes; if bundles are also affected, walk back through
`working-snapshots\` until one verifies. Confirm the recovered commit hash matches the
manifest, then run `git fsck --full` and `npm run verify` before trusting it.

#### Accidental deletion

Covers a deleted file, a deleted branch, a bad `git reset --hard`, a discarded stash, or
a deleted local directory.

1. Stop and do not run `git gc`, `git prune`, or any repository maintenance — these
   destroy the objects that would otherwise make recovery trivial.
2. For committed work still in the local repository, recover from `git reflog`; unreachable
   commits usually survive for the reflog expiry window.
3. For work pushed to the canonical remote, re-fetch it.
4. For a force-pushed or remotely deleted branch, the mirror may already have caught up
   and dropped it — use the newest **bundle** instead, which is point-in-time and immune
   to upstream rewrites. This is exactly why bundles are retained alongside the mirror.
5. For deleted untracked files, recover from the newest working snapshot archive, then
   record the gap between the deletion and the last snapshot as real data loss.

Never recover by restoring over the live repository; restore to a separate directory and
copy the specific artifact across after verification.

#### External-drive failure

Symptoms are SMART warnings, unreadable files, checksum mismatches against the manifest,
mount failures, or NTFS errors. The drive holds the only external copy, so its failure
returns the project to a single-site, single-copy state and is an operational incident.

1. Stop writing to the drive. Do not run repair tooling before evidence is preserved —
   `chkdsk /f` can destroy recoverable data.
2. Confirm scope by verifying manifest checksums for the most recent set; a checksum
   mismatch means that backup is already invalid and must not be trusted.
3. The canonical remote and the working repository remain available, so recovery is
   normally to procure a replacement drive, format NTFS, enable BitLocker To Go, and run
   a full backup with restore test to re-establish the external copy.
4. If the drive failed *and* the remote is unavailable, the working repository is the
   only copy — push or bundle it to new media immediately before any other action.
5. Retire the failed media per §3, securely erasing or physically destroying it according
   to data classification. Record the incident, the interval with no valid external copy,
   and whether any backup set was lost entirely.

#### Ransomware or device compromise

Do not connect offline media to the compromised host. Rebuild a trusted environment,
rotate all accessible secrets, restore from a backup predating compromise, scan and
verify recovered artifacts, and investigate persistence before reconnecting services.

### Closure

Document actual data loss, RPO/RTO achieved, verification evidence, credential rotation,
residual risk, and corrective actions. Update this strategy through an ADR when the
incident exposes an architectural weakness.

## 11. Restore testing

Use a documented restoration matrix:

| Test | Initial cadence | Evidence |
|---|---|---|
| Git clone and full bundle/mirror restore | Monthly | Refs/tags/object integrity and build result |
| Individual documentation/file recovery | Monthly | Exact file/version checksum |
| Logical database restore | Monthly after database adoption | Schema, counts, integrity, application tests |
| Full database plus point-in-time recovery | Quarterly | Selected recovery timestamp and reconciliation |
| Vector rebuild/snapshot restore | Quarterly after adoption | Counts, mappings, deletion filters, query checks |
| Secret/recovery-key exercise | Quarterly | Access recovered without exposing secret material |
| Full disaster simulation | At least annually and after major architecture changes | Measured RPO/RTO and signed review |

Restore tests must use isolated infrastructure and non-production endpoints. Sensitive
production data should be minimized or protected equivalently. A test passes only when:

- backup integrity and decryption succeed;
- required versions and keys are available;
- the restored system starts and passes conformance/integrity checks;
- owner permissions, provenance, relationships, and deletion state remain correct;
- observed RPO/RTO meet targets; and
- results, failures, remediation owner, and retest date are recorded.

Track the time since last successful restore as an operational risk. A backup set with
no successful restore evidence must not be the only retained recovery point.

## 12. Repository migration procedures

Repository migration must preserve complete history, branches, tags, signatures where
supported, releases, security settings, and governance. Never delete the old remote
until the new remote is verified and the rollback window expires.

### Plan

1. Approve the destination owner, visibility, access roles, data residency, and URL.
2. Inventory branches, tags, submodules, large-file storage, releases, issues/PRs,
   actions, secrets, deploy keys, webhooks, environments, and protection rules.
3. Announce a write freeze and record source remote refs and checksums.
4. Create a fresh verified full mirror and offline bundle.

### Transfer Git data

> **Destructive command.** `git push --mirror` makes the destination match the source
> exactly: it **deletes** any branch or tag on the destination that is absent from the
> source, and it can overwrite refs non-fast-forward. Run it only against a destination
> confirmed empty or confirmed disposable, only after `git fsck --full` passes, and only
> after a verified offline bundle exists. If the destination URL is wrong, this command
> destroys whatever is at that URL. Verify `git remote -v` before running it.

Use standard Git mirror procedures with exact approved URLs:

```powershell
git clone --mirror <SOURCE_REPOSITORY_URL> aion-migration.git
cd aion-migration.git
git fsck --full
git remote set-url --push origin <DESTINATION_REPOSITORY_URL>
git remote -v          # confirm the push URL before the next line
git push --mirror      # DESTRUCTIVE - see warning above
```

Do not substitute or invent repository URLs. If Git LFS is adopted, transfer and verify
all LFS objects using its supported fetch/push migration procedure separately.

### Recreate provider metadata and controls

- Transfer required issues, pull requests, releases, wiki, and project metadata using
  supported exports/APIs while preserving attribution where possible.
- Recreate branch rules, review requirements, environments, webhooks, applications,
  security settings, and least-privilege collaborators.
- Re-enter secrets through the approved secret manager; never copy them through Git.
- Update trusted documentation, CI references, package metadata, and deployment systems
  through reviewed changes.

### Verify and cut over

1. Compare all source/destination refs and commit IDs.
2. Clone the destination normally and run full build, tests, package, and documentation
   checks.
3. Verify signed tags, releases, large files, permissions, security rules, and webhooks.
4. Change developer remotes only after verification:

```powershell
git remote set-url origin <DESTINATION_REPOSITORY_URL>
git remote -v
git fetch origin --prune
git status --branch
```

5. Make the old repository read-only or archive it during the rollback window.
6. Monitor, then retire old integrations and credentials after formal acceptance.

### Rollback

Restore developer remotes to the source URL, re-enable the source only after security
review, reconcile commits created during the cutover window, and document the failure.
The pre-migration mirror/bundle remains immutable until migration closure.

## Backup failure and monitoring requirements

Future automation must report:

- last successful backup and last successful restore test;
- RPO age and retention compliance;
- source/backup sizes and unexpected changes;
- checksum, encryption, media-health, and repository-integrity results;
- missed, partial, or expired backup sets;
- transaction-log continuity;
- off-site/offline copy age; and
- accountable remediation owner.

Alerts must not include secrets or owner content. Backup failures are operational
incidents, not warnings to ignore.

## Approval gates before automation

Approved on 2026-08-06: the external backup root `D:\AION-backups`, the canonical remote,
and a reviewable backup/restore script slice run on demand. **Scheduling remains
unapproved** — the scripts are invoked manually until the gates below are satisfied.

Scheduled automation may begin only after approval of:

- the data inventory and classification;
- measured RPO/RTO requirements;
- backup formats, retention, and deletion behavior;
- encryption and recovery-key custody;
- chosen tools/adapters and documented exit procedures;
- threat model and least-privilege access design;
- failure alerts and operational ownership;
- test plan, acceptance criteria, and restore runbooks; and
- an ADR for any vendor, storage engine, or irreversible format decision.

This document authorizes design review and the approved on-demand tooling described
above. It does **not** authorize scheduled jobs, cloud storage, database selection,
credential creation, or production data movement.

The Sprint 3.0 recovery gate also runs matching, preparation, CLI, and the complete synthetic Career
demo from the isolated exact-HEAD restore. This proves source recoverability only. Private Career
state and exports remain excluded and need a separately approved owner-data backup policy.

## Related artifacts

Delivered separately by the approved tooling slice, not by this commit:

- `docs/operations/backup-runbook.md` — operator procedures for the approved scripts
- `docs/operations/backup-manifest-schema.md` — machine-readable run record
- `scripts/backup-aion.ps1`, `scripts/restore-test-aion.ps1`
