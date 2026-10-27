/**
 * Component: qBittorrent Automatic Torrent Management on add (#326)
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * The real service against the fake qBittorrent (tests/helpers): what each add sends so the files
 * land in RMAB's download folder whatever qBittorrent's default Torrent Management Mode is.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { FakeQbittorrent, magnetOf, PLAIN, torrentFile } from '../helpers/fake-qbittorrent';

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const fake = new FakeQbittorrent();
let files: Server;
let filesUrl = '';
const addParams = () => fake.requests.find((r) => r.path === '/api/v2/torrents/add')?.params;

const sources = [
  ['magnet link', () => magnetOf(PLAIN)],
  ['.torrent file', () => `${filesUrl}/plain.torrent`],
] as const;

beforeAll(async () => {
  await fake.start();
  files = createServer((_req, res) => res.end(torrentFile(PLAIN)));
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  const address = files.address();
  filesUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await fake.stop();
  await new Promise<void>((resolve) => files.close(() => resolve()));
});

beforeEach(() => fake.reset());

describe.each(sources)('adding a %s', (_label, url) => {
  it('asks for Automatic Torrent Management so the category save path applies, with no savepath', async () => {
    await new QBittorrentService(fake.url, '', '', '/downloads').addDownload(url());

    const params = addParams();
    expect(params).toMatchObject({ category: 'readmeabook', autoTMM: 'true' });
    expect(params).not.toHaveProperty('savepath');
  });

  it('sends the download folder in Manual mode when the category could not be ensured', async () => {
    fake.categoryFault = true;
    await new QBittorrentService(fake.url, '', '', '/downloads/torrents').addDownload(url());

    expect(addParams()).toMatchObject({ category: 'readmeabook', autoTMM: 'false', savepath: '/downloads/torrents' });
  });

  it('sends the remote-mapped download folder in that fallback', async () => {
    fake.categoryFault = true;
    const mapping = { enabled: true, remotePath: 'F:\\Docker\\downloads', localPath: '/downloads' };
    await new QBittorrentService(fake.url, '', '', '/downloads', 'readmeabook', false, mapping).addDownload(url());

    expect(addParams()).toMatchObject({ autoTMM: 'false', savepath: 'F:\\Docker\\downloads' });
  });
});
