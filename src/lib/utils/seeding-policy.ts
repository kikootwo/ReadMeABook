/**
 * Component: Per-Indexer Seeding Policy
 * Documentation: documentation/backend/services/scheduler.md
 *
 * One answer to "is this torrent done seeding?", shared by the scheduled
 * seeding cleanup and request deletion.
 */

/** Per-indexer thresholds from `prowlarr_indexers`. 0 (or missing) disables a criterion. */
export interface SeedingRequirement {
  seedingTimeMinutes?: number;
  ratioLimit?: number;
}

/** What the download client reports for the torrent. */
export interface SeedingProgress {
  /** Seconds spent seeding. */
  seedingTime?: number;
  /** Upload/download ratio; undefined when the client does not report one. */
  ratio?: number;
}

export interface SeedingEvaluation {
  /** No config, or both criteria 0: the torrent seeds forever and is never cleaned up. */
  unlimited: boolean;
  /** Every enabled criterion is met (always false when unlimited). */
  met: boolean;
  /** e.g. `ratio 1.20/2.00, time 45/60 min` (`--/--` for a disabled criterion). */
  progress: string;
}

/**
 * AND-semantics across seeding time and ratio. Each criterion is met when it
 * is disabled (0) or the actual value meets or exceeds it. An unreported
 * ratio with ratioLimit > 0 is not met (safe-deny).
 */
export function evaluateSeeding(
  requirement: SeedingRequirement | null | undefined,
  actual: SeedingProgress
): SeedingEvaluation {
  const seedingMin = requirement?.seedingTimeMinutes ?? 0;
  const ratioMin = requirement?.ratioLimit ?? 0;
  const seedingTime = actual.seedingTime ?? 0;
  const ratio = actual.ratio;

  const ratioPart = ratioMin === 0
    ? '--/--'
    : `${(typeof ratio === 'number' ? ratio : 0).toFixed(2)}/${ratioMin.toFixed(2)}`;
  const timePart = seedingMin === 0 ? '--/--' : `${Math.floor(seedingTime / 60)}/${seedingMin}`;
  const progress = `ratio ${ratioPart}, time ${timePart} min`;

  if (!requirement || (seedingMin === 0 && ratioMin === 0)) {
    return { unlimited: true, met: false, progress };
  }

  const timeMet = seedingMin === 0 || seedingTime >= seedingMin * 60;
  const ratioMet = ratioMin === 0 || (typeof ratio === 'number' && ratio >= ratioMin);
  return { unlimited: false, met: timeMet && ratioMet, progress };
}

/** True when the indexer config never asks for cleanup (no config, or both criteria 0). */
export function isUnlimitedSeeding(requirement: SeedingRequirement | null | undefined): boolean {
  return evaluateSeeding(requirement, {}).unlimited;
}
