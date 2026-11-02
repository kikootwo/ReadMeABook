/**
 * Component: E-book Sidecar Service Tests (URL joining)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMd5Cache,
  getSlowDownloadLinks,
  searchByAsin,
  searchByTitle,
  testFlareSolverrConnection,
} from '@/lib/services/ebook-scraper';

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
  AxiosError: class extends Error {},
}));

const okSolution = (response: string) => ({
  data: { status: 'ok', solution: { status: 200, response } },
});

const flareBases: Array<[string, string]> = [
  ['http://host:8191', 'http://host:8191/v1'],
  ['http://host:8191/', 'http://host:8191/v1'],
  ['http://host:8191//', 'http://host:8191/v1'],
  ['http://host/flaresolverr/', 'http://host/flaresolverr/v1'],
];

const annasBases = ['https://annas-archive.gl', 'https://annas-archive.gl/', 'https://annas-archive.gl//'];

describe('E-book sidecar URL joining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMd5Cache();
  });

  it.each(flareBases)('connection test with FlareSolverr at %s posts to %s', async (base, endpoint) => {
    axiosMock.post.mockResolvedValue(okSolution(`<html>${'Anna'.padEnd(1200, 'A')}</html>`));

    const result = await testFlareSolverrConnection(base, 'https://annas-archive.gl');

    expect(result.success).toBe(true);
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
    expect(axiosMock.post.mock.calls[0][0]).toBe(endpoint);
  });

  it.each(flareBases)('page fetches with FlareSolverr at %s post to %s', async (base, endpoint) => {
    axiosMock.post.mockResolvedValue(okSolution('<html>No links</html>'));

    await getSlowDownloadLinks('abc123', 'https://annas-archive.gl', undefined, base);

    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
    expect(axiosMock.post.mock.calls[0][0]).toBe(endpoint);
  });

  it.each(annasBases)("connection test targets the Anna's Archive root once for %s", async (baseUrl) => {
    axiosMock.post.mockResolvedValue(okSolution(`<html>${'Anna'.padEnd(1200, 'A')}</html>`));

    await testFlareSolverrConnection('http://host:8191', baseUrl);

    expect(axiosMock.post.mock.calls[0][1]).toEqual(expect.objectContaining({ url: 'https://annas-archive.gl/' }));
  });

  it.each(annasBases)("Anna's Archive pages built from %s have a single slash", async (baseUrl) => {
    axiosMock.get.mockResolvedValue({
      data:
        '<li><a href="/slow_download/abc123/0/0">Slow Partner Server #1</a> (no waitlist)</li>',
    });

    await searchByAsin('B000000001', 'epub', baseUrl);
    await searchByTitle('Title', 'Author', 'epub', baseUrl);
    const links = await getSlowDownloadLinks('abc123', baseUrl);

    const fetched = axiosMock.get.mock.calls.map((call) => call[0] as string);
    expect(fetched).toEqual([
      expect.stringMatching(/^https:\/\/annas-archive\.gl\/search\?/),
      expect.stringMatching(/^https:\/\/annas-archive\.gl\/search\?/),
      'https://annas-archive.gl/md5/abc123',
    ]);
    expect(links).toEqual(['https://annas-archive.gl/slow_download/abc123/0/0']);
  });
});
