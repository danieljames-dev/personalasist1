/**
 * Conservative recovery-point retention.
 *
 * Backups accumulate: 26 encrypted artifacts had built up on the local disk before any policy
 * existed. Unbounded growth is a real cost, but over-eager pruning destroys the thing the backups
 * exist for, so this planner is deliberately timid. It is a *pure* function — it decides, it never
 * deletes — which keeps the dangerous half of the operation in one small, testable place.
 *
 * Three invariants hold regardless of how the count is tuned:
 *   1. the newest artifact is never pruned;
 *   2. the newest *verified* artifact is never pruned;
 *   3. an artifact that is the only off-disk copy is never pruned.
 */

export interface BackupArtifactV1 {
  /** Absolute path or stable identifier. */
  path: string;
  /** Sort key; larger is newer. */
  modifiedMs: number;
  /** True when integrity has been confirmed for this artifact. */
  verified: boolean;
  /** True when this artifact lives off the primary disk (the disaster-recovery copy). */
  offDisk: boolean;
}

export interface BackupRetentionPolicyV1 {
  /** How many artifacts to keep per location before considering pruning. */
  keepPerLocation: number;
}

export const DEFAULT_BACKUP_RETENTION: BackupRetentionPolicyV1 = { keepPerLocation: 12 };

export interface BackupRetentionPlanV1 {
  keep: BackupArtifactV1[];
  prune: Array<{ artifact: BackupArtifactV1; reason: string }>;
  protectedPaths: string[];
  policy: BackupRetentionPolicyV1;
}

/**
 * Decide which artifacts may be pruned. Nothing is removed here; the caller performs deletion and
 * is expected to stop on the first failure rather than continue.
 */
export function planBackupRetention(
  artifacts: readonly BackupArtifactV1[],
  policy: BackupRetentionPolicyV1 = DEFAULT_BACKUP_RETENTION,
): BackupRetentionPlanV1 {
  const keepPerLocation = Math.max(1, Math.floor(policy.keepPerLocation));
  const protectedPaths = new Set<string>();

  const newest = [...artifacts].sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
  if (newest) protectedPaths.add(newest.path);

  // Per-location, not global: a verified off-disk copy must not shadow — and so expose to pruning —
  // the newest verified copy held locally, and vice versa.
  for (const location of [false, true]) {
    const newestVerifiedHere = artifacts
      .filter((a) => a.offDisk === location && a.verified)
      .sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
    if (newestVerifiedHere) protectedPaths.add(newestVerifiedHere.path);
  }

  const offDisk = artifacts.filter((a) => a.offDisk);
  const offDiskVerified = offDisk.filter((a) => a.verified);
  // The only off-disk copy — verified if any are, otherwise the sole off-disk artifact — is the
  // last line of defence against losing the primary disk. It is never a pruning candidate.
  const offDiskPool = offDiskVerified.length > 0 ? offDiskVerified : offDisk;
  if (offDiskPool.length === 1) protectedPaths.add(offDiskPool[0]!.path);
  const newestOffDisk = [...offDiskPool].sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
  if (newestOffDisk) protectedPaths.add(newestOffDisk.path);

  const keep: BackupArtifactV1[] = [];
  const prune: Array<{ artifact: BackupArtifactV1; reason: string }> = [];

  for (const location of [false, true]) {
    const inLocation = artifacts
      .filter((a) => a.offDisk === location)
      .sort((a, b) => b.modifiedMs - a.modifiedMs);
    inLocation.forEach((artifact, index) => {
      if (protectedPaths.has(artifact.path)) {
        keep.push(artifact);
        return;
      }
      if (index < keepPerLocation) {
        keep.push(artifact);
        return;
      }
      prune.push({
        artifact,
        reason: `Beyond newest ${keepPerLocation} for ${location ? "off-disk" : "local"} location.`,
      });
    });
  }

  return { keep, prune, protectedPaths: [...protectedPaths], policy: { keepPerLocation } };
}
