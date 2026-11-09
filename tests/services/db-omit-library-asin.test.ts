/**
 * Component: The stored library ASIN never reaches a response raw (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * The Prisma client omits `audiobooks.library_asin` from every audiobook result (an
 * `include: { audiobook: true }` in POST /api/requests and every other route included); only
 * queries that select it, or set `omit: { libraryAsin: false }`, read it for the overlay.
 */

import { describe, expect, it, vi } from 'vitest';

const constructed = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('@/generated/prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClient(options: Record<string, unknown>) {
    constructed.push(options);
    return { $disconnect: async () => undefined };
  }),
}));

describe('Prisma client options', () => {
  it('omit audiobook.libraryAsin globally', async () => {
    (globalThis as Record<symbol, unknown>)[Symbol.for('rmab.singleton.prisma')] = undefined;
    vi.resetModules();
    await import('@/lib/db');
    expect(constructed.at(-1)?.omit).toEqual({ audiobook: { libraryAsin: true } });
  });
});
