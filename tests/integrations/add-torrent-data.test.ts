/**
 * Component: Add Torrent - each client's add of a .torrent file's own bytes (addTorrentData)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * addTorrentData shares the client's add with a fetched .torrent: the bytes go out unchanged under a
 * fixed `<v1>.torrent` name, with the category (qBittorrent: an existing category another app owns is
 * used as is, never created or edited), the `audiobook` tag, the save path, seed limits off, and a
 * copy already in the client taken over instead of added.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type FormData from 'form-data';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { TransmissionService } from '@/lib/integrations/transmission.service';
import { DelugeService } from '@/lib/integrations/deluge.service';
import { PLAIN, torrentFile } from '../helpers/fake-qbittorrent';
import { FakeDeluge, FakeTransmission } from '../helpers/fake-torrent-clients';

const clientMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  post: vi.fn(),
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const BYTES = torrentFile(PLAIN);
const FILE_URL = 'http://indexer.test/book.torrent';

describe('qBittorrent addTorrentData', () => {
  let categories: Record<string, { savePath: string }>;
  let listed: { hash: string }[];

  function qbit(category: string, owned: boolean) {
    const s = new QBittorrentService('http://qb', 'user', 'pass', '/downloads', category, false, undefined, owned);
    (s as unknown as { cookie: string }).cookie = 'SID=test';
    return s;
  }
  const posts = (path: string) => clientMock.post.mock.calls.filter(([url]) => url === path);
  /** The multipart /torrents/add body: the file part's header and bytes, and the text fields */
  function addBody() {
    const [, form] = posts('/torrents/add')[0] as [string, FormData];
    const raw = form.getBuffer();
    const text = raw.toString('latin1');
    const fields = Object.fromEntries([...text.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map((m) => [m[1], m[2]]));
    const header = /name="torrents"; filename="([^"]+)"/.exec(text);
    const start = text.indexOf('\r\n\r\n', text.indexOf('name="torrents"')) + 4;
    return { fields, filename: header?.[1], file: raw.subarray(start, start + BYTES.length) };
  }

  beforeEach(() => {
    categories = {};
    listed = [];
    clientMock.get.mockReset().mockImplementation(async (url: string) => ({
      status: 200,
      data: url === '/torrents/categories' ? categories : url === '/torrents/info' ? listed : '',
    }));
    clientMock.post.mockReset().mockResolvedValue({ data: 'Ok.' });
  });

  it('owned category: created at the download folder, Automatic mode, the bytes unchanged under <v1>.torrent, tagged audiobook', async () => {
    await expect(qbit('readmeabook', true).addTorrentData(BYTES, { category: 'readmeabook' }))
      .resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });

    expect(posts('/torrents/createCategory')).toHaveLength(1);
    const { fields, filename, file } = addBody();
    expect(filename).toBe(`${PLAIN.v1}.torrent`);
    expect(file.equals(BYTES)).toBe(true);
    expect(fields).toMatchObject({ category: 'readmeabook', autoTMM: 'true', tags: 'audiobook', ratioLimit: '-1', seedingTimeLimit: '-1', paused: 'false' });
    expect(fields.savepath).toBeUndefined();
  });

  it('a category another app owns is never created or edited; the add names the download folder (Manual mode)', async () => {
    categories = { Books: { savePath: '/other-app' } };
    await qbit('Books', false).addTorrentData(BYTES, { category: 'Books' });

    expect(posts('/torrents/createCategory')).toEqual([]);
    expect(posts('/torrents/editCategory')).toEqual([]);
    expect(addBody().fields).toMatchObject({ category: 'Books', autoTMM: 'false', savepath: '/downloads', tags: 'audiobook' });
  });

  it('a copy already in qBittorrent is taken over: nothing is added', async () => {
    listed = [{ hash: PLAIN.v1 }];
    await expect(qbit('readmeabook', true).addTorrentData(BYTES))
      .resolves.toEqual({ id: PLAIN.v1, alreadyInClient: true, infoHash: PLAIN.v1 });
    expect(posts('/torrents/add')).toEqual([]);
  });

  it('a fetched indexer .torrent goes out under the same fixed name, never one taken from the file', async () => {
    axiosMock.get.mockResolvedValue({ status: 200, data: BYTES, headers: {} });
    await qbit('readmeabook', true).addDownload(FILE_URL);
    expect(addBody().filename).toBe(`${PLAIN.v1}.torrent`);
  });
});

describe('Transmission and Deluge addTorrentData', () => {
  let fakeT: FakeTransmission;
  let fakeD: FakeDeluge;

  beforeEach(() => {
    fakeT = new FakeTransmission();
    fakeD = new FakeDeluge();
    axiosMock.get.mockReset();
    clientMock.post.mockReset().mockImplementation(async (url: string, body: { method: string }) => ({
      data: url === '/json' ? fakeD.answer(body) : fakeT.answer(body),
      headers: {},
    }));
  });

  it('Transmission: metainfo is the bytes, labelled with the category, in the download folder, seed limits off', async () => {
    const t = new TransmissionService('http://transmission', '', '', '/downloads', 'readmeabook');
    await expect(t.addTorrentData(BYTES, { category: 'audiobooks' }))
      .resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    expect(fakeT.callsOf('torrent-add')).toEqual([
      { metainfo: BYTES.toString('base64'), 'download-dir': '/downloads', paused: false, labels: ['audiobooks'] },
    ]);
    expect(fakeT.callsOf('torrent-set')).toEqual([expect.objectContaining({ ids: [PLAIN.v1], seedRatioMode: 2 })]);
  });

  it('Transmission: a copy already in the client is taken over: nothing is added', async () => {
    fakeT.seed(PLAIN.v1);
    const t = new TransmissionService('http://transmission', '', '');
    await expect(t.addTorrentData(BYTES)).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: true, infoHash: PLAIN.v1 });
    expect(fakeT.callsOf('torrent-add')).toEqual([]);
  });

  it('Deluge: core.add_torrent_file gets <v1>.torrent and the bytes, the download folder, then the label', async () => {
    const d = new DelugeService('http://deluge', '', 'pw', '/downloads', 'readmeabook');
    await expect(d.addTorrentData(BYTES, { category: 'audiobooks' }))
      .resolves.toEqual({ id: PLAIN.v1, alreadyInClient: false, infoHash: PLAIN.v1 });
    const [[filename, metainfo, opts]] = fakeD.callsOf('core.add_torrent_file') as [string, string, Record<string, unknown>][];
    expect(filename).toBe(`${PLAIN.v1}.torrent`);
    expect(metainfo).toBe(BYTES.toString('base64'));
    expect(opts).toMatchObject({ download_location: '/downloads' });
    expect(fakeD.callsOf('label.set_torrent')).toEqual([[PLAIN.v1, 'audiobooks']]);
  });

  it('Deluge: a copy already in the session is taken over: nothing is added', async () => {
    fakeD.session.set(PLAIN.v1, 'Theirs');
    const d = new DelugeService('http://deluge', '', 'pw');
    await expect(d.addTorrentData(BYTES)).resolves.toEqual({ id: PLAIN.v1, alreadyInClient: true, infoHash: PLAIN.v1 });
    expect(fakeD.callsOf('core.add_torrent_file')).toEqual([]);
  });

  it('Deluge: a fetched indexer .torrent goes out under the same fixed name', async () => {
    axiosMock.get.mockResolvedValue({ status: 200, data: BYTES, headers: {} });
    await new DelugeService('http://deluge', '', 'pw').addDownload(FILE_URL);
    expect((fakeD.callsOf('core.add_torrent_file')[0] as string[])[0]).toBe(`${PLAIN.v1}.torrent`);
  });
});
