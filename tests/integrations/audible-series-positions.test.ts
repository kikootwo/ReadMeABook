/**
 * Component: Audible Series Positions Fallback Tests (#599)
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const SERIES = 'B0H3C5X19W';
const TITLE = 'Die Tagebücher der Apothekerin';

const fakeAudible = vi.hoisted(() => ({
  getRegion: vi.fn(() => 'de'),
  fetch: vi.fn(),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => fakeAudible }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

function row(asin: string, overrides: Partial<AudibleAudiobook> = {}): AudibleAudiobook {
  return { asin, title: TITLE, author: 'Author', narrator: 'Narrator One', durationMinutes: 500, seriesAsin: SERIES, ...overrides };
}

const positionless = () => [row('B0H36S85HC'), row('B0H6N477LX'), row('B0H6N6TH8T')];

function catalogAnswer(sequences: Record<string, string>) {
  return {
    data: {
      data: {
        products: Object.entries(sequences).map(([asin, sequence]) => ({
          asin,
          // The first entry is another series: the page's own series must win
          series: [{ asin: 'B0OTHER001', title: 'Omnibus', sequence: '9' }, { asin: SERIES, title: TITLE, sequence }],
        })),
      },
    },
  };
}

async function load() {
  return (await import('@/lib/integrations/audible-series-positions')).fillSeriesPositions;
}

describe('fillSeriesPositions', () => {
  beforeEach(() => {
    vi.resetModules();
    fakeAudible.fetch.mockReset();
  });

  it('makes no call when every row carries its position label', async () => {
    const fill = await load();
    const rows = positionless().map((r, i) => ({ ...r, seriesPart: String(i + 1) }));
    expect(await fill(rows, SERIES)).toEqual(rows);
    expect(fakeAudible.fetch).not.toHaveBeenCalled();
  });

  it('makes no call when the local pass proposes no merge', async () => {
    const fill = await load();
    const rows = [row('B0H36S85HC', { title: 'One' }), row('B0H6N477LX', { title: 'Two' })];
    await fill(rows, SERIES);
    expect(fakeAudible.fetch).not.toHaveBeenCalled();
  });

  it('makes exactly one batch call and reads the entry of the page series', async () => {
    fakeAudible.fetch.mockResolvedValue(catalogAnswer({ B0H36S85HC: '1', B0H6N477LX: '2', B0H6N6TH8T: '3.0' }));
    const fill = await load();

    const out = await fill(positionless(), SERIES);

    expect(fakeAudible.fetch).toHaveBeenCalledTimes(1);
    const [path, config, options] = fakeAudible.fetch.mock.calls[0];
    expect(path).toBe('/1.0/catalog/products');
    expect(config.params).toMatchObject({ asins: 'B0H36S85HC,B0H6N477LX,B0H6N6TH8T', num_results: 3, response_groups: 'series' });
    expect(config.timeout).toBeLessThanOrEqual(3000);
    expect(options).toEqual({ catalog: true });
    expect(out.map((b) => b.seriesPart)).toEqual(['1', '2', '3']);
  });

  it('answers a repeat view from the 24 h cache without a call', async () => {
    fakeAudible.fetch.mockResolvedValue(catalogAnswer({ B0H36S85HC: '1', B0H6N477LX: '2', B0H6N6TH8T: '3' }));
    const fill = await load();
    await fill(positionless(), SERIES);
    fakeAudible.fetch.mockClear();

    const out = await fill(positionless(), SERIES);

    expect(fakeAudible.fetch).not.toHaveBeenCalled();
    expect(out.map((b) => b.seriesPart)).toEqual(['1', '2', '3']);
  });

  it('leaves positions unknown on a 503, does not throw, and pauses lookups for 15 min', async () => {
    fakeAudible.fetch.mockRejectedValue({ response: { status: 503 }, isAxiosError: true });
    const fill = await load();

    const out = await fill(positionless(), SERIES);
    expect(out.map((b) => b.seriesPart)).toEqual([undefined, undefined, undefined]);

    fakeAudible.fetch.mockClear();
    await fill(positionless(), SERIES);
    expect(fakeAudible.fetch).not.toHaveBeenCalled();
  });

  it('treats a timeout the same way', async () => {
    fakeAudible.fetch.mockRejectedValue({ code: 'ECONNABORTED', name: 'CanceledError' });
    const fill = await load();
    await expect(fill(positionless(), SERIES)).resolves.toHaveLength(3);
    fakeAudible.fetch.mockClear();
    await fill(positionless(), SERIES);
    expect(fakeAudible.fetch).not.toHaveBeenCalled();
  });
});
