/**
 * Component: Saved Indexer Config Normalizer Tests
 * Documentation: documentation/settings-pages.md
 */

import { describe, expect, it } from 'vitest';
import { createIndexerConfigLookup, findIndexerConfig, toSavedIndexerConfig, type SavedIndexerConfig } from '@/lib/utils/indexer-config';

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

  it('prefers the id over a name that belongs to another indexer', () => {
    expect(findIndexerConfig(configs, { indexerId: 7, indexerName: 'Other' }).config).toBe(configs[0]);
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
