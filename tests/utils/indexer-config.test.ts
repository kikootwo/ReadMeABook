/**
 * Component: Saved Indexer Config Normalizer Tests
 * Documentation: documentation/settings-pages.md
 */

import { describe, expect, it } from 'vitest';
import {
  createIndexerConfigLookup, describeIgnoredIndexerId, findIndexerConfig, parseSavedIndexers, toSavedIndexerConfig, type SavedIndexerConfig,
} from '@/lib/utils/indexer-config';

const torrent: SavedIndexerConfig = {
  id: 1,
  name: 'Torrent A',
  protocol: 'torrent',
  priority: 17,
  rssEnabled: true,
  audiobookCategories: [3030, 3040],
  ebookCategories: [7020, 7030],
  seedingTimeMinutes: 90,
  ratioLimit: 1.25,
};

const usenet: SavedIndexerConfig = {
  id: 2,
  name: 'Usenet B',
  protocol: 'usenet',
  priority: 3,
  rssEnabled: false,
  audiobookCategories: [3030],
  ebookCategories: [7020],
  removeAfterProcessing: false,
};

describe('toSavedIndexerConfig', () => {
  it('keeps every per-indexer field of a torrent indexer, including ratioLimit', () => {
    expect(toSavedIndexerConfig(torrent)).toEqual(torrent);
  });

  it('keeps every per-indexer field of a usenet indexer', () => {
    expect(toSavedIndexerConfig(usenet)).toEqual(usenet);
  });

  it('is stable when applied repeatedly (load -> save -> load)', () => {
    for (const config of [torrent, usenet]) {
      const once = toSavedIndexerConfig(config);
      expect(toSavedIndexerConfig(once)).toEqual(once);
    }
  });

  it('drops UI-only fields', () => {
    const result = toSavedIndexerConfig({
      ...torrent,
      enabled: true,
      isAdded: true,
      privacy: 'private',
      supportsRss: true,
    } as any);
    expect(result).toEqual(torrent);
  });

  it('treats protocol case-insensitively', () => {
    const result = toSavedIndexerConfig({ ...torrent, protocol: 'Torrent' });
    expect(result.ratioLimit).toBe(1.25);
    expect(result.removeAfterProcessing).toBeUndefined();
  });

  it('applies defaults to missing fields', () => {
    expect(toSavedIndexerConfig({ id: 3, name: 'New', protocol: 'torrent' })).toEqual({
      id: 3,
      name: 'New',
      protocol: 'torrent',
      priority: 10,
      rssEnabled: false,
      audiobookCategories: [3030],
      ebookCategories: [7020],
      seedingTimeMinutes: 0,
      ratioLimit: 0,
    });
    expect(toSavedIndexerConfig({ id: 4, name: 'New NZB', protocol: 'usenet' }).removeAfterProcessing).toBe(true);
  });

  it('keeps a ratioLimit of 0 as 0 rather than replacing it', () => {
    expect(toSavedIndexerConfig({ ...torrent, ratioLimit: 0 }).ratioLimit).toBe(0);
  });

  it('migrates the legacy categories list to audiobookCategories', () => {
    const result = toSavedIndexerConfig({ id: 5, name: 'Old', protocol: 'torrent', categories: [3010] });
    expect(result.audiobookCategories).toEqual([3010]);
  });
});

describe('findIndexerConfig', () => {
  const configs = [
    { id: 7, name: 'New Name', ratioLimit: 2 },
    { id: 8, name: 'Other', ratioLimit: 1 },
  ];

  it('matches by Prowlarr id even when the recorded name differs (renamed indexer)', () => {
    expect(findIndexerConfig(configs, { indexerId: 7, indexerName: 'Old Name' })).toEqual({ config: configs[0], matchedBy: 'id' });
  });

  it('uses the name when it is a different configured indexer than the id (Prowlarr ids reused)', () => {
    expect(findIndexerConfig(configs, { indexerId: 7, indexerName: 'Other' })).toEqual({
      config: configs[1], matchedBy: 'name', idIgnored: 'name-conflict',
    });
  });

  it('uses the id to pick between saved entries that share the recorded name', () => {
    const duplicates = [
      { id: 2, name: 'Tracker', seedingTimeMinutes: 30, ratioLimit: 0 },
      { id: 7, name: 'Tracker', ratioLimit: 2 },
    ];
    expect(findIndexerConfig(duplicates, { indexerId: 7, indexerName: 'Tracker' })).toEqual({ config: duplicates[1], matchedBy: 'id' });
  });

  it('uses the id when the recorded name is the same indexer', () => {
    expect(findIndexerConfig(configs, { indexerId: 7, indexerName: 'New Name' })).toEqual({ config: configs[0], matchedBy: 'id' });
  });

  it('ignores an id that now belongs to an indexer of another protocol', () => {
    const mixed = [
      { id: 3, name: 'SomeNZB', protocol: 'usenet' },
      { id: 5, name: 'PublicTracker', protocol: 'torrent' },
    ];
    expect(findIndexerConfig(mixed, { indexerId: 3, indexerName: 'PublicTracker', protocol: 'torrent' })).toEqual({
      config: mixed[1], matchedBy: 'name', idIgnored: 'protocol-mismatch',
    });
    expect(findIndexerConfig(mixed, { indexerId: 3, indexerName: 'Gone', protocol: 'torrent' })).toEqual({
      config: undefined, matchedBy: null, idIgnored: 'protocol-mismatch',
    });
    // Same protocol, or no protocol known on either side: the id is used
    expect(findIndexerConfig(mixed, { indexerId: 3, indexerName: 'Gone', protocol: 'usenet' }).matchedBy).toBe('id');
    expect(findIndexerConfig(mixed, { indexerId: 3, indexerName: 'Gone' }).matchedBy).toBe('id');
  });

  it('still matches a reused id by id when the indexer it meant is gone (same as a rename)', () => {
    expect(findIndexerConfig(configs, { indexerId: 8, indexerName: 'Removed Tracker' })).toEqual({ config: configs[1], matchedBy: 'id' });
  });

  it('describes an ignored id for the log, and nothing otherwise', () => {
    const ref = { indexerId: 7, indexerName: 'Other', protocol: 'torrent' };
    expect(describeIgnoredIndexerId(ref, findIndexerConfig(configs, ref))).toMatch(/Indexer id 7 recorded for "Other" belongs to another configured indexer.*matched by name/);
    expect(describeIgnoredIndexerId({ indexerId: 7 }, findIndexerConfig(configs, { indexerId: 7 }))).toBeNull();
  });

  it('falls back to the name when the download has no id', () => {
    expect(findIndexerConfig(configs, { indexerId: null, indexerName: 'Other' })).toEqual({ config: configs[1], matchedBy: 'name' });
  });

  it('falls back to the name when the id is no longer configured', () => {
    expect(findIndexerConfig(configs, { indexerId: 42, indexerName: 'New Name' })).toEqual({ config: configs[0], matchedBy: 'name' });
  });

  it('reports no match when neither id nor name is configured', () => {
    expect(findIndexerConfig(configs, { indexerId: 42, indexerName: 'Gone' })).toEqual({ config: undefined, matchedBy: null });
    expect(findIndexerConfig([], {})).toEqual({ config: undefined, matchedBy: null });
  });

  it('a lookup built once answers repeatedly', () => {
    const lookup = createIndexerConfigLookup(configs);
    expect(lookup({ indexerId: 8 }).config).toBe(configs[1]);
    expect(lookup({ indexerName: 'New Name' }).config).toBe(configs[0]);
  });
});

describe('parseSavedIndexers', () => {
  it('returns the list for a JSON array', () => {
    expect(parseSavedIndexers('[{"id":1}]')).toEqual([{ id: 1 }]);
  });

  it.each([null, '', 'not json', '{"id":1}', '42', 'null'])('returns null for %j', (raw) => {
    expect(parseSavedIndexers(raw as string | null)).toBeNull();
  });
});
