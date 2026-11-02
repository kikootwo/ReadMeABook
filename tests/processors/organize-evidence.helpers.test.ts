/**
 * Component: Organize Evidence Helper Tests (filesHash inputs, fileFormat)
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn() }) }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

const { audioFileFormat, splitForeignAudio } = await import('@/lib/processors/organize-evidence');

describe('splitForeignAudio', () => {
  it('separates differs targets (files the library already held) from this import\'s files', () => {
    const records = [
      { source: '/dl/1.mp3', target: '/m/B/1.mp3', status: 'copied' as const, verified: true },
      { source: '/dl/2.mp3', target: '/m/B/2.mp3', status: 'present' as const, verified: false },
      { source: '/dl/3.mp3', target: '/m/B/3.mp3', status: 'differs' as const, verified: false },
    ];
    expect(splitForeignAudio(['/m/B/1.mp3', '/m/B/2.mp3', '/m/B/3.mp3'], records)).toEqual({
      owned: ['/m/B/1.mp3', '/m/B/2.mp3'],
      foreign: ['/m/B/3.mp3'],
    });
  });

  it('treats every file as owned when there are no records', () => {
    expect(splitForeignAudio(['/m/B/1.mp3'], undefined)).toEqual({ owned: ['/m/B/1.mp3'], foreign: [] });
  });
});

describe('audioFileFormat', () => {
  it('is the extension, or the most common one, lower-cased', () => {
    expect(audioFileFormat(['/m/B/Book.M4B'])).toBe('m4b');
    expect(audioFileFormat(['/a.mp3', '/b.mp3', '/c.m4a'])).toBe('mp3');
    expect(audioFileFormat([])).toBeNull();
  });
});
