/**
 * Component: In-memory request table for approve route tests
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Honours the `where` fields the approval path uses (id, status, deletedAt) on reads and
 * conditional writes, so a claim race behaves as in the database. Use from a vi.mock factory:
 *   vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/approval-db-fake')).approvalDb.prisma }));
 */

import { vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';

export const APPROVAL_AUDIOBOOK = { id: 'ab-1', title: 'The Book', author: 'An Author', audibleAsin: 'B000000001' };
export const APPROVAL_USER = { id: 'user-2', plexUsername: 'reader' };

const rows = new Map<string, Record<string, unknown>>();
const histories: Record<string, unknown>[] = [];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === null ? row[key] == null : row[key] === value));
}

function shaped(row: Record<string, unknown>, include: unknown) {
  return include ? { ...row, audiobook: { ...APPROVAL_AUDIOBOOK }, user: { ...APPROVAL_USER } } : { ...row };
}

function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value === Prisma.DbNull || value === Prisma.JsonNull ? null : value;
  }
}

const find = async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
  for (const row of rows.values()) if (matches(row, where)) return shaped(row, include);
  return null;
};

const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), count: vi.fn() });

export const approvalDb = {
  rows,
  histories,
  prisma: {
    request: {
      findFirst: vi.fn(find),
      findUnique: vi.fn(find),
      update: vi.fn(async ({ where, data, include }: { where: Record<string, unknown>; data: Record<string, unknown>; include?: unknown }) => {
        const row = [...rows.values()].find((r) => matches(r, where));
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        apply(row, data);
        return shaped(row, include);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hits = [...rows.values()].filter((r) => matches(r, where));
        hits.forEach((row) => apply(row, data));
        return { count: hits.length };
      }),
    },
    downloadHistory: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const history = { id: `dh-${histories.length + 1}`, ...data };
        histories.push(history);
        return history;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const history = histories.find((h) => h.id === where.id)!;
        Object.assign(history, data);
        return history;
      }),
    },
    apiToken: model(),
    configuration: model(),
    user: model(),
  },
  reset() {
    rows.clear();
    histories.length = 0;
  },
  seed(overrides: Record<string, unknown> = {}) {
    const row: Record<string, unknown> & { id: string } = {
      id: 'req-1',
      userId: APPROVAL_USER.id,
      audiobookId: APPROVAL_AUDIOBOOK.id,
      type: 'audiobook',
      status: 'awaiting_approval',
      selectedTorrent: null,
      approvalBypassedBy: null,
      placedEbookFiles: null,
      releaseDate: null,
      deletedAt: null,
      ...overrides,
    };
    rows.set(row.id, row);
    return row;
  },
};
