/**
 * Component: Admin Paths Settings - File Placement and Metadata Tests
 * Documentation: documentation/features/library-placement.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = vi.hoisted(() => ({ clearCache: vi.fn(), getBackendMode: vi.fn() }));
const stored = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({ invalidateDownloadClientManager: vi.fn() }));
vi.mock('@/lib/integrations/qbittorrent.service', () => ({ invalidateQBittorrentService: vi.fn() }));
vi.mock('@/lib/integrations/sabnzbd.service', () => ({ invalidateSABnzbdService: vi.fn() }));
vi.mock('@/lib/integrations/nzbget.service', () => ({ invalidateNZBGetService: vi.fn() }));
vi.mock('@/lib/integrations/transmission.service', () => ({ invalidateTransmissionService: vi.fn() }));
vi.mock('@/lib/services/audiobookshelf/requester-tag-users', () => ({ loadRequesterTagWarnings: vi.fn(async () => null) }));

const BASE = { downloadDir: '/downloads', mediaDir: '/media/audiobooks' };

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/admin/settings/paths/route');
  const response = await PUT({ json: vi.fn().mockResolvedValue({ ...BASE, ...body }) } as any);
  return { status: response.status, payload: await response.json() };
}

const upsertedKeys = () => prismaMock.configuration.upsert.mock.calls.map((c: unknown[]) => (c[0] as { where: { key: string } }).where.key);
const upsertedValue = (key: string) =>
  (prismaMock.configuration.upsert.mock.calls.find((c: unknown[]) => (c[0] as { where: { key: string } }).where.key === key)?.[0] as { update: { value: string } } | undefined)?.update.value;

describe('PUT /api/admin/settings/paths: File placement and Metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.values.clear();
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.configuration.findUnique.mockImplementation(async ({ where: { key } }: { where: { key: string } }) => {
      const value = stored.values.get(key);
      return value === undefined ? null : { key, value };
    });
    configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
  });

  it('saves a hard link with OPF', async () => {
    const { status } = await put({ filePlacement: 'hardlink', metadataTaggingEnabled: false, metadataOpfEnabled: true, chapterMergingEnabled: false });
    expect(status).toBe(200);
    expect(upsertedValue('audiobook_file_placement')).toBe('hardlink');
    expect(upsertedValue('metadata_opf_enabled')).toBe('true');
    expect(configServiceMock.clearCache).toHaveBeenCalledWith('audiobook_file_placement');
  });

  it('refuses an unknown placement', async () => {
    for (const filePlacement of ['symlink', 'move', 1]) {
      const { status, payload } = await put({ filePlacement });
      expect(status).toBe(400);
      expect(payload.error).toBe('File placement must be copy, hardlink or hardlink_only');
    }
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it('refuses a non-boolean metadataOpfEnabled', async () => {
    expect((await put({ metadataOpfEnabled: 'yes' })).status).toBe(400);
  });

  it('refuses a hard link with tags, and with chapter merge, saving nothing', async () => {
    let r = await put({ filePlacement: 'hardlink', metadataTaggingEnabled: true, chapterMergingEnabled: false });
    expect(r).toMatchObject({ status: 400, payload: { error: 'Hard links need Metadata set to OPF file or None.' } });
    r = await put({ filePlacement: 'hardlink_only', metadataTaggingEnabled: false, chapterMergingEnabled: true });
    expect(r).toMatchObject({ status: 400, payload: { error: 'Turn off chapter merge to use hard links.' } });
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it('checks the stored placement when the field is absent, and an absent tagging field means tags on', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink');
    const r = await put({ chapterMergingEnabled: false });
    expect(r.status).toBe(400);
    expect(r.payload.error).toBe('Hard links need Metadata set to OPF file or None.');
  });

  it('leaves absent placement and OPF keys unchanged', async () => {
    const r = await put({ metadataTaggingEnabled: true });
    expect(r.status).toBe(200);
    expect(upsertedKeys()).not.toContain('audiobook_file_placement');
    expect(upsertedKeys()).not.toContain('metadata_opf_enabled');
  });

  it('never refuses in Plex mode, where placement is hidden (Audiobookshelf -> Plex -> Audiobookshelf)', async () => {
    stored.values.set('audiobook_file_placement', 'hardlink');
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    const r = await put({ metadataTaggingEnabled: true, chapterMergingEnabled: true, filePlacement: 'hardlink', metadataOpfEnabled: true });
    expect(r.status).toBe(200);
    expect(upsertedValue('metadata_tagging_enabled')).toBe('true');
  });
});

describe('GET /api/admin/settings: File placement values', () => {
  it('returns the stored values, today\'s defaults when absent, and the copy-fallback note', async () => {
    const note = { title: 'Book', reason: 'the download and library folders are separate mounts (EXDEV)', at: '2026-11-10T12:00:00.000Z' };
    prismaMock.configuration.findMany.mockResolvedValueOnce([
      { key: 'system.backend_mode', value: 'audiobookshelf' },
      { key: 'audiobook_file_placement', value: 'hardlink_only' },
      { key: 'metadata_opf_enabled', value: 'true' },
      { key: 'audiobook_link_fallback_last', value: JSON.stringify(note) },
    ]);
    prismaMock.user.count.mockResolvedValue(0);
    const { GET } = await import('@/app/api/admin/settings/route');
    const payload = await (await GET({} as any)).json();
    expect(payload.paths).toMatchObject({ filePlacement: 'hardlink_only', metadataOpfEnabled: true, linkFallbackLast: note });

    prismaMock.configuration.findMany.mockResolvedValueOnce([{ key: 'audiobook_file_placement', value: 'symlink' }]);
    const defaults = await (await GET({} as any)).json();
    expect(defaults.paths).toMatchObject({ filePlacement: 'copy', metadataOpfEnabled: false, linkFallbackLast: null });
  });
});
