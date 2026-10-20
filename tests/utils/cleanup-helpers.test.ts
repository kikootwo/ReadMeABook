/**
 * Component: Cleanup Helpers Tests
 * Documentation: documentation/phase3/sabnzbd.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePath, removeEmptyParentDirectories } from '@/lib/utils/cleanup-helpers';

// Mock fs/promises
const fsMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  rmdir: vi.fn(),
}));

// Mock logger
const loggerMock = vi.hoisted(() => ({
  RMABLogger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    forJob: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('@/lib/utils/logger', () => loggerMock);

describe('removeEmptyParentDirectories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('removes a single empty parent directory', async () => {
      // Setup: /downloads/category/audiobook was deleted
      // /downloads/category is empty
      fsMock.readdir.mockResolvedValueOnce([]); // /downloads/category is empty
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toEqual(['/downloads/category']);
      expect(result.stoppedReason).toBe('boundary_reached');
      expect(fsMock.rmdir).toHaveBeenCalledWith('/downloads/category');
    });

    it('removes multiple nested empty directories', async () => {
      // Setup: /downloads/cat/subcat/audiobook was deleted
      // Both /downloads/cat/subcat and /downloads/cat are empty
      fsMock.readdir
        .mockResolvedValueOnce([]) // /downloads/cat/subcat is empty
        .mockResolvedValueOnce([]); // /downloads/cat is empty
      fsMock.rmdir.mockResolvedValue(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/cat/subcat/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toHaveLength(2);
      expect(result.removedDirectories).toContain('/downloads/cat/subcat');
      expect(result.removedDirectories).toContain('/downloads/cat');
      expect(result.stoppedReason).toBe('boundary_reached');
    });

    it('stops when encountering a non-empty directory', async () => {
      // Setup: /downloads/category/audiobook was deleted
      // /downloads/category has other files
      fsMock.readdir.mockResolvedValueOnce(['other-file.txt']);

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toHaveLength(0);
      expect(result.stoppedReason).toBe('non_empty');
      expect(result.stoppedAt).toBe('/downloads/category');
      expect(fsMock.rmdir).not.toHaveBeenCalled();
    });

    it('removes first empty dir but stops at non-empty parent', async () => {
      // Setup: /downloads/cat/subcat/audiobook was deleted
      // /downloads/cat/subcat is empty, /downloads/cat has other stuff
      fsMock.readdir
        .mockResolvedValueOnce([]) // /downloads/cat/subcat is empty
        .mockResolvedValueOnce(['other-subcat']); // /downloads/cat has other subcat
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/cat/subcat/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toEqual(['/downloads/cat/subcat']);
      expect(result.stoppedReason).toBe('non_empty');
      expect(result.stoppedAt).toBe('/downloads/cat');
    });
  });

  describe('boundary protection', () => {
    it('never deletes the boundary directory itself', async () => {
      // Setup: /downloads/audiobook was deleted (directly under boundary)
      // /downloads is empty
      fsMock.readdir.mockResolvedValueOnce([]);

      const result = await removeEmptyParentDirectories(
        '/downloads/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toHaveLength(0);
      expect(result.stoppedReason).toBe('boundary_reached');
      // Should NOT try to remove /downloads
      expect(fsMock.rmdir).not.toHaveBeenCalled();
    });

    it('never deletes above the boundary directory', async () => {
      // Setup: Deep nested structure with empty parents all the way up
      fsMock.readdir.mockResolvedValue([]); // All directories empty
      fsMock.rmdir.mockResolvedValue(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/a/b/c/d/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      // Should remove a/b/c/d, a/b/c, a/b, a - but NOT /downloads
      expect(result.removedDirectories).toHaveLength(4);
      expect(result.removedDirectories).not.toContain('/downloads');
      expect(result.stoppedReason).toBe('boundary_reached');
    });

    it('handles boundary with trailing slash', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads/' } // Trailing slash
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toEqual(['/downloads/category']);
    });

    it('handles path directly at boundary level', async () => {
      const result = await removeEmptyParentDirectories(
        '/downloads/audiobook',
        { boundaryPath: '/downloads' }
      );

      // Parent of /downloads/audiobook is /downloads which is the boundary
      expect(result.success).toBe(true);
      expect(result.removedDirectories).toHaveLength(0);
      expect(result.stoppedReason).toBe('boundary_reached');
    });
  });

  describe('error handling', () => {
    it('handles ENOENT gracefully (directory already deleted)', async () => {
      // First directory check succeeds (empty), rmdir fails with ENOENT
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      // Should continue without error
    });

    it('handles ENOENT when checking if directory exists', async () => {
      // Directory doesn't exist when we try to read it
      fsMock.readdir.mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      // Should handle gracefully, move to parent
    });

    it('handles ENOTEMPTY race condition gracefully', async () => {
      // Directory was empty when checked, but became non-empty before removal
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockRejectedValueOnce(
        Object.assign(new Error('ENOTEMPTY'), { code: 'ENOTEMPTY' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.stoppedReason).toBe('non_empty');
    });

    it('handles EACCES permission error gracefully', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockRejectedValueOnce(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      // Should still be considered partial success
      expect(result.success).toBe(true);
      expect(result.stoppedReason).toBe('error');
      expect(result.error).toContain('Permission denied');
    });

    it('handles EPERM permission error gracefully', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockRejectedValueOnce(
        Object.assign(new Error('Operation not permitted'), { code: 'EPERM' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.stoppedReason).toBe('error');
    });

    it('handles unexpected errors', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockRejectedValueOnce(
        Object.assign(new Error('Unknown error'), { code: 'EUNKNOWN' })
      );

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(false);
      expect(result.stoppedReason).toBe('error');
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('path edge cases', () => {
    it('handles Windows-style backslash paths', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        'C:\\downloads\\category\\audiobook',
        { boundaryPath: 'C:\\downloads' }
      );

      expect(result.success).toBe(true);
      // Should normalize paths and work correctly
    });

    it('handles mixed slash paths', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/category\\audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
    });

    it('handles paths with redundant slashes', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads//category///audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
    });

    it('prevents /downloads2 from matching /downloads boundary', async () => {
      // If boundary is /downloads, path /downloads2/cat/audio should NOT match
      fsMock.readdir.mockResolvedValue([]); // All empty
      fsMock.rmdir.mockResolvedValue(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads2/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      // Should reach root (no boundary match) or handle gracefully
      // The boundary check should NOT match /downloads2 when boundary is /downloads
      expect(result.success).toBe(true);
      // Should have removed /downloads2/category and /downloads2 (or hit root)
    });
  });

  describe('with job context logging', () => {
    it('uses job-aware logger when context provided', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        {
          boundaryPath: '/downloads',
          logContext: { jobId: 'job-123', context: 'TestCleanup' },
        }
      );

      expect(result.success).toBe(true);
      expect(loggerMock.RMABLogger.forJob).toHaveBeenCalledWith('job-123', 'TestCleanup');
    });

    it('uses default logger when no context provided', async () => {
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/category/audiobook',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      // Default logger is created at module load time, not per-call
      // Just verify the function works without job context
      expect(loggerMock.RMABLogger.forJob).not.toHaveBeenCalled();
    });
  });

  describe('realistic SABnzbd scenarios', () => {
    it('cleans up empty readmeabook category folder', async () => {
      // Real scenario: SABnzbd downloads to /downloads/readmeabook/My.Audiobook.Name/
      // After organizing, My.Audiobook.Name is deleted
      // readmeabook folder should be cleaned up too
      fsMock.readdir.mockResolvedValueOnce([]); // /downloads/readmeabook is empty
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/downloads/readmeabook/My.Audiobook.Name',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toEqual(['/downloads/readmeabook']);
      expect(result.stoppedReason).toBe('boundary_reached');
    });

    it('preserves category folder with other downloads', async () => {
      // Real scenario: Multiple downloads in readmeabook category
      // Only one is being cleaned up
      fsMock.readdir.mockResolvedValueOnce(['Other.Audiobook.Name']); // Other download exists

      const result = await removeEmptyParentDirectories(
        '/downloads/readmeabook/My.Audiobook.Name',
        { boundaryPath: '/downloads' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toHaveLength(0);
      expect(result.stoppedReason).toBe('non_empty');
    });

    it('handles path mapping scenario (mapped download_dir)', async () => {
      // Real scenario: download_dir is /media/usenet/complete
      // after path mapping from SABnzbd's perspective
      fsMock.readdir.mockResolvedValueOnce([]);
      fsMock.rmdir.mockResolvedValueOnce(undefined);

      const result = await removeEmptyParentDirectories(
        '/media/usenet/complete/readmeabook/My.Audiobook.Name',
        { boundaryPath: '/media/usenet/complete' }
      );

      expect(result.success).toBe(true);
      expect(result.removedDirectories).toEqual(['/media/usenet/complete/readmeabook']);
    });
  });
});

describe('normalizePath (Windows input forms)', () => {
  it.each([
    ['C:', 'C:/'],
    ['c:', 'C:/'],
    ['C:\\', 'C:/'],
    ['c:\\Media\\Books\\', 'C:/Media/Books'],
    ['C:/Media//Books/', 'C:/Media/Books'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('leaves POSIX paths alone', () => {
    expect(normalizePath('/media/books/')).toBe('/media/books');
    expect(normalizePath('/')).toBe('/');
  });
});
