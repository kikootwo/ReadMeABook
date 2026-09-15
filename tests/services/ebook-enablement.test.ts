/**
 * Component: E-book enablement rule
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * One rule shared by the request path and the Discord /request type choices, so the command list
 * can never offer a request type the service would reject.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

/** Feed configuration.findUnique per key. */
const withConfig = (values: Record<string, string | undefined>) => {
  prismaMock.configuration.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(values[where.key] === undefined ? null : { value: values[where.key] })
  );
};

const load = () => import('@/lib/services/ebook-request-creator.service');

describe('isEbookRequestingEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is false when no source is configured', async () => {
    withConfig({});
    const { isEbookRequestingEnabled } = await load();
    expect(await isEbookRequestingEnabled()).toBe(false);
  });

  it('is false when both sources are explicitly disabled', async () => {
    withConfig({ ebook_annas_archive_enabled: 'false', ebook_indexer_search_enabled: 'false' });
    const { isEbookRequestingEnabled } = await load();
    expect(await isEbookRequestingEnabled()).toBe(false);
  });

  it("is true with Anna's Archive alone", async () => {
    withConfig({ ebook_annas_archive_enabled: 'true', ebook_indexer_search_enabled: 'false' });
    const { isEbookRequestingEnabled } = await load();
    expect(await isEbookRequestingEnabled()).toBe(true);
  });

  it('is true with indexer search alone', async () => {
    withConfig({ ebook_annas_archive_enabled: 'false', ebook_indexer_search_enabled: 'true' });
    const { isEbookRequestingEnabled } = await load();
    expect(await isEbookRequestingEnabled()).toBe(true);
  });

  it('honours the legacy key only when the newer one was never written', async () => {
    withConfig({ ebook_sidecar_enabled: 'true' });
    const { isEbookRequestingEnabled } = await load();
    expect(await isEbookRequestingEnabled()).toBe(true);

    vi.clearAllMocks();
    // An explicit false on the newer key wins over the legacy key.
    withConfig({ ebook_annas_archive_enabled: 'false', ebook_sidecar_enabled: 'true' });
    expect(await isEbookRequestingEnabled()).toBe(false);
  });
});
