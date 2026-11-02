/**
 * Component: E2E fake-arr download simulation (progress, stalls, failures, fixture drop)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Progress is computed from wall-clock time on each poll, so there are no timers to leak.
 * Files are copied into the shared downloads volume on the first poll that reaches 100%,
 * before that poll reports completion, so RMAB never sees "complete" without files.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Create a simulated download job for a release. */
export function startDownload(state, release, { savePath, name }) {
  const knobs = release.download || {};
  const total = release.files.reduce((s, f) => s + f.length, 0);
  return {
    releaseId: release.id,
    name,
    savePath,
    contentPath: path.posix.join(savePath, name),
    advertisedBytes: release.sizeBytes,
    actualBytes: total,
    startedAt: Date.now(),
    completeMs: Math.max(0, Number(knobs.completeMs ?? 4000)),
    stallAtPct: knobs.stallAtPct ?? null,
    failAtPct: knobs.failAtPct ?? null,
    dropFixture: knobs.dropFixture || release.fixture,
    paused: false,
    pausedAt: null,
    pausedTotalMs: 0,
    materialized: false,
    deleted: false,
  };
}

/**
 * Snapshot of a job at `now`: { progress 0..1, phase, bytesDone, speed }.
 * phase: downloading | stalled | paused | failed | complete
 */
export function snapshot(state, job, now = Date.now()) {
  const pausedMs = job.pausedTotalMs + (job.paused && job.pausedAt ? now - job.pausedAt : 0);
  const elapsed = Math.max(0, now - job.startedAt - pausedMs);
  let fraction = job.completeMs === 0 ? 1 : Math.min(1, elapsed / job.completeMs);
  let phase = job.paused ? 'paused' : 'downloading';

  if (job.failAtPct !== null && fraction * 100 >= job.failAtPct) {
    return { progress: job.failAtPct / 100, phase: 'failed', bytesDone: Math.round(job.advertisedBytes * job.failAtPct / 100), speed: 0 };
  }
  if (job.stallAtPct !== null && fraction * 100 >= job.stallAtPct) {
    fraction = job.stallAtPct / 100;
    phase = 'stalled';
  }
  // Finished stays finished: a completed job that is later paused reports 100% (qBit pausedUP).
  if (fraction >= 1) {
    if (!job.materialized) materialize(state, job);
    phase = 'complete';
  }
  const moving = phase === 'downloading';
  // Non-zero speed while moving: RMAB's monitor treats 0 B/s plus unchanged progress as a stall.
  const speed = moving ? Math.max(1, Math.round(job.advertisedBytes / Math.max(1, job.completeMs / 1000))) : 0;
  return { progress: fraction, phase, bytesDone: Math.round(job.advertisedBytes * fraction), speed };
}

export function pauseJob(job) {
  if (!job.paused) {
    job.paused = true;
    job.pausedAt = Date.now();
  }
}

export function resumeJob(job) {
  if (job.paused) {
    job.pausedTotalMs += Date.now() - job.pausedAt;
    job.paused = false;
    job.pausedAt = null;
  }
}

/** Copy the job's fixture files into <savePath>/<name>/ and chown them to PUID:PGID. */
export function materialize(state, job) {
  const fixture = state.fixture(job.dropFixture);
  const srcRoot = path.join(state.config.fixturesDir, job.dropFixture);
  for (const file of fixture.files) {
    const dest = path.posix.join(job.contentPath, file.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, file.rel), dest);
  }
  chownTree(state, job.savePath, job.contentPath);
  job.materialized = true;
}

/** chown everything from `top` down, plus the directories between `base` and `top`. */
function chownTree(state, base, top) {
  const { puid, pgid } = state.config;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return; // only root can chown
  const walk = (p) => {
    fs.chownSync(p, puid, pgid);
    if (fs.statSync(p).isDirectory()) for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
  };
  let dir = path.dirname(top);
  while (dir.startsWith(base) && dir !== base) {
    fs.chownSync(dir, puid, pgid);
    dir = path.dirname(dir);
  }
  if (fs.existsSync(base)) fs.chownSync(base, puid, pgid);
  walk(top);
}

export function removeJobFiles(job) {
  fs.rmSync(job.contentPath, { recursive: true, force: true });
}
