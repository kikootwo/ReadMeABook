/**
 * Component: Automatic search reports failed indexer searches (#522)
 * Documentation: documentation/phase3/prowlarr.md
 *
 * A failed indexer query must show in the job log (System Logs) and in the request's
 * message, never pass for "no torrents found". Results from the searches that worked
 * are still ranked and used.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import type { SearchStats } from '@/lib/utils/indexer-search-failures';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: vi.fn().mockResolvedValue(null) }),
}));
vi.mock('@/lib/services/ebook-scraper', () => ({ searchByAsin: vi.fn(), searchByTitle: vi.fn(), getSlowDownloadLinks: vi.fn() }));

const HTTP_400 = 'Request failed with status code 400';
const GROUP = '1 indexer (Indexer) with categories [3030]';
const EBOOK_GROUP = '1 indexer (Indexer) with categories [7020]';

const release = (title: string, sizeMB: number) => ({
  indexer: 'Indexer', indexerId: 1, title, size: sizeMB * 1024 * 1024, seeders: 10,
  publishDate: new Date(), downloadUrl: 'magnet:?xt=urn:btih:abc', guid: `guid-${title}`, format: 'M4B',
});

/** searchWithVariations as ProwlarrService fills its stats out-param: `failed` queries threw, the rest answered */
function searchAnswers(failed: string[], answered: number, results: unknown[]) {
  prowlarrMock.searchWithVariations.mockImplementation(async (_t, _a, _f, _o, stats: SearchStats) => {
    for (const query of failed) {
      stats.queriesSent++;
      stats.queriesFailed++;
      stats.failures.push({ query, message: HTTP_400 });
    }
    stats.queriesSent += answered;
    return results;
  });
}

const jobLog = (level: string) =>
  prismaMock.jobEvent.create.mock.calls.map(([arg]) => arg.data).filter((d) => d.level === level).map((d) => d.message);

/** The errorMessage the request was left with (stop-guarded write) */
const requestMessage = () => {
  const call = prismaMock.request.updateMany.mock.calls.at(-1)?.[0] ?? prismaMock.request.update.mock.calls.at(-1)?.[0];
  return call?.data?.errorMessage;
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.request.update.mockResolvedValue({});
  prismaMock.request.findUnique.mockResolvedValue({ customSearchTerms: null, audiobook: null });
  prismaMock.blockedRelease.findMany.mockResolvedValue([]);
  configMock.getAudibleRegion.mockResolvedValue('us');
  configMock.get.mockImplementation(async (key: string) => {
    if (key === 'prowlarr_indexers') {
      return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030], ebookCategories: [7020] }]);
    }
    if (key === 'indexer_flag_config') return '[]';
    if (key === 'ebook_sidecar_preferred_format') return 'epub';
    if (key === 'ebook_annas_archive_enabled') return 'false';
    if (key === 'ebook_indexer_search_enabled') return 'true';
    return null;
  });
});

async function runAudiobookSearch() {
  const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
  return processSearchIndexers({ requestId: 'req-1', audiobook: { id: 'a1', title: 'Book', author: 'Author' }, jobId: 'job-1' });
}

describe('automatic audiobook search: failed indexer searches (#522)', () => {
  it('some fail: one warn per failed query and a summary in the job log, the results that came back are still used', async () => {
    searchAnswers(['Book Author'], 1, [release('Author - Book [M4B]', 300)]);

    const result = await runAudiobookSearch();

    expect(jobLog('warn')).toEqual([
      `Indexer search failed: "Book Author" (${GROUP}): ${HTTP_400}`,
      '1 of 2 indexer searches failed',
    ]);
    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-1', expect.anything(), expect.objectContaining({ title: 'Author - Book [M4B]' }), [], { clientFailures: 0 }
    );
  });

  it('some fail and nothing comes back: the request message counts the failures', async () => {
    searchAnswers(['Book Author'], 1, []);

    await runAudiobookSearch();

    expect(requestMessage()).toBe('No torrents/nzbs found (1 of 2 indexer searches failed; see System Logs). Will retry automatically.');
  });

  it('every search fails: the request message says so instead of "No torrents/nzbs found"', async () => {
    searchAnswers(['Book Author', 'Book'], 0, []);

    await runAudiobookSearch();

    expect(requestMessage()).toBe('All 2 indexer searches failed (see System Logs). Will retry automatically.');
    expect(jobLog('warn')).toContain('2 of 2 indexer searches failed');
  });

  it('a group whose search throws counts as a failed search', async () => {
    prowlarrMock.searchWithVariations.mockRejectedValue(new Error(HTTP_400));

    await runAudiobookSearch();

    expect(jobLog('warn').slice(0, 2)).toEqual([`Indexer search failed: "(whole group)" (${GROUP}): ${HTTP_400}`, '1 of 1 indexer searches failed']);
    expect(requestMessage()).toBe('The indexer search failed (see System Logs). Will retry automatically.');
  });

  it('some fail and nothing qualifies: the "no quality matches" message counts them too', async () => {
    searchAnswers(['Book Author'], 1, [release('Someone Else - Other Title', 300)]);

    await runAudiobookSearch();

    expect(requestMessage()).toBe('No quality matches found (1 of 2 indexer searches failed; see System Logs). Will retry automatically.');
  });

  it('none fail: messages and job log are unchanged', async () => {
    searchAnswers([], 2, []);

    await runAudiobookSearch();

    expect(requestMessage()).toBe('No torrents/nzbs found. Will retry automatically.');
    expect(jobLog('warn').filter((m) => m.includes('indexer search'))).toEqual([]);
  });
});

describe('automatic ebook search: failed indexer searches (#522)', () => {
  async function runEbookSearch() {
    const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
    return processSearchEbook({ requestId: 'req-e', audiobook: { id: 'a1', title: 'Book', author: 'Author' }, jobId: 'job-e' });
  }

  it('some fail: warn lines and the counted message', async () => {
    searchAnswers(['Book Author'], 1, []);

    await runEbookSearch();

    expect(jobLog('warn')).toEqual(expect.arrayContaining([
      `Indexer search failed: "Book Author" (${EBOOK_GROUP}): ${HTTP_400}`,
      '1 of 2 indexer searches failed',
    ]));
    expect(requestMessage()).toBe('No ebook found on Indexer Search (1 of 2 indexer searches failed; see System Logs). Will retry automatically.');
  });

  it("every search fails, Anna's Archive on: what Anna's Archive found, then that every indexer search failed", async () => {
    const base = configMock.get.getMockImplementation()!;
    configMock.get.mockImplementation(async (key: string) => (key === 'ebook_annas_archive_enabled' ? 'true' : base(key)));
    const scraper = await import('@/lib/services/ebook-scraper');
    vi.mocked(scraper.searchByTitle).mockResolvedValue(null);
    searchAnswers(['Book Author', 'Book'], 0, []);

    await runEbookSearch();

    expect(requestMessage()).toBe("No ebook found on Anna's Archive. All 2 indexer searches failed (see System Logs). Will retry automatically.");
  });

  it('none fail: the message is unchanged', async () => {
    searchAnswers([], 2, []);

    await runEbookSearch();

    expect(requestMessage()).toBe('No ebook found on Indexer Search. Will retry automatically.');
  });
});
