/**
 * Component: E2E fake qBittorrent WebUI API v2 (subset RMAB calls)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Derived from src/lib/integrations/qbittorrent.service.ts: auth/login :194/:941, app/version :852/:918,
 * torrents/categories :555, createCategory :566, editCategory :588, add (urls) :354, add (multipart) :523,
 * info :632/:675, pause :696, resume :723, delete :750, files :780, setCategory :821.
 */

import { randomBytes } from 'node:crypto';
import { readParams, sendJson, sendText, notFound } from './http-util.js';
import { startDownload, snapshot, pauseJob, resumeJob, removeJobFiles } from './sim.js';

const QBIT_VERSION = 'v4.6.5';

function cookieSid(req) {
  return /(?:^|;\s*)SID=([^;]+)/.exec(req.headers.cookie || '')?.[1];
}

function hashesParam(value) {
  return String(value || '')
    .split('|')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function stateName(phase, paused) {
  switch (phase) {
    case 'complete':
      return paused ? 'pausedUP' : 'uploading';
    case 'stalled':
      return 'stalledDL';
    case 'paused':
      return 'pausedDL';
    case 'failed':
      return 'error';
    default:
      return 'downloading';
  }
}

/** qBittorrent /torrents/info entry for one torrent at `now`. */
export function torrentInfo(state, t, now = Date.now()) {
  const snap = t.job ? snapshot(state, t.job, now) : { progress: 0, phase: 'stalled', bytesDone: 0, speed: 0 };
  const complete = snap.phase === 'complete';
  if (complete && !t.completionOn) t.completionOn = Math.floor(now / 1000);
  const size = t.job ? t.job.advertisedBytes : 0;
  return {
    hash: t.hash,
    name: t.name,
    category: t.category,
    tags: t.tags,
    save_path: t.savePath,
    content_path: t.job ? t.job.contentPath : `${t.savePath}/${t.name}`,
    size,
    total_size: size,
    progress: snap.progress,
    dlspeed: snap.speed,
    upspeed: complete ? 1024 : 0,
    downloaded: snap.bytesDone,
    amount_left: Math.max(0, size - snap.bytesDone),
    eta: complete ? 8640000 : snap.speed > 0 ? Math.ceil((size - snap.bytesDone) / snap.speed) : 8640000,
    state: stateName(snap.phase, t.job?.paused),
    added_on: t.addedOn,
    completion_on: t.completionOn || -1,
    ratio: 0,
    seeding_time: complete && t.completionOn ? Math.max(0, Math.floor(now / 1000) - t.completionOn) : 0,
    num_seeds: 5,
    num_leechs: 0,
  };
}

function addTorrentRecord(state, { hash, release, name, category, tags, savePathParam, paused }) {
  if (state.torrents.has(hash)) return state.torrents.get(hash);
  const cat = state.qbitCategories[category];
  const savePath = (cat && cat.savePath) || savePathParam || state.config.downloadsDir;
  const record = {
    hash,
    name,
    category: category || '',
    tags: tags || '',
    savePath,
    addedOn: Math.floor(Date.now() / 1000),
    completionOn: 0,
    releaseId: release?.id,
    files: release?.files || [], // kept on the record: the release may leave with a scenario switch
    job: release ? startDownload(state, release, { savePath, name }) : null,
  };
  if (record.job && paused) pauseJob(record.job);
  state.torrents.set(hash, record);
  return record;
}

export async function handleQbit(state, req, res, url, recordEntry) {
  const p = url.pathname;
  if (!p.startsWith('/api/v2/')) return notFound(res);
  const route = p.slice('/api/v2'.length);
  const { params, files } = await readParams(req, url);

  if (route === '/auth/login') {
    if (params.username === state.config.qbitUser && params.password === state.config.qbitPass) {
      const sid = randomBytes(16).toString('hex');
      state.qbitSessions.add(sid);
      return sendText(res, 200, 'Ok.', { 'Set-Cookie': `SID=${sid}; HttpOnly; SameSite=Strict; path=/` });
    }
    return sendText(res, 200, 'Fails.');
  }

  if (!state.qbitSessions.has(cookieSid(req))) return sendText(res, 403, 'Forbidden');

  switch (route) {
    case '/auth/logout':
      state.qbitSessions.delete(cookieSid(req));
      return sendText(res, 200, '');
    case '/app/version':
      return sendText(res, 200, QBIT_VERSION);
    case '/app/webapiVersion':
      return sendText(res, 200, '2.9.3');
    case '/app/preferences':
      return sendJson(res, 200, { save_path: state.config.downloadsDir, temp_path_enabled: false, temp_path: '' });
    case '/transfer/info':
      return sendJson(res, 200, { dl_info_speed: 0, up_info_speed: 0, connection_status: 'connected' });
    case '/torrents/categories':
      return sendJson(res, 200, state.qbitCategories);
    case '/torrents/createCategory':
    case '/torrents/editCategory': {
      if (!params.category) return sendText(res, 400, 'Bad Request');
      if (route === '/torrents/createCategory' && state.qbitCategories[params.category]) return sendText(res, 409, 'Conflict');
      state.qbitCategories[params.category] = { name: params.category, savePath: params.savePath || '' };
      return sendText(res, 200, '');
    }
    case '/torrents/add':
      return addTorrents(state, res, params, files, recordEntry);
    case '/torrents/info': {
      const wanted = hashesParam(params.hashes);
      const list = [...state.torrents.values()]
        .filter((t) => wanted.length === 0 || wanted.includes(t.hash))
        .filter((t) => !params.category || t.category === params.category)
        .map((t) => torrentInfo(state, t));
      return sendJson(res, 200, list);
    }
    case '/torrents/files': {
      const t = state.torrents.get(String(params.hash || '').toLowerCase());
      if (!t) return sendText(res, 404, 'Not Found');
      const snap = t.job ? snapshot(state, t.job) : { progress: 0 };
      return sendJson(
        res,
        200,
        t.files.map((f, index) => ({
          index,
          name: [t.name, ...f.path].join('/'),
          size: f.length,
          progress: snap.progress,
          priority: 1,
          is_seed: snap.progress >= 1,
        }))
      );
    }
    case '/torrents/pause':
    case '/torrents/stop':
    case '/torrents/resume':
    case '/torrents/start': {
      const pausing = route === '/torrents/pause' || route === '/torrents/stop';
      for (const t of selectTorrents(state, params.hashes)) {
        if (!t.job) continue;
        if (pausing) pauseJob(t.job);
        else resumeJob(t.job);
      }
      return sendText(res, 200, '');
    }
    case '/torrents/setCategory': {
      for (const t of selectTorrents(state, params.hashes)) t.category = params.category || '';
      return sendText(res, 200, '');
    }
    case '/torrents/delete': {
      const deleteFiles = String(params.deleteFiles) === 'true';
      for (const t of selectTorrents(state, params.hashes)) {
        if (deleteFiles && t.job) removeJobFiles(t.job);
        state.torrents.delete(t.hash);
      }
      return sendText(res, 200, '');
    }
    default:
      recordEntry.unimplemented = true;
      return sendText(res, 404, 'Not Found');
  }
}

function selectTorrents(state, hashes) {
  if (hashes === 'all') return [...state.torrents.values()];
  return hashesParam(hashes)
    .map((h) => state.torrents.get(h))
    .filter(Boolean);
}

function addTorrents(state, res, params, files, recordEntry) {
  const added = [];
  const common = { category: params.category, tags: params.tags, savePathParam: params.savepath, paused: params.paused === 'true' || params.stopped === 'true' };
  for (const line of String(params.urls || '').split(/\r?\n/).filter(Boolean)) {
    const hash = /xt=urn:btih:([0-9a-fA-F]{40})/.exec(line)?.[1]?.toLowerCase();
    if (!hash) return sendText(res, 200, 'Fails.');
    const release = state.releaseForHash(hash);
    const dn = new URLSearchParams(line.split('?')[1] || '').get('dn') || hash;
    added.push(addTorrentRecord(state, { hash, release, name: release?.name || dn, ...common }));
  }
  for (const file of files.filter((f) => f.name === 'torrents')) {
    const release = [...state.releases.values()].find((r) => r.torrentFile && r.torrentFile.equals(file.data));
    if (!release) return sendText(res, 200, 'Fails.');
    added.push(addTorrentRecord(state, { hash: release.infoHash, release, name: release.name, ...common }));
  }
  if (added.length === 0) return sendText(res, 200, 'Fails.');
  recordEntry.added = added.map((t) => ({ hash: t.hash, releaseId: t.releaseId || null }));
  return sendText(res, 200, 'Ok.');
}
