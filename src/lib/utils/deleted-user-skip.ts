/**
 * Component: Deleted-User Skip for Background Runs
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Shelves and watches of a soft-deleted user (User.deletedAt set) are skipped by
 * the scheduled and manual runs (#504). Their rows and requests are kept.
 */

/** Prisma `select` for the user of a shelf or watch: the fields the runs read */
export const SYNC_USER_SELECT = { id: true, plexUsername: true, deletedAt: true } as const;

/**
 * The rows whose user is not deleted. Logs one line with the number skipped
 * (`Skipped N <what> whose user is deleted`) when any are.
 */
export function withoutDeletedUsers<T extends { user: { deletedAt: Date | null } }>(
  rows: T[],
  what: string,
  log: { info: (message: string) => void },
): T[] {
  const active = rows.filter((row) => row.user.deletedAt == null);
  const skipped = rows.length - active.length;
  if (skipped > 0) log.info(`Skipped ${skipped} ${what} whose user is deleted`);
  return active;
}
