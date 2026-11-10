/**
 * Component: E2E fake-arr control API (scenario switch, request recorder, state dump)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { readParams, sendJson, notFound } from './http-util.js';
import { torrentInfo, seedTorrent, armQbitFault } from './qbit.js';
import { sabSlots } from './sab.js';
import { scanAlbums } from './plex.js';

/** Constant-time token check; the token is per run and only the harness runner and host hold it. */
function authorized(state, req) {
  const want = Buffer.from(state.config.controlToken || '');
  const got = Buffer.from(String(req.headers['x-control-token'] || ''));
  return want.length >= 16 && got.length === want.length && timingSafeEqual(want, got);
}

/** A category another app made before RMAB (qbit: name kept as given; sab: lower-case, like SABnzbd). */
function seedCategory(state, { client, name, path: dir = '' }) {
  const given = String(name || '').trim();
  if (!given || given === '*') throw new Error('category name required');
  if (client !== 'qbit' && client !== 'sab') throw new Error("client must be 'qbit' or 'sab'");
  const key = client === 'sab' ? given.toLowerCase() : given;
  if (client === 'qbit') state.qbitCategories[key] = { name: key, savePath: String(dir) };
  else state.sabCategories[key] = String(dir);
  state.seededCategories.push({ client, name: key });
  return { client, name: key, path: String(dir) };
}

/** Drop one category (seeded or created through the client API), so a spec can leave the client as it found it. */
function removeCategory(state, { client, name }) {
  if (client !== 'qbit' && client !== 'sab') throw new Error("client must be 'qbit' or 'sab'");
  const key = client === 'sab' ? String(name || '').trim().toLowerCase() : String(name || '').trim();
  const map = client === 'qbit' ? state.qbitCategories : state.sabCategories;
  const existed = key in map;
  delete map[key];
  state.seededCategories = state.seededCategories.filter((c) => !(c.client === client && c.name === key));
  return existed;
}

function removeSeededCategories(state) {
  for (const { client, name } of state.seededCategories) {
    delete (client === 'qbit' ? state.qbitCategories : state.sabCategories)[name];
  }
  state.seededCategories = [];
}

export async function handleControl(state, req, res, url) {
  const p = url.pathname.replace(/^\/__control/, '') || '/';
  try {
    // Health stays open (container healthcheck); it reveals nothing.
    if (p === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
    if (!authorized(state, req)) return sendJson(res, 401, { ok: false, error: 'control token required' });
    if (p === '/scenarios' && req.method === 'GET') return sendJson(res, 200, state.listScenarios());
    if (p === '/books' && req.method === 'GET') return sendJson(res, 200, state.fixtureIndex.books);
    if (p === '/plex-library' && req.method === 'GET') {
      return sendJson(res, 200, { refreshes: state.plexRefreshes, albums: scanAlbums(state).map(({ dir, ...a }) => ({ ...a, dir })) });
    }
    if (p === '/release-torrent' && req.method === 'GET') {
      // What an admin would paste or upload by hand (#290): the magnet, and the .torrent bytes as base64
      const release = state.releases.get(String(url.searchParams.get('id') || ''));
      if (!release || release.protocol !== 'torrent') throw new Error(`no torrent release "${url.searchParams.get('id')}" in the scenario`);
      const file = release.torrentFile || null;
      return sendJson(res, 200, {
        id: release.id,
        infoHash: release.infoHash,
        magnet: release.magnet,
        torrentFile: file ? file.toString('base64') : null,
        sha256: file ? createHash('sha256').update(file).digest('hex') : null,
      });
    }
    if (p === '/scenario' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      const scenario = params.definition ? state.loadScenario(params.definition) : state.loadScenarioByName(params.name);
      return sendJson(res, 200, { ok: true, scenario: scenario.name, releases: [...state.releases.keys()] });
    }
    if (p === '/metadata-tags' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      const asin = String(params.asin || '').toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('asin must be 10 letters or digits');
      const tags = Array.isArray(params.tags) ? params.tags.map(String) : [];
      if (tags.length) state.metadataTags.set(asin, tags);
      else state.metadataTags.delete(asin);
      return sendJson(res, 200, { ok: true, asin, tags });
    }
    if (p === '/qbit-seed' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      return sendJson(res, 200, { ok: true, torrent: seedTorrent(state, params) });
    }
    if (p === '/qbit-fault' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      return sendJson(res, 200, { ok: true, fault: armQbitFault(state, params) });
    }
    if (p === '/categories' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      if (params.remove) return sendJson(res, 200, { ok: true, removed: removeCategory(state, params) });
      return sendJson(res, 200, { ok: true, category: seedCategory(state, params) });
    }
    if (p === '/reset' && req.method === 'POST') {
      removeSeededCategories(state);
      const name = state.scenario?.name;
      if (name && state.listScenarios().includes(name)) state.loadScenarioByName(name);
      else state.reset();
      return sendJson(res, 200, { ok: true, scenario: state.scenario?.name ?? null });
    }
    if (p === '/requests' && req.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const service = url.searchParams.get('service');
      return sendJson(
        res,
        200,
        state.records.filter((r) => r.seq > since && (!service || r.service === service))
      );
    }
    if (p === '/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        scenario: state.scenario?.name ?? null,
        releases: [...state.releases.values()].map((r) => ({
          id: r.id,
          title: r.title,
          protocol: r.protocol,
          infoHash: r.infoHash || null,
          grabAttempts: r.grabAttempts,
        })),
        torrents: [...state.torrents.values()].map((t) => ({ releaseId: t.releaseId || null, ...torrentInfo(state, t) })),
        nzbs: sabSlots(state),
        qbitCategories: state.qbitCategories,
        sabCategories: state.sabCategories,
        plexRefreshes: state.plexRefreshes,
      });
    }
    return notFound(res);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message });
  }
}
