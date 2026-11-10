/**
 * Component: Admin Add Torrent Route Tests (real auth middleware)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * POST /api/admin/requests/[id]/add-torrent: admin sessions only. An API token (even an admin's) and a
 * non-admin session are refused before the body is read or any request is looked up, the same for any
 * id. Then: body limits, the torrent itself, the request (404 / type / status), a torrent client, and a
 * compare-and-set claim so a double submit queues one download.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PLAIN, torrentFile } from '../helpers/fake-qbittorrent';
import { bareMagnet } from '@/lib/services/manual-torrent';

const ISSUED_AT = vi.hoisted(() => 1_700_000_000);
const HEX = 'c'.repeat(40);
const MAGNET = `magnet:?xt=urn:btih:${HEX}&dn=A%20Book&tr=udp%3A%2F%2Ftracker.invalid%3A80%2Fpasskey123`;
const BYTES = torrentFile(PLAIN);

const state = vi.hoisted(() => ({
  request: null as null | Record<string, unknown>,
  torrentClient: true as boolean,
  logLines: [] as unknown[][],
}));

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (
      where.id === 'u-admin' ? { id: 'u-admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' }
        : where.id === 'u-user' ? { id: 'u-user', role: 'user', deletedAt: null, registrationStatus: 'approved' }
        : null
    )),
  },
  apiToken: {
    findUnique: vi.fn(async () => ({
      id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'admin',
      tokenUser: { id: 'u-admin', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
    })),
    update: vi.fn(async () => ({})),
  },
  request: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; deletedAt: null } }) => (
      state.request && state.request.id === where.id && state.request.deletedAt === null ? { ...state.request } : null
    )),
    // Compare-and-set on the fixture row: only a row still in the status read matches
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; deletedAt?: null }; data: Record<string, unknown> }) => {
      if (!state.request || state.request.id !== where.id || state.request.status !== where.status) return { count: 0 };
      if ('deletedAt' in where && state.request.deletedAt !== null) return { count: 0 };
      Object.assign(state.request, data);
      return { count: 1 };
    }),
  },
}));
const jobQueueMock = vi.hoisted(() => ({ addDownloadJob: vi.fn(async () => 'job-1') }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'local-admin', username: 'admin', iat: ISSUED_AT }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'local-user', username: 'user', iat: ISSUED_AT }
      : null,
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: async () => ({ get: async () => null }) }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({
    getClientForProtocol: async (protocol: string) => (protocol === 'torrent' && state.torrentClient ? { id: 'c1', type: 'qbittorrent', enabled: true } : null),
  }),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => { throw new Error('not used for magnets'); },
}));
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { state.logLines.push(args); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

function post(body: unknown, { token = 'admin-token' as string | null, id = 'req-1', type = 'application/json', length = undefined as string | undefined } = {}) {
  const headers = new Headers({ 'content-type': type });
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (length) headers.set('content-length', length);
  return new NextRequest(`http://localhost/api/admin/requests/${id}/add-torrent`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(req: NextRequest, id = 'req-1') {
  const { POST } = await import('@/app/api/admin/requests/[id]/add-torrent/route');
  const response = await POST(req, { params: Promise.resolve({ id }) });
  return { status: response.status, payload: await response.json() };
}

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1', type: 'audiobook', status: 'failed', progress: 30, errorMessage: 'old failure', deletedAt: null,
  audiobook: { id: 'ab-1', title: 'Generated Title', author: 'Generated Author' },
  ...overrides,
});
const requestCalls = () => prismaMock.request.findFirst.mock.calls.length + prismaMock.request.updateMany.mock.calls.length;

describe('POST /api/admin/requests/[id]/add-torrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.request = requestRow();
    state.torrentClient = true;
    state.logLines = [];
    jobQueueMock.addDownloadJob.mockImplementation(async () => 'job-1');
  });

  describe('who may call it', () => {
    it('no API token allowlist entry ever matches this path (or the old manual-download path)', async () => {
      const { isEndpointAllowed } = await import('@/lib/constants/api-tokens');
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(isEndpointAllowed(method, '/api/admin/requests/req-1/add-torrent')).toBe(false);
        expect(isEndpointAllowed(method, '/api/requests/req-1/manual-download')).toBe(false);
      }
    });

    it('no session: 401, nothing looked up', async () => {
      expect((await call(post({ magnet: MAGNET }, { token: null }))).status).toBe(401);
      expect(requestCalls()).toBe(0);
    });

    it.each(['req-1', 'no-such-request'])('a non-admin session: 403, body unread, no request query (id %s)', async (id) => {
      const req = post({ magnet: MAGNET }, { token: 'user-token', id });
      const { status, payload } = await call(req, id);
      expect(status).toBe(403);
      expect(payload.message).toBe('Admin access required');
      expect(req.bodyUsed).toBe(false);
      expect(requestCalls()).toBe(0);
    });

    it('a user-role API token: 403 from the allowlist, body unread, no request query', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValueOnce({
        id: 't2', tokenPrefix: 'rmab_usr', expiresAt: null, role: 'user',
        tokenUser: { id: 'u-user', plexId: 'local-user', plexUsername: 'user', role: 'user', deletedAt: null, registrationStatus: 'approved' },
      });
      const req = post({ magnet: MAGNET }, { token: 'rmab_userxyz' });
      const { status, payload } = await call(req);
      expect(status).toBe(403);
      expect(payload.message).toBe('This endpoint is not available via API token authentication');
      expect(req.bodyUsed).toBe(false);
      expect(requestCalls()).toBe(0);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it.each(['req-1', 'no-such-request'])('an admin API token: 403 from the allowlist, before the route runs (id %s)', async (id) => {
      const req = post({ magnet: MAGNET }, { token: 'rmab_abcdef', id });
      const { status, payload } = await call(req, id);
      expect(status).toBe(403);
      expect(payload.message).toBe('This endpoint is not available via API token authentication');
      expect(req.bodyUsed).toBe(false);
      expect(requestCalls()).toBe(0);
    });
  });

  describe('the body and the torrent (checked before any request lookup)', () => {
    it('wrong content type: 415', async () => {
      expect((await call(post({ magnet: MAGNET }, { type: 'text/plain' }))).status).toBe(415);
      expect(requestCalls()).toBe(0);
    });

    it('a declared body over 3 MiB: 413 before reading', async () => {
      const req = post({ magnet: MAGNET }, { length: String(3 * 1024 * 1024 + 1) });
      expect((await call(req)).status).toBe(413);
      expect(requestCalls()).toBe(0);
    });

    it('an undeclared body over 3 MiB: 413, reading stops at the limit', async () => {
      const { status } = await call(post(JSON.stringify({ torrentFile: 'A'.repeat(3 * 1024 * 1024) })));
      expect(status).toBe(413);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it.each([
      ['neither field', {}],
      ['both fields', { magnet: MAGNET, torrentFile: BYTES.toString('base64') }],
      ['not JSON', '{nope'],
      ['a number for the magnet', { magnet: 7 }],
    ])('%s: 400', async (_label, body) => {
      expect((await call(post(body))).status).toBe(400);
      expect(requestCalls()).toBe(0);
    });

    it.each([
      ['malformed base64', { torrentFile: '!!!not base64!!!' }, 'Not a valid .torrent file.'],
      ['20 raw bytes', { torrentFile: Buffer.alloc(20, 7).toString('base64') }, 'Not a valid .torrent file.'],
      ['an http link as magnet', { magnet: 'http://prowlarr:9696/1/download' }, 'This is not a magnet link.'],
      ['a magnet with two torrents', { magnet: `magnet:?xt=urn:btih:${HEX}&xt.1=urn:btih:${'d'.repeat(40)}` }, 'This magnet link names more than one torrent.'],
      ...([
        ['a string length that runs past the end', 'd4:info9:abce'],
        ['a length with a letter before the colon', 'd4:info4a:spame'],
        ['a length with a + before the colon', 'd4:info+4:spame'],
        ['an unclosed list', 'd4:infol4:spam'],
        ['a top-level list', 'l4:spame'],
        ['an empty buffer', ''],
      ].map(([label, bencode]) => [
        `refuses a file that is not well-formed (${label})`,
        { torrentFile: Buffer.from(bencode).toString('base64') },
        'Not a valid .torrent file.',
      ]) as [string, Record<string, string>, string][]),
    ])('%s: 400 with a plain message, no job', async (_label, body, message) => {
      const { status, payload } = await call(post(body));
      expect(status).toBe(400);
      expect(payload.message).toBe(message);
      expect(requestCalls()).toBe(0);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });
  });

  describe('the request', () => {
    it('missing or soft-deleted: 404 (looked up with deletedAt: null)', async () => {
      state.request = requestRow({ deletedAt: new Date() });
      expect((await call(post({ magnet: MAGNET }))).status).toBe(404);
      expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'req-1', deletedAt: null } }));
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('an ebook request: 409', async () => {
      state.request = requestRow({ type: 'ebook' });
      expect((await call(post({ magnet: MAGNET }))).status).toBe(409);
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it.each(['pending', 'failed', 'awaiting_search', 'awaiting_release'])('%s: 200, claimed and one job', async (status) => {
      state.request = requestRow({ status });
      const { status: code, payload } = await call(post({ magnet: MAGNET }));
      expect(code).toBe(200);
      expect(payload.message).toBe('Torrent added.');
      expect(state.request).toMatchObject({ status: 'downloading', progress: 0, errorMessage: null, autoRerequestCount: 0 });
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['awaiting_approval', 'Approve this request before adding a torrent.'],
      ['denied', 'This request was denied.'],
      ['searching', 'A torrent can only be added to a pending, failed or waiting request (this one is searching).'],
      ['downloading', 'A torrent can only be added to a pending, failed or waiting request (this one is downloading).'],
      ['processing', 'A torrent can only be added to a pending, failed or waiting request (this one is processing).'],
      ['downloaded', 'A torrent can only be added to a pending, failed or waiting request (this one is downloaded).'],
      ['available', 'A torrent can only be added to a pending, failed or waiting request (this one is available).'],
      ['cancelled', 'A torrent can only be added to a pending, failed or waiting request (this one is cancelled).'],
    ])('%s: 409, no job', async (status, message) => {
      state.request = requestRow({ status });
      const { status: code, payload } = await call(post({ magnet: MAGNET }));
      expect(code).toBe(409);
      expect(payload.message).toBe(message);
      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('no torrent client: 409 with the plain message, before the claim', async () => {
      state.torrentClient = false;
      const { status, payload } = await call(post({ magnet: MAGNET }));
      expect(status).toBe(409);
      expect(payload).toEqual({
        error: 'NoDownloadClient',
        message: 'No torrent client is set up. Add qBittorrent, Transmission or Deluge in Settings > Download Clients.',
      });
      expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
    });

    it('a request that changed after the read: 409, no job', async () => {
      prismaMock.request.updateMany.mockResolvedValueOnce({ count: 0 });
      const { status, payload } = await call(post({ magnet: MAGNET }));
      expect(status).toBe(409);
      expect(payload.message).toBe('This request changed; refresh and try again.');
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('a request deleted between the read and the claim: 409, no job (the claim also matches deletedAt: null)', async () => {
      prismaMock.request.findFirst.mockImplementationOnce(async () => {
        const read = { ...state.request! };
        state.request!.deletedAt = new Date(); // soft-deleted right after the read
        return read as never;
      });
      const { status, payload } = await call(post({ magnet: MAGNET }));
      expect(status).toBe(409);
      expect(payload.message).toBe('This request changed; refresh and try again.');
      expect(state.request).toMatchObject({ status: 'failed' });
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });

    it('a double submit queues one download', async () => {
      const [a, b] = await Promise.all([call(post({ magnet: MAGNET })), call(post({ magnet: MAGNET }))]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    });

    it('the queue add fails: everything the claim changed is undone and the answer is 500', async () => {
      state.request = requestRow({ autoRerequestCount: 2 });
      jobQueueMock.addDownloadJob.mockRejectedValueOnce(new Error('redis down'));
      expect((await call(post({ magnet: MAGNET }))).status).toBe(500);
      expect(state.request).toMatchObject({ status: 'failed', progress: 30, errorMessage: 'old failure', autoRerequestCount: 2 });
    });
  });

  describe('what is queued', () => {
    it('a magnet: the release carries the magnet as checked, label Manual, no file', async () => {
      await call(post({ magnet: MAGNET }));
      const [id, audiobook, torrent, alternates, chain, file] = jobQueueMock.addDownloadJob.mock.calls[0] as unknown[];
      expect([id, audiobook, alternates, chain, file]).toEqual(['req-1', { id: 'ab-1', title: 'Generated Title', author: 'Generated Author' }, [], undefined, undefined]);
      expect(torrent).toMatchObject({ indexer: 'Manual', title: 'A Book', downloadUrl: MAGNET, guid: MAGNET, infoHash: HEX, protocol: 'torrent' });
      expect((torrent as { indexerId?: number }).indexerId).toBeUndefined();
    });

    it('an upper-case MAGNET: scheme is queued lower-cased (what every client tests for)', async () => {
      expect((await call(post({ magnet: `MAGNET:?XT=URN:BTIH:${HEX}&dn=A%20Book` })))).toMatchObject({ status: 200 });
      const torrent = jobQueueMock.addDownloadJob.mock.calls[0][2] as Record<string, unknown>;
      expect(torrent).toMatchObject({ downloadUrl: `magnet:?xt=urn:btih:${HEX}&dn=A%20Book`, guid: `magnet:?xt=urn:btih:${HEX}&dn=A%20Book`, infoHash: HEX });
    });

    it('a .torrent file: the bytes go beside the release (bare magnet), never on it', async () => {
      await call(post({ torrentFile: BYTES.toString('base64') }));
      const [, , torrent, , , file] = jobQueueMock.addDownloadJob.mock.calls[0] as [unknown, unknown, Record<string, unknown>, unknown, unknown, { data: Buffer; infoHash: string }];
      expect(file.data.equals(BYTES)).toBe(true);
      expect(file.infoHash).toBe(PLAIN.v1);
      expect(torrent).toMatchObject({ indexer: 'Manual', title: PLAIN.name, downloadUrl: bareMagnet(PLAIN.v1, PLAIN.name) });
      expect(JSON.stringify(torrent)).not.toContain(BYTES.toString('base64'));
    });

    it('the log never holds the magnet (its tracker passkey) or the file bytes', async () => {
      expect((await call(post({ magnet: MAGNET }))).status).toBe(200);
      state.request = requestRow();
      expect((await call(post({ torrentFile: BYTES.toString('base64') }))).status).toBe(200);
      const logged = JSON.stringify(state.logLines);
      expect(logged.match(/Admin added a torrent to a request/g)).toHaveLength(2);
      expect(logged).not.toContain('passkey123');
      expect(logged).not.toContain(BYTES.toString('base64'));
    });
  });
});
