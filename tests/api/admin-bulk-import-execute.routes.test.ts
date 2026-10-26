/**
 * Component: Admin Bulk Import Execute API Route Tests (request size limit)
 * Documentation: documentation/backend/validation.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const fsMock = vi.hoisted(() => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => {
    req.user = { id: 'admin-1', role: 'admin' };
    return handler(req);
  },
  requireAdmin: (_req: any, handler: any) => handler(),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({ addOrganizeJob: vi.fn() }),
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn() }),
}));

vi.mock('fs/promises', () => fsMock);

/** About 2 MB: 1,000 books with 60 file names each. */
function largeImportBody(): string {
  const imports = Array.from({ length: 1000 }, (_, book) => ({
    folderPath: `/outside/Author ${book}/Book Title Number ${book}`,
    asin: `B0${String(book).padStart(8, '0')}`,
    audioFiles: Array.from({ length: 60 }, (_, track) => `Book Title Number ${book} - Part ${track}.mp3`),
  }));
  return JSON.stringify({ imports });
}

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/admin/bulk-import/execute', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Admin bulk-import execute route: request size limit (32 MB)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));
  });

  // Guard (passes on main too): a large selection stays within the bulk import limit
  it('accepts a ~2 MB import list', async () => {
    const body = largeImportBody();
    expect(body.length).toBeGreaterThan(2 * 1024 * 1024);
    const { POST } = await import('@/app/api/admin/bulk-import/execute/route');

    const response = await POST(post(body));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary.total).toBe(1000);
  });

  it('returns 413 when the Content-Length is over 32 MB', async () => {
    const { POST } = await import('@/app/api/admin/bulk-import/execute/route');

    const response = await POST(post('{}', { 'content-length': String(33 * 1024 * 1024) }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'PayloadTooLarge', message: 'Request body is larger than 32 MB' });
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });
});
