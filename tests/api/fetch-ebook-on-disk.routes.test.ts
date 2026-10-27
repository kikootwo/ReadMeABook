/**
 * Component: Fetch E-book API Tests, a manual fetch with an ebook already on disk (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The on-disk check only gates the automatic paths: an admin's Fetch Ebook still
 * creates the request and starts the search when the book folder holds an ebook.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addSearchEbookJob: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-313-manual-'));
  await fs.writeFile(path.join(dir, '01.mp3'), 'x');
  await fs.writeFile(path.join(dir, 'Book.epub'), 'x');
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null
  );
  prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ebook-manual', ...args.data }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('POST /api/requests/[id]/fetch-ebook with an ebook already in the book folder', () => {
  it('still creates the ebook request and starts the search', async () => {
    prismaMock.request.findFirst
      .mockResolvedValueOnce({
        id: 'req-1',
        userId: 'user-1',
        audiobookId: 'ab-1',
        status: 'available',
        customSearchTerms: null,
        audiobook: { id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN1', filePath: dir },
      })
      .mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
    const response = await POST({} as Parameters<typeof POST>[0], { params: Promise.resolve({ id: 'req-1' }) });
    const payload = await response.json();

    expect(payload).toMatchObject({ success: true, requestId: 'ebook-manual' });
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'ebook', parentRequestId: 'req-1', status: 'pending' }),
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-manual', expect.objectContaining({ id: 'ab-1' }));
  });
});
