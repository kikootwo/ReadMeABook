/**
 * Component: Organize Tag Details Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudibleDetailsLoader, resolveTagDetails } from '@/lib/processors/organize-tag-details';
import type { RMABLogger } from '@/lib/utils/logger';

const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as RMABLogger;

describe('organize tag details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.get.mockImplementation(async (key: string) =>
      key === 'metadata_tagging_enabled' ? 'true' : null
    );
  });

  describe('createAudibleDetailsLoader', () => {
    it('looks the ASIN up once, however often it is asked', async () => {
      const details = { asin: 'B01', title: 'Book', author: 'Author' };
      audibleServiceMock.getAudiobookDetails.mockResolvedValue(details);
      const load = createAudibleDetailsLoader('B01');

      await expect(load()).resolves.toBe(details);
      await expect(load()).resolves.toBe(details);
      expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledTimes(1);
    });

    it('resolves to null without an ASIN and never calls Audible', async () => {
      await expect(createAudibleDetailsLoader(null)()).resolves.toBeNull();
      expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
    });

    it('does not call Audible until it is asked', () => {
      createAudibleDetailsLoader('B01');
      expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
    });
  });

  describe('resolveTagDetails', () => {
    it('prefers the Audible summary and takes the top-level genres', async () => {
      const load = vi.fn().mockResolvedValue({
        description: 'Full summary.',
        primaryGenres: ['Romance'],
      });

      await expect(resolveTagDetails('Stored blurb.', load, logger)).resolves.toEqual({
        description: 'Full summary.',
        genres: ['Romance'],
      });
    });

    it('keeps the stored description when the lookup fails, and warns', async () => {
      const load = vi.fn().mockRejectedValue(new Error('Audnexus down'));

      await expect(resolveTagDetails('Stored blurb.', load, logger)).resolves.toEqual({
        description: 'Stored blurb.',
        genres: undefined,
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Audnexus down'));
    });

    it('treats an empty summary and an empty genre list as missing', async () => {
      const load = vi.fn().mockResolvedValue({ description: '', primaryGenres: [] });

      await expect(resolveTagDetails(null, load, logger)).resolves.toEqual({
        description: undefined,
        genres: undefined,
      });
    });

    it.each([['false'], [null]])('returns nothing and skips the lookup when tagging is %s', async (value) => {
      configMock.get.mockResolvedValue(value);
      const load = vi.fn();

      await expect(resolveTagDetails('Stored blurb.', load, logger)).resolves.toEqual({});
      expect(load).not.toHaveBeenCalled();
    });
  });
});
