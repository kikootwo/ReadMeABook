/**
 * Component: Setup Complete - Download Category Ownership
 * Documentation: documentation/phase3/download-clients.md
 *
 * Setup complete decides ownership itself before writing anything: the wizard's display-only
 * categoryInClient and any sent ownedCategory are dropped.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const listCategories = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hashed') }, hash: vi.fn(async () => 'hashed') }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (v: string) => `enc-${v}`, isEncryptedFormat: (v: string) => typeof v === 'string' && v.startsWith('enc-') }),
}));
vi.mock('@/lib/utils/jwt', () => ({ generateAccessToken: () => 'access', generateRefreshToken: () => 'refresh' }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({ listCategories }),
}));

const body = (downloadClient: unknown) => ({
  json: async () => ({
    backendMode: 'plex',
    admin: { username: 'admin', password: 'pass' },
    plex: { url: 'http://plex', token: 'token', audiobook_library_id: 'lib', machine_identifier: 'machine' },
    prowlarr: { url: 'http://prowlarr', api_key: 'key', indexers: [{ id: 1 }] },
    downloadClient,
    paths: { download_dir: '/downloads', media_dir: '/media' },
  }),
}) as never;

const storedClients = () => {
  const call = prismaMock.configuration.upsert.mock.calls.find((call: unknown[]) => (call[0] as { where: { key: string } }).where.key === 'download_clients');
  return call ? JSON.parse(call[0].create.value) : null;
};

const wizardClient = (extra: Record<string, unknown>) => ({
  id: 'temp-1', type: 'qbittorrent', name: 'qBittorrent', enabled: true, url: 'http://qbt', username: 'u', password: 'p',
  disableSSLVerify: false, remotePathMappingEnabled: false, ...extra,
});

describe('setup complete: download categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.create.mockResolvedValue({ id: 'admin-1', plexId: 'local-admin', plexUsername: 'admin', plexEmail: null, role: 'admin', avatarUrl: null });
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.bookDateConfig.findFirst.mockResolvedValue(null);
  });

  it('a custom name missing in the client is stored as ReadMeABook\'s own; the preview is dropped', async () => {
    listCategories.mockResolvedValue(['movies']);
    const { POST } = await import('@/app/api/setup/complete/route');
    await POST(body([wizardClient({ category: ' audiobooks ', categoryInClient: false })]));

    expect(storedClients()).toEqual([expect.objectContaining({ category: 'audiobooks', ownedCategory: 'audiobooks' })]);
    expect(storedClients()[0]).not.toHaveProperty('categoryInClient');
    expect(listCategories).toHaveBeenCalledWith(expect.objectContaining({ type: 'qbittorrent', url: 'http://qbt' }));
  });

  it('a sent ownedCategory cannot claim a category that already exists in the client', async () => {
    listCategories.mockResolvedValue(['Books']);
    const { POST } = await import('@/app/api/setup/complete/route');
    await POST(body([wizardClient({ category: 'books', ownedCategory: 'books', categoryInClient: false })]));

    expect(storedClients()[0].category).toBe('Books');
    expect(storedClients()[0]).not.toHaveProperty('ownedCategory');
  });

  it('a list failure answers 400 before anything is written', async () => {
    listCategories.mockRejectedValue(new Error('ECONNREFUSED'));
    const { POST } = await import('@/app/api/setup/complete/route');
    const res = await POST(body([wizardClient({ category: 'audiobooks' })]));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Couldn't read qBittorrent's categories: ECONNREFUSED");
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('the default needs no list call', async () => {
    const { POST } = await import('@/app/api/setup/complete/route');
    await POST(body([wizardClient({ category: 'readmeabook' })]));
    expect(listCategories).not.toHaveBeenCalled();
    expect(storedClients()[0].category).toBe('readmeabook');
  });

  it('the legacy single-client body keeps the category it sends', async () => {
    listCategories.mockResolvedValue([]);
    const { POST } = await import('@/app/api/setup/complete/route');
    await POST(body({ type: 'sabnzbd', url: 'http://sab', password: 'key', category: 'AudioBooks' }));
    expect(storedClients()[0]).toMatchObject({ type: 'sabnzbd', category: 'audiobooks', ownedCategory: 'audiobooks' });
  });
});
