/**
 * Component: E2E fake Audible / Audnexus metadata, served as an answering HTTP proxy (fake-arr:9898)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Used with `--overrides abs-fake-metadata`: Audiobookshelf and RMAB get HTTP(S)_PROXY pointing here.
 * ABS (axios 0.27) sends an https target to an http proxy as a plain absolute-URI request, so this
 * listener reads the target host from the request line and answers itself. RMAB (axios 1.x) opens a
 * CONNECT tunnel instead; the fake refuses every CONNECT with 403 and records it, so it does NOT serve
 * RMAB (RMAB's own Audible/Audnexus lookups fail, and nothing reaches a real provider). Nothing is ever
 * forwarded. Data comes from the fixture book index (offline fixtures: made-up titles); every free-text
 * field is synthetic.
 *   api.audible.<tld>  GET /1.0/catalog/products?title=&author=  → { products: [{ asin }] }
 *   api.audnex.us      GET /books/<ASIN>                         → Audnexus-shaped book (no image)
 *                      GET /authors?name=                        → []
 *   other Audible/Audnexus paths → 404; non-GET to a faked host → 405; any other host or CONNECT → 403
 */

import dns from 'node:dns/promises';
import { sendJson, sendText } from './http-util.js';

const AUDIBLE_API = /^api\.audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)$/;
const AUDIBLE_WEB = /^(www\.)?audible\.(com|ca|co\.uk|com\.au|fr|de|co\.jp|it|in|es)$/;
const AUDNEXUS = 'api.audnex.us';

/** True for the hosts this fake stands in for; every other host gets 403. */
export function isFakedHost(host) {
  const h = String(host || '').toLowerCase();
  return AUDIBLE_API.test(h) || AUDIBLE_WEB.test(h) || h === AUDNEXUS;
}

/** Host the client asked for: absolute-URI request line first, Host header otherwise. */
export function targetOf(req) {
  try {
    const url = new URL(req.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url;
  } catch {
    // origin-form request: not proxied
  }
  return new URL(req.url, `http://${req.headers.host || 'unknown'}`);
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** Fixture books whose title contains every title word of the query (≥3 chars). */
export function searchBooks(books, title) {
  const want = words(title);
  if (want.length === 0) return [];
  return Object.values(books).filter((b) => {
    const have = new Set(words(b.title));
    return want.every((w) => have.has(w));
  });
}

export function audnexusBook(book) {
  return {
    asin: book.asin,
    title: book.title,
    subtitle: '',
    authors: [{ name: book.author }],
    narrators: book.narrator ? [{ name: book.narrator }] : [],
    publisherName: 'E2E Synthetic Publishing',
    summary: `<p>Synthetic e2e summary for ${book.title}. Not a real book description.</p>`,
    description: `Synthetic e2e summary for ${book.title}.`,
    releaseDate: '2020-01-01T00:00:00.000Z',
    genres: [],
    language: 'english',
    runtimeLengthMin: book.runtimeMin || 60,
    formatType: 'unabridged',
    isAdult: false,
    region: 'us',
    rating: '4.0',
  };
}

const CLIENTS = ['abs', 'rmab'];
const NAMES_RETRY_MS = 10_000;
let names; // Promise<Map ip -> service name> from the stack DNS
let namesAt = 0;
let namesComplete = false;
async function clientName(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  // Kept for good once both services resolved; an incomplete map (a service not up yet, or no stack
  // network in unit tests) is looked up again at most every NAMES_RETRY_MS.
  if (!names || (!namesComplete && Date.now() - namesAt > NAMES_RETRY_MS)) {
    namesAt = Date.now();
    names = (async () => {
      const map = new Map();
      const found = new Set();
      for (const svc of CLIENTS) {
        try {
          for (const { address: a } of await dns.lookup(svc, { all: true })) { map.set(a, svc); found.add(svc); }
        } catch {
          // service not resolvable (yet)
        }
      }
      namesComplete = found.size === CLIENTS.length;
      return map;
    })();
  }
  return (await names).get(ip) || ip;
}

export async function handleMetadata(state, req, res, entry) {
  const target = targetOf(req);
  const host = target.hostname.toLowerCase();
  entry.client = await clientName(req.socket.remoteAddress);
  entry.target = `${target.protocol}//${host}${target.pathname}`;
  entry.host = host;
  entry.path = target.pathname;
  entry.query = Object.fromEntries(target.searchParams.entries());

  // Host first: an unfaked host is always 403, whatever the method.
  if (!isFakedHost(host)) return sendText(res, 403, `fake metadata proxy: ${host} is not a faked provider`);
  if (req.method !== 'GET') return sendText(res, 405, 'GET only');

  const books = state.fixtureIndex.books || {};

  if (AUDIBLE_API.test(host)) {
    if (target.pathname === '/1.0/catalog/products') {
      const found = searchBooks(books, target.searchParams.get('title') || target.searchParams.get('keywords'));
      return sendJson(res, 200, { products: found.map((b) => ({ asin: b.asin })), total_results: found.length });
    }
    return sendJson(res, 404, { message: 'not faked' });
  }

  if (host === AUDNEXUS) {
    const m = target.pathname.match(/^\/books\/([A-Za-z0-9]{10})$/);
    if (m) {
      const book = Object.values(books).find((b) => b.asin.toUpperCase() === m[1].toUpperCase());
      return book ? sendJson(res, 200, audnexusBook(book)) : sendJson(res, 404, { error: 'Book not found' });
    }
    if (target.pathname === '/authors') return sendJson(res, 200, []);
    return sendJson(res, 404, { error: 'not faked' });
  }

  return sendText(res, 404, 'not faked'); // www.audible.<tld>
}

/** CONNECT tunnels are refused (and recorded): the fake can only answer absolute-URI requests. */
export async function refuseConnect(state, req, socket) {
  // A client reset (ECONNRESET/EPIPE) on this raw socket must not crash the fake.
  socket.on('error', () => {});
  const entry = state.record({ service: 'metadata', method: 'CONNECT', host: String(req.url).split(':')[0], path: '', query: {}, headers: { ...req.headers }, status: 403 });
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  entry.client = await clientName(socket.remoteAddress);
}
