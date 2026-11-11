/**
 * Component: Library Relative Path Tests
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { describe, expect, it } from 'vitest';
import { libraryRelativePath } from '@/lib/utils/library-relative-path';

describe('libraryRelativePath', () => {
  it('gives the book folder relative to the media directory with forward slashes', () => {
    expect(libraryRelativePath('/media/audiobooks/A. G. Riddle/Pandemic B072NRMT8Q', '/media/audiobooks'))
      .toBe('A. G. Riddle/Pandemic B072NRMT8Q');
    expect(libraryRelativePath('/media/audiobooks/Author/Title/', '/media/audiobooks/')).toBe('Author/Title');
  });

  it('returns undefined for the root itself, outside paths and missing values', () => {
    expect(libraryRelativePath('/media/audiobooks', '/media/audiobooks')).toBeUndefined();
    expect(libraryRelativePath('/media/other/Author/Title', '/media/audiobooks')).toBeUndefined();
    expect(libraryRelativePath('/media/audiobooks/../etc', '/media/audiobooks')).toBeUndefined();
    expect(libraryRelativePath('/media/audiobooksX/Author', '/media/audiobooks')).toBeUndefined();
    expect(libraryRelativePath(undefined, '/media/audiobooks')).toBeUndefined();
    expect(libraryRelativePath('/media/audiobooks/A', null)).toBeUndefined();
  });
});
