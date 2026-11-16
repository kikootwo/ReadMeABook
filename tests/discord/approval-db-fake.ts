/**
 * Component: In-memory request table for approval tests
 * Documentation: documentation/admin-features/request-approval.md
 *
 * A Prisma stand-in for the request rows the approval service reads and writes. Reads and
 * writes honour plain `where` field equality (id, status, deletedAt), and `updateMany` applies
 * synchronously, so two callers racing for the same claim behave as one conditional UPDATE.
 * `hooks.beforeClaim` runs just before each conditional write (to change the row in between).
 * Use from a vi.mock factory: `vi.mock('@/lib/db', async () => (await import('./approval-db-fake')).fakePrisma(db))`.
 */

import { vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';

export interface FakeDb {
  rows: Map<string, Record<string, unknown>>;
  histories: Record<string, unknown>[];
  hooks: { beforeClaim?: (where: Record<string, unknown>) => void };
}

export const AUDIOBOOK = { id: 'ab-1', title: 'The Book', author: 'An Author', audibleAsin: 'B000000001', narrator: 'A Reader', coverArtUrl: null };
export const REQUESTER = { id: 'user-2', plexUsername: 'reader', discordUserId: '222222222222222222' };

export function createFakeDb(): FakeDb {
  return { rows: new Map(), histories: [], hooks: {} };
}

export function resetFakeDb(db: FakeDb): void {
  db.rows.clear();
  db.histories.length = 0;
  db.hooks = {};
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === null ? row[key] == null : row[key] === value));
}

function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value === Prisma.DbNull || value === Prisma.JsonNull ? null : value;
  }
}

/** Shapes a row like Prisma: `include` adds the relations, `select` keeps only the named fields. */
function shaped(row: Record<string, unknown>, args: { include?: unknown; select?: Record<string, unknown> }) {
  const full: Record<string, unknown> = { ...row, audiobook: { ...AUDIOBOOK }, user: { ...REQUESTER } };
  if (args.select) {
    return Object.fromEntries(Object.keys(args.select).map((key) => [key, full[key]]));
  }
  return args.include ? full : { ...row };
}

export function fakePrisma(db: FakeDb) {
  const find = async (args: { where: Record<string, unknown>; include?: unknown; select?: Record<string, unknown> }) => {
    for (const row of db.rows.values()) if (matches(row, args.where)) return shaped(row, args);
    return null;
  };
  return {
    prisma: {
      request: {
        findFirst: vi.fn(find),
        findUnique: vi.fn(find),
        update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown>; include?: unknown }) => {
          const row = [...db.rows.values()].find((r) => matches(r, args.where));
          if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
          apply(row, args.data);
          return shaped(row, args);
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          db.hooks.beforeClaim?.(where);
          const hits = [...db.rows.values()].filter((r) => matches(r, where));
          hits.forEach((row) => apply(row, data));
          return { count: hits.length };
        }),
      },
      downloadHistory: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const history = { id: `dh-${db.histories.length + 1}`, ...data };
          db.histories.push(history);
          return history;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const history = db.histories.find((h) => h.id === where.id)!;
          Object.assign(history, data);
          return history;
        }),
      },
    },
  };
}

export function seedRequest(db: FakeDb, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a',
    userId: REQUESTER.id,
    audiobookId: AUDIOBOOK.id,
    type: 'audiobook',
    status: 'awaiting_approval',
    selectedTorrent: null,
    approvalBypassedBy: null,
    placedEbookFiles: [{ path: '/library/Author/Book/book.epub', size: 1, sha256: 'abc', placedAt: '2026-01-01T00:00:00.000Z' }],
    releaseDate: null,
    deletedAt: null,
    discordCards: null,
    ...overrides,
  };
  db.rows.set(row.id as string, row);
  return row;
}
