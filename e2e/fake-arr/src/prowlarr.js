/**
 * Component: E2E fake Prowlarr (search, indexers, health, stats, RSS) + release grab/redirect chain
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Derived from src/lib/integrations/prowlarr.service.ts (search :151, indexer :268, health :281,
 * indexerstats :294, RSS :312) and the .torrent/.nzb fetches in qbittorrent.service.ts :383-:440
 * and sabnzbd.service.ts :496.
 */

import { sendJson, sendText, sendBuffer, notFound } from './http-util.js';

const AUDIOBOOK_CATEGORY = { id: 3030, name: 'Audio/Audiobook' };
const CATEGORY_NAMES = { 3030: 'Audio/Audiobook', 7020: 'Books/EBook', 7000: 'Books', 3000: 'Audio' };
const SEARCH_TYPES = new Set(['search', 'book', 'music', 'tvsearch', 'movie']);

export function encodeLink(releaseId) {
  return Buffer.from(JSON.stringify({ r: releaseId })).toString('base64url');
}

function decodeLink(link) {
  try {
    return JSON.parse(Buffer.from(String(link), 'base64url').toString('utf8')).r;
  } catch {
    return undefined;
  }
}

function presentedKey(req, url) {
  return req.headers['x-api-key'] || url.searchParams.get('apikey') || undefined;
}

export function downloadUrlFor(state, release) {
  const { publicHost, trackerHost, ports, prowlarrApiKey } = state.config;
  // Some indexers hand Prowlarr a direct tracker link instead of a Prowlarr proxy URL.
  if (release.grab.direct) {
    return `http://${trackerHost}:${ports.tracker}/d/${release.id}?file=${encodeURIComponent(release.name)}`;
  }
  const params = new URLSearchParams({ apikey: prowlarrApiKey, link: encodeLink(release.id), file: release.name });
  return `http://${publicHost}:${ports.prowlarr}/${release.indexerId}/download?${params.toString()}`;
}

function toProwlarrResult(state, release) {
  const { publicHost, ports } = state.config;
  const result = {
    guid: `http://${publicHost}:${ports.prowlarr}/info/${release.id}`,
    indexerId: release.indexerId,
    indexer: release.indexerName,
    title: release.title,
    size: release.sizeBytes,
    publishDate: release.publishDate || '2026-09-01T00:00:00Z',
    protocol: release.protocol,
    infoUrl: `http://${publicHost}:${ports.prowlarr}/info/${release.id}`,
    categories: release.categories.map((id) => ({ id, name: CATEGORY_NAMES[id] || `Category ${id}` })),
    downloadVolumeFactor: 1,
    uploadVolumeFactor: 1,
    indexerFlags: release.indexerFlags || [],
  };
  if (release.protocol === 'torrent') {
    result.seeders = release.seeders ?? 25;
    result.leechers = release.leechers ?? 2;
    result.infoHash = release.infoHash;
  }
  if (release.link === 'magnet') result.magnetUrl = release.magnet;
  else result.downloadUrl = downloadUrlFor(state, release);
  return result;
}

function matchesQuery(release, query) {
  if (release.alwaysMatch) return true;
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const title = release.title.toLowerCase();
  return words.every((w) => title.includes(w));
}

/** Next status from a per-call sequence; the last entry repeats. */
export function nextStatus(statuses, attempt) {
  if (!Array.isArray(statuses) || statuses.length === 0) return 200;
  return statuses[Math.min(attempt, statuses.length - 1)];
}

function rssXml(state, releases) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = releases
    .map((r) => {
      const link = r.link === 'magnet' ? r.magnet : downloadUrlFor(state, r);
      const attrs = [`<torznab:attr name="category" value="3030" />`];
      if (r.protocol === 'torrent') {
        attrs.push(`<torznab:attr name="seeders" value="${r.seeders ?? 25}" />`);
        attrs.push(`<torznab:attr name="peers" value="${(r.seeders ?? 25) + (r.leechers ?? 2)}" />`);
        attrs.push(`<torznab:attr name="infohash" value="${r.infoHash}" />`);
      }
      return (
        `<item><title>${esc(r.title)}</title><guid>${esc(`fake-arr:${r.id}`)}</guid>` +
        `<prowlarrindexer id="${r.indexerId}">${esc(r.indexerName)}</prowlarrindexer>` +
        `<link>${esc(link)}</link><size>${r.sizeBytes}</size>` +
        `<pubDate>${new Date(r.publishDate || '2026-09-01T00:00:00Z').toUTCString()}</pubDate>` +
        `${attrs.join('')}</item>`
      );
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">` +
    `<channel><title>fake-arr</title>${items}</channel></rss>`
  );
}

/** Location header for redirect hop `hop` of type `kind`. */
export function hopLocation(state, release, kind, hop) {
  const { trackerHost, publicHost, ports } = state.config;
  const pathPart = `/t/${release.id}/${hop}`;
  switch (kind) {
    case 'tracker':
      return `http://${trackerHost}:${ports.tracker}${pathPart}`;
    case 'other-port':
      return `http://${publicHost}:${ports.tracker}${pathPart}`;
    case 'relative':
      return pathPart;
    case 'magnet':
      return release.magnet;
    default:
      throw new Error(`unknown redirect kind ${kind}`);
  }
}

function serveReleaseBody(res, release) {
  if (release.protocol === 'usenet') {
    return sendBuffer(res, 200, release.nzbFile, 'application/x-nzb', {
      'Content-Disposition': `attachment; filename="${release.name}.nzb"`,
    });
  }
  if (release.grab.body === 'magnet-text' || !release.torrentFile) {
    return sendText(res, 200, release.magnet);
  }
  return sendBuffer(res, 200, release.torrentFile, 'application/x-bittorrent', {
    'Content-Disposition': `attachment; filename="${release.name}.torrent"`,
  });
}

function redirectOrServe(state, res, release, nextHop) {
  const hops = release.grab.redirects || [];
  if (nextHop < hops.length) {
    res.writeHead(302, { Location: hopLocation(state, release, hops[nextHop], nextHop) });
    return res.end();
  }
  return serveReleaseBody(res, release);
}

/**
 * Tracker-side handler: `/d/<releaseId>` (direct link, hop chain starts at 0) and
 * `/t/<releaseId>/<hop>` (redirect hop). Never requires (or wants) the Prowlarr key.
 */
export function handleTrackerHop(state, req, res, url) {
  const m = /^\/(?:d\/([A-Za-z0-9_-]+)|t\/([A-Za-z0-9_-]+)\/(\d+))$/.exec(url.pathname);
  if (!m) return false;
  const release = state.releases.get(m[1] || m[2]);
  if (!release) {
    notFound(res, 'unknown release');
    return true;
  }
  redirectOrServe(state, res, release, m[1] ? 0 : Number(m[3]) + 1);
  return true;
}

export function handleProwlarr(state, req, res, url) {
  const { pathname } = url;
  const key = presentedKey(req, url);
  const keyOk = key === state.config.prowlarrApiKey;

  const dl = /^\/(\d+)\/download$/.exec(pathname);
  if (dl && req.method === 'GET') {
    if (!keyOk) return sendJson(res, 401, { error: 'invalid api key' });
    const release = state.releases.get(decodeLink(url.searchParams.get('link')));
    if (!release) return notFound(res, 'unknown link');
    const status = nextStatus(release.grab.statuses, release.grabAttempts);
    release.grabAttempts += 1;
    if (status !== 200) {
      return sendJson(res, status, { error: `scenario status ${status}` }, status === 429 || status === 503 ? { 'Retry-After': '1' } : {});
    }
    return redirectOrServe(state, res, release, 0);
  }

  const rss = /^\/(\d+)\/api$/.exec(pathname);
  if (rss && req.method === 'GET') {
    if (!keyOk) return sendJson(res, 401, { error: 'invalid api key' });
    const indexerId = Number(rss[1]);
    const releases = [...state.releases.values()].filter((r) => r.indexerId === indexerId && !r.hideFromRss);
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    return res.end(rssXml(state, releases));
  }

  if (pathname.startsWith('/info/')) return sendText(res, 200, 'fake-arr release info page');

  if (!pathname.startsWith('/api/v1/')) return notFound(res);
  if (!keyOk) return sendJson(res, 401, { error: 'invalid api key' });

  const scenario = state.scenario;
  switch (pathname) {
    case '/api/v1/search': {
      scenario.searchCalls = (scenario.searchCalls || 0) + 1;
      const status = nextStatus(scenario.search?.statuses, scenario.searchCalls - 1);
      if (status !== 200) return sendJson(res, status, { error: `scenario status ${status}` });
      const query = url.searchParams.get('query');
      const type = url.searchParams.get('type') || 'search';
      if (!SEARCH_TYPES.has(type)) return sendJson(res, 400, { error: `unsupported search type ${type}` });
      const indexerIds = url.searchParams.getAll('indexerIds').map(Number);
      const categories = url.searchParams.getAll('categories').map(Number).filter(Number.isFinite);
      const limit = Number(url.searchParams.get('limit'));
      let results = [...state.releases.values()]
        .filter((r) => indexerIds.length === 0 || indexerIds.includes(r.indexerId))
        .filter((r) => categories.length === 0 || r.categories.some((c) => categories.includes(c)))
        .filter((r) => matchesQuery(r, query))
        .map((r) => toProwlarrResult(state, r));
      // Scenarios can set search.ignoreLimit to model indexers that over-return.
      if (limit > 0 && !scenario.search?.ignoreLimit) results = results.slice(0, limit);
      return sendJson(res, 200, results);
    }
    case '/api/v1/indexer':
      return sendJson(
        res,
        200,
        scenario.indexers.map((i) => ({
          id: i.id,
          name: i.name,
          protocol: i.protocol,
          enable: true,
          priority: i.priority ?? 25,
          privacy: 'private',
          capabilities: { categories: [AUDIOBOOK_CATEGORY] },
        }))
      );
    case '/api/v1/health':
      return sendJson(res, 200, []);
    case '/api/v1/indexerstats':
      return sendJson(res, 200, {
        indexers: scenario.indexers.map((i) => ({ indexerId: i.id, indexerName: i.name, numberOfQueries: 0, numberOfGrabs: 0 })),
        userAgents: [],
        hosts: [],
      });
    case '/api/v1/system/status':
      return sendJson(res, 200, { appName: 'Prowlarr', version: '1.24.3.4754-fake' });
    default:
      return notFound(res);
  }
}
