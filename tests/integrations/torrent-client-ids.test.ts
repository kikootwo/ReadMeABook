/**
 * Component: Transmission and Deluge Torrent ID Tests (#457)
 * Documentation: documentation/phase3/download-clients.md
 *
 * The real services against fakes that answer by the IDs RMAB sends (tests/helpers):
 * base32 magnets, rows stored with a base32 hash, Deluge hybrids, and the add result RMAB records.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransmissionService } from '@/lib/integrations/transmission.service';
import { DelugeService } from '@/lib/integrations/deluge.service';
import { HYBRID, magnetOf, PLAIN, torrentFile, type Fixture } from '../helpers/fake-qbittorrent';
import { FakeDeluge, FakeTransmission } from '../helpers/fake-torrent-clients';

const clientMock = vi.hoisted(() => ({ post: vi.fn() }));
const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));
const warn = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn() }) },
}));

const HEX = PLAIN.v1;
/** As a magnet carries it (upper case) and as main stored it (lower case) */
const B32 = PLAIN.b32;
const STORED_B32 = PLAIN.b32.toLowerCase();
const OTHER = 'ab'.repeat(20);
const FILE_URL = 'http://indexer.test/book.torrent';

let fakeT: FakeTransmission;
let fakeD: FakeDeluge;
const transmission = () => new TransmissionService('http://transmission', '', '');
const deluge = () => new DelugeService('http://deluge', '', 'pw');
const serveTorrent = (f: Fixture) => axiosMock.get.mockResolvedValue({ status: 200, data: torrentFile(f), headers: {} });
const warned = () => warn.mock.calls.map((call) => String(call[0])).join('\n');

beforeEach(() => {
  fakeT = new FakeTransmission();
  fakeD = new FakeDeluge();
  warn.mockClear();
  axiosMock.get.mockReset();
  clientMock.post.mockReset().mockImplementation(async (url: string, body: { method: string }) => ({
    data: url === '/json' ? fakeD.answer(body) : fakeT.answer(body),
    headers: {},
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Transmission', () => {
  it('adds a base32 magnet by its hex hash: pre-check, seed limits and the recorded ID', async () => {
    await expect(transmission().addDownload(magnetOf(PLAIN, { base32: true }))).resolves.toEqual({ id: HEX, alreadyInClient: false, infoHash: HEX });
    expect(fakeT.callsOf('torrent-get').map((a) => a.ids)).toEqual([[HEX]]);
    expect(fakeT.callsOf('torrent-set')).toEqual([expect.objectContaining({ ids: [HEX], seedRatioMode: 2 })]);
  });

  it('records a torrent-duplicate answer to a base32 magnet by its hex hash and leaves its seed limits alone', async () => {
    fakeT.addedByOthersAtAdd = true;
    await expect(transmission().addDownload(magnetOf(PLAIN, { base32: true }))).resolves.toEqual({ id: HEX, alreadyInClient: true, infoHash: HEX });
    expect(fakeT.callsOf('torrent-set')).toEqual([]);
  });

  it('finds a base32 magnet already in Transmission on the pre-check and sends no torrent-add', async () => {
    fakeT.seed(HEX);
    await expect(transmission().addDownload(`magnet:?xt=urn:btih:${B32}`)).resolves.toEqual({ id: HEX, alreadyInClient: true, infoHash: HEX });
    expect(fakeT.callsOf('torrent-add')).toEqual([]);
  });

  it('reaches a row stored with a base32 hash: probe, monitoring and removal send hex', async () => {
    fakeT.seed(HEX, PLAIN.name);
    const t = transmission();
    await expect(t.probeDownload(STORED_B32)).resolves.toMatchObject({ found: true, info: { id: HEX, name: PLAIN.name } });
    await expect(t.getDownload(STORED_B32)).resolves.toMatchObject({ id: HEX, name: PLAIN.name });
    await t.deleteDownload(STORED_B32, true);
    expect(fakeT.callsOf('torrent-remove')).toEqual([{ ids: [HEX], 'delete-local-data': true }]);
    expect(fakeT.torrents).toEqual([]);
    expect(fakeT.callsOf('torrent-get').map((a) => a.ids)).toEqual([[HEX], [HEX], [HEX]]);
  });

  it('never acts on another torrent when the answer lacks the requested one', async () => {
    fakeT.ignoresIds = true;
    fakeT.seed(OTHER);
    const t = transmission();
    await expect(t.deleteDownload(HEX, true)).rejects.toThrow('Failed to delete torrent');
    await expect(t.setCategory(HEX, 'done')).rejects.toThrow('Failed to set torrent label');
    expect(fakeT.callsOf('torrent-remove')).toEqual([]);
    expect(fakeT.callsOf('torrent-set')).toEqual([]);
    expect(fakeT.torrents).toEqual([{ hashString: OTHER, name: 'Theirs' }]);

    vi.useFakeTimers();
    const lookup = t.getDownload(HEX);
    await vi.runAllTimersAsync();
    await expect(lookup).resolves.toBeNull();
  });

  it('matches a stored upper-case hex hash and picks its entry from a list of several', async () => {
    fakeT.ignoresIds = true;
    fakeT.seed(OTHER);
    fakeT.seed(HEX, PLAIN.name);
    const t = transmission();
    await expect(t.getDownload(HEX.toUpperCase())).resolves.toMatchObject({ id: HEX, name: PLAIN.name });
    await t.pauseDownload(HEX.toUpperCase());
    await t.deleteDownload(HEX.toUpperCase(), true);
    expect(fakeT.callsOf('torrent-stop')).toEqual([{ ids: [HEX] }]);
    expect(fakeT.callsOf('torrent-remove')).toEqual([{ ids: [HEX], 'delete-local-data': true }]);
  });

  it('records the hex hash Transmission reports for a .torrent when it differs from the parsed v1, with a warning', async () => {
    serveTorrent(PLAIN);
    fakeT.addHash = OTHER;
    await expect(transmission().addDownload(FILE_URL)).resolves.toEqual({ id: OTHER, alreadyInClient: false, infoHash: HEX });
    expect(fakeT.callsOf('torrent-set')).toEqual([expect.objectContaining({ ids: [OTHER], seedRatioMode: 2 })]);
    expect(warned()).toContain(OTHER);
  });
});

describe('Deluge', () => {
  const labelCalls = () => fakeD.callsOf('label.set_torrent');
  const seedCalls = () => fakeD.callsOf('core.set_torrent_options').map((params) => params[0]);
  const addCalls = () => [...fakeD.callsOf('core.add_torrent_magnet'), ...fakeD.callsOf('core.add_torrent_file')];

  it('adds a base32 magnet by its hex hash: pre-check, label, seed limits and the recorded ID', async () => {
    await expect(deluge().addDownload(magnetOf(PLAIN, { base32: true }))).resolves.toEqual({ id: HEX, alreadyInClient: false, infoHash: HEX });
    expect(fakeD.statusIds()).toEqual([HEX]);
    expect(seedCalls()).toEqual([[HEX]]);
    expect(labelCalls()).toEqual([[HEX, 'readmeabook']]);
  });

  it('finds a base32 magnet already in Deluge on the pre-check', async () => {
    fakeD.session.set(HEX, 'Theirs');
    await expect(deluge().addDownload(`magnet:?xt=urn:btih:${B32}`)).resolves.toEqual({ id: HEX, alreadyInClient: true, infoHash: HEX });
    expect(fakeD.statusIds()).toEqual([HEX]);
    expect(addCalls()).toEqual([]);
  });

  it('takes over a base32 magnet Deluge rejects as already in session, found by hex on the re-check', async () => {
    fakeD.addedByOthersAtAdd = true;
    await expect(deluge().addDownload(magnetOf(PLAIN, { base32: true }))).resolves.toEqual({ id: HEX, alreadyInClient: true, infoHash: HEX });
    expect(fakeD.statusIds()).toEqual([HEX, HEX]);
    expect(labelCalls()).toEqual([]);
    expect(seedCalls()).toEqual([]);
  });

  it('reaches a row stored with a base32 hash: every call sends hex', async () => {
    fakeD.session.set(HEX, PLAIN.name);
    const d = deluge();
    await expect(d.probeDownload(STORED_B32)).resolves.toMatchObject({ found: true, info: { id: HEX, name: PLAIN.name } });
    await expect(d.getDownload(STORED_B32)).resolves.toMatchObject({ id: HEX, name: PLAIN.name });
    await d.pauseDownload(STORED_B32);
    await d.resumeDownload(STORED_B32);
    await d.setCategory(STORED_B32, 'done');
    await d.deleteDownload(STORED_B32, true);
    expect(fakeD.statusIds()).toEqual([HEX, HEX]);
    expect(fakeD.callsOf('core.pause_torrent')).toEqual([[[HEX]]]);
    expect(fakeD.callsOf('core.resume_torrent')).toEqual([[[HEX]]]);
    expect(labelCalls()).toEqual([[HEX, 'done']]);
    expect(fakeD.callsOf('core.remove_torrent')).toEqual([[HEX, true]]);
    expect(fakeD.session.size).toBe(0);
  });

  it('finds a hybrid .torrent Deluge holds under its truncated v2 on the pre-check', async () => {
    serveTorrent(HYBRID);
    fakeD.session.set(HYBRID.id, 'Theirs');
    await expect(deluge().addDownload(FILE_URL)).resolves.toEqual({ id: HYBRID.id, alreadyInClient: true, infoHash: HYBRID.v1 });
    expect(fakeD.statusIds()).toEqual([HYBRID.id]);
    expect(addCalls()).toEqual([]);
  });

  it.each([
    ['2', HYBRID.id],
    ['1.2', HYBRID.v1],
  ] as const)('adds a hybrid .torrent on libtorrent %s under the ID Deluge returns', async (libtorrent, id) => {
    serveTorrent(HYBRID);
    fakeD.libtorrent = libtorrent;
    await expect(deluge().addDownload(FILE_URL)).resolves.toEqual({ id, alreadyInClient: false, infoHash: HYBRID.v1 });
    expect(fakeD.statusIds()).toEqual([HYBRID.id, HYBRID.v1]);
    expect(seedCalls()).toEqual([[id]]);
    expect(labelCalls()).toEqual([[id, 'readmeabook']]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('records an add result that is none of the computed IDs, with a warning, and labels it', async () => {
    fakeD.addKey = OTHER;
    await expect(deluge().addDownload(magnetOf(PLAIN))).resolves.toEqual({ id: OTHER, alreadyInClient: false, infoHash: HEX });
    expect(seedCalls()).toEqual([[OTHER]]);
    expect(labelCalls()).toEqual([[OTHER, 'readmeabook']]);
    expect(warned()).toContain(OTHER);
  });
});
