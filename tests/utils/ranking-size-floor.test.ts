/**
 * Component: Ranking Size Floor (MB per minute) Tests
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { AUTO_SEARCH_MIN_MB_PER_MINUTE, rankTorrents } from '@/lib/utils/ranking-algorithm';

const MB = 1024 * 1024;
const RUNTIME = 1182; // minutes

const book = { title: 'The Prefect', author: 'Alastair Reynolds', durationMinutes: RUNTIME };

const release = (guid: string, title: string, sizeMB: number) => ({
  indexer: 'Usenet',
  title,
  size: sizeMB * MB,
  seeders: undefined,
  publishDate: new Date('2024-01-01T00:00:00Z'),
  downloadUrl: `https://indexer/${guid}`,
  guid,
  protocol: 'usenet',
});

// One chapter file out of a 97-file Usenet post: 57 MB for a 1182-minute book (0.05 MB/min)
const singleFile = release('part-44', 'Alastair Reynolds - The Prefect - 44 of 97.mp3', 57);
// A complete low-bitrate release at 0.21 MB/min (about 29 kbps)
const lowBitrate = release('low', 'Alastair Reynolds - The Prefect (Unabridged) MP3', Math.ceil(0.21 * RUNTIME));

describe('automatic search size floor (minMBPerMinute)', () => {
  it('sits at 0.15 MB per minute (about 21 kbps)', () => {
    expect(AUTO_SEARCH_MIN_MB_PER_MINUTE).toBe(0.15);
  });

  it('drops a 57 MB single file for a 1182-minute book', () => {
    const ranked = rankTorrents([singleFile], book, { minMBPerMinute: AUTO_SEARCH_MIN_MB_PER_MINUTE });
    expect(ranked).toEqual([]);
  });

  it('keeps a complete release at 0.21 MB per minute', () => {
    const ranked = rankTorrents([singleFile, lowBitrate], book, { minMBPerMinute: AUTO_SEARCH_MIN_MB_PER_MINUTE });
    expect(ranked.map((r) => r.guid)).toEqual(['low']);
  });

  it('keeps everything when the runtime is unknown', () => {
    const ranked = rankTorrents(
      [singleFile, lowBitrate],
      { title: book.title, author: book.author },
      { minMBPerMinute: AUTO_SEARCH_MIN_MB_PER_MINUTE }
    );
    expect(ranked.map((r) => r.guid).sort()).toEqual(['low', 'part-44']);
  });

  it('keeps everything when the option is not set (interactive search)', () => {
    const ranked = rankTorrents([singleFile, lowBitrate], book, { requireAuthor: false });
    expect(ranked.map((r) => r.guid).sort()).toEqual(['low', 'part-44']);
  });

  it('still applies the 20 MB filter alongside the floor', () => {
    const tiny = release('tiny', 'Alastair Reynolds - The Prefect (Unabridged) MP3', 10);
    const ranked = rankTorrents([tiny], { title: book.title, author: book.author }, { minMBPerMinute: AUTO_SEARCH_MIN_MB_PER_MINUTE });
    expect(ranked).toEqual([]);
  });
});
