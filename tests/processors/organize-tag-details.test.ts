/**
 * Component: Organize Tag Details Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAudibleDetailsLoader,
  readMetadataTaggingEnabled,
  resolveTagDetails,
  TAG_DETAILS_TIMEOUT_MS,
} from '@/lib/processors/organize-tag-details';
import type { RMABLogger } from '@/lib/utils/logger';
import { MAX_RAW_DESCRIPTION_LENGTH } from '@/lib/utils/metadata-text';

const prismaMock = vi.hoisted(() => ({ configuration: { findUnique: vi.fn() } }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as RMABLogger;

describe('organize tag details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  describe('readMetadataTaggingEnabled', () => {
    it.each([
      ['true', true],
      ['false', false],
      [undefined, false],
    ])('reads %s as %s', async (value, expected) => {
      prismaMock.configuration.findUnique.mockResolvedValue(value === undefined ? null : { value });

      await expect(readMetadataTaggingEnabled(logger)).resolves.toBe(expected);
      expect(prismaMock.configuration.findUnique).toHaveBeenCalledWith({ where: { key: 'metadata_tagging_enabled' } });
    });

    it('is undefined when the setting cannot be read (the organizer then reads and reports it), and warns', async () => {
      prismaMock.configuration.findUnique.mockRejectedValue(new Error('db down'));

      await expect(readMetadataTaggingEnabled(logger)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
  });

  describe('resolveTagDetails', () => {
    it('prefers the Audible summary and takes the top-level genres', async () => {
      const load = vi.fn().mockResolvedValue({ description: 'Full summary.', primaryGenres: ['Romance'] });

      await expect(resolveTagDetails('Stored blurb.', load, true, logger)).resolves.toEqual({
        description: 'Full summary.',
        genres: ['Romance'],
      });
    });

    it('takes publisher, subtitle and language from the lookup; the log shows them as the tags get them', async () => {
      const load = vi.fn().mockResolvedValue({
        description: 'Full summary.',
        publisherName: 'Penguin Audio',
        subtitle: 'An Easy & Proven Way',
        language: 'english',
      });

      await expect(resolveTagDetails('Stored blurb.', load, true, logger)).resolves.toMatchObject({
        publisher: 'Penguin Audio',
        subtitle: 'An Easy & Proven Way',
        language: 'english',
      });
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('publisher=Penguin Audio, subtitle=An Easy & Proven Way, language=English'));
    });

    it('logs the sanitized values: a line break from the lookup cannot split the log line', async () => {
      const load = vi.fn().mockResolvedValue({ publisherName: 'Penguin\r\nAudio', subtitle: '  Part\tOne ', language: ' german\n' });

      await resolveTagDetails(null, load, true, logger);

      const line = vi.mocked(logger.info).mock.calls.at(-1)?.[0] as string;
      expect(line).toContain('publisher=Penguin Audio, subtitle=Part One, language=German');
      expect(line).not.toMatch(/[\r\n\t]/);
    });

    it('ignores a publisher, subtitle or language that is not a string, and never throws on it', async () => {
      const load = vi.fn().mockResolvedValue({ publisherName: 42, subtitle: { text: 'x' }, language: ['english'] });

      const details = await resolveTagDetails(null, load, true, logger);

      expect([details.publisher, details.subtitle, details.language]).toEqual([undefined, undefined, undefined]);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('publisher=none, subtitle=none, language=none'));
    });

    it('shortens a long value to 100 characters plus "…" in the job log', async () => {
      const load = vi.fn().mockResolvedValue({ subtitle: 's'.repeat(5000) });

      await resolveTagDetails(null, load, true, logger);

      const line = vi.mocked(logger.info).mock.calls.at(-1)?.[0] as string;
      expect(line).toContain(`subtitle=${'s'.repeat(100)}…,`);
      expect(line.length).toBeLessThan(400);
    });

    it('has no publisher, subtitle or language without the lookup (the book row stores none)', async () => {
      const load = vi.fn().mockResolvedValue(null);

      const details = await resolveTagDetails('Stored blurb.', load, true, logger);

      expect(details).toEqual({ description: 'Stored blurb.' });
      expect([details.publisher, details.subtitle, details.language]).toEqual([undefined, undefined, undefined]);
    });

    it('keeps the stored description when the lookup fails, and warns', async () => {
      const load = vi.fn().mockRejectedValue(new Error('Audnexus down'));

      await expect(resolveTagDetails('Stored blurb.', load, true, logger)).resolves.toEqual({
        description: 'Stored blurb.',
        genres: undefined,
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Audnexus down'));
    });

    it('strips HTML from the stored description (client text, older rows) like the lookup path', async () => {
      const load = vi.fn().mockResolvedValue(null);

      await expect(
        resolveTagDetails('<p>Stored <b>blurb</b>.</p><p>Two &amp; three.</p>', load, true, logger)
      ).resolves.toEqual({ description: 'Stored blurb.\n\nTwo & three.', genres: undefined });
    });

    it('bounds a huge stored description before stripping it', async () => {
      const load = vi.fn().mockResolvedValue(null);
      const started = performance.now();

      const { description } = await resolveTagDetails('<b>x</b> '.repeat(200_000), load, true, logger);

      expect(performance.now() - started).toBeLessThan(1000);
      expect(description!.length).toBeLessThanOrEqual(MAX_RAW_DESCRIPTION_LENGTH);
      expect(description!.startsWith('x x x')).toBe(true);
    });

    it('treats an empty summary and an empty genre list as missing', async () => {
      const load = vi.fn().mockResolvedValue({ description: '', primaryGenres: [] });

      await expect(resolveTagDetails(null, load, true, logger)).resolves.toEqual({
        description: undefined,
        genres: undefined,
      });
    });

    it.each([[false], [undefined]])('returns nothing and skips the lookup when tagging is %s', async (enabled) => {
      const load = vi.fn();

      await expect(resolveTagDetails('Stored blurb.', load, enabled, logger)).resolves.toEqual({});
      expect(load).not.toHaveBeenCalled();
    });

    it('gives up on a lookup slower than 15 s: stored description, no genres, a warning', async () => {
      vi.useFakeTimers();
      const load = vi.fn(() => new Promise<never>(() => {})); // Audible never answers

      const pending = resolveTagDetails('Stored blurb.', load, true, logger);
      await vi.advanceTimersByTimeAsync(TAG_DETAILS_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({ description: 'Stored blurb.', genres: undefined });
      expect(TAG_DETAILS_TIMEOUT_MS).toBe(15_000);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('took over 15 s'));
      expect(vi.getTimerCount()).toBe(0);
    });

    it('uses a lookup the series backfill already settled without waiting, and clears its timer', async () => {
      vi.useFakeTimers();
      audibleServiceMock.getAudiobookDetails.mockResolvedValue({ description: 'Full summary.', primaryGenres: ['History'] });
      const load = createAudibleDetailsLoader('B01');
      await load(); // the series backfill's await

      await expect(resolveTagDetails('Stored blurb.', load, true, logger)).resolves.toEqual({
        description: 'Full summary.',
        genres: ['History'],
      });
      expect(audibleServiceMock.getAudiobookDetails).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
