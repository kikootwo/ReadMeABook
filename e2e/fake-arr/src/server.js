/**
 * Component: E2E fake-arr entrypoint (one process, one listener per faked service)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Listeners: prowlarr (+ relative-redirect hops), tracker (foreign origin for redirect hops),
 * qbit, sab, plex, control. Every non-control request is recorded with its listener port and
 * all headers so specs can assert where credentials travelled.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, State } from './state.js';
import { handleProwlarr, handleTrackerHop } from './prowlarr.js';
import { handleQbit } from './qbit.js';
import { handleSab } from './sab.js';
import { handlePlex } from './plex.js';
import { handleControl } from './control.js';
import { sendJson, sendText, notFound } from './http-util.js';

function routerFor(service, state) {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'fake-arr'}`);
    if (service === 'control') return handleControl(state, req, res, url);

    const entry = state.record({
      service,
      listener: req.socket.localPort,
      method: req.method,
      host: req.headers.host || '',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { ...req.headers },
    });
    res.on('finish', () => {
      entry.status = res.statusCode;
      entry.location = res.getHeader('location') || undefined;
    });

    switch (service) {
      case 'prowlarr':
        if (handleTrackerHop(state, req, res, url)) return;
        return handleProwlarr(state, req, res, url);
      case 'tracker':
        if (url.pathname === '/announce') return sendText(res, 200, 'd8:intervali1800e5:peerslee');
        if (handleTrackerHop(state, req, res, url)) return;
        return notFound(res);
      case 'qbit':
        return handleQbit(state, req, res, url, entry);
      case 'sab':
        return handleSab(state, req, res, url, entry);
      case 'plex':
        return handlePlex(state, req, res, url);
      default:
        return notFound(res);
    }
  };
}

/** Start all listeners. Returns { state, servers, close() }. Ports of 0 pick a free port (tests). */
export async function startFakeArr(config = loadConfig()) {
  const state = new State(config);
  state.loadScenarioByName(config.defaultScenario);
  const servers = {};
  for (const [service, port] of Object.entries(config.ports)) {
    const server = http.createServer((req, res) => {
      routerFor(service, state)(req, res).catch((error) => {
        console.error(`[fake-arr] ${service} ${req.method} ${req.url} failed:`, error);
        if (!res.headersSent) sendJson(res, 500, { error: error.message });
        else res.end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', resolve);
    });
    servers[service] = server;
    config.ports[service] = server.address().port;
  }
  const close = () => Promise.all(Object.values(servers).map((s) => new Promise((r) => s.close(r))));
  return { state, servers, close };
}

/**
 * Named volumes are created root-owned. RMAB (PUID) must write to /downloads and /media, and nothing
 * in its image chowns them, so fake-arr (root, mounts both) prepares them before RMAB starts.
 */
export function prepareVolumes(config) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const dirs = [config.downloadsDir, config.mediaDir, path.posix.join(config.mediaDir, 'audiobooks')];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.chownSync(dir, config.puid, config.pgid);
    fs.chmodSync(dir, 0o775);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const config = loadConfig();
  prepareVolumes(config);
  const { state } = await startFakeArr(config);
  console.log(`[fake-arr] scenario=${state.scenario.name} ports=${JSON.stringify(config.ports)}`);
  const shutdown = () => process.exit(0);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
