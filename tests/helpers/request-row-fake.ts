/**
 * Component: One request row behind a Prisma mock (test helper, #216)
 * Documentation: documentation/backend/database.md
 *
 * `request.update` and `request.updateMany` apply a write to one in-memory row the
 * way Postgres would: update always (by id), updateMany only where its filter
 * matches (equality, null and `{ not }`). A write without `status` in its data
 * (a progress-only write) can be held back and released later, to land it after
 * the writes that follow it in the code.
 */

import type { Mock } from 'vitest';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

export function fakeRequestRow(
  requestMock: { update: Mock; updateMany: Mock },
  initial: Row,
  options: { holdProgressOnlyWrites?: boolean } = {}
) {
  const row: Row = { ...initial };
  const held: Array<() => void> = [];

  const matches = (where: Where) => Object.entries(where).every(([key, want]) =>
    want !== null && typeof want === 'object' && 'not' in want
      ? row[key] !== (want as { not: unknown }).not
      : row[key] === want
  );
  const apply = (data: Data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === null || typeof value !== 'object' || value instanceof Date) row[key] = value; // skip { increment }
    }
  };
  const run = (data: Data, write: () => unknown) =>
    options.holdProgressOnlyWrites && !('status' in data)
      ? new Promise((resolve) => { held.push(() => resolve(write())); })
      : Promise.resolve(write());

  requestMock.update.mockImplementation(({ data }: { data: Data }) =>
    run(data, () => { apply(data); return { ...row }; }));
  requestMock.updateMany.mockImplementation(({ where, data }: { where: Where; data: Data }) =>
    run(data, () => {
      if (!matches(where)) return { count: 0 };
      apply(data);
      return { count: 1 };
    }));

  return {
    row,
    /** Lets every held write land, in order, waits for them and returns how many there were. */
    async releaseHeld(): Promise<number> {
      const writes = held.splice(0);
      writes.forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
      return writes.length;
    },
  };
}
