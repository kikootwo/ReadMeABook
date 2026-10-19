/**
 * Component: E2E fake-arr control API (scenario switch, request recorder, state dump)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { timingSafeEqual } from 'node:crypto';
import { readParams, sendJson, notFound } from './http-util.js';
import { torrentInfo } from './qbit.js';
import { sabSlots } from './sab.js';
import { scanAlbums } from './plex.js';

/** Constant-time token check; the token is per run and only the harness runner and host hold it. */
function authorized(state, req) {
  const want = Buffer.from(state.config.controlToken || '');
  const got = Buffer.from(String(req.headers['x-control-token'] || ''));
  return want.length >= 16 && got.length === want.length && timingSafeEqual(want, got);
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
    if (p === '/scenario' && req.method === 'POST') {
      const { params } = await readParams(req, url);
      const scenario = params.definition ? state.loadScenario(params.definition) : state.loadScenarioByName(params.name);
      return sendJson(res, 200, { ok: true, scenario: scenario.name, releases: [...state.releases.keys()] });
    }
    if (p === '/reset' && req.method === 'POST') {
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
