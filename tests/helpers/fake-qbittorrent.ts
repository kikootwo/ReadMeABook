/**
 * Component: Fake qBittorrent Web API for hybrid-torrent tests (#422)
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * Models qBittorrent's torrent IDs from its source (5.2.0 / 4.4.5):
 * - ID = v1 hash, or the first 40 hex chars of the v2 hash for a hybrid (libtorrent 2);
 *   libtorrent 1.2 builds always use v1 and report an empty `infohash_v2`
 * - a magnet added by its btih hash only switches to the v2 ID when its metadata arrives
 * - `hashes=` (split on `|`, or `all`) matches the ID only; actions skip unknown IDs with HTTP 200
 * - duplicates (SessionImpl::findTorrent): by ID; 4.5+ also by the alternative ID (a hybrid by the
 *   v1 of non-hybrid input; a torrent listed by v1 for hybrid input). 4.4 checks the ID only.
 *   An add qBittorrent lets through ("Ok.") is still dropped by libtorrent when the v1 or v2 matches.
 * - a magnet whose btmh is not the fixture's v2 is a different torrent with the same v1
 * Fixture IDs are precomputed (SHA-1 / SHA-256 of the info dicts below), never derived here.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface Fixture {
  name: string;
  /** Bencoded info dict */
  info: string;
  v1: string;
  /** Base32 form of v1 */
  b32: string;
  v2?: string;
  /** ID on libtorrent 2 builds */
  id: string;
}

export const HYBRID: Fixture = {
  name: 'Hybrid Book.m4b',
  info: `d9:file treed15:Hybrid Book.m4bd0:d6:lengthi1e11:pieces root32:${'r'.repeat(32)}eee6:lengthi1e12:meta versioni2e4:name15:Hybrid Book.m4b12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}e`,
  v1: '56f05049e768e7ba997e32e2bf25cf680d8769ae',
  b32: 'K3YFASPHNDT3VGL6GLRL6JOPNAGYO2NO',
  v2: '1dea74c775e3036724f2b462451bc3f00f6708e451e30fa44d47b92af17b7bf5',
  id: '1dea74c775e3036724f2b462451bc3f00f6708e4',
};

export const PLAIN: Fixture = {
  name: 'Plain Book.m4b',
  info: `d6:lengthi1e4:name14:Plain Book.m4b12:piece lengthi16384e6:pieces20:${'x'.repeat(20)}e`,
  v1: 'dee7e62e6341b0500aa05086bc3501cf2a7a111c',
  b32: '33T6MLTDIGYFACVAKCDLYNIBZ4VHUEI4',
  id: 'dee7e62e6341b0500aa05086bc3501cf2a7a111c',
};

export const torrentFile = (f: Fixture) => Buffer.from(`d4:info${f.info}e`);

/** Magnet by btih (hex or base32), optionally with the btmh (v2) hash */
export function magnetOf(f: Fixture, { btmh = false, base32 = false } = {}): string {
  const btih = `xt=urn:btih:${base32 ? f.b32 : f.v1}`;
  return `magnet:?${btih}${btmh && f.v2 ? `&xt=urn:btmh:1220${f.v2}` : ''}&dn=${encodeURIComponent(f.name)}`;
}

/** '5.2': JSON receipt / 409; 'legacy' (4.5-5.1): Ok./Fails.; '4.4': duplicates by ID only, answered "Ok." */
export type FakeVersion = '5.2' | 'legacy' | '4.4';

interface Record_ {
  fixture: Fixture;
  /** v2 known to the client (a btih-only magnet learns it from metadata) */
  v2Known: boolean;
  category: string;
  addedOn: number;
}

export interface FakeRequest {
  path: string;
  params: Record<string, string>;
}

export class FakeQbittorrent {
  version: FakeVersion = '5.2';
  /** libtorrent build: '1.2' uses v1 IDs and knows no v2 hashes */
  libtorrent: '2' | '1.2' = '2';
  /** Legacy adds are listed only after `flush()` */
  lateAdds = false;
  /** Delay for unfiltered /torrents/info answers (to overlap concurrent callers) */
  scanDelayMs = 0;
  /** Unfiltered /torrents/info answers HTTP 503, or a JSON object instead of a list */
  listFault: '' | '503' | 'not-a-list' = '';
  readonly requests: FakeRequest[] = [];
  private torrents: Record_[] = [];
  private pending: Record_[] = [];
  private server?: Server;
  url = '';

  idOf(t: Record_): string {
    return this.libtorrent === '2' && t.v2Known && t.fixture.v2 ? t.fixture.id : t.fixture.v1;
  }

  get list(): ReadonlyArray<{ id: string; category: string; name: string }> {
    return this.torrents.map((t) => ({ id: this.idOf(t), category: t.category, name: t.fixture.name }));
  }

  /** Someone else's torrent, already in the client */
  seed(fixture: Fixture, { v2Known = true, addedAgoSec = 172800, category = 'other' } = {}): void {
    this.torrents.push({ fixture, v2Known, category, addedOn: Math.floor(Date.now() / 1000) - addedAgoSec });
  }

  /** Metadata arrives for btih-only magnets: hybrids switch to their v2 ID (libtorrent 2) */
  receiveMetadata(): void {
    for (const t of this.torrents) t.v2Known = true;
  }

  flush(): void {
    this.torrents.push(...this.pending.splice(0));
  }

  scans(): number {
    return this.requests.filter((r) => r.path === '/api/v2/torrents/info' && r.params.hashes === undefined).length;
  }

  private select(hashes: string | undefined): Record_[] {
    if (hashes === undefined || hashes === 'all') return this.torrents;
    const ids = hashes.split('|').map((h) => h.toLowerCase());
    return this.torrents.filter((t) => ids.includes(this.idOf(t)));
  }

  private entry(t: Record_) {
    return {
      hash: this.idOf(t),
      infohash_v1: t.fixture.v1,
      infohash_v2: this.libtorrent === '2' && t.v2Known && t.fixture.v2 ? t.fixture.v2 : '',
      name: t.fixture.name, size: 1, progress: 0.5, dlspeed: 0, upspeed: 0, downloaded: 0, uploaded: 0, eta: 60,
      state: 'downloading', category: t.category, tags: '', save_path: '/downloads',
      content_path: `/downloads/${t.fixture.name}`, completion_on: 0, added_on: t.addedOn,
    };
  }

  /** qBittorrent's duplicate check (SessionImpl::findTorrent) for a new add */
  private duplicate(fixture: Fixture, v2Known: boolean): boolean {
    const all = [...this.torrents, ...this.pending];
    const hybridInput = this.libtorrent === '2' && v2Known && !!fixture.v2;
    const id = hybridInput ? fixture.id : fixture.v1;
    if (all.some((t) => this.idOf(t) === id)) return true;
    if (this.version === '4.4') return false;
    return hybridInput ? all.some((t) => this.idOf(t) === fixture.v1) : all.some((t) => t.fixture.v1 === fixture.v1);
  }

  /** libtorrent refuses a torrent whose v1 or v2 is already in the session */
  private sessionHas(fixture: Fixture): boolean {
    return [...this.torrents, ...this.pending].some((t) => t.fixture.v1 === fixture.v1 || (!!fixture.v2 && t.fixture.v2 === fixture.v2));
  }

  private add(body: string, contentType: string): { status: number; body: unknown } {
    const adds: Array<{ fixture: Fixture; v2Known: boolean }> = [];
    if (contentType.includes('multipart/form-data')) {
      for (const f of [HYBRID, PLAIN]) if (body.includes(torrentFile(f).toString('latin1'))) adds.push({ fixture: f, v2Known: true });
    } else {
      for (const url of (new URLSearchParams(body).get('urls') ?? '').split('\n').filter(Boolean)) {
        const f = [HYBRID, PLAIN].find((x) => url.toLowerCase().includes(x.v1) || url.toUpperCase().includes(x.b32));
        const btmh = /urn:btmh:1220([0-9a-f]{64})/i.exec(url)?.[1].toLowerCase();
        const other = btmh && btmh !== f?.v2 ? { v2: btmh, id: btmh.slice(0, 40), name: `${f?.name} (other v2)` } : {};
        if (f) adds.push({ fixture: { ...f, ...other }, v2Known: !!btmh });
      }
    }
    const ids: string[] = [];
    let failures = 0;
    for (const a of adds) {
      if (this.duplicate(a.fixture, a.v2Known)) {
        failures++;
        continue;
      }
      const record = { ...a, category: 'readmeabook', addedOn: Math.floor(Date.now() / 1000) };
      ids.push(this.idOf(record));
      if (this.sessionHas(a.fixture)) continue; // accepted, then dropped by libtorrent
      (this.lateAdds && this.version !== '5.2' ? this.pending : this.torrents).push(record);
    }
    if (this.version === '5.2') {
      return ids.length ? { status: 200, body: { success_count: ids.length, failure_count: failures, pending_count: 0, added_torrent_ids: ids } } : { status: 409, body: 'Conflict' };
    }
    if (this.version === '4.4') return { status: 200, body: adds.length ? 'Ok.' : 'Fails.' };
    return { status: 200, body: ids.length && !failures ? 'Ok.' : 'Fails.' };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('latin1');
    const form = (req.headers['content-type'] ?? '').includes('urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : {};
    const params = { ...Object.fromEntries(url.searchParams), ...form };
    this.requests.push({ path: url.pathname, params });
    const targets = () => this.select(params.hashes);
    switch (url.pathname) {
      case '/api/v2/torrents/categories':
        return { status: 200, body: { readmeabook: { savePath: '/downloads' } } };
      case '/api/v2/torrents/info':
        if (params.hashes === undefined && this.scanDelayMs) await new Promise((r) => setTimeout(r, this.scanDelayMs));
        if (params.hashes === undefined && this.listFault) return this.listFault === '503' ? { status: 503, body: 'Service Unavailable' } : { status: 200, body: { error: 'busy' } };
        return { status: 200, body: targets().map((t) => this.entry(t)) };
      case '/api/v2/torrents/add':
        return this.add(raw, req.headers['content-type'] ?? '');
      case '/api/v2/torrents/setCategory':
        for (const t of targets()) t.category = params.category ?? '';
        return { status: 200, body: '' };
      case '/api/v2/torrents/delete': {
        const gone = new Set(targets());
        this.torrents = this.torrents.filter((t) => !gone.has(t));
        return { status: 200, body: '' };
      }
      default:
        return { status: 200, body: '' };
    }
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req).then(({ status, body }) => {
        res.statusCode = status;
        res.setHeader('Content-Type', typeof body === 'string' ? 'text/plain' : 'application/json');
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      }, () => res.writeHead(500).end());
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    this.url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  }

  reset(): void {
    Object.assign(this, { version: '5.2', libtorrent: '2', lateAdds: false, scanDelayMs: 0, listFault: '', torrents: [], pending: [] });
    this.requests.length = 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}
