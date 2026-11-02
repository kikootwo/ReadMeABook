/**
 * Component: Fake Transmission and Deluge RPC for torrent-ID tests (#457)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Both fakes answer by the IDs RMAB sends, as the real clients do:
 * - Transmission `torrent-get ids`: an entry matches a 40-hex `hashString`, ignoring case; a base32
 *   entry matches nothing. `ignoresIds` lists every torrent (a server that ignores the filter).
 *   `torrent-add` reads the torrent itself (v1-only client): `hashString` = v1; a torrent already
 *   in the session answers `torrent-duplicate`.
 * - Deluge `core.get_torrent_status`: `{}` unless the ID is an exact (lowercase) session key.
 *   `core.add_torrent_*`: "Torrent already in session" when the key exists, else the new key: v1 for
 *   a magnet; for a .torrent, the truncated v2 of a hybrid on libtorrent 2, else v1.
 * Which fixture a magnet or .torrent is comes from the fixture table (precomputed hashes), never
 * from RMAB's own conversion code.
 */

import { HYBRID, PLAIN, torrentFile, type Fixture } from './fake-qbittorrent';

const FIXTURES = [HYBRID, PLAIN];
const HEX40 = /^[0-9a-f]{40}$/i;

/** The fixture a magnet names by its btih (hex or base32, any case) */
function fixtureOfMagnet(magnet: string): Fixture {
  const btih = /xt=urn:btih:([0-9a-z]+)/i.exec(magnet)?.[1].toLowerCase();
  const f = FIXTURES.find((x) => btih === x.v1 || btih === x.b32.toLowerCase());
  if (!f) throw new Error(`fake: unknown magnet ${magnet}`);
  return f;
}

/** The fixture a base64 .torrent is */
function fixtureOfFile(base64: string): Fixture {
  const f = FIXTURES.find((x) => torrentFile(x).toString('base64') === base64);
  if (!f) throw new Error('fake: unknown .torrent');
  return f;
}

type Args = Record<string, unknown>;

export class FakeTransmission {
  torrents: { hashString: string; name: string }[] = [];
  /** Answers every torrent-get with the whole list */
  ignoresIds = false;
  /** Someone else adds the torrent between RMAB's pre-check and its torrent-add */
  addedByOthersAtAdd = false;
  /** hashString torrent-add reports instead of the fixture's v1 */
  addHash?: string;
  readonly calls: { method: string; args: Args }[] = [];

  seed(hashString: string, name = 'Theirs'): void {
    this.torrents.push({ hashString, name });
  }

  callsOf(method: string): Args[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  answer(body: { method: string; arguments?: Args }): unknown {
    const a = body.arguments ?? {};
    this.calls.push({ method: body.method, args: a });
    const ids: unknown[] = Array.isArray(a.ids) ? a.ids : [];
    const matches = (t: { hashString: string }) =>
      ids.some((id) => typeof id === 'string' && HEX40.test(id) && id.toLowerCase() === t.hashString);
    switch (body.method) {
      case 'torrent-get':
        return { result: 'success', arguments: { torrents: (this.ignoresIds ? this.torrents : this.torrents.filter(matches)).map(entry) } };
      case 'torrent-add': {
        const f = typeof a.filename === 'string' ? fixtureOfMagnet(a.filename) : fixtureOfFile(String(a.metainfo));
        const hashString = this.addHash ?? f.v1;
        if (this.addedByOthersAtAdd) this.seed(hashString);
        const existing = this.torrents.find((t) => t.hashString === hashString);
        if (existing) return { result: 'success', arguments: { 'torrent-duplicate': { id: 1, ...existing } } };
        this.torrents.push({ hashString, name: f.name });
        return { result: 'success', arguments: { 'torrent-added': { id: 2, hashString, name: f.name } } };
      }
      case 'torrent-remove':
        this.torrents = this.torrents.filter((t) => !matches(t));
        return { result: 'success', arguments: {} };
      default:
        return { result: 'success', arguments: {} };
    }
  }
}

function entry(t: { hashString: string; name: string }) {
  return {
    hashString: t.hashString, name: t.name, totalSize: 1, downloadedEver: 0, percentDone: 0.5, status: 4,
    rateDownload: 0, eta: 60, labels: [], downloadDir: '/downloads', doneDate: 0, errorString: '', error: 0,
    secondsSeeding: 0, uploadRatio: 0, uploadedEver: 0, addedDate: 1700000000,
  };
}

export class FakeDeluge {
  libtorrent: '2' | '1.2' = '2';
  /** Session dict: torrent key → name */
  readonly session = new Map<string, string>();
  /** Someone else adds the torrent between RMAB's pre-check and its add */
  addedByOthersAtAdd = false;
  /** Key (and add result) Deluge gives the next add instead of the computed one */
  addKey?: string;
  readonly calls: { method: string; args: unknown[] }[] = [];

  callsOf(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  /** IDs RMAB sent to core.get_torrent_status, in order */
  statusIds(): unknown[] {
    return this.callsOf('core.get_torrent_status').map((params) => params[0]);
  }

  answer(body: { method: string; params?: unknown[] }): unknown {
    const params = body.params ?? [];
    this.calls.push({ method: body.method, args: params });
    switch (body.method) {
      case 'core.get_torrent_status': {
        const name = typeof params[0] === 'string' ? this.session.get(params[0]) : undefined;
        return ok(name === undefined ? {} : { name, state: 'Downloading', progress: 50, total_size: 1, save_path: '/downloads', time_added: 1700000000 });
      }
      case 'core.add_torrent_magnet':
        return this.add(fixtureOfMagnet(String(params[0])), fixtureOfMagnet(String(params[0])).v1);
      case 'core.add_torrent_file': {
        const f = fixtureOfFile(String(params[1]));
        return this.add(f, this.libtorrent === '2' && f.v2 ? f.id : f.v1);
      }
      case 'core.remove_torrent':
        return ok(this.session.delete(String(params[0])));
      default:
        return ok(true);
    }
  }

  private add(f: Fixture, computedKey: string) {
    const key = this.addKey ?? computedKey;
    if (this.addedByOthersAtAdd) this.session.set(key, 'Theirs');
    if (this.session.has(key)) return { result: null, error: { message: `Torrent already in session (${key}).`, code: 4 }, id: 1 };
    this.session.set(key, f.name);
    return ok(key);
  }
}

const ok = (result: unknown) => ({ result, error: null, id: 1 });
