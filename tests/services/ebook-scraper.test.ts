/**
 * Component: E-book Sidecar Service Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import { clearMd5Cache, downloadEbook, testFlareSolverrConnection } from '@/lib/services/ebook-scraper';

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const AxiosErrorMock = vi.hoisted(() =>
  class MockAxiosError extends Error {
    code?: string;
    response?: { status?: number };
    config?: { url?: string };
    constructor(message?: string) {
      super(message);
      this.name = 'AxiosError';
    }
  }
);

const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  unlink: vi.fn(),
}));

const fsCoreMock = vi.hoisted(() => ({
  createWriteStream: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
  AxiosError: AxiosErrorMock,
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));
vi.mock('fs', () => fsCoreMock);

describe('E-book sidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.unlink.mockResolvedValue(undefined);
    clearMd5Cache();
    vi.useRealTimers();
  });

  it('tests FlareSolverr connections', async () => {
    const longHtml = `<html>${'Anna'.padEnd(1200, 'A')}</html>`;
    axiosMock.post.mockResolvedValue({
      data: {
        status: 'ok',
        solution: { status: 200, response: longHtml },
      },
    });

    const result = await testFlareSolverrConnection('http://flare', 'https://annas-archive.gl');

    expect(result.success).toBe(true);
    expect(result.responseTime).toBeTypeOf('number');
  });

  it('uses configured base URL for FlareSolverr test', async () => {
    const longHtml = `<html>${'Anna'.padEnd(1200, 'A')}</html>`;
    axiosMock.post.mockResolvedValue({
      data: {
        status: 'ok',
        solution: { status: 200, response: longHtml },
      },
    });

    await testFlareSolverrConnection('http://flare', 'https://custom-mirror.org');

    expect(axiosMock.post).toHaveBeenCalledWith(
      'http://flare/v1',
      expect.objectContaining({ url: 'https://custom-mirror.org/' }),
      expect.any(Object)
    );
  });

  it('returns false when FlareSolverr response is invalid', async () => {
    axiosMock.post.mockResolvedValue({
      data: {
        status: 'ok',
        solution: { status: 200, response: '<html>nope</html>' },
      },
    });

    const result = await testFlareSolverrConnection('http://flare', 'https://annas-archive.gl');

    expect(result.success).toBe(false);
  });

  it('returns error details when FlareSolverr request fails', async () => {
    axiosMock.post.mockRejectedValue(new Error('flare down'));

    const result = await testFlareSolverrConnection('http://flare', 'https://annas-archive.gl');

    expect(result.success).toBe(false);
    expect(result.message).toContain('flare down');
  });

  it('returns errors when FlareSolverr reports failure status', async () => {
    axiosMock.post.mockResolvedValue({
      data: {
        status: 'error',
        message: 'bad',
      },
    });

    const result = await testFlareSolverrConnection('http://flare', 'https://annas-archive.gl');

    expect(result.success).toBe(false);
    expect(result.message).toContain('FlareSolverr error');
  });

  it('returns errors when FlareSolverr responds with HTTP errors', async () => {
    axiosMock.post.mockResolvedValue({
      data: {
        status: 'ok',
        solution: { status: 403, response: '<html></html>' },
        message: 'Forbidden',
      },
    });

    const result = await testFlareSolverrConnection('http://flare', 'https://annas-archive.gl');

    expect(result.success).toBe(false);
    expect(result.message).toContain('FlareSolverr returned HTTP 403');
  });

  it('downloads an ebook from ASIN search', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.unlink.mockResolvedValue(undefined);

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abc123">Result</a>' };
      }
      if (url.includes('/md5/abc123')) {
        return { data: '<li><a href="/slow_download/abc123/0/5">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      if (url === 'https://files.example.com/book.epub' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => {
              // Use microtask to emit before timers run (avoids race with download timeout)
              queueMicrotask(() => dest.emit('finish'));
              return dest;
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN1', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.format).toBe('epub');
    expect(result.filePath).toBe(path.join('/downloads', 'Title - Author.epub'));

    vi.useRealTimers();
  });

  it('falls back to title search when ASIN search has no results', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.unlink.mockResolvedValue(undefined);

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    axiosMock.post.mockRejectedValue(new Error('flare down'));
    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?') && (url.includes('asin%3A') || url.includes('asin:'))) {
        return { data: '<html></html>' };
      }
      if (url.includes('/search?') && url.includes('termtype_1=author')) {
        return { data: '<a href="/md5/abc123">Result</a>' };
      }
      if (url.includes('/md5/abc123')) {
        return { data: '<li><a href="/slow_download/abc123/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/')) {
        return { data: '<pre>https://files.example.com/book.pdf</pre>' };
      }
      if (url === 'https://files.example.com/book.pdf' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => {
              // Use microtask to emit before timers run (avoids race with download timeout)
              queueMicrotask(() => dest.emit('finish'));
              return dest;
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN-NO', 'Title', 'Author', '/downloads', 'pdf', 'https://annas-archive.gl', undefined, 'http://flare');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.format).toBe('pdf');
    expect(axiosMock.post).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('returns an error when no download links are available', async () => {
    vi.useFakeTimers();

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abcd12">Result</a>' };
      }
      if (url.includes('/md5/abcd12')) {
        return { data: '<li><a href="/slow_download/abcd12/0/1">Slow</a></li>' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN3', 'Missing', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No download links available');

    vi.useRealTimers();
  });

  it('returns success when file already exists', async () => {
    vi.useFakeTimers();

    fsMock.access.mockResolvedValue(undefined);

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abcdef">Result</a>' };
      }
      if (url.includes('/md5/abcdef')) {
        return { data: '<li><a href="/slow_download/abcdef/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN4', 'Existing', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(path.join('/downloads', 'Existing - Author.epub'));

    vi.useRealTimers();
  });

  it('returns an error when downloads fail', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.unlink.mockResolvedValue(undefined);

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/deadbeef">Result</a>' };
      }
      if (url.includes('/md5/deadbeef')) {
        return { data: '<li><a href="/slow_download/deadbeef/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      if (url === 'https://files.example.com/book.epub' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => {
              setTimeout(() => dest.emit('error', new Error('download error')), 0);
              return dest;
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN5', 'Fail', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('download attempts failed');

    vi.useRealTimers();
  });

  it('uses cached ASIN search results on repeat calls', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.unlink.mockResolvedValue(undefined);

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    let searchCalls = 0;
    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        searchCalls += 1;
        if (searchCalls > 1) {
          throw new Error('Search called twice');
        }
        return { data: '<a href="/md5/cafebabe">Result</a>' };
      }
      if (url.includes('/md5/cafebabe')) {
        return { data: '<li><a href="/slow_download/cafebabe/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      if (url === 'https://files.example.com/book.epub' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => {
              // Use microtask to emit before timers run (avoids race with download timeout)
              queueMicrotask(() => dest.emit('finish'));
              return dest;
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const first = downloadEbook('ASIN6', 'Cached', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    await first;

    const second = downloadEbook('ASIN6', 'Cached', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await second;

    expect(result.success).toBe(true);
    expect(searchCalls).toBe(1);

    vi.useRealTimers();
  });

  it('returns an error when no results are found', async () => {
    vi.useFakeTimers();

    axiosMock.get.mockResolvedValue({ data: '<html></html>' });

    const promise = downloadEbook('ASIN2', 'Missing', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No search results');

    vi.useRealTimers();
  });

  it('uses FlareSolverr when configured for HTML fetches', async () => {
    vi.useFakeTimers();

    axiosMock.post
      .mockResolvedValueOnce({
        data: {
          status: 'ok',
          solution: { status: 200, response: '<a href="/md5/abc123">Result</a>' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: 'ok',
          solution: { status: 200, response: '<html>No links</html>' },
        },
      });

    const promise = downloadEbook(
      'ASIN7',
      'Title',
      'Author',
      '/downloads',
      'epub',
      'https://annas-archive.gl',
      undefined,
      'http://flare'
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No download links');
    expect(axiosMock.get).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('filters ASIN search results and warns on challenge pages', async () => {
    vi.useFakeTimers();

    const searchHtml = `
      <div class="js-recent-downloads-container">
        <a href="/md5/abc111">Recent</a>
      </div>
      <div class="js-partial-matches-show">
        <a href="/md5/abc222">Partial</a>
      </div>
      <a href="/md5/abc333">Valid</a>
    `;
    const md5Html = '<html>challenge-running</html>';

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: searchHtml };
      }
      if (url.includes('/md5/abc333')) {
        return { data: md5Html };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN8', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No download links');

    vi.useRealTimers();
  });

  it('returns empty slow links when md5 page fetch fails', async () => {
    vi.useFakeTimers();

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abc123">Result</a>' };
      }
      if (url.includes('/md5/abc123')) {
        throw new Error('md5 down');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN9', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No download links');

    vi.useRealTimers();
  });

  it('returns errors when no download URL is found on slow pages', async () => {
    vi.useFakeTimers();

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abc123">Result</a>' };
      }
      if (url.includes('/md5/abc123')) {
        return { data: '<li><a href="/slow_download/abc123/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/abc123/0/1')) {
        return { data: '<html>No url here</html>' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN10', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('All 1 download attempts failed');

    vi.useRealTimers();
  });

  it('marks attempts failed when direct downloads fail', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));

    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abc123">Result</a>' };
      }
      if (url.includes('/md5/abc123')) {
        return { data: '<li><a href="/slow_download/abc123/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/abc123/0/1')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      if (url === 'https://files.example.com/book.epub' && config?.responseType === 'stream') {
        throw new Error('download failed');
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN11', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('All 1 download attempts failed');

    vi.useRealTimers();
  });

  it('returns errors when logger throws during download', async () => {
    const logger = {
      info: vi.fn(() => {
        throw new Error('logger boom');
      }),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await downloadEbook('ASIN12', 'Title', 'Author', '/downloads', 'epub', undefined, logger as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('logger boom');
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns null when ASIN and title searches fail', async () => {
    vi.useFakeTimers();

    const error = new AxiosErrorMock('network down');
    error.code = 'ENOTFOUND';

    axiosMock.get.mockRejectedValue(error);

    const promise = downloadEbook('ASIN13', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('No search results found');

    vi.useRealTimers();
  });

  it('uses cached MD5 values for title searches', async () => {
    vi.useFakeTimers();

    const searchHtml = `
      <div class="js-recent-downloads-container">
        <a href="/md5/recent">Recent</a>
      </div>
      <div class="js-partial-matches-show">
        <a href="/md5/partial">Partial</a>
      </div>
      <a href="/md5/cached">Valid</a>
    `;

    axiosMock.get.mockImplementation(async (url: string) => {
      if (url.includes('/search?')) {
        return { data: searchHtml };
      }
      if (url.includes('/md5/cached')) {
        return { data: '<html></html>' };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const first = downloadEbook('', 'Cached', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    await first;

    const second = downloadEbook('', 'Cached', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await second;

    const searchCalls = axiosMock.get.mock.calls.filter(([url]) => String(url).includes('/search?'));
    expect(searchCalls).toHaveLength(1);
    expect(result.success).toBe(false);

    vi.useRealTimers();
  });

  it('downloads files when format is any and URL is in body text', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/deadbeef">Result</a>' };
      }
      if (url.includes('/md5/deadbeef')) {
        return { data: '<li><a href="/slow_download/deadbeef/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/deadbeef/0/1')) {
        return { data: '<body>https://files.example.com/book.pdf</body>' };
      }
      if (url === 'https://files.example.com/book.pdf' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => {
              // Use microtask to emit before timers run (avoids race with download timeout)
              queueMicrotask(() => dest.emit('finish'));
              return dest;
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN14', 'Any', 'Author', '/downloads', 'any');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.format).toBe('pdf');

    vi.useRealTimers();
  });

  it('times out downloads that never finish', async () => {
    vi.useFakeTimers();

    fsMock.access.mockRejectedValue(new Error('missing'));

    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);

    axiosMock.get.mockImplementation(async (url: string, config?: any) => {
      if (url.includes('/search?')) {
        return { data: '<a href="/md5/abc999">Result</a>' };
      }
      if (url.includes('/md5/abc999')) {
        return { data: '<li><a href="/slow_download/abc999/0/1">Slow</a> (no waitlist)</li>' };
      }
      if (url.includes('/slow_download/abc999/0/1')) {
        return { data: '<pre>https://files.example.com/book.epub</pre>' };
      }
      if (url === 'https://files.example.com/book.epub' && config?.responseType === 'stream') {
        return {
          data: {
            pipe: (dest: EventEmitter) => dest,
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const promise = downloadEbook('ASIN15', 'Title', 'Author', '/downloads');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('All 1 download attempts failed');

    vi.useRealTimers();
  });
});
