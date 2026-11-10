/**
 * Component: Fetch E-book API, the ebook-sources gate uses the one shared rule
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The Library's viewer.canFetchEbook and this route's gate must give the same answer, so both call
 * ebookSourcesEnabled() (src/lib/services/ebook-sources.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const sourcesMock = vi.hoisted(() => ({ ebookSourcesEnabled: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addSearchEbookJob: vi.fn(() => Promise.resolve()) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/ebook-sources', () => sourcesMock);
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: vi.fn((_req: unknown, handler: () => unknown) => handler()),
}));

async function post() {
  const { POST } = await import('@/app/api/requests/[id]/fetch-ebook/route');
  return POST({} as Parameters<typeof POST>[0], { params: Promise.resolve({ id: 'req-1' }) });
}

describe('POST /api/requests/[id]/fetch-ebook ebook-sources gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The raw keys say a source is on; only the shared rule decides
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null
    );
    prismaMock.request.findFirst.mockResolvedValue(null);
  });

  it('answers 400 when the shared rule says no source is on', async () => {
    sourcesMock.ebookSourcesEnabled.mockResolvedValue(false);
    const response = await post();
    expect(response.status).toBe(400);
    expect(sourcesMock.ebookSourcesEnabled).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
  });

  it('goes on to the request lookup when the shared rule says a source is on', async () => {
    sourcesMock.ebookSourcesEnabled.mockResolvedValue(true);
    const response = await post();
    expect(response.status).toBe(404);
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });
});
