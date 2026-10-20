/**
 * Component: qBittorrent Add Response Compatibility Tests
 * Documentation: documentation/phase3/qbittorrent.md
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => loggerMock },
}));

/** The error text addTorrent logged before throwing its generic failure. */
const loggedAddError = () =>
  loggerMock.error.mock.calls
    .filter(([message]) => message === 'Failed to add torrent')
    .map(([, meta]) => String((meta as { error?: unknown })?.error ?? ''))
    .join('\n');

// A minimal trackerless torrent, so the real parser and the real multipart upload both run.
const info = Buffer.from(`d6:lengthi1e4:name8:Book.txt12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}e`);
const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
const hash = createHash('sha1').update(info).digest('hex');
const otherHash = '0'.repeat(40);

// The qBittorrent 5.2 receipt for one accepted torrent.
const receipt = {
  success_count: 1,
  failure_count: 0,
  pending_count: 0,
  added_torrent_ids: [hash],
};

describe('qBittorrent add responses over real HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let addBody: unknown;
  let addStatus: number;
  let alreadyAdded: boolean;
  let uploads: { contentType: string; body: Buffer }[];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/book.torrent') {
        res.end(torrent);
      } else if (pathname === '/api/v2/torrents/categories') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ readmeabook: { savePath: '/downloads' } }));
      } else if (pathname === '/api/v2/torrents/info') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(alreadyAdded ? [{ hash }] : []));
      } else if (pathname === '/api/v2/torrents/add') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        uploads.push({ contentType: req.headers['content-type'] ?? '', body: Buffer.concat(chunks) });
        const isText = typeof addBody === 'string';
        res.statusCode = addStatus;
        res.setHeader('Content-Type', isText ? 'text/plain' : 'application/json');
        res.end(isText ? addBody : JSON.stringify(addBody));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    addBody = receipt;
    addStatus = 200;
    alreadyAdded = false;
    uploads = [];
  });

  describe.each(['magnet', 'file'] as const)('%s upload', (kind) => {
    // No credentials: auth-optional mode, so no login round trip is needed.
    const add = () =>
      new QBittorrentService(baseUrl, '', '').addTorrent(
        kind === 'magnet' ? `magnet:?xt=urn:btih:${hash}` : `${baseUrl}/book.torrent`
      );

    it.each([
      ['the legacy Ok. body', 'Ok.'],
      ['a 5.2 JSON receipt', receipt],
      ['a 5.2 receipt with an upper-case hash', { ...receipt, added_torrent_ids: [hash.toUpperCase()] }],
    ])('accepts %s and returns the submitted hash', async (_label, body) => {
      addBody = body;
      await expect(add()).resolves.toBe(hash);
      expect(uploads).toHaveLength(1);
      if (kind === 'magnet') {
        expect(uploads[0].contentType).toContain('application/x-www-form-urlencoded');
        expect(new URLSearchParams(uploads[0].body.toString()).get('urls')).toBe(`magnet:?xt=urn:btih:${hash}`);
      } else {
        expect(uploads[0].contentType).toContain('multipart/form-data');
        expect(uploads[0].body.includes(torrent)).toBe(true);
      }
    });

    it.each([
      ['an empty body', ''],
      ['the legacy Fails. body', 'Fails.'],
      ['an HTML page', '<html>login</html>'],
      ['null', null],
      ['an array', [receipt]],
      ['a receipt missing fields', { success_count: 1 }],
      ['a receipt with a failure', { ...receipt, failure_count: 1 }],
      ['a receipt with a pending add', { ...receipt, pending_count: 1 }],
      ['a receipt with no success', { ...receipt, success_count: 0 }],
      ['a receipt with a string count', { ...receipt, success_count: '1' }],
      ['a receipt for another hash', { ...receipt, added_torrent_ids: [otherHash] }],
      ['a receipt with no hash', { ...receipt, added_torrent_ids: [] }],
      ['a receipt with a non-string hash', { ...receipt, added_torrent_ids: [123] }],
      ['a receipt with an extra hash', { ...receipt, added_torrent_ids: [hash, otherHash] }],
      ['a receipt with two successes', { ...receipt, success_count: 2 }],
    ])('rejects %s despite HTTP 200', async (_label, body) => {
      addBody = body;
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
      expect(uploads).toHaveLength(1);
    });

    it('logs the returned ID when it rejects a receipt for another hash', async () => {
      addBody = { ...receipt, added_torrent_ids: [otherHash] };
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
      const logged = loggedAddError();
      expect(logged).toContain(otherHash);
      expect(logged).not.toContain('[object Object]');
    });

    it('rejects an asynchronous receipt that confirms no hash', async () => {
      addStatus = 202;
      addBody = { success_count: 0, failure_count: 0, pending_count: 1, added_torrent_ids: [] };
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
      expect(uploads).toHaveLength(1);
    });

    it('rejects an HTTP error even with a success-shaped body', async () => {
      addStatus = 409;
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
      expect(uploads).toHaveLength(1);
    });

    it('returns an existing download without submitting it again', async () => {
      alreadyAdded = true;
      await expect(add()).resolves.toBe(hash);
      expect(uploads).toHaveLength(0);
    });
  });
});
