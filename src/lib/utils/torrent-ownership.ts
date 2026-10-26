/**
 * Component: Torrent Ownership Rule
 * Documentation: documentation/phase3/download-clients.md
 *
 * Decides whether RMAB may remove (or change) the torrent of a download history row.
 * Every path that removes a torrent or changes it in the client asks this first.
 * Fails toward keeping: anything unclear keeps the torrent and writes nothing.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Legacy rows: a client added time this far before the row's createdAt still counts as RMAB's add */
export const LEGACY_ADDED_BEFORE_MS = 15 * MINUTE_MS;
/** Legacy rows: ... and this far after it (clock drift between the client host and RMAB) */
export const LEGACY_ADDED_AFTER_MS = 5 * MINUTE_MS;
/** Legacy rows: added at least this long before the grab = clearly someone else's (recorded false) */
export const LEGACY_CLEARLY_OLDER_MS = 24 * HOUR_MS;
/** Rows RMAB added: a client added time this long after the row = re-added by someone else */
export const READDED_AFTER_MS = HOUR_MS;
/** Rows RMAB added: a client added time at least this long before the row = an older copy (another client instance) */
export const OLDER_COPY_BEFORE_MS = LEGACY_CLEARLY_OLDER_MS;

export interface OwnershipRow {
  addedByRmab: boolean | null;
  createdAt: Date;
  downloadStatus?: string | null;
}

export type OwnershipVerdict =
  | { owned: true }
  | {
      owned: false;
      reason: 'removed' | 'taken-over' | 'readded' | 'older-copy' | 'legacy-taken-over' | 'legacy-unclear';
      /** Clear verdict on a legacy row: record false (or hard-delete a soft-deleted request's row) */
      recordNotOwned: boolean;
      /** Why the torrent is kept, for the log */
      detail: string;
    };

/** Known from the row alone (no client call): a removed or taken-over row is never removed by RMAB. */
export function knownNotOwned(row: OwnershipRow): OwnershipVerdict | null {
  if (row.downloadStatus === 'removed') {
    return {
      owned: false,
      reason: 'removed',
      recordNotOwned: false,
      detail: 'RMAB already recorded this torrent as gone; anything with this hash in the client now is not RMAB\'s',
    };
  }
  if (row.addedByRmab === false) {
    return {
      owned: false,
      reason: 'taken-over',
      recordNotOwned: false,
      detail: 'it was already there when RMAB grabbed it',
    };
  }
  return null;
}

function describeGap(addedAt: Date, createdAt: Date): string {
  const minutes = Math.round((addedAt.getTime() - createdAt.getTime()) / MINUTE_MS);
  return `client added time is ${Math.abs(minutes)} min ${minutes < 0 ? 'before' : 'after'} RMAB's grab`;
}

/**
 * Full rule, given the client's added time for the torrent (undefined when it reports none).
 * - addedByRmab true: ours, unless the client added it more than 1 h after the row (re-added) or at
 *   least 24 h before it (an older copy, e.g. another client instance of the same type); no added time = ours
 * - addedByRmab false or row removed: never ours
 * - null (recorded before the column existed): ours inside [createdAt - 15 min, createdAt + 5 min];
 *   clearly not ours when added at least 24 h before createdAt; anything else is unclear (kept)
 */
export function resolveOwnership(row: OwnershipRow, addedAt: Date | undefined): OwnershipVerdict {
  const known = knownNotOwned(row);
  if (known) return known;

  // createdAt is non-null in the schema; a missing one (NaN) fails every comparison below (true rows stay owned)
  const created = row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
  const added = addedAt && addedAt.getTime() > 0 ? addedAt.getTime() : undefined;

  if (row.addedByRmab === true) {
    if (added !== undefined && added - created > READDED_AFTER_MS) {
      return {
        owned: false,
        reason: 'readded',
        recordNotOwned: false,
        detail: `it was added again after RMAB's grab (${describeGap(addedAt!, row.createdAt)})`,
      };
    }
    if (added !== undefined && created - added >= OLDER_COPY_BEFORE_MS) {
      return {
        owned: false,
        reason: 'older-copy',
        recordNotOwned: false,
        detail: `the torrent in the client is older than RMAB's grab (${describeGap(addedAt!, row.createdAt)}): another copy`,
      };
    }
    return { owned: true };
  }

  // Legacy row (null)
  if (added === undefined || Number.isNaN(created)) {
    return {
      owned: false,
      reason: 'legacy-unclear',
      recordNotOwned: false,
      detail: 'recorded before RMAB tracked who added torrents, and the client reports no added time',
    };
  }
  if (added >= created - LEGACY_ADDED_BEFORE_MS && added <= created + LEGACY_ADDED_AFTER_MS) {
    return { owned: true };
  }
  if (created - added >= LEGACY_CLEARLY_OLDER_MS) {
    return {
      owned: false,
      reason: 'legacy-taken-over',
      recordNotOwned: true,
      detail: `it was already there when RMAB grabbed it (${describeGap(addedAt!, row.createdAt)})`,
    };
  }
  return {
    owned: false,
    reason: 'legacy-unclear',
    recordNotOwned: false,
    detail: `recorded before RMAB tracked who added torrents, and the ${describeGap(addedAt!, row.createdAt)}; checked again next run`,
  };
}
