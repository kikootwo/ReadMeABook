/**
 * Component: Prowlarr Key Scoping Across Download Clients (real HTTP source servers)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Each client fetches the .torrent/.nzb itself; these tests assert that the
 * Prowlarr key reaches only the configured Prowlarr origin across absolute and
 * relative redirects. Client APIs are stubbed except qBittorrent, which runs
 * against a minimal fake qBittorrent server.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SourceServers,
  TEST_MAGNET,
  TEST_NZB,
  TEST_PROWLARR_KEY,
  TEST_TORRENT,
  TEST_TORRENT_HASH,
  redirectTo,
  serve,
} from '../helpers/source-servers';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { TransmissionService } from '@/lib/integrations/transmission.service';
import { DelugeService } from '@/lib/integrations/deluge.service';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { NZBGetService } from '@/lib/integrations/nzbget.service';
import { UnusableDownloadSourceError } from '@/lib/interfaces/download-client.interface';
import { DownloadSourceTimeoutError } from '@/lib/integrations/download-source';

const logged = vi.hoisted(() => [] as string[]);
// Short fetch deadline so the slow-source case finishes quickly
vi.mock('@/lib/constants/download-timeouts', () => ({ DOWNLOAD_CLIENT_TIMEOUT: 1500 }));
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { logged.push(JSON.stringify(args)); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

const servers = new SourceServers();
let qbitServer: Server;
let qbitUrl = '';
let qbitAdds: URLSearchParams[] = [];
let submitted: string[] = [];

interface ClientCase {
  name: string;
  protocol: 'torrent' | 'usenet';
  create: () => { addDownload: (url: string, options?: any) => Promise<string> };
}

const cases: ClientCase[] = [
  { name: 'qBittorrent', protocol: 'torrent', create: () => new QBittorrentService(qbitUrl, '', '') },
  {
    name: 'Transmission', protocol: 'torrent', create: () => {
      const service = new TransmissionService('http://127.0.0.1:9', 'u', 'p');
      vi.spyOn(service as any, 'getTorrentByHash').mockRejectedValue(new Error('not found'));
      vi.spyOn(service as any, 'disableSeedLimits').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'rpc').mockImplementation(async (...args: any[]) => {
        submitted.push(args[1]?.filename ?? 'metainfo');
        return { result: 'success', arguments: { 'torrent-added': { hashString: TEST_TORRENT_HASH } } };
      });
      return service;
    },
  },
  {
    name: 'Deluge', protocol: 'torrent', create: () => {
      const service = new DelugeService('http://127.0.0.1:9', '', 'p');
      vi.spyOn(service as any, 'postAddSetup').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'rpc').mockImplementation(async (...args: any[]) => {
        if (args[0] === 'core.get_torrent_status') return { result: {} };
        submitted.push(args[0] === 'core.add_torrent_magnet' ? args[1][0] : 'metainfo');
        return { result: TEST_TORRENT_HASH };
      });
      return service;
    },
  },
  {
    name: 'SABnzbd', protocol: 'usenet', create: () => {
      const service = new SABnzbdService('http://127.0.0.1:9', 'sab-key');
      vi.spyOn(service, 'ensureCategory').mockResolvedValue(undefined);
      vi.spyOn((service as any).client, 'post').mockResolvedValue({ data: { status: true, nzo_ids: ['SABnzbd_nzo_1'] } });
      return service;
    },
  },
  {
    name: 'NZBGet', protocol: 'usenet', create: () => {
      const service = new NZBGetService('http://127.0.0.1:9', 'u', 'p');
      vi.spyOn(service, 'ensureCategory').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'rpc').mockResolvedValue(42);
      return service;
    },
  },
];

// sourceHeaders is the pre-fix option (key sent on every hop); the fix ignores it.
const options = () => ({
  sourceAuth: { prowlarrBaseUrl: servers.prowlarrUrl, apiKey: TEST_PROWLARR_KEY },
  sourceHeaders: { 'X-Api-Key': TEST_PROWLARR_KEY },
}) as any;

describe('Prowlarr key scoping in download clients', () => {
  beforeAll(async () => {
    await servers.start();
    qbitServer = createServer(async (req, res) => {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/api/v2/torrents/categories') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ readmeabook: { savePath: '/downloads' } }));
      } else if (pathname === '/api/v2/torrents/info') {
        res.setHeader('Content-Type', 'application/json');
        res.end('[]');
      } else if (pathname === '/api/v2/torrents/add') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString();
        qbitAdds.push(new URLSearchParams(body));
        submitted.push(new URLSearchParams(body).get('urls') ?? 'metainfo');
        res.end('Ok.');
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => qbitServer.listen(0, '127.0.0.1', resolve));
    const address = qbitServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing qBittorrent test port');
    qbitUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await servers.stop();
    await new Promise<void>((resolve) => qbitServer.close(() => resolve()));
  });

  beforeEach(() => {
    servers.reset();
    logged.length = 0;
    qbitAdds = [];
    submitted = [];
  });

  describe.each(cases)('$name', ({ protocol, create }) => {
    const payload = () => serve(protocol === 'torrent' ? TEST_TORRENT : TEST_NZB);
    const startUrl = () => `${servers.prowlarrUrl}/1/download?apikey=${TEST_PROWLARR_KEY}&link=abc`;

    it('sends the key to Prowlarr but not across an absolute redirect to another origin', async () => {
      servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/release`));
      servers.on('other', '/release', payload());

      await expect(create().addDownload(startUrl(), options())).resolves.toBeTruthy();

      expect(servers.keyed('prowlarr').length).toBeGreaterThan(0);
      expect(servers.requests.some((r) => r.server === 'other')).toBe(true);
      expect(servers.keyed('other')).toHaveLength(0);
    });

    it('follows relative redirects and keeps the key on the Prowlarr origin only', async () => {
      servers.on('prowlarr', '/1/download', redirectTo('/2/download'));
      servers.on('prowlarr', '/2/download', redirectTo(`${servers.otherUrl}/indexer/get`));
      servers.on('other', '/indexer/get', redirectTo('/files/release'));
      servers.on('other', '/files/release', payload());

      await expect(create().addDownload(startUrl(), options())).resolves.toBeTruthy();

      expect(servers.keyed('prowlarr')).toHaveLength(2);
      expect(servers.keyed('other')).toHaveLength(0);
    });

    it('never sends the key when the download URL is not on the Prowlarr origin', async () => {
      servers.on('other', '/1/download', payload());

      await create().addDownload(`${servers.otherUrl}/1/download`, options());

      expect(servers.keyed()).toHaveLength(0);
    });

    it('keeps the key out of the logs', async () => {
      servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/release`));
      servers.on('other', '/release', payload());

      await create().addDownload(startUrl(), options());

      expect(logged.join('\n')).not.toContain(TEST_PROWLARR_KEY);
    });

    if (protocol === 'torrent') {
      it.each([2, 3])('adds a magnet found at redirect hop %i', async (hop) => {
        servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/hop1`));
        servers.on('other', '/hop1', redirectTo(hop === 2 ? TEST_MAGNET : '/hop2'));
        servers.on('other', '/hop2', redirectTo(TEST_MAGNET));

        await expect(create().addDownload(startUrl(), options())).resolves.toBe(TEST_TORRENT_HASH);

        expect(submitted).toEqual([TEST_MAGNET]);
        expect(servers.keyed('other')).toHaveLength(0);
      });
    }
  });

  describe('qBittorrent passes source errors through to the processor', () => {
    it('reports an unusable redirect as UnusableDownloadSourceError (so the next release is tried)', async () => {
      servers.on('prowlarr', '/1/download', redirectTo('ftp://files.example/book.torrent'));
      const error = await new QBittorrentService(qbitUrl, '', '').addDownload(`${servers.prowlarrUrl}/1/download`, options()).catch((e) => e);
      expect(error).toBeInstanceOf(UnusableDownloadSourceError);
    });

    it('reports a source that outlasts the deadline as DownloadSourceTimeoutError (so the job is retried)', async () => {
      servers.on('other', '/slow', (res) => {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        const timer = setInterval(() => res.write('d'), 50);
        res.on('close', () => clearInterval(timer));
      });
      const error = await new QBittorrentService(qbitUrl, '', '').addDownload(`${servers.otherUrl}/slow`, options()).catch((e) => e);
      expect(error).toBeInstanceOf(DownloadSourceTimeoutError);
      expect(error.code).toBe('ETIMEDOUT');
    });
  });
});
