/**
 * Component: Path Mapper Tests
 * Documentation: documentation/phase3/qbittorrent.md
 */

import { describe, expect, it } from 'vitest';
import { PathMapper } from '@/lib/utils/path-mapper';

describe('PathMapper', () => {
  it('returns original path when mapping is disabled', () => {
    const result = PathMapper.transform('/remote/path/book', {
      enabled: false,
      remotePath: '/remote/path',
      localPath: '/local/path',
    });

    expect(result).toBe('/remote/path/book');
  });

  it('transforms remote path to local path when enabled', () => {
    const result = PathMapper.transform('/remote/mnt/d/done/Book', {
      enabled: true,
      remotePath: '/remote/mnt/d/done',
      localPath: '/downloads',
    });

    expect(result.replace(/\\/g, '/')).toBe('/downloads/Book');
  });

  it('returns original path when remote prefix does not match', () => {
    const result = PathMapper.transform('/other/path/book', {
      enabled: true,
      remotePath: '/remote/path',
      localPath: '/local/path',
    });

    expect(result).toBe('/other/path/book');
  });

  it('validates mapping configuration when enabled', () => {
    expect(() =>
      PathMapper.validate({ enabled: true, remotePath: '', localPath: '/local' })
    ).toThrow('Remote path cannot be empty');
    expect(() =>
      PathMapper.validate({ enabled: true, remotePath: '/remote', localPath: '' })
    ).toThrow('Local path cannot be empty');
  });

  describe('normalizePath', () => {
    it('converts backslashes to forward slashes (Windows clients)', () => {
      expect(PathMapper.normalizePath('E:\\Torrents\\ReadMeABook\\Book.m4b'))
        .toBe('E:/Torrents/ReadMeABook/Book.m4b');
    });

    it('normalizes mixed separators consistently', () => {
      expect(PathMapper.normalizePath('E:\\Torrents/ReadMeABook\\Book'))
        .toBe('E:/Torrents/ReadMeABook/Book');
    });

    it('strips trailing separators (both forms)', () => {
      expect(PathMapper.normalizePath('E:\\Torrents\\ReadMeABook\\')).toBe('E:/Torrents/ReadMeABook');
      expect(PathMapper.normalizePath('/downloads/readmeabook/')).toBe('/downloads/readmeabook');
    });

    it('collapses `..` segments and redundant separators', () => {
      expect(PathMapper.normalizePath('/downloads//readmeabook/../Book')).toBe('/downloads/Book');
    });
  });

  describe('reverseTransform', () => {
    it('returns original path when mapping is disabled', () => {
      const result = PathMapper.reverseTransform('/downloads/Book', {
        enabled: false,
        remotePath: 'F:\\Docker\\downloads\\completed\\books',
        localPath: '/downloads',
      });

      expect(result).toBe('/downloads/Book');
    });

    it('transforms local path to remote path with Unix-style separators', () => {
      const result = PathMapper.reverseTransform('/downloads/Audiobook.Name', {
        enabled: true,
        remotePath: '/remote/mnt/d/done',
        localPath: '/downloads',
      });

      expect(result).toBe('/remote/mnt/d/done/Audiobook.Name');
    });

    it('transforms local path to remote path with Windows-style separators', () => {
      const result = PathMapper.reverseTransform('/downloads/Audiobook.Name', {
        enabled: true,
        remotePath: 'F:\\Docker\\downloads\\completed\\books',
        localPath: '/downloads',
      });

      expect(result).toBe('F:\\Docker\\downloads\\completed\\books\\Audiobook.Name');
    });

    it('returns original path when local prefix does not match', () => {
      const result = PathMapper.reverseTransform('/other/path/book', {
        enabled: true,
        remotePath: 'F:\\Docker\\downloads\\completed\\books',
        localPath: '/downloads',
      });

      expect(result).toBe('/other/path/book');
    });

    it('handles exact path match (no subdirectory)', () => {
      const result = PathMapper.reverseTransform('/downloads', {
        enabled: true,
        remotePath: 'F:\\Docker\\downloads\\completed\\books',
        localPath: '/downloads',
      });

      expect(result).toBe('F:\\Docker\\downloads\\completed\\books');
    });

    it('handles nested subdirectories', () => {
      const result = PathMapper.reverseTransform('/downloads/Author/Book Name/file.m4b', {
        enabled: true,
        remotePath: 'F:\\seedbox\\audiobooks',
        localPath: '/downloads',
      });

      expect(result).toBe('F:\\seedbox\\audiobooks\\Author\\Book Name\\file.m4b');
    });

    it('handles trailing slashes in config', () => {
      const result = PathMapper.reverseTransform('/downloads/Book', {
        enabled: true,
        remotePath: '/remote/path/',
        localPath: '/downloads/',
      });

      expect(result).toBe('/remote/path/Book');
    });
  });
});


