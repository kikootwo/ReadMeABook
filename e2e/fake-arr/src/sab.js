/**
 * Component: E2E fake SABnzbd API (subset RMAB calls)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Derived from src/lib/integrations/sabnzbd.service.ts: version :219, get_config :242,
 * set_config :423/:445, queue :155/:636/:719, history :662/:745, pause :689, resume :703,
 * addfile (multipart) :553, queue/history delete (deleteNZB / archiveCompletedNZB).
 */

import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readParams, sendJson, notFound } from './http-util.js';
import { startDownload, snapshot, pauseJob, resumeJob, removeJobFiles } from './sim.js';

const SAB_VERSION = '4.3.3';

function fmtTimeLeft(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function categoryDir(state, cat) {
  const complete = state.config.downloadsDir;
  const dir = state.sabCategories[cat] ?? '';
  if (!dir) return complete;
  return dir.startsWith('/') ? dir : path.posix.join(complete, dir);
}

/**
 * Where a job lands: its category folder, unless the release sets `sabStorageDir` (absolute, or
 * relative to complete_dir), which places it there regardless of category, like SABnzbd sorting.
 */
function jobDir(state, release, cat) {
  const override = release?.sabStorageDir;
  if (!override) return categoryDir(state, cat);
  return override.startsWith('/') ? override : path.posix.join(state.config.downloadsDir, override);
}

function addJob(state, release, cat, name) {
  const nzoId = `SABnzbd_nzo_${randomBytes(6).toString('hex')}`;
  const savePath = jobDir(state, release, cat);
  const job = release ? startDownload(state, release, { savePath, name }) : null;
  if (job && state.sabPaused) pauseJob(job);
  state.nzbs.set(nzoId, { nzoId, name, cat, releaseId: release?.id, job, completedAt: 0, archived: false });
  return nzoId;
}

/** Split jobs into queue and history slots at `now`. */
export function sabSlots(state, now = Date.now()) {
  const queue = [];
  const history = [];
  for (const n of state.nzbs.values()) {
    const snap = n.job ? snapshot(state, n.job, now) : { progress: 0, phase: 'stalled', bytesDone: 0, speed: 0 };
    const totalMb = (n.job?.advertisedBytes || 0) / (1024 * 1024);
    if (snap.phase === 'complete' || snap.phase === 'failed') {
      if (!n.completedAt) n.completedAt = Math.floor(now / 1000);
      if (n.archived) continue;
      history.push({
        nzo_id: n.nzoId,
        name: n.name,
        category: n.cat,
        status: snap.phase === 'complete' ? 'Completed' : 'Failed',
        bytes: String(n.job?.advertisedBytes || 0),
        fail_message: snap.phase === 'failed' ? 'Out of retention (fake-arr scenario)' : '',
        storage: snap.phase === 'complete' ? n.job.contentPath : '',
        completed: String(n.completedAt),
        download_time: String(Math.round((n.job?.completeMs || 0) / 1000)),
      });
    } else {
      const left = totalMb * (1 - snap.progress);
      queue.push({
        nzo_id: n.nzoId,
        filename: n.name,
        mb: totalMb.toFixed(2),
        mbleft: left.toFixed(2),
        percentage: String(Math.floor(snap.progress * 100)),
        status: snap.phase === 'paused' ? 'Paused' : 'Downloading',
        timeleft: fmtTimeLeft(snap.speed > 0 ? (left * 1024 * 1024) / snap.speed : 0),
        cat: n.cat,
        priority: 'Normal',
      });
    }
  }
  return { queue, history };
}

export async function handleSab(state, req, res, url, recordEntry) {
  if (url.pathname !== '/api' && url.pathname !== '/sabnzbd/api') return notFound(res);
  const { params, files } = await readParams(req, url);
  if (params.apikey !== state.config.sabApiKey) return sendJson(res, 200, { status: false, error: 'API Key Incorrect' });

  switch (params.mode) {
    case 'version':
      return sendJson(res, 200, { version: SAB_VERSION });
    case 'get_config':
      return sendJson(res, 200, {
        config: {
          misc: { complete_dir: state.config.downloadsDir, download_dir: path.posix.join(state.config.downloadsDir, 'incomplete') },
          // Real SABnzbd 4.x returns categories as an array of objects.
          categories: [
            { name: '*', order: 0, dir: '' },
            ...Object.entries(state.sabCategories).map(([name, dir], i) => ({ name, order: i + 1, dir })),
          ],
        },
      });
    case 'set_config':
      if (params.section === 'categories' && params.keyword) state.sabCategories[params.keyword] = params.dir || '';
      return sendJson(res, 200, { status: true });
    case 'addfile': {
      const file = files.find((f) => f.name === 'nzbfile' || f.name === 'name');
      if (!file) return sendJson(res, 200, { status: false, error: 'No NZB file' });
      const release = state.releaseForNzb(file.data);
      if (!release) return sendJson(res, 200, { status: false, error: 'Unknown NZB (not from this scenario)' });
      const nzoId = addJob(state, release, params.cat || '*', release.name);
      recordEntry.added = [{ nzoId, releaseId: release.id }];
      return sendJson(res, 200, { status: true, nzo_ids: [nzoId] });
    }
    case 'queue': {
      if (params.name === 'delete') {
        for (const id of String(params.value || '').split(',')) {
          const n = state.nzbs.get(id);
          if (n && params.del_files === '1' && n.job) removeJobFiles(n.job);
          state.nzbs.delete(id);
        }
        return sendJson(res, 200, { status: true, nzo_ids: String(params.value || '').split(',') });
      }
      // Per-job pause/resume (real SABnzbd: mode=queue&name=pause|resume&value=<nzo_id>).
      if (params.name === 'pause' || params.name === 'resume') {
        for (const id of String(params.value || '').split(',')) {
          const n = state.nzbs.get(id);
          if (!n?.job) continue;
          n.userPaused = params.name === 'pause';
          if (n.userPaused) pauseJob(n.job);
          else if (!state.sabPaused) resumeJob(n.job);
        }
        return sendJson(res, 200, { status: true, nzo_ids: String(params.value || '').split(',') });
      }
      const { queue } = sabSlots(state);
      return sendJson(res, 200, { queue: { status: state.sabPaused ? 'Paused' : 'Downloading', paused: state.sabPaused, slots: queue, noofslots: queue.length } });
    }
    case 'history': {
      if (params.name === 'delete') {
        for (const id of String(params.value || '').split(',')) {
          const n = state.nzbs.get(id);
          if (n) n.archived = true;
        }
        return sendJson(res, 200, { status: true });
      }
      const { history } = sabSlots(state);
      return sendJson(res, 200, { history: { slots: history, noofslots: history.length } });
    }
    case 'pause':
    case 'resume': {
      // Real SABnzbd: mode=pause / mode=resume pause or resume the WHOLE queue; `value` is ignored.
      state.sabPaused = params.mode === 'pause';
      for (const n of state.nzbs.values()) {
        if (!n.job) continue;
        if (state.sabPaused) pauseJob(n.job);
        else if (!n.userPaused) resumeJob(n.job);
      }
      return sendJson(res, 200, { status: true });
    }
    default:
      recordEntry.unimplemented = true;
      return sendJson(res, 200, { status: false, error: `fake-arr: mode ${params.mode} not implemented` });
  }
}
