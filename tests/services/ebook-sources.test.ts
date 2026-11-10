/**
 * Component: Ebook sources enabled helper tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

function withConfig(values: Record<string, string | null>) {
  configMock.get.mockImplementation(async (key: string) => values[key] ?? null);
}

describe('ebookSourcesEnabled', () => {
  it.each([
    [{}, false],
    [{ ebook_annas_archive_enabled: 'true' }, true],
    [{ ebook_indexer_search_enabled: 'true' }, true],
    [{ ebook_annas_archive_enabled: 'false', ebook_indexer_search_enabled: 'false' }, false],
    [{ ebook_sidecar_enabled: 'true' }, true],
    [{ ebook_sidecar_enabled: 'true', ebook_annas_archive_enabled: 'false' }, false],
  ])('%j → %s', async (values, expected) => {
    withConfig(values);
    const { ebookSourcesEnabled } = await import('@/lib/services/ebook-sources');
    expect(await ebookSourcesEnabled()).toBe(expected);
  });
});
