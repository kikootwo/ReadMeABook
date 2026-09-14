/**
 * Component: qBittorrent Add Response Compatibility Tests
 * Documentation: documentation/phase3/qbittorrent.md
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

// Minimal trackerless torrent; exercise the real parser and multipart upload.
const info = Buffer.from(`d6:lengthi1e4:name8:Book.txt12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}e`);
const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
const hash = createHash('sha1').update(info).digest('hex');
const receipt = {
  success_count: 1,
  failure_count: 0,
  pending_count: 0,
  added_torrent_ids: [hash],
};

describe('qBittorrent add responses over HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let response: unknown;
  let status: number;
  let existing: boolean;
  let uploads: { contentType: string; body: Buffer }[];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const pathname = new URL(req.url!, 'http://localhost').pathname;
      if (pathname === '/book.torrent') {
        res.end(torrent);
      } else if (pathname === '/api/v2/torrents/categories') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ readmeabook: { savePath: '/downloads' } }));
      } else if (pathname === '/api/v2/torrents/info') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(existing ? [{ hash }] : []));
      } else if (pathname === '/api/v2/torrents/add') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        uploads.push({ contentType: req.headers['content-type'] || '', body: Buffer.concat(chunks) });
        res.statusCode = status;
        res.setHeader('Content-Type', typeof response === 'string' ? 'text/plain' : 'application/json');
        res.end(typeof response === 'string' ? response : JSON.stringify(response));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    response = receipt;
    status = 200;
    existing = false;
    uploads = [];
  });

  describe.each(['magnet', 'file'] as const)('%s', kind => {
    const add = () => new QBittorrentService(baseUrl, '', '').addTorrent(
      kind === 'magnet' ? `magnet:?xt=urn:btih:${hash}` : `${baseUrl}/book.torrent`
    );

    it.each([
      ['legacy success', 'Ok.'],
      ['5.2 success', receipt],
      ['case-insensitive hash', { ...receipt, added_torrent_ids: [hash.toUpperCase()] }],
    ])('accepts %s and returns the submitted hash', async (_label, body) => {
      response = body;
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
      ['empty body', ''],
      ['legacy rejection', 'Fails.'],
      ['HTML response', '<html>login</html>'],
      ['null', null],
      ['array', [receipt]],
      ['missing fields', { success_count: 1 }],
      ['failure', { ...receipt, failure_count: 1 }],
      ['pending', { ...receipt, pending_count: 1 }],
      ['no success', { ...receipt, success_count: 0 }],
      ['string count', { ...receipt, success_count: '1' }],
      ['wrong hash', { ...receipt, added_torrent_ids: ['0'.repeat(40)] }],
      ['missing hash', { ...receipt, added_torrent_ids: [] }],
      ['non-string hash', { ...receipt, added_torrent_ids: [123] }],
      ['extra hash', { ...receipt, added_torrent_ids: [hash, '0'.repeat(40)] }],
      ['multiple successes', { ...receipt, success_count: 2 }],
    ])('rejects %s despite HTTP 200', async (_label, body) => {
      response = body;
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
      expect(uploads).toHaveLength(1);
    });

    it('rejects an asynchronous receipt without a confirmed hash', async () => {
      status = 202;
      response = { success_count: 0, failure_count: 0, pending_count: 1, added_torrent_ids: [] };
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
    });

    it('still rejects HTTP errors with a success-shaped body', async () => {
      status = 409;
      await expect(add()).rejects.toThrow('Failed to add torrent to qBittorrent');
    });

    it('returns existing downloads without submitting them again', async () => {
      existing = true;
      await expect(add()).resolves.toBe(hash);
      expect(uploads).toHaveLength(0);
    });
  });
});
