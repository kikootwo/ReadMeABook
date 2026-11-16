/**
 * Component: Audiobook columns left out of full-row reads (#325a library ASIN, #600 file size)
 * Documentation: documentation/backend/services/api-tokens.md, documentation/fixes/file-hash-matching.md
 *
 * The Prisma client omits `audiobooks.library_asin` and `audiobooks.file_size_bytes` from every
 * audiobook result (an `include: { audiobook: true }` in GET/POST /api/requests and every other
 * route included). The library ASIN reaches a response only through the overlay; the file size is
 * a BigInt, which `NextResponse.json` cannot serialize. Queries that select a column, or set
 * `omit: { <column>: false }`, still read it: GET /api/requests/:id returns the file size through
 * `toJsonSafe` for both the admin and the owner shape.
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
  it('omit audiobook.libraryAsin and audiobook.fileSizeBytes globally', async () => {
    (globalThis as Record<symbol, unknown>)[Symbol.for('rmab.singleton.prisma')] = undefined;
    vi.resetModules();
    await import('@/lib/db');
    expect(constructed.at(-1)?.omit).toEqual({ audiobook: { libraryAsin: true, fileSizeBytes: true } });
  });

  it('GET /api/requests/:id still reads audiobook.fileSizeBytes (admin and owner shapes)', async () => {
    const { ADMIN_REQUEST_DETAIL_INCLUDE, OWNER_REQUEST_DETAIL_SELECT } = await import('@/lib/services/request-detail-query');
    expect(ADMIN_REQUEST_DETAIL_INCLUDE.audiobook.omit).toMatchObject({ fileSizeBytes: false });
    expect(OWNER_REQUEST_DETAIL_SELECT.audiobook.select.fileSizeBytes).toBe(true);
  });
});
