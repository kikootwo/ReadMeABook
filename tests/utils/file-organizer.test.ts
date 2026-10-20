/**
 * Component: File Organization System Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileOrganizer, getFileOrganizer } from '@/lib/utils/file-organizer';

const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  readdir: vi.fn(),
  constants: { R_OK: 4 },
}));

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

const metadataMock = vi.hoisted(() => ({
  tagMultipleFiles: vi.fn(),
  checkFfmpegAvailable: vi.fn(),
}));

const chapterMock = vi.hoisted(() => ({
  detectChapterFiles: vi.fn(),
  analyzeChapterFiles: vi.fn(),
  mergeChapters: vi.fn(),
  formatDuration: vi.fn((ms: number) => `${ms}`),
  estimateOutputSize: vi.fn(),
  checkDiskSpace: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  RMABLogger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    forJob: vi.fn(() => ({
      info: vi.fn().mockResolvedValue(undefined),
      warn: vi.fn().mockResolvedValue(undefined),
      error: vi.fn().mockResolvedValue(undefined),
      debug: vi.fn(),
    })),
  },
}));

const configState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

const prismaMock = vi.hoisted(() => ({
  configuration: {
    findUnique: vi.fn(async ({ where: { key } }: { where: { key: string } }) => {
      const value = configState.values.get(key);
      return value !== undefined ? { value } : null;
    }),
  },
}));

const ebookMock = vi.hoisted(() => ({
  downloadEbook: vi.fn(),
}));

const copyFileMock = vi.hoisted(() => ({
  copyFile: vi.fn(),
  isSameFile: vi.fn(async () => false),
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('@/lib/utils/copy-file', () => copyFileMock);

// Placement is covered on the real filesystem in organize-copy.test.ts; here it
// keeps the organizer's previous contract: an existing target (fs.access) is
// kept, otherwise the file is copied, and a failed tagged copy falls back to
// the original.
const placementMock = vi.hoisted(() => {
  const place = async (source: string, target: string, fileMode: number) => {
    try {
      await fsMock.access(source);
    } catch {
      return { status: 'failed' as const, target, reason: `Source file not found: ${source}` };
    }
    try {
      await fsMock.access(target);
      return { status: 'present' as const, target };
    } catch {
      // Not there yet
    }
    try {
      await copyFileMock.copyFile(source, target);
    } catch (error) {
      return { status: 'failed' as const, target, reason: error instanceof Error ? error.message : String(error) };
    }
    const permissions = await applyFileMode(target, fileMode);
    if (permissions.kind === 'missing') return { status: 'failed' as const, target, reason: permissions.reason };
    return permissions.kind === 'refused'
      ? { status: 'copied' as const, target, warning: permissions.warning }
      : { status: 'copied' as const, target };
  };
  // The real applyFileMode (over the mocked fs/promises) is installed by the vi.mock factory below;
  // a plain holder, so mock resets between tests leave it in place
  const real: { applyFileMode?: (target: string, fileMode: number) => Promise<any> } = {};
  const applyFileMode = (target: string, fileMode: number) => real.applyFileMode!(target, fileMode);
  return {
    real,
    applyFileMode,
    isVerifiedStatus: (status: string) => status === 'copied' || status === 'identical',
    placeFile: vi.fn(async (source: string, target: string, options: { fileMode: number }) =>
      place(source, target, options.fileMode)
    ),
    placeAudio: vi.fn(async (original: string, derivative: string | undefined, target: string, options: { fileMode: number }) => {
      if (derivative) {
        const tagged = await place(derivative, target, options.fileMode);
        if (tagged.status !== 'failed') {
          return { ...tagged, verified: tagged.status === 'copied', usedDerivative: true };
        }
        const fallback = await place(original, target, options.fileMode);
        return {
          ...fallback,
          verified: fallback.status === 'copied',
          usedDerivative: false,
          reason: fallback.status === 'copied'
            ? `Tagged copy failed (${tagged.reason}); original placed without metadata tags`
            : fallback.reason,
        };
      }
      const placed = await place(original, target, options.fileMode);
      return { ...placed, verified: placed.status === 'copied', usedDerivative: false };
    }),
  };
});
vi.mock('@/lib/utils/organize-copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/organize-copy')>();
  placementMock.real.applyFileMode = actual.applyFileMode;
  return placementMock;
});

// Cover publishing is covered on the real filesystem in file-organizer.cover.test.ts;
// here an existing cover (fs.access) is kept, otherwise it is copied or written and its mode applied.
const coverMock = vi.hoisted(() => ({
  hasCover: vi.fn(async (target: string) => fsMock.access(target).then(() => true, () => false)),
  publishCover: vi.fn(async (target: string, content: { file?: string; data?: Buffer }, fileMode: number) => {
    if (content.file) await copyFileMock.copyFile(content.file, target);
    else await fsMock.writeFile(target, content.data);
    const mode = await placementMock.applyFileMode(target, fileMode);
    if (mode.kind === 'missing') throw new Error(mode.reason);
    return mode.kind === 'refused' ? { outcome: 'written', warning: mode.warning } : { outcome: 'written' };
  }),
}));
vi.mock('@/lib/utils/cover-placement', () => coverMock);

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}));

vi.mock('@/lib/utils/metadata-tagger', () => metadataMock);
vi.mock('@/lib/utils/chapter-merger', () => chapterMock);
vi.mock('@/lib/utils/logger', () => loggerMock);
vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));
vi.mock('@/lib/services/ebook-scraper', () => ebookMock);

describe('file organizer', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    configState.values.clear();
    process.env = { ...originalEnv };
  });

  it('organizes a single file and copies cached cover art', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    fsMock.stat.mockResolvedValue({ isFile: () => true });
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (filePath === '/downloads/book.m4b') return undefined;
      if (filePath === '/app/cache/thumbnails/cover.jpg') return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    const result = await organizer.organize(
      '/downloads/book.m4b',
      {
        title: 'Book: Title',
        author: 'Author/Name',
        year: 2020,
        asin: 'ASIN123',
        coverArtUrl: '/api/cache/thumbnails/cover.jpg',
      },
      '{author}/{title} ({year}) {asin}',
      { jobId: 'job-1', context: 'organize' }
    );

    const expectedDir = path.join('/media', 'AuthorName', 'Book Title (2020) ASIN123');
    const expectedAudio = path.join(expectedDir, 'book.m4b');

    expect(result.success).toBe(true);
    expect(result.targetPath).toBe(expectedDir);
    expect(result.audioFiles).toEqual([expectedAudio]);
    expect(result.coverArtFile).toBe(path.join(expectedDir, 'cover.jpg'));
    expect(result.filesMovedCount).toBe(1);
    expect(loggerMock.RMABLogger.forJob).toHaveBeenCalledWith('job-1', 'organize');
    expect(metadataMock.tagMultipleFiles).not.toHaveBeenCalled();
  });

  it('returns errors when no audiobook files are found', async () => {
    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: [],
      coverFile: undefined,
      isFile: false,
    });

    const result = await organizer.organize('/downloads/empty', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('No audiobook files found in download');
  });

  it('falls back when chapter merge fails and continues organizing', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    chapterMock.detectChapterFiles.mockResolvedValue(true);
    chapterMock.estimateOutputSize.mockResolvedValue(100);
    chapterMock.checkDiskSpace.mockResolvedValue(1000);
    chapterMock.analyzeChapterFiles.mockResolvedValue([
      { path: '/downloads/book/disc1.mp3', filename: 'disc1.mp3', duration: 1000, chapterTitle: 'One' },
    ]);
    chapterMock.mergeChapters.mockResolvedValue({ success: false, error: 'merge failed' });

    const downloadRoot = path.normalize(path.join('/downloads', 'book'));
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath).startsWith(downloadRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['disc1.mp3', 'disc2.mp3'],
      coverFile: undefined,
      isFile: false,
    });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.filesMovedCount).toBe(2);
    expect(result.errors.join(' ')).toContain('Chapter merge failed');
    expect(chapterMock.mergeChapters).toHaveBeenCalled();
  });

  it('uses tagged files when metadata tagging succeeds', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    configState.values.set('ebook_sidecar_enabled', 'false');

    metadataMock.checkFfmpegAvailable.mockResolvedValue(true);
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    metadataMock.tagMultipleFiles.mockResolvedValue([
      {
        success: true,
        filePath: sourcePath,
        taggedFilePath: '/tmp/tagged.m4b',
      },
    ]);

    const downloadRoot = path.normalize(path.join('/downloads', 'book'));
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize('/tmp/tagged.m4b')) return undefined;
      if (path.normalize(filePath).startsWith(downloadRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    const expectedDir = path.join('/media', 'Author', 'Book');
    expect(result.success).toBe(true);
    expect(result.targetPath).toBe(expectedDir);
    expect(copyFileMock.copyFile).toHaveBeenCalledWith('/tmp/tagged.m4b', path.join(expectedDir, 'book.m4b'));
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/tagged.m4b');
  });

  it('skips metadata tagging when ffmpeg is unavailable', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    configState.values.set('ebook_sidecar_enabled', 'false');

    metadataMock.checkFfmpegAvailable.mockResolvedValue(false);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book');
    const targetFile = path.join(expectedDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.errors).toContain('Metadata tagging skipped: ffmpeg not available');
    expect(metadataMock.tagMultipleFiles).not.toHaveBeenCalled();
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(sourcePath, targetFile);
  });

  it.each([
    ['a cached thumbnail', '/api/cache/thumbnails/cover.jpg'],
    ['a remote cover', 'https://m.media-amazon.com/images/I/cover.jpg'],
  ])('keeps %s with a permission warning when chmod is refused', async (_label, coverArtUrl) => {
    configState.values.set('metadata_tagging_enabled', 'false');
    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({ audioFiles: ['book.m4b'], coverFile: undefined, isFile: false });
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const coverPath = path.join('/media', 'Author', 'Book', 'cover.jpg');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });
    fsMock.chmod.mockImplementation(async (filePath: string) => {
      if (filePath === coverPath) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });

    const result = await organizer.organize('/downloads/book', { title: 'Book', author: 'Author', coverArtUrl }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.coverArtFile).toBe(coverPath);
    expect(result.errors).toEqual([]);
    expect(result.permissionWarnings).toHaveLength(1);
    expect(result.permissionWarnings![0]).toContain(coverPath);
    expect(result.permissionWarnings![0]).toContain('EPERM');
  });

  it('records a cover as failed when it is not there after writing (chmod ENOENT)', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({ audioFiles: ['book.m4b'], coverFile: undefined, isFile: false });
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const coverPath = path.join('/media', 'Author', 'Book', 'cover.jpg');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });
    fsMock.chmod.mockImplementation(async (filePath: string) => {
      if (filePath === coverPath) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book', author: 'Author', coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.coverArtFile).toBeUndefined();
    expect(result.errors).toContain('Failed to download cover art');
    expect(result.permissionWarnings).toBeUndefined();
  });

  it('downloads remote cover art when no local cover exists', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book ASIN123');
    const targetFile = path.join(expectedDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);

    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
      asin: 'ASIN123',
      coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
    }, '{author}/{title} {asin}');

    expect(result.success).toBe(true);
    expect(result.coverArtFile).toBe(path.join(expectedDir, 'cover.jpg'));
    expect(axiosMock.get).toHaveBeenCalledWith(
      'https://m.media-amazon.com/images/I/cover.jpg',
      expect.objectContaining({ responseType: 'arraybuffer' })
    );
    // NOTE: Ebook downloads are now handled as first-class requests through the job queue
    // The file organizer no longer downloads ebooks inline
    expect(ebookMock.downloadEbook).not.toHaveBeenCalled();
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(sourcePath, targetFile);
    expect(result.filesMovedCount).toBe(1);
  });

  it('follows up to 3 cover redirects, checks every hop, and applies the file mode', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({ audioFiles: ['book.m4b'], coverFile: undefined, isFile: false });
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book', author: 'Author', asin: 'ASIN123',
      coverArtUrl: 'https://images-na.ssl-images-amazon.com/images/I/legacy.jpg',
    }, '{author}/{title} {asin}');

    const config = axiosMock.get.mock.calls[0][1];
    expect(config.maxRedirects).toBe(3);
    expect(() => config.beforeRedirect({ href: 'https://m.media-amazon.com/images/I/legacy.jpg' })).not.toThrow();
    expect(() => config.beforeRedirect({ href: 'http://127.0.0.1:6379/' })).toThrow();
    expect(() => config.beforeRedirect({ protocol: 'https:', hostname: 'evil.example' })).toThrow();
    const coverPath = path.join('/media', 'Author', 'Book ASIN123', 'cover.jpg');
    expect(result.coverArtFile).toBe(coverPath);
    expect(fsMock.chmod).toHaveBeenCalledWith(coverPath, expect.anything());
  });

  it.each([
    ['a loopback URL', 'http://127.0.0.1:6379/'],
    ['a plain-http image host', 'http://m.media-amazon.com/images/I/cover.jpg'],
    ['a look-alike host', 'https://media-amazon.com.evil.example/cover.jpg'],
    ['a local file path', '/etc/passwd'],
    ['a file URL', 'file:///etc/passwd'],
    ['a cache path traversal', '/api/cache/thumbnails/../../../etc/passwd'],
    ['a cache path with a sub-directory', '/api/cache/thumbnails/sub/cover.jpg'],
  ])('never fetches or copies cover art from %s', async (_label, coverArtUrl) => {
    configState.values.set('metadata_tagging_enabled', 'false');
    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book', author: 'Author', asin: 'ASIN123', coverArtUrl,
    }, '{author}/{title} {asin}');

    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(copyFileMock.copyFile).toHaveBeenCalledTimes(1); // the audio file only
    expect(result.coverArtFile).toBeUndefined();
    // Display-only covers are skipped with a warning, not reported as an error
    expect(result.errors.join(' ')).not.toContain('cover art');
  });

  it('records an error when cover art download fails', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book');
    const targetFile = path.join(expectedDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    axiosMock.get.mockRejectedValue(new Error('cover failed'));

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
      coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.errors.join(' ')).toContain('Failed to download cover art');
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(sourcePath, targetFile);
  });

  it('continues when chapter analysis returns no valid chapters', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    chapterMock.detectChapterFiles.mockResolvedValue(true);
    chapterMock.estimateOutputSize.mockResolvedValue(100);
    chapterMock.checkDiskSpace.mockResolvedValue(1000);
    chapterMock.analyzeChapterFiles.mockResolvedValue([]);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['disc1.mp3', 'disc2.mp3'],
      coverFile: undefined,
      isFile: false,
    });

    const sourceRoot = path.normalize('/downloads/book');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath).startsWith(sourceRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.filesMovedCount).toBe(2);
    expect(chapterMock.mergeChapters).not.toHaveBeenCalled();
  });

  it('records errors when some metadata tagging operations fail', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    configState.values.set('ebook_sidecar_enabled', 'false');

    metadataMock.checkFfmpegAvailable.mockResolvedValue(true);
    metadataMock.tagMultipleFiles.mockResolvedValue([
      { success: true, filePath: '/downloads/book/one.m4b', taggedFilePath: '/tmp/one-tagged.m4b' },
      { success: false, filePath: '/downloads/book/two.m4b', error: 'bad tags' },
    ]);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['one.m4b', 'two.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourceRoot = path.normalize('/downloads/book');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize('/tmp/one-tagged.m4b')) return undefined;
      if (path.normalize(filePath).startsWith(sourceRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.errors.join(' ')).toContain('Failed to tag 1 file(s) with metadata');
  });

  // NOTE: The ebook sidecar test was removed because ebook downloads are now
  // handled as first-class requests through the job queue, not inline during
  // file organization. See organize-files.processor.ts createEbookRequestIfEnabled().

  it('finds audio files and cover art in nested folders', async () => {
    const organizer = new FileOrganizer('/media', '/tmp');

    fsMock.stat.mockResolvedValue({ isFile: () => false });
    const subDir = path.join('/downloads', 'sub');
    fsMock.readdir.mockImplementation(async (dir: string) => {
      if (dir === '/downloads') {
        return [
          { name: 'disc1.mp3', isDirectory: () => false },
          { name: 'sub', isDirectory: () => true },
        ];
      }
      if (dir === subDir) {
        return [
          { name: 'disc2.mp3', isDirectory: () => false },
          { name: 'cover.jpg', isDirectory: () => false },
        ];
      }
      return [];
    });

    const result = await (organizer as any).findAudiobookFiles('/downloads');

    expect(result.audioFiles).toEqual([
      'disc1.mp3',
      path.join('sub', 'disc2.mp3'),
    ]);
    expect(result.coverFile).toBe(path.join('sub', 'cover.jpg'));
    expect(result.isFile).toBe(false);
  });

  it('keeps nested duplicate track names unique when renaming is disabled', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: [
        path.join('CD1', 'Track01.mp3'),
        path.join('CD1', 'Track02.mp3'),
        path.join('CD2', 'Track01.mp3'),
        path.join('CD2', 'Track02.mp3'),
      ],
      coverFile: undefined,
      isFile: false,
    });

    const sourceRoot = path.normalize('/downloads/book');
    fsMock.access.mockImplementation(async (filePath: string) => {
      const normalized = path.normalize(filePath);
      if (normalized.startsWith(sourceRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    const expectedDir = path.join('/media', 'Author', 'Book');
    expect(result.success).toBe(true);
    expect(result.filesMovedCount).toBe(4);
    expect(result.audioFiles).toEqual([
      path.join(expectedDir, 'CD1-Track01.mp3'),
      path.join(expectedDir, 'CD1-Track02.mp3'),
      path.join(expectedDir, 'CD2-Track01.mp3'),
      path.join(expectedDir, 'CD2-Track02.mp3'),
    ]);
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(
      path.join('/downloads', 'book', 'CD1', 'Track01.mp3'),
      path.join(expectedDir, 'CD1-Track01.mp3')
    );
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(
      path.join('/downloads', 'book', 'CD2', 'Track01.mp3'),
      path.join(expectedDir, 'CD2-Track01.mp3')
    );
  });

  it('returns no audio files for unsupported single files', async () => {
    const organizer = new FileOrganizer('/media', '/tmp');
    fsMock.stat.mockResolvedValue({ isFile: () => true });

    const result = await (organizer as any).findAudiobookFiles('/downloads/readme.txt');

    expect(result.audioFiles).toEqual([]);
    expect(result.isFile).toBe(true);
  });

  it('returns failure when source audio files are missing', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) {
        throw new Error('missing');
      }
      return undefined;
    });
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(false);
    expect(result.audioFiles).toEqual([]);
    expect(result.errors.join(' ')).toContain('Source file not found');
    expect(result.errors.join(' ')).toContain('No audio files were successfully copied');
    expect(copyFileMock.copyFile).not.toHaveBeenCalled();
  });

  it('skips copying when target files already exist', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('ebook_sidecar_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const targetDir = path.join('/media', 'Author', 'Book');
    const targetPath = path.join(targetDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      if (path.normalize(filePath) === path.normalize(targetPath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.audioFiles).toEqual([targetPath]);
    expect(result.filesMovedCount).toBe(0);
    expect(copyFileMock.copyFile).not.toHaveBeenCalled();
  });

  it('continues when metadata tagging throws', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    configState.values.set('ebook_sidecar_enabled', 'false');

    metadataMock.checkFfmpegAvailable.mockRejectedValue(new Error('ffmpeg error'));

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.errors.join(' ')).toContain('Metadata tagging failed');
    expect(copyFileMock.copyFile).toHaveBeenCalled();
  });

  it('validates paths and reports multiple issues', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false });
    fsMock.writeFile.mockRejectedValue(new Error('not writable'));

    const organizer = new FileOrganizer('/media', '/tmp');
    const result = await organizer.validate('/media');

    expect(result.isValid).toBe(false);
    expect(result.issues).toContain('Path is not a directory');
    expect(result.issues).toContain('Directory is not writable');
  });

  it('returns validation errors when path is missing', async () => {
    fsMock.access.mockRejectedValue(new Error('missing'));

    const organizer = new FileOrganizer('/media', '/tmp');
    const result = await organizer.validate('/missing');

    expect(result.isValid).toBe(false);
    expect(result.issues.join(' ')).toContain('Path does not exist');
  });

  it('throws when the download directory cannot be read', async () => {
    fsMock.stat.mockRejectedValue(new Error('bad path'));

    const organizer = new FileOrganizer('/media', '/tmp');
    await expect((organizer as any).findAudiobookFiles('/downloads/bad')).rejects.toThrow('bad path');
  });

  it('reports an incomplete listing when a directory cannot be read', async () => {
    fsMock.readdir.mockRejectedValue(new Error('no perms'));

    const { walkFiles } = await import('@/lib/utils/import-inventory');
    const walk = await walkFiles('/downloads');

    expect(walk).toEqual({ files: [], complete: false });
  });

  it('validates writable directories without issues', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    const result = await organizer.validate('/media');

    expect(result.isValid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(fsMock.unlink).toHaveBeenCalledWith(path.join('/media', '.test-write'));
  });

  it('builds organizer settings from configuration', async () => {
    configState.values.set('media_dir', '/media/custom');
    process.env.TEMP_DIR = '/tmp/custom';

    const organizer = await getFileOrganizer();

    expect((organizer as any).mediaDir).toBe('/media/custom');
    expect((organizer as any).tempDir).toBe('/tmp/custom');
  });

  it('returns failure when all audio file copies fail (EPERM)', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book');
    const targetFile = path.join(expectedDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockRejectedValue(
      Object.assign(new Error('EPERM: operation not permitted, copyfile'), { code: 'EPERM' })
    );

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    expect(result.success).toBe(false);
    expect(result.audioFiles).toEqual([]);
    expect(result.filesMovedCount).toBe(0);
    expect(result.targetPath).toBe(expectedDir);
    expect(result.errors.join(' ')).toContain('EPERM');
    expect(result.errors.join(' ')).toContain('No audio files were successfully copied');
  });

  it('falls back to untagged file when tagged copy fails', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');

    metadataMock.checkFfmpegAvailable.mockResolvedValue(true);
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const taggedPath = `${sourcePath}.tmp`;
    metadataMock.tagMultipleFiles.mockResolvedValue([
      { success: true, filePath: sourcePath, taggedFilePath: taggedPath },
    ]);

    const expectedDir = path.join('/media', 'Author', 'Book');
    const targetFile = path.join(expectedDir, 'book.m4b');

    fsMock.access.mockImplementation(async (filePath: string) => {
      const normalized = path.normalize(filePath);
      if (normalized === path.normalize(taggedPath)) return undefined;
      if (normalized === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockImplementation(async (src: string, dest: string) => {
      // Tagged file copy fails with EPERM
      if (path.normalize(src) === path.normalize(taggedPath)) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      // Original file copy succeeds
      return undefined;
    });
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}',
      { jobId: 'job-fallback', context: 'test' }
    );

    expect(result.success).toBe(true);
    expect(result.audioFiles).toEqual([targetFile]);
    expect(result.filesMovedCount).toBe(1);
    // Tagged temp file should be cleaned up
    expect(fsMock.unlink).toHaveBeenCalledWith(taggedPath);
    // Fallback copy should use the original source
    expect(copyFileMock.copyFile).toHaveBeenCalledWith(sourcePath, targetFile);
    // Should record that tagged copy failed
    expect(result.errors.join(' ')).toContain('Tagged copy failed');
    expect(result.errors.join(' ')).toContain('without metadata tags');
  });

  it('returns failure when tagged copy and fallback both fail', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');

    metadataMock.checkFfmpegAvailable.mockResolvedValue(true);
    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const taggedPath = `${sourcePath}.tmp`;
    metadataMock.tagMultipleFiles.mockResolvedValue([
      { success: true, filePath: sourcePath, taggedFilePath: taggedPath },
    ]);

    fsMock.access.mockImplementation(async (filePath: string) => {
      const normalized = path.normalize(filePath);
      if (normalized === path.normalize(taggedPath)) return undefined;
      if (normalized === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    // Both tagged and original copies fail
    copyFileMock.copyFile.mockRejectedValue(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    );
    fsMock.unlink.mockResolvedValue(undefined);

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}',
      { jobId: 'job-both-fail', context: 'test' }
    );

    expect(result.success).toBe(false);
    expect(result.audioFiles).toEqual([]);
    expect(result.filesMovedCount).toBe(0);
    expect(result.errors.join(' ')).toContain('EPERM');
    expect(result.errors.join(' ')).toContain('No audio files were successfully copied');
    // Should still clean up tagged temp file
    expect(fsMock.unlink).toHaveBeenCalledWith(taggedPath);
  });

  it('reports partial success when some files copy and others fail', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['disc1.mp3', 'disc2.mp3'],
      coverFile: undefined,
      isFile: false,
    });

    const sourceRoot = path.normalize('/downloads/book');
    const source1 = path.join('/downloads', 'book', 'disc1.mp3');
    const source2 = path.join('/downloads', 'book', 'disc2.mp3');
    const expectedDir = path.join('/media', 'Author', 'Book');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath).startsWith(sourceRoot)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockImplementation(async (src: string) => {
      // First file succeeds, second fails
      if (path.normalize(src) === path.normalize(source2)) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      }
      return undefined;
    });
    fsMock.chmod.mockResolvedValue(undefined);

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
    }, '{author}/{title}');

    // Should succeed because at least one file was copied
    expect(result.success).toBe(true);
    expect(result.audioFiles).toEqual([path.join(expectedDir, 'disc1.mp3')]);
    expect(result.filesMovedCount).toBe(1);
    expect(result.errors.join(' ')).toContain('Failed to copy disc2.mp3');
  });

  it('succeeds with cover art when audio files were copied', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
      coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
    }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(result.audioFiles).toEqual([path.join(expectedDir, 'book.m4b')]);
    expect(result.coverArtFile).toBe(path.join(expectedDir, 'cover.jpg'));
  });

  it('returns failure even when cover art succeeds but audio copy fails', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');

    const organizer = new FileOrganizer('/media', '/tmp');
    (organizer as any).findAudiobookFiles = vi.fn().mockResolvedValue({
      audioFiles: ['book.m4b'],
      coverFile: undefined,
      isFile: false,
    });

    const sourcePath = path.join('/downloads', 'book', 'book.m4b');
    const expectedDir = path.join('/media', 'Author', 'Book');

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (path.normalize(filePath) === path.normalize(sourcePath)) return undefined;
      throw new Error('missing');
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    copyFileMock.copyFile.mockRejectedValue(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    );
    fsMock.writeFile.mockResolvedValue(undefined);
    axiosMock.get.mockResolvedValue({ data: Buffer.from('cover') });

    const result = await organizer.organize('/downloads/book', {
      title: 'Book',
      author: 'Author',
      coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
    }, '{author}/{title}');

    // Audio copy failed → should be failure despite cover art being available
    expect(result.success).toBe(false);
    expect(result.audioFiles).toEqual([]);
    expect(result.filesMovedCount).toBe(0);
    expect(result.errors.join(' ')).toContain('EPERM');
    expect(result.errors.join(' ')).toContain('No audio files were successfully copied');
  });
});
