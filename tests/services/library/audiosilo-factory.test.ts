/**
 * Component: Library Factory Tests (AudioSilo)
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudiobookshelfLibraryService,
  AudioSiloLibraryService,
  PlexLibraryService,
  clearLibraryServiceCache,
  getLibraryService,
} from '@/lib/services/library';

const configServiceMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

describe('library factory', () => {
  beforeEach(() => {
    clearLibraryServiceCache();
    configServiceMock.getBackendMode.mockReset();
  });

  it('returns the AudioSilo service in audiosilo mode', async () => {
    configServiceMock.getBackendMode.mockResolvedValue('audiosilo');
    expect(await getLibraryService()).toBeInstanceOf(AudioSiloLibraryService);
  });

  it('still returns the Audiobookshelf and Plex services for their modes', async () => {
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
    expect(await getLibraryService()).toBeInstanceOf(AudiobookshelfLibraryService);

    configServiceMock.getBackendMode.mockResolvedValue('plex');
    expect(await getLibraryService()).toBeInstanceOf(PlexLibraryService);
  });

  it('switches service when the backend mode changes', async () => {
    configServiceMock.getBackendMode.mockResolvedValue('audiosilo');
    const first = await getLibraryService();
    expect(await getLibraryService()).toBe(first);

    configServiceMock.getBackendMode.mockResolvedValue('plex');
    expect(await getLibraryService()).not.toBe(first);
  });
});
