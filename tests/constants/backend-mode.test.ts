/**
 * Component: Backend Mode Helper Tests
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { describe, expect, it } from 'vitest';
import {
  BACKEND_MODES,
  backendLabel,
  isBackendMode,
  libraryIdConfigKey,
  triggerScanConfigKey,
  usesItemIdColumn,
} from '@/lib/constants/backend-mode';

describe('backend modes', () => {
  it('knows the three backends and rejects anything else', () => {
    expect(BACKEND_MODES).toEqual(['plex', 'audiobookshelf', 'audiosilo']);
    expect(isBackendMode('audiosilo')).toBe(true);
    expect(isBackendMode('jellyfin')).toBe(false);
    expect(isBackendMode(undefined)).toBe(false);
    expect(isBackendMode(null)).toBe(false);
  });

  it('labels each backend', () => {
    expect(backendLabel('plex')).toBe('Plex');
    expect(backendLabel('audiobookshelf')).toBe('Audiobookshelf');
    expect(backendLabel('audiosilo')).toBe('AudioSilo');
  });

  it('keeps every non-Plex item id in the abs_item_id column', () => {
    expect(usesItemIdColumn('plex')).toBe(false);
    expect(usesItemIdColumn('audiobookshelf')).toBe(true);
    expect(usesItemIdColumn('audiosilo')).toBe(true);
  });

  it('maps each backend to its library id and scan-after-import config keys', () => {
    expect(libraryIdConfigKey('plex')).toBe('plex_audiobook_library_id');
    expect(libraryIdConfigKey('audiobookshelf')).toBe('audiobookshelf.library_id');
    expect(libraryIdConfigKey('audiosilo')).toBe('audiosilo.library_id');
    expect(triggerScanConfigKey('plex')).toBe('plex.trigger_scan_after_import');
    expect(triggerScanConfigKey('audiobookshelf')).toBe('audiobookshelf.trigger_scan_after_import');
    expect(triggerScanConfigKey('audiosilo')).toBe('audiosilo.trigger_scan_after_import');
  });
});
