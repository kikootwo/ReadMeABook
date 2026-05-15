/**
 * Component: Plex Format Coercion Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { coerceToPlexCompatible } from '@/lib/utils/format-coercion';

const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: fsMock,
  default: { promises: fsMock },
}));

/** Make `fs.access` reject with ENOENT (target does not exist) for every path. */
function targetMissing(): void {
  fsMock.access.mockImplementation(() => {
    const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return Promise.reject(err);
  });
}

/** Make `fs.rename` resolve successfully. */
function renameOk(): void {
  fsMock.rename.mockResolvedValue(undefined);
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('coerceToPlexCompatible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy paths', () => {
    it('renames .mp4 to .m4b', async () => {
      targetMissing();
      renameOk();
      const input = ['/media/Book/Book.mp4'];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([{ from: '/media/Book/Book.mp4', to: path.join('/media/Book', 'Book.m4b') }]);
      expect(result.finalAudioFiles).toEqual([path.join('/media/Book', 'Book.m4b')]);
      expect(result.warnings).toEqual([]);
      expect(fsMock.rename).toHaveBeenCalledTimes(1);
    });

    it('renames single-file .m4a to .m4b', async () => {
      targetMissing();
      renameOk();
      const input = ['/media/Book/Book.m4a'];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([{ from: '/media/Book/Book.m4a', to: path.join('/media/Book', 'Book.m4b') }]);
      expect(result.finalAudioFiles).toEqual([path.join('/media/Book', 'Book.m4b')]);
      expect(result.warnings).toEqual([]);
    });

    it('leaves multi-file .m4a audiobooks alone (more than one .m4a in same dir)', async () => {
      targetMissing();
      renameOk();
      const input = ['/media/Book/Chapter01.m4a', '/media/Book/Chapter02.m4a'];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([]);
      expect(result.finalAudioFiles).toEqual(input);
      expect(fsMock.rename).not.toHaveBeenCalled();
    });

    it('handles mixed .mp4 + .mp3: renames mp4, leaves mp3 untouched', async () => {
      targetMissing();
      renameOk();
      const input = ['/media/Book/Book.mp4', '/media/Other/Intro.mp3'];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([
        { from: '/media/Book/Book.mp4', to: path.join('/media/Book', 'Book.m4b') },
      ]);
      expect(result.finalAudioFiles).toEqual([
        path.join('/media/Book', 'Book.m4b'),
        '/media/Other/Intro.mp3',
      ]);
      expect(fsMock.rename).toHaveBeenCalledTimes(1);
    });

    it('returns empty result for empty input', async () => {
      const result = await coerceToPlexCompatible([]);
      expect(result).toEqual({ renamed: [], warnings: [], errors: [], finalAudioFiles: [] });
      expect(fsMock.rename).not.toHaveBeenCalled();
    });
  });

  describe('already-compatible inputs (sanity)', () => {
    it('is a silent no-op for already-Plex-compatible files (.m4b/.mp3/.flac)', async () => {
      targetMissing();
      renameOk();
      const input = [
        '/media/Book/Book.m4b',
        '/media/Other/Track.mp3',
        '/media/Third/Track.flac',
      ];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.finalAudioFiles).toEqual(input);
      expect(fsMock.rename).not.toHaveBeenCalled();
    });
  });

  describe('DRM and transcode-required formats', () => {
    it('warns on .aa (DRM) and skips rename', async () => {
      const logger = makeLogger();
      const input = ['/media/Book/Book.aa'];

      const result = await coerceToPlexCompatible(input, logger as never);

      expect(result.renamed).toEqual([]);
      expect(result.finalAudioFiles).toEqual(input);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toMatch(/DRM/i);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(fsMock.rename).not.toHaveBeenCalled();
    });

    it('warns on .aax (DRM) and skips rename', async () => {
      const input = ['/media/Book/Book.aax'];

      const result = await coerceToPlexCompatible(input);

      expect(result.renamed).toEqual([]);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toMatch(/DRM/i);
      expect(result.finalAudioFiles).toEqual(input);
    });

    it('warns on .ogg (transcode-required) and skips rename', async () => {
      const logger = makeLogger();
      const input = ['/media/Book/Book.ogg'];

      const result = await coerceToPlexCompatible(input, logger as never);

      expect(result.renamed).toEqual([]);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toMatch(/transcode/i);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(result.finalAudioFiles).toEqual(input);
    });
  });

  describe('idempotency (collision)', () => {
    it('does not overwrite an existing target file', async () => {
      // First access resolves (target exists), rename should not be called.
      fsMock.access.mockResolvedValue(undefined);
      const logger = makeLogger();
      const input = ['/media/Book/Book.mp4'];

      const result = await coerceToPlexCompatible(input, logger as never);

      expect(result.renamed).toEqual([]);
      expect(result.finalAudioFiles).toEqual(input);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toMatch(/already exists/i);
      expect(fsMock.rename).not.toHaveBeenCalled();
    });
  });

  describe('rename failures', () => {
    it('captures EPERM as a warning and preserves the original path', async () => {
      targetMissing();
      const epermErr = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
      epermErr.code = 'EPERM';
      fsMock.rename.mockRejectedValueOnce(epermErr);
      const logger = makeLogger();
      const input = ['/media/Book/Book.mp4'];

      const result = await coerceToPlexCompatible(input, logger as never);

      expect(result.renamed).toEqual([]);
      expect(result.finalAudioFiles).toEqual(input);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toMatch(/EPERM/);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('logger contract', () => {
    it('works without a logger (optional parameter)', async () => {
      targetMissing();
      renameOk();
      const input = ['/media/Book/Book.mp4'];

      // Must not throw when logger is omitted.
      const result = await coerceToPlexCompatible(input);

      expect(result.renamed.length).toBe(1);
      expect(result.finalAudioFiles).toEqual([path.join('/media/Book', 'Book.m4b')]);
    });
  });
});
