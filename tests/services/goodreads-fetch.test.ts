/**
 * Component: Goodreads Feed Fetch Tests
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Only https Goodreads hosts are ever requested: the feed URL is checked before the
 * first request and every redirect target is checked before it is followed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({ default: { get: axiosGet } }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const FEED = `<?xml version="1.0"?><rss><channel><title>Bob's bookshelf: to-read</title>
<item><book_id>1</book_id><title>Dune</title><author_name>Frank Herbert</author_name></item>
</channel></rss>`;

const ok = (data = FEED) => ({ status: 200, data, headers: {} });
const redirect = (location: string, status = 301) => ({ status, data: '', headers: { location } });

async function fetchFeed(url: string) {
  const { fetchAndValidateRss } = await import('@/lib/services/goodreads-sync.service');
  return fetchAndValidateRss(url);
}

const requested = () => axiosGet.mock.calls.map(([url]) => new URL(url).origin + new URL(url).pathname);

describe('fetchAndValidateRss', () => {
  beforeEach(() => {
    axiosGet.mockReset();
  });

  it('fetches the feed without letting axios follow redirects', async () => {
    axiosGet.mockResolvedValueOnce(ok());
    const result = await fetchFeed('https://www.goodreads.com/review/list_rss/1?shelf=to-read');

    expect(result.books).toHaveLength(1);
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(axiosGet.mock.calls[0][1]).toMatchObject({ maxRedirects: 0 });
    expect(axiosGet.mock.calls[0][0]).toContain('shelf=to-read');
  });

  it('upgrades a stored http:// Goodreads URL to https before fetching', async () => {
    axiosGet.mockResolvedValueOnce(ok());
    await fetchFeed('http://www.goodreads.com/review/list_rss/1');

    expect(requested()).toEqual(['https://www.goodreads.com/review/list_rss/1']);
  });

  it('follows a redirect between Goodreads hosts', async () => {
    axiosGet
      .mockResolvedValueOnce(redirect('https://www.goodreads.com/review/list_rss/1?shelf=to-read&page=1'))
      .mockResolvedValueOnce(ok());
    const result = await fetchFeed('https://goodreads.com/review/list_rss/1?shelf=to-read');

    expect(result.books).toHaveLength(1);
    expect(requested()).toEqual(['https://goodreads.com/review/list_rss/1', 'https://www.goodreads.com/review/list_rss/1']);
  });

  it('resolves a relative redirect against the current Goodreads URL', async () => {
    axiosGet.mockResolvedValueOnce(redirect('/review/list_rss/2', 302)).mockResolvedValueOnce(ok());
    await fetchFeed('https://www.goodreads.com/review/list_rss/1');

    expect(requested()[1]).toBe('https://www.goodreads.com/review/list_rss/2');
  });

  it.each([
    ['another host', 'http://169.254.169.254/latest/meta-data/'],
    ['a private address over https', 'https://10.0.0.5/review/list_rss/1'],
    ['Goodreads over plain http', 'http://www.goodreads.com/review/list_rss/1'],
    ['a look-alike host', 'https://www.goodreads.com.evil.example/review/list_rss/1'],
  ])('refuses a redirect to %s without requesting it', async (_label, location) => {
    axiosGet.mockResolvedValueOnce(redirect(location));

    await expect(fetchFeed('https://www.goodreads.com/review/list_rss/1')).rejects.toThrow(/only fetched from/);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many redirects', async () => {
    axiosGet.mockResolvedValue(redirect('https://www.goodreads.com/review/list_rss/1'));

    await expect(fetchFeed('https://www.goodreads.com/review/list_rss/1')).rejects.toThrow(/Too many redirects/);
    expect(axiosGet).toHaveBeenCalledTimes(4);
  });

  it('refuses a redirect with no target', async () => {
    axiosGet.mockResolvedValueOnce({ status: 302, data: '', headers: {} });

    await expect(fetchFeed('https://www.goodreads.com/review/list_rss/1')).rejects.toThrow(/without a redirect target/);
  });

  it.each([
    'http://10.0.0.1/goodreads.com/review/list_rss/1',
    'https://evilgoodreads.com/review/list_rss/1',
    'https://www.goodreads.com/user/show/1',
  ])('rejects %s without any request', async (url) => {
    await expect(fetchFeed(url)).rejects.toThrow(/Not a Goodreads shelf RSS URL/);
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
