import { describe, it, expect } from 'vitest';
import { rankTorrents, TorrentResult, AudiobookRequest } from '@/lib/utils/ranking-algorithm';

describe('Configurable Preferred Language and Penalty Scoring', () => {
  const audiobook: AudiobookRequest = {
    title: 'The Expanse 03: Abaddon\'s Gate',
    author: 'James S. A. Corey',
  };

  const germanTorrent: TorrentResult = {
    title: 'James S. A. Corey - Abaddon\'s Gate [German] Hörbuch',
    size: 500000000,
    publishDate: new Date(),
    downloadUrl: 'http://example.com/de.nzb',
    guid: 'guid-de',
    indexer: 'Nzbhydra2',
  };

  it('should bypass language penalties when preferredLanguage is set to "all"', () => {
    const ranked = rankTorrents([germanTorrent], audiobook, {
      preferredLanguage: 'all',
    });

    const germanRanked = ranked.find(r => r.guid === 'guid-de');
    expect(germanRanked?.finalScore).toBeGreaterThan(0);
    expect(germanRanked?.bonusModifiers.some(m => m.points < 0)).toBe(false);
  });

  it('should apply custom languagePenaltyScore when specified', () => {
    const ranked = rankTorrents([germanTorrent], audiobook, {
      preferredLanguage: 'en',
      languagePenaltyScore: 250,
    });

    const germanRanked = ranked.find(r => r.guid === 'guid-de');
    const penaltyMod = germanRanked?.bonusModifiers.find(m => m.points < 0);

    expect(penaltyMod?.points).toBe(-250);
    expect(penaltyMod?.reason).toContain('-250 penalty');
  });
});
