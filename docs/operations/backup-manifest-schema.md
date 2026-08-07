# AION Backup Manifest Schema

Status: Operational contract, version 2
Owner: Project AION CTO
Produced by: `scripts/backup-aion.ps1`
Location: `<BackupRoot>\manifests\backup-<UTC>.json`

The manifest is the machine-readable record of every real backup run, successful or failed.
Dry runs write nothing. A backup without a `SUCCESS` manifest and embedded successful restore
result is not a recovery point.

## Identity and source

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Fixed `aion.backup-manifest.v2` |
| `timestampUtc` | string | UTC stamp tying artifacts, logs, and restore evidence together |
| `dryRun` | boolean | Always `false` in a written manifest |
| `repositorySourcePath` | string | Active local repository used for bundle selection |
| `canonicalRemote` | string | Exact approved origin URL |
| `branch` | string | Must be `main` |
| `commitHash` | string | Compatibility alias for the expected recovery commit |
| `localHead` | string | Active repository HEAD at the gate |
| `originMain` | string | Local remote-tracking `origin/main` at the gate |
| `expectedBackedUpCommit` | string | Exact commit required in mirror, bundle reachability, and restore |
| `mirrorSource` | string | Approved canonical origin URL |
| `bundleSource` | string | Active local repository path |

`localHead`, local `main`, and `originMain` must be identical before a real backup mutates the
external drive. The canonical mirror and local bundle deliberately have different sources.

## Durable-ref policy

`refPolicy` contains:

| Field | Type | Meaning |
|---|---|---|
| `durableNamespaces` | string[] | Allowlist: `refs/heads/*`, `refs/tags/*`, `refs/notes/*` |
| `includedRefs` | string[] | Exact durable local refs selected for the bundle |
| `transientNamespacesExcluded` | object[] | `{namespace,count,longestRefLength}` summaries for excluded namespaces |
| `excludedRefCount` | integer | Total local refs excluded from source artifacts |
| `longestExcludedRefLength` | integer | Longest excluded name length; the full long name need not be logged |

Unknown namespaces are excluded by default. `refs/codex/*`, remote-tracking refs, bisect,
rewritten, worktree, editor, agent, merge, debug, and runtime checkpoint refs are not durable AION
source history. Exclusion does not delete them from the active repository. A future durable custom
namespace requires a versioned policy and schema update.

## Artifacts

| Field | Type | Meaning |
|---|---|---|
| `mirrorPath` | string | Installed canonical durable-ref mirror |
| `stagedMirrorPath` | string \| null | Candidate path; `null` after successful installation |
| `quarantinedMirrorPath` | string \| null | Preserved prior mirror moved aside during replacement |
| `bundlePath` | string | Immutable local durable-ref recovery bundle |
| `untrackedArchivePath` | string \| null | Archive of explicitly declared safe untracked files |
| `includedUntracked` | string[] | Deliberately included repository-relative paths |
| `exclusions` | string[] | Refused `.aion-local/`, private, secret, dependency, build, cache, and editor patterns |
| `checksums` | object | Absolute artifact path to lowercase SHA-256 |

The mirror is validated by exact ref checks, `git fsck --full`, and an independent clone. The
bundle must pass `git bundle verify`. Checksums prove later byte equality, not authenticity.

## Verification

| Field | Type | Meaning |
|---|---|---|
| `verificationCommand` | string | `npm run verify` |
| `regressionCommand` | string | `npm run test:backup-refs` |
| `controlPlaneCommand` | string | `npm run control-plane:test` when the control plane exists |
| `collectionCommand` | string | PowerShell zero/one/multiple collection regression command |
| `realGateCommand` | string | Real repository-gate regression command |
| `privacyBoundaryCommand` | string | Path, link, network, Git-ignore, and backup-exclusion regression command |
| `careerInputCommand` | string | Versioned career contracts, template, preflight, and architecture-boundary tests |
| `careerEvidenceCommand` | string | Synthetic catalogue, fact, profile, persistence, and architecture tests |
| `jobPostingCommand` | string | Synthetic Job Posting contract, source, currentness, import, persistence, and architecture tests |
| `expectedTests` | integer | Exact Node test count expected in restored verification |
| `restoreResult` | object \| null | Embedded `aion.restore-test.v1` evidence |
| `outcome` | string | `SUCCESS` or `FAILURE` |
| `failureReason` | string \| null | Exact failure message |

The restore result adds `mirror-ref-policy`, `backup-ref-regression`, and
`control-plane-regression` steps plus result fields. It must prove mirror `main`, absence of `refs/codex/*`, exact checkout,
successful `npm ci`, the expected passing test count with zero failures, and a passing synthetic
overlong-ref regression.

## Success invariant

All conditions are required:

```text
outcome                              == "SUCCESS"
localHead                            == originMain
expectedBackedUpCommit               == localHead
restoreResult                        != null
restoreResult.outcome                == "SUCCESS"
restoreResult.expectedCommit         == expectedBackedUpCommit
restoreResult.testsPassed            == expectedTests
restoreResult.testsFailed            == 0
restoreResult.regressionResult       == "PASS"
restoreResult.controlPlaneResult     == "PASS"
restoreResult.collectionResult       == "PASS"
restoreResult.realGateResult         == "PASS"
restoreResult.privacyBoundaryResult  == "PASS"
restoreResult.careerInputResult       == "PASS"
restoreResult.careerEvidenceResult    == "PASS"
restoreResult.jobPostingResult        == "PASS"
```

Artifact presence alone never means success.

## Compatibility and historical evidence

Version 2 is a breaking change because mirror and bundle semantics move from catch-all refs to a
durable allowlist. Version 1 manifests remain immutable historical evidence and must remain
readable under their original contract. In particular,
`D:\AION-backups\manifests\backup-20260806T163039Z.json` remains a version 1 `FAILURE`; it must
never be rewritten or described as successful.
