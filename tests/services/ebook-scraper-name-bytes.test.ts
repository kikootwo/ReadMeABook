/**
 * Component: E-book Download Name Byte Limit Tests (#474)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import { clearMd5Cache, downloadEbook } from '@/lib/services/ebook-scraper';

const axiosMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const fsMock = vi.hoisted(() => ({ access: vi.fn(), unlink: vi.fn() }));
const fsCoreMock = vi.hoisted(() => ({ createWriteStream: vi.fn() }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock, AxiosError: class extends Error {} }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('fs', () => fsCoreMock);

const MAX = 255;
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

/** Run a download that succeeds and return the file name it was written under */
async function downloadedName(title: string, author: string, format = 'epub'): Promise<string> {
  const fileUrl = `https://files.example.com/book.${format}`;
  axiosMock.get.mockImplementation(async (url: string, config?: { responseType?: string }) => {
    if (url.includes('/search?')) return { data: '<a href="/md5/abc123">Result</a>' };
    if (url.includes('/md5/abc123')) return { data: '<li><a href="/slow_download/abc123/0/5">Slow</a> (no waitlist)</li>' };
    if (url.includes('/slow_download/')) return { data: `<pre>${fileUrl}</pre>` };
    if (url === fileUrl && config?.responseType === 'stream') {
      return { data: { pipe: (dest: EventEmitter) => { queueMicrotask(() => dest.emit('finish')); return dest; } } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });

  const promise = downloadEbook('ASIN474', title, author, '/downloads', format);
  await vi.runAllTimersAsync();
  const result = await promise;

  expect(result.success).toBe(true);
  expect(path.dirname(result.filePath!)).toBe(path.join('/downloads'));
  return path.basename(result.filePath!);
}

/** At most 255 bytes, valid UTF-8 (a split surrogate pair would not survive the round trip) */
function expectFits(name: string, extension: string) {
  expect(bytes(name)).toBeLessThanOrEqual(MAX);
  expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
  expect(name.endsWith(extension)).toBe(true);
}

describe('ebook download name fits in 255 bytes (#474)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearMd5Cache();
    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.unlink.mockResolvedValue(undefined);
    const writer = new EventEmitter() as EventEmitter & { close: () => void };
    writer.close = vi.fn();
    fsCoreMock.createWriteStream.mockReturnValue(writer);
  });

  it('a long Cyrillic title: the title is cut, the author is kept whole', async () => {
    const author = 'Фёдор Михайлович Достоевский'; // 54 bytes
    const name = await downloadedName('Ж'.repeat(150), author);

    expectFits(name, '.epub');
    // 255 - '.epub' - ' - ' - author = 193 bytes of title: 96 letters
    expect(name).toBe(`${'Ж'.repeat(96)} - ${author}.epub`);
  });

  it('a long CJK title: the title is cut, the author is kept whole', async () => {
    const title = '吾輩は猫である'.repeat(20);
    const name = await downloadedName(title, '夏目漱石', 'pdf');

    expectFits(name, '.pdf');
    // 255 - '.pdf' - ' - ' - 12 = 236 bytes of title: 78 characters
    expect(name).toBe(`${title.slice(0, 78)} - 夏目漱石.pdf`);
  });

  it('a CJK author too long to keep whole: title and author share the room', async () => {
    const title = '吾輩は猫である'.repeat(20);
    const author = '芥川龍之介'.repeat(30);
    const name = await downloadedName(title, author);

    expectFits(name, '.epub');
    const [titlePart, authorPart] = name.slice(0, -'.epub'.length).split(' - ');
    // Room is 247 bytes: the title keeps half (41 characters), the author the rest
    expect(titlePart).toBe(title.slice(0, 41));
    expect(authorPart).toBe(author.slice(0, 41));
  });

  it('an emoji title is cut between characters, never inside one', async () => {
    const name = await downloadedName(`a${'📚'.repeat(80)}`, 'Author');

    expectFits(name, '.epub');
    expect(name).toMatch(/^a(📚)+ - Author\.epub$/u);
  });

  it.each([
    ['Title', 'Author', 'epub', 'Title - Author.epub'],
    ['Война и мир', 'Лев Толстой', 'fb2', 'Война и мир - Лев Толстой.fb2'],
    ['Mistborn: The <Final> Empire', 'Brandon   Sanderson', 'epub', 'Mistborn The Final Empire - Brandon Sanderson.epub'],
    // The 100-character cap per part applies first, as today
    ['T'.repeat(150), 'A'.repeat(150), 'epub', `${'T'.repeat(100)} - ${'A'.repeat(100)}.epub`],
  ])('unchanged when it fits: %s - %s', async (title, author, format, expected) => {
    expect(await downloadedName(title, author, format)).toBe(expected);
  });
});
