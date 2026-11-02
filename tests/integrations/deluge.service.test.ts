/**
 * Component: Deluge Integration Service Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DelugeService, getDelugeService, invalidateDelugeService } from '@/lib/integrations/deluge.service';

const clientMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  isAxiosError: (error: any) => Boolean(error?.isAxiosError),
}));

const parseTorrentMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
}));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('parse-torrent', () => ({ default: parseTorrentMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: vi.fn(async () => configServiceMock),
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));

/** Helper: simulate a successful Deluge login + daemon connected response */
function mockLoginSuccess() {
  // auth.login
  clientMock.post.mockResolvedValueOnce({
    data: { result: true, error: null, id: 1 },
    headers: { 'set-cookie': ['_session_id=abc123; Path=/;'] },
  });
  // web.connected (daemon already connected)
  clientMock.post.mockResolvedValueOnce({
    data: { result: true, error: null, id: 2 },
    headers: {},
  });
}

/** Helper: simulate login + force daemon reconnection (get_hosts -> connect -> verify) */
function mockLoginForceReconnect() {
  // auth.login
  clientMock.post.mockResolvedValueOnce({
    data: { result: true, error: null, id: 1 },
    headers: { 'set-cookie': ['_session_id=abc123; Path=/;'] },
  });
  // web.get_hosts
  mockRpc([['host-1', '127.0.0.1', 58846, '']]);
  // web.connect
  mockRpc(null);
  // web.connected (verify)
  mockRpc(true);
}

/** Helper: simulate a Deluge RPC response */
function mockRpc(result: any, error: any = null) {
  clientMock.post.mockResolvedValueOnce({
    data: { result, error, id: 1 },
    headers: {},
  });
}

describe('DelugeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    parseTorrentMock.mockReset();
    configServiceMock.get.mockReset();
    downloadClientManagerMock.getClientForProtocol.mockReset();
    invalidateDelugeService();
  });

  it('authenticates and stores session cookie', async () => {
    const service = new DelugeService('http://deluge', '', 'mypass');

    // Mock login (auth.login + web.connected check)
    mockLoginSuccess();

    const result = await service.testConnection();
    expect(result.success).toBe(true);
  });

  it('fails authentication with wrong password', async () => {
    const service = new DelugeService('http://deluge', '', 'bad');

    clientMock.post.mockResolvedValueOnce({
      data: { result: false, error: null, id: 1 },
      headers: {},
    });

    const result = await service.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('authenticate');
  });

  it('force reconnects daemon on error code 2 (Unknown method)', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    // First RPC returns error code 2 (daemon disconnected)
    mockRpc(null, { code: 2, message: 'Unknown method' });
    // rpc() retries via login(true) -> force reconnect
    mockLoginForceReconnect();
    // Retried core.get_torrent_status succeeds
    mockRpc({
      name: 'Test Torrent', total_size: 1000, total_done: 1000, progress: 100,
      state: 'Seeding', download_payload_rate: 0, eta: 0,
      label: 'readmeabook', save_path: '/downloads', time_added: 1700000000,
      is_finished: true, seeding_time: 3600, ratio: 1.5, message: '',
    });

    const info = await service.getDownload('abc123');
    expect(info).not.toBeNull();
    expect(info!.name).toBe('Test Torrent');
    expect(info!.status).toBe('seeding');
  });

  it('does not retry error code 2 more than once', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    // First RPC returns error code 2
    mockRpc(null, { code: 2, message: 'Unknown method' });
    // Force reconnect succeeds
    mockLoginForceReconnect();
    // Retried RPC also returns error code 2 (persistent failure) — retried=true, so no more retries
    mockRpc(null, { code: 2, message: 'Unknown method' });

    const result = await (service as any).rpc('core.get_torrent_status', ['abc123', ['name']]);
    expect(result.error).toEqual({ code: 2, message: 'Unknown method' });
  });

  it('returns connection errors for refused connections', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');

    clientMock.post.mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ECONNREFUSED',
      message: 'refused',
    });

    const result = await service.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection refused');
  });

  it('maps Deluge status strings to unified DownloadStatus', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    const states: Record<string, string> = {
      'Downloading': 'downloading',
      'Seeding': 'seeding',
      'Paused': 'paused',
      'Checking': 'checking',
      'Queued': 'queued',
      'Error': 'failed',
      'Moving': 'downloading',
      'UnknownState': 'downloading', // fallback
    };

    for (const [delugeState, expectedStatus] of Object.entries(states)) {
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: {
            name: 'Test', total_size: 1000, total_done: 500, progress: 50,
            state: delugeState, download_payload_rate: 100, eta: 60,
            label: 'readmeabook', save_path: '/downloads', time_added: 1700000000,
            is_finished: false, seeding_time: 0, ratio: 0, message: '',
          },
          error: null,
          id: 1,
        },
        headers: {},
      });

      const info = await service.getDownload('abc123');
      expect(info).not.toBeNull();
      expect(info!.status).toBe(expectedStatus);
    }
  });

  it('normalizes progress from 0-100 to 0-1', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc({
      name: 'Audiobook', total_size: 1000, total_done: 420, progress: 42,
      state: 'Downloading', download_payload_rate: 50, eta: 120,
      label: 'readmeabook', save_path: '/downloads', time_added: 1700000000,
      is_finished: false, seeding_time: 0, ratio: 0, message: '',
    });

    const info = await service.getDownload('hash1');
    expect(info).not.toBeNull();
    expect(info!.progress).toBeCloseTo(0.42);
    expect(info!.bytesDownloaded).toBe(420);
  });

  it('returns null when torrent is not found (empty result)', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    // Mock 4 attempts (initial + 3 retries) returning empty results
    for (let i = 0; i < 4; i++) {
      mockRpc({});
    }

    const info = await service.getDownload('missing-hash');
    expect(info).toBeNull();
  });

  it('rejects empty download URLs', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    await expect(service.addDownload('')).rejects.toThrow('Invalid download URL');
  });

  it('rejects a magnet link without an info hash before any RPC call', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    await expect(service.addDownload('magnet:?xt=urn:btih:')).rejects.toThrow('Invalid magnet link');
    expect(clientMock.post).not.toHaveBeenCalled();
  });

  it('adds magnet links successfully', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    // Mock: check duplicate (not found)
    mockRpc({});
    // Mock: add_torrent_magnet
    mockRpc('0123456789abcdef0123456789abcdef01234567');
    // Mock: set_torrent_options (disable seed limits)
    mockRpc(null);
    // Mock: label.add (ensure label)
    mockRpc(null);
    // Mock: label.set_torrent
    mockRpc(null);

    const result = await service.addDownload(
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    );
    expect(result).toEqual({ id: '0123456789abcdef0123456789abcdef01234567', alreadyInClient: false, infoHash: '0123456789abcdef0123456789abcdef01234567' });
  });

  it('reports a magnet already in Deluge as taken over and sends no add', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    // Mock: duplicate found
    mockRpc({ name: 'Existing Audiobook' });

    const result = await service.addDownload(
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    );
    expect(result).toEqual({ id: '0123456789abcdef0123456789abcdef01234567', alreadyInClient: true, infoHash: '0123456789abcdef0123456789abcdef01234567' });
    // Only 1 RPC call (the duplicate check), no add call
    expect(clientMock.post).toHaveBeenCalledTimes(1);
  });

  it('throws when Deluge rejects a magnet link', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc({}); // not duplicate
    mockRpc(null, { message: 'rejected' }); // add returns null (failure)
    mockRpc({}); // re-check after the rejection: still not there

    await expect(service.addDownload(
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
    )).rejects.toThrow('Deluge rejected magnet link');
  });

  // #423: someone else added it between the pre-check and the add; Deluge rejects the duplicate
  it('records a rejected duplicate add as taken over after one re-check', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc({}); // pre-check: not there
    mockRpc(null, { message: 'Torrent already in session (0123).' });
    mockRpc({ name: 'Theirs' }); // re-check: there now

    const result = await service.addDownload('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');
    expect(result).toEqual({ id: '0123456789abcdef0123456789abcdef01234567', alreadyInClient: true, infoHash: '0123456789abcdef0123456789abcdef01234567' });
    // No seed-limit or label calls on someone else's torrent
    expect(clientMock.post).toHaveBeenCalledTimes(3);
  });

  it('adds torrent files after parsing', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent-data') });
    parseTorrentMock.mockResolvedValueOnce({ infoHash: 'hash-1', name: 'Book' });

    mockRpc({}); // not duplicate
    mockRpc('hash-1'); // add_torrent_file
    mockRpc(null); // set_torrent_options
    mockRpc(null); // label.add
    mockRpc(null); // label.set_torrent

    const result = await service.addDownload('http://example.com/file.torrent');
    expect(result).toEqual({ id: 'hash-1', alreadyInClient: false, infoHash: 'hash-1' });
  });

  it('follows redirect to magnet link', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 302, headers: { location: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01' } },
    });

    // Magnet duplicate check
    mockRpc({});
    mockRpc('abcdef0123456789abcdef0123456789abcdef01');
    mockRpc(null); // set_torrent_options
    mockRpc(null); // label.add
    mockRpc(null); // label.set_torrent

    const result = await service.addDownload('http://example.com/file.torrent');
    expect(result).toEqual({ id: 'abcdef0123456789abcdef0123456789abcdef01', alreadyInClient: false, infoHash: 'abcdef0123456789abcdef0123456789abcdef01' });
  });

  it('throws for invalid redirect locations', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 302, headers: { location: 'ftp://bad' } },
    });

    await expect(service.addDownload('http://example.com/file.torrent')).rejects.toThrow('Invalid redirect location');
  });

  it('throws when torrent file parsing fails', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('bad-data') });
    parseTorrentMock.mockRejectedValueOnce(new Error('bad torrent'));

    await expect(service.addDownload('http://example.com/file.torrent')).rejects.toThrow('Invalid .torrent file');
  });

  it('pauses and resumes torrents', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc(null);
    await service.pauseDownload('hash-1');

    mockRpc(null);
    await service.resumeDownload('hash-1');

    // Verify pause used array of hashes
    const pauseCall = clientMock.post.mock.calls[0];
    expect(pauseCall[1].method).toBe('core.pause_torrent');
    expect(pauseCall[1].params).toEqual([['hash-1']]);

    // Verify resume used array of hashes
    const resumeCall = clientMock.post.mock.calls[1];
    expect(resumeCall[1].method).toBe('core.resume_torrent');
    expect(resumeCall[1].params).toEqual([['hash-1']]);
  });

  it('deletes torrents with correct parameters', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc(null);
    await service.deleteDownload('hash-1', true);

    const deleteCall = clientMock.post.mock.calls[0];
    expect(deleteCall[1].method).toBe('core.remove_torrent');
    expect(deleteCall[1].params).toEqual(['hash-1', true]);
  });

  it('returns labels from Label plugin', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    mockRpc(['readmeabook', 'movies', 'tv']);

    const categories = await service.getCategories();
    expect(categories).toEqual(['readmeabook', 'movies', 'tv']);
  });

  it('returns empty array when Label plugin is not available', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    (service as any).sessionCookie = '_session_id=abc';

    clientMock.post.mockRejectedValueOnce(new Error('Unknown method'));

    const categories = await service.getCategories();
    expect(categories).toEqual([]);
  });

  it('postProcess is a no-op', async () => {
    const service = new DelugeService('http://deluge', '', 'pass');
    await expect(service.postProcess('hash-1')).resolves.toBeUndefined();
  });

  describe('singleton getDelugeService()', () => {
    it('throws when no Deluge client is configured', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue(null);
      await expect(getDelugeService()).rejects.toThrow('Deluge is not configured');
    });

    it('throws when configured client is not deluge type', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'c1', type: 'qbittorrent', name: 'qB', enabled: true,
        url: 'http://qb', password: 'pass', disableSSLVerify: false,
        remotePathMappingEnabled: false,
      });
      configServiceMock.get.mockResolvedValue('/downloads');

      await expect(getDelugeService()).rejects.toThrow('Expected Deluge client but found qbittorrent');
    });

    it('creates and caches instance on success', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'c1', type: 'deluge', name: 'Deluge', enabled: true,
        url: 'http://deluge', password: 'pass', disableSSLVerify: false,
        remotePathMappingEnabled: false,
      });
      configServiceMock.get.mockResolvedValue('/downloads');

      const testSpy = vi.spyOn(DelugeService.prototype, 'testConnection')
        .mockResolvedValue({ success: true, message: 'Connected' });

      const first = await getDelugeService();
      const second = await getDelugeService();
      expect(first).toBe(second);
      expect(downloadClientManagerMock.getClientForProtocol).toHaveBeenCalledTimes(1);

      testSpy.mockRestore();
    });
  });
});
