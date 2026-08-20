import { describe, it, expect } from 'vitest';
import { rankTorrents, TorrentResult, AudiobookRequest } from '@/lib/utils/ranking-algorithm';

describe('English Language Filtering and Subtitle Search', () => {
  const audiobook: AudiobookRequest = {
    title: 'The Expanse 03: Abaddon\'s Gate',
    author: 'James S. A. Corey',
  };

  it('should penalize non-English releases with a -100 penalty', () => {
    const englishTorrent: TorrentResult = {
      title: 'James S. A. Corey - The Expanse 03 - Abaddon\'s Gate (Unabr - 64k [2013])',
      size: 500000000,
      publishDate: new Date(),
      downloadUrl: 'http://example.com/en.nzb',
      guid: 'guid-1',
      indexer: 'Nzbhydra2',
    };

    const germanTorrent: TorrentResult = {
      title: 'James S. A. Corey - Abaddon\'s Gate [German] Hörbuch',
      size: 500000000,
      publishDate: new Date(),
      downloadUrl: 'http://example.com/de.nzb',
      guid: 'guid-2',
      indexer: 'Nzbhydra2',
    };

    const ranked = rankTorrents([englishTorrent, germanTorrent], audiobook, {
      requireAuthor: true,
    });

    const germanRanked = ranked.find(r => r.guid === 'guid-2');
    expect(germanRanked?.finalScore).toBeLessThan(0);
    expect(ranked[0].guid).toBe('guid-1');
  });

  it('should penalize language learning courses for standard book requests', () => {
    const courseTorrent: TorrentResult = {
      title: 'Pimsleur German Level 1 - Learn German Audio Course',
      size: 500000000,
      publishDate: new Date(),
      downloadUrl: 'http://example.com/course.nzb',
      guid: 'guid-3',
      indexer: 'Nzbhydra2',
    };

    const ranked = rankTorrents([courseTorrent], audiobook);
    expect(ranked[0].finalScore).toBeLessThan(0);
  });
});
