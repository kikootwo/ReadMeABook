/**
 * Component: Goodreads Shelves API Route Tests (add shelf)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Only https Goodreads shelf feed URLs are accepted; anything else is refused
 * before any fetch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const fetchRssMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ addSyncShelvesJob: vi.fn(() => Promise.resolve()) }));
const authRequest = vi.hoisted(() => ({ user: { id: 'user-1', role: 'user' }, json: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler(authRequest),
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/goodreads-sync.service', () => ({ fetchAndValidateRss: fetchRssMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

async function addShelf(rssUrl: unknown) {
  authRequest.json.mockResolvedValue({ rssUrl });
  const { POST } = await import('@/app/api/user/goodreads-shelves/route');
  return POST({} as any);
}

describe('POST /api/user/goodreads-shelves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.goodreadsShelf.findUnique.mockResolvedValue(null);
    prismaMock.goodreadsShelf.create.mockImplementation(async ({ data }: any) => ({ id: 'shelf-1', ...data }));
    fetchRssMock.mockResolvedValue({ shelfName: 'to-read', books: [] });
  });

  it.each([
    ['another host with the Goodreads path in it', 'http://169.254.169.254/goodreads.com/review/list_rss/1'],
    ['a look-alike host', 'https://www.goodreads.com.evil.example/review/list_rss/1'],
    ['a non-feed Goodreads page', 'https://www.goodreads.com/user/show/1'],
    ['a non-string', 42],
  ])('refuses %s without fetching', async (_label, rssUrl) => {
    const response = await addShelf(rssUrl);

    expect(response.status).toBe(400);
    expect(fetchRssMock).not.toHaveBeenCalled();
    expect(prismaMock.goodreadsShelf.create).not.toHaveBeenCalled();
  });

  it('adds a Goodreads shelf feed, storing an http:// link as https://', async () => {
    const response = await addShelf('http://www.goodreads.com/review/list_rss/12345?shelf=to-read');

    expect(response.status).toBeLessThan(300);
    expect(fetchRssMock).toHaveBeenCalledWith('https://www.goodreads.com/review/list_rss/12345?shelf=to-read');
    expect(prismaMock.goodreadsShelf.create.mock.calls[0][0].data.rssUrl).toBe('https://www.goodreads.com/review/list_rss/12345?shelf=to-read');
  });
});
