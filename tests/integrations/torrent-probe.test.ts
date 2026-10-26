/**
 * Component: Strict Torrent Probe Tests (#258)
 * Documentation: documentation/phase3/download-clients.md
 *
 * The seeding cleanup marks a row 'removed' only when the client gives a well-formed
 * answer without the torrent. Every other answer must throw (an error is never "gone"),
 * and the probe makes one request: no not-found retries.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { TransmissionService } from '@/lib/integrations/transmission.service';
import { DelugeService } from '@/lib/integrations/deluge.service';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  post: vi.fn(),
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
}));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

const HASH = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'f'.repeat(40);
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status } });

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.get.mockReset();
  clientMock.post.mockReset();
});

describe('qBittorrent probeDownload', () => {
  const service = () => {
    const s = new QBittorrentService('http://qb', 'user', 'pass');
    (s as unknown as { cookie: string }).cookie = 'SID=x';
    return s;
  };

  it.each([
    ['an empty list', []],
    ['a list with another torrent only (filter ignored)', [{ hash: OTHER, name: 'Other' }]],
  ])('reports missing for HTTP 200 with %s, in one request', async (_label, data) => {
    clientMock.get.mockResolvedValueOnce({ status: 200, data });
    await expect(service().probeDownload(HASH)).resolves.toEqual({ found: false });
    expect(clientMock.get).toHaveBeenCalledTimes(1);
  });

  it('finds the torrent (case-insensitive hash) and reports its added time', async () => {
    clientMock.get.mockResolvedValueOnce({
      status: 200,
      data: [{ hash: HASH.toUpperCase(), name: 'Book', save_path: '/d', added_on: 1700000000, completion_on: 0, state: 'uploading' }],
    });
    const probe = await service().probeDownload(HASH);
    expect(probe.found).toBe(true);
    if (probe.found) expect(probe.info.addedAt).toEqual(new Date(1700000000 * 1000));
  });

  it.each([
    ['an HTML login page', 200, '<html>login</html>'],
    ['an empty body', 200, ''],
    ['null', 200, null],
    ['an object', 200, {}],
    ['HTTP 204', 204, []],
  ])('throws for %s', async (_label, status, data) => {
    clientMock.get.mockResolvedValueOnce({ status, data });
    await expect(service().probeDownload(HASH)).rejects.toThrow();
  });

  it.each([500, 502])('throws for HTTP %s', async (status) => {
    clientMock.get.mockRejectedValueOnce(httpError(status));
    await expect(service().probeDownload(HASH)).rejects.toThrow();
  });

  it('throws on a timeout', async () => {
    clientMock.get.mockRejectedValueOnce(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
    await expect(service().probeDownload(HASH)).rejects.toThrow('timeout');
  });

  it('re-logs in once on 403, then a second 403 is an error', async () => {
    const s = service();
    const login = vi.spyOn(s, 'login').mockResolvedValue();
    clientMock.get.mockRejectedValueOnce(httpError(403)).mockRejectedValueOnce(httpError(403));
    await expect(s.probeDownload(HASH)).rejects.toThrow('HTTP 403');
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('re-logs in once on 403 and uses the next answer', async () => {
    const s = service();
    vi.spyOn(s, 'login').mockResolvedValue();
    clientMock.get.mockRejectedValueOnce(httpError(403)).mockResolvedValueOnce({ status: 200, data: [] });
    await expect(s.probeDownload(HASH)).resolves.toEqual({ found: false });
  });
});

describe('Transmission probeDownload', () => {
  const service = () => new TransmissionService('http://tr', '', '');

  it('reports missing for success with an empty list, in one RPC', async () => {
    clientMock.post.mockResolvedValueOnce({ data: { result: 'success', arguments: { torrents: [] } } });
    await expect(service().probeDownload(HASH)).resolves.toEqual({ found: false });
    expect(clientMock.post).toHaveBeenCalledTimes(1);
    expect(clientMock.post.mock.calls[0][1].arguments.fields).toContain('addedDate');
  });

  it('finds the torrent and reports its added time', async () => {
    clientMock.post.mockResolvedValueOnce({
      data: { result: 'success', arguments: { torrents: [{ hashString: HASH, name: 'Book', downloadDir: '/d', addedDate: 1700000000 }] } },
    });
    const probe = await service().probeDownload(HASH);
    expect(probe.found).toBe(true);
    if (probe.found) expect(probe.info.addedAt).toEqual(new Date(1700000000 * 1000));
  });

  it.each([
    ['an RPC error result', { result: 'no such method' }],
    ['a success without arguments', { result: 'success' }],
    ['a success without a torrent list', { result: 'success', arguments: {} }],
    ['an empty body', ''],
  ])('throws for %s', async (_label, data) => {
    clientMock.post.mockResolvedValueOnce({ data });
    await expect(service().probeDownload(HASH)).rejects.toThrow();
  });
});

describe('Deluge probeDownload', () => {
  const service = () => {
    const s = new DelugeService('http://deluge', '', 'pass');
    (s as unknown as { sessionCookie: string }).sessionCookie = '_session_id=abc';
    return s;
  };

  it('reports missing for {} (core.get_torrent_status of an unknown id), in one call', async () => {
    clientMock.post.mockResolvedValueOnce({ data: { result: {}, error: null, id: 1 }, headers: {} });
    await expect(service().probeDownload(HASH)).resolves.toEqual({ found: false });
    expect(clientMock.post).toHaveBeenCalledTimes(1);
  });

  it('finds the torrent and reports its added time', async () => {
    clientMock.post.mockResolvedValueOnce({ data: { result: { name: 'Book', time_added: 1700000000 }, error: null, id: 1 }, headers: {} });
    const probe = await service().probeDownload(HASH);
    expect(probe.found).toBe(true);
    if (probe.found) expect(probe.info.addedAt).toEqual(new Date(1700000000 * 1000));
  });

  it.each([
    ['a daemon error answer', { result: null, error: { message: 'daemon gone', code: 3 } }],
    ['a null result', { result: null, error: null }],
    ['a list result', { result: [], error: null }],
  ])('throws for %s', async (_label, data) => {
    clientMock.post.mockResolvedValueOnce({ data: { ...data, id: 1 }, headers: {} });
    await expect(service().probeDownload(HASH)).rejects.toThrow();
  });
});
