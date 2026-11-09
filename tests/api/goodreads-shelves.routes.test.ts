/**
 * Component: Goodreads Shelves API Route Tests (add shelf)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Only Goodreads shelf feed URLs are accepted (saved as https://www.goodreads.com/...);
 * anything else is refused before any fetch. Duplicates are found by normalised URL.
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

const FEED = 'https://www.goodreads.com/review/list_rss/12345?shelf=to-read';

async function addShelf(rssUrl: unknown) {
  authRequest.json.mockResolvedValue({ rssUrl });
  const { POST } = await import('@/app/api/user/goodreads-shelves/route');
  return POST({} as any);
}

describe('POST /api/user/goodreads-shelves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([]);
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

  it('returns the validation message for the UI', async () => {
    const response = await addShelf('https://evil.example/review/list_rss/1');

    expect((await response.json()).message).toContain('https://www.goodreads.com/review/list_rss/');
  });

  it('saves an http:// or bare goodreads.com link as https://www.goodreads.com', async () => {
    const response = await addShelf('http://goodreads.com/review/list_rss/12345?shelf=to-read');

    expect(response.status).toBe(201);
    expect(fetchRssMock).toHaveBeenCalledWith(FEED);
    expect(prismaMock.goodreadsShelf.create.mock.calls[0][0].data.rssUrl).toBe(FEED);
  });

  it('treats an older stored form of the same feed as a duplicate, without fetching', async () => {
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([
      { id: 'old', rssUrl: 'http://goodreads.com/review/list_rss/12345?shelf=to-read' },
    ]);
    const response = await addShelf(FEED);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DuplicateShelf');
    expect(fetchRssMock).not.toHaveBeenCalled();
    expect(prismaMock.goodreadsShelf.create).not.toHaveBeenCalled();
  });

  it('does not treat a different shelf of the same user as a duplicate', async () => {
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([
      { id: 'other', rssUrl: 'https://www.goodreads.com/review/list_rss/12345?shelf=read' },
    ]);
    const response = await addShelf(FEED);

    expect(response.status).toBe(201);
  });

  it('says Goodreads no longer serves shelf feeds when the feed is gone, and saves nothing (#514)', async () => {
    const { GoodreadsFeedEndedError, GOODREADS_FEEDS_ENDED_ADD_MESSAGE } = await import('@/lib/utils/goodreads-rss-url');
    fetchRssMock.mockRejectedValue(new GoodreadsFeedEndedError(404));
    const response = await addShelf(FEED);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('GoodreadsFeedsEnded');
    expect(body.message).toBe(GOODREADS_FEEDS_ENDED_ADD_MESSAGE);
    expect(body.message).toMatch(/^Goodreads no longer serves shelf RSS feeds/);
    expect(body.message).not.toContain('Could not fetch or parse');
    expect(prismaMock.goodreadsShelf.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSyncShelvesJob).not.toHaveBeenCalled();
  });

  it('keeps the fetch-or-parse message for other feed failures', async () => {
    fetchRssMock.mockRejectedValue(new Error('Invalid Goodreads RSS: no channel element'));
    const body = await (await addShelf(FEED)).json();

    expect(body.error).toBe('InvalidRSS');
    expect(body.message).toBe('Could not fetch or parse the RSS feed: Invalid Goodreads RSS: no channel element');
  });

  it('returns 409 when a concurrent add wins the unique constraint', async () => {
    prismaMock.goodreadsShelf.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const response = await addShelf(FEED);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DuplicateShelf');
  });
});
