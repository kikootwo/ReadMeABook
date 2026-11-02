/**
 * Component: E2E regression #242 (post-import cleanup must never delete library content)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Scenario usenet-smoke (fake SABnzbd, indexer 2, "Remove after processing" on), path mapping off.
 * Stack override: the media volume is also mounted in rmab at /downloads/media-bind (case 1E).
 * The first test seeds the library through a real usenet download (and is case 3A); every later
 * test restores the library from a copy taken after the seed, then triggers a real manual import
 * (POST /api/admin/manual-import, as the UI does) or a real organize job, and compares sha256
 * snapshots of /media and /downloads before and after. Checks are recorded per case in
 * <evidence>/242/<case>/result.json; a test fails when any check fails.
 */

import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { evidencePath, waitFor, fakeArr, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import {
  MEDIA, BACKUP, PUID, PGID, sh, asApp, q, psql, sqlStr, markJobs, shas, listing, exists, fileSize, eventsSince, fmtEvents,
  waitOrganized, sabHistoryDeletes, setRemoveAfterProcessing, requestState, CaseRun, diffShas, fmtShas, type JobEventRow,
} from './242-helpers';

// Needs docker exec into the stack (sha256 snapshots, psql, symlinks, Bull): untainted runs only.
test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const BIND = '/downloads/media-bind';
const SEED_FILE = () => evidencePath('242/seed.json');

interface Seed {
  requestId: string;
  audiobookId: string;
  userId: string;
  L: string;
  nzoId: string;
  nzbName: string;
  audio: string[];
}

const seed = (): Seed => {
  if (!fs.existsSync(SEED_FILE())) throw new Error('seed missing: the 3A seed test did not complete');
  return JSON.parse(fs.readFileSync(SEED_FILE(), 'utf8'));
};

const has = (rows: JobEventRow[], text: string, level?: string) => rows.some((r) => r.message.includes(text) && (!level || r.level === level));
const count = (rows: JobEventRow[], text: string) => rows.filter((r) => r.message.includes(text)).length;

/** Restore the seeded library and clear every per-case artefact. */
function restoreLibrary() {
  sh(
    [
      `rm -rf ${q(MEDIA)} /media/incoming /downloads/linked-book /downloads/manual`,
      `cp -a ${q(BACKUP)} ${q(MEDIA)}`,
      `chown ${PUID}:${PGID} ${q(MEDIA)}`,
    ].join('\n')
  );
}

function addCover(L: string) {
  asApp(`ffmpeg -nostdin -loglevel error -f lavfi -i color=c=blue:s=320x320 -frames:v 1 -y ${q(`${L}/cover.jpg`)}`);
}

function addEpub(dir: string, name: string) {
  asApp(`mkdir -p ${q(dir)}\ni=0; while [ $i -lt 200 ]; do echo "generated epub ${name}"; i=$((i+1)); done > ${q(`${dir}/${name}`)}`);
}

function audioIn(dir: string): string[] {
  return sh(`find ${q(dir)} -maxdepth 1 -type f \\( -name '*.m4b' -o -name '*.mp3' -o -name '*.m4a' -o -name '*.flac' -o -name '*.opus' -o -name '*.ogg' \\) -printf '%f\\n' | sort`)
    .split('\n')
    .filter(Boolean);
}

interface Snapshot {
  media: Record<string, string>;
  downloads: Record<string, string>;
}

function snapshot(c: CaseRun, phase: 'before' | 'after'): Snapshot {
  const media = shas('/media');
  const downloads = shas('/downloads', [BIND]);
  c.save(`sha256-media-${phase}.txt`, fmtShas(media));
  c.save(`sha256-downloads-${phase}.txt`, fmtShas(downloads));
  c.save(`listing-${phase}.txt`, `# /media\n${listing('/media')}\n\n# /downloads (excluding ${BIND})\n${listing('/downloads', [BIND])}\n`);
  const covers = sh(`find /media -name cover.jpg -printf '%s %p\\n' | sort -k2`);
  c.save(`cover-sizes-${phase}.txt`, covers || '(no cover.jpg)\n');
  return { media, downloads };
}

/** Trigger a manual import over HTTP and wait for its organize job; saves request, events and fake-client calls. */
async function manualImport(c: CaseRun, rmab: Rmab, body: Record<string, unknown>) {
  const sabBefore = (await sabHistoryDeletes()).length;
  const since = markJobs();
  c.save('trigger.json', { method: 'POST', path: '/api/admin/manual-import', body });
  const res = await rmab.raw('POST', '/api/admin/manual-import', body);
  const response = await res.json().catch(() => ({}));
  c.save('trigger-response.json', { status: res.status, body: response });
  c.check(`manual import accepted (HTTP ${res.status})`, res.ok, 'control', JSON.stringify(response));
  if (res.ok) {
    try {
      const done = await waitOrganized(since, response.requestId);
      c.save('organize-jobs.json', done);
    } catch (error) {
      c.check('organize job finished in time', false, 'control', String(error));
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(response.requestId || seed().requestId)}\n`);
  const sabAfter = await sabHistoryDeletes();
  c.save('sab-history-delete-requests.json', sabAfter);
  return { events, newSabDeletes: sabAfter.length - sabBefore, requestId: response.requestId as string };
}

function compare(c: CaseRun, before: Snapshot, after: Snapshot, { allowNew = false, label = '/media' } = {}) {
  const d = diffShas(before.media, after.media);
  c.save('media-diff.json', d);
  c.check(`${label}: no file missing (${d.missing.length} missing)`, d.missing.length === 0, 'safety', d.missing.slice(0, 20).join(' | '));
  c.check(`${label}: no file changed (${d.changed.length} changed)`, d.changed.length === 0, 'safety', d.changed.slice(0, 20).join(' | '));
  if (!allowNew) c.check(`${label}: unchanged (no new files)`, d.added.length === 0, 'safety', d.added.join(' | '));
  return d;
}

function finish(c: CaseRun) {
  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`)).toEqual([]);
}

test.describe.configure({ mode: 'default' });

test('3A seed: usenet download, mapping off, source removed and library copy kept', async () => {
  const c = new CaseRun('3A-usenet-mapping-off');
  await fakeArr.scenario('usenet-smoke');
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  c.save(
    'scenario.txt',
    [
      'Case 3A (also the library seed for cases 1, 4 and 5).',
      'Scenario usenet-smoke: one NZB release (fixture phm-m4b, generated tones) on indexer 2 via fake SABnzbd.',
      'SABnzbd client path mapping off. Indexer 2 "Remove after processing" on (saved through the indexer settings API).',
      `Trigger: POST /api/requests for ${book.title} (${book.asin}); search, grab, download, organize run for real.`,
      'Expect: /downloads/<nzb name> removed, /downloads kept, library .m4b present, nzo archived in SABnzbd.',
    ].join('\n') + '\n'
  );
  const before = snapshot(c, 'before');
  const since = markJobs();
  // Only this case's fake-client traffic: the recorder still holds the seed (3A) job and its legitimate history delete.
  const recSince = (await fakeArr.requests()).at(-1)?.seq ?? 0;
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitFor(
    'request downloaded/available',
    async () => {
      const s = psql(`select status from requests where id = ${sqlStr(requestId)}`);
      return ['downloaded', 'available'].includes(s) ? s : null;
    },
    { timeoutMs: 300_000, intervalMs: 3_000 }
  );
  await waitOrganized(since, requestId);
  await new Promise((r) => setTimeout(r, 2000));
  snapshot(c, 'after');
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(requestId)}\n`);

  const recs = await fakeArr.requests(recSince);
  const add = recs.find((r) => r.service === 'sab' && r.added?.some((a) => a.nzoId));
  const nzoId = add?.added?.find((a) => a.nzoId)?.nzoId || '';
  const nzbName = book.title;
  const dh = psql(`select download_path, download_status from download_history where request_id = ${sqlStr(requestId)} order by created_at desc limit 1`).split('\t');
  const dirs = sh(`find ${q(MEDIA)} -name '*.m4b' -size +0 -printf '%h\\n' | sort -u`).split('\n').filter(Boolean);
  const L = dirs[0] || '';
  const state = await fakeArr.state();
  c.save('fake-sab-state.json', state.nzbs);
  const deletes = await sabHistoryDeletes(nzoId);
  c.save('sab-history-delete-requests.json', deletes);

  c.check(`/downloads/${nzbName} removed`, !exists(`/downloads/${nzbName}`), 'safety');
  c.check('/downloads still exists', exists('/downloads'), 'safety');
  c.check(`library holds one folder with a non-zero .m4b (${dirs.join(', ')})`, dirs.length === 1, 'safety');
  c.check(`SABnzbd history delete recorded for ${nzoId}`, !!nzoId && deletes.length > 0, 'control');
  c.check('nzo gone from SABnzbd history', !state.nzbs.history.some((h: any) => h.nzo_id === nzoId), 'control');
  c.check(`download_history path = /downloads/${nzbName} (${dh[0]})`, dh[0] === `/downloads/${nzbName}`, 'control');
  c.check(`download_history status completed (${dh[1]})`, dh[1] === 'completed', 'control');
  c.check(`log: Removing download files from filesystem: /downloads/${nzbName}`, has(events, `Removing download files from filesystem: /downloads/${nzbName}`), 'log');
  c.check(`log: Removed directory: /downloads/${nzbName}`, has(events, `Removed directory: /downloads/${nzbName}`), 'log');
  c.check(`log: Successfully post-processed download ${nzoId} via sabnzbd`, has(events, `Successfully post-processed download ${nzoId} via sabnzbd`), 'log');
  void before;

  // Seed for the later cases: a copy of the organized library inside the rmab container's own filesystem.
  sh(`rm -rf ${q(BACKUP)}\ncp -a ${q(MEDIA)} ${q(BACKUP)}`);
  const ids = psql(`select audiobook_id, user_id from requests where id = ${sqlStr(requestId)}`).split('\t');
  const s: Seed = { requestId, audiobookId: ids[0], userId: ids[1], L, nzoId, nzbName, audio: L ? audioIn(L) : [] };
  fs.writeFileSync(SEED_FILE(), JSON.stringify(s, null, 2));
  c.save('seed.json', s);
  finish(c);
});

test('1A manual import of the library folder itself, cleanupSource off', async () => {
  const s = seed();
  const c = new CaseRun('1A-library-folder-cleanup-off');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  c.save('scenario.txt', `Case 1A. Seeded library folder L = ${s.L} (+ generated cover.jpg). The request's newest download_history row is the completed usenet download (remove after processing on).\nTrigger: manual import folderPath = L, cleanupSource = false, no selectedFiles.\nExpect: /media unchanged, cover.jpg non-zero, no new SABnzbd history delete.\n`);
  const before = snapshot(c, 'before');
  const { events, newSabDeletes } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: s.L, cleanupSource: false });
  const after = snapshot(c, 'after');
  compare(c, before, after);
  c.check(`cover.jpg size > 0 (${fileSize(`${s.L}/cover.jpg`)})`, fileSize(`${s.L}/cover.jpg`) > 0, 'safety');
  c.check(`no new SABnzbd history delete (${newSabDeletes})`, newSabDeletes === 0, 'safety');
  c.check('log: Not a download RMAB completed (manual or bulk import), skipping download cleanup', has(events, 'Not a download RMAB completed (manual or bulk import), skipping download cleanup'), 'log');
  for (const f of s.audio) c.check(`log: Already in place, skipping copy: ${f}`, count(events, `Already in place, skipping copy: ${f}`) === 1, 'log');
  c.check('log: Cover art already in place, skipping copy', has(events, 'Cover art already in place, skipping copy'), 'log');
  c.check(`log absent: Removing download files from filesystem: ${s.L}`, !has(events, `Removing download files from filesystem: ${s.L}`), 'safety');
  c.check(`log absent: Removed directory: ${s.L}`, !has(events, `Removed directory: ${s.L}`), 'safety');
  finish(c);
});

test('1B manual import of the library folder itself, cleanupSource on with selectedFiles (what the UI sends)', async () => {
  const s = seed();
  const c = new CaseRun('1B-library-folder-cleanup-on');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  c.save('scenario.txt', `Case 1B. L = ${s.L} (+ cover.jpg). Trigger: manual import folderPath = L, cleanupSource = true, selectedFiles = ${JSON.stringify(s.audio)}.\nExpect: /media unchanged; WARN "Kept <n> source file(s) that are part of the import target".\n`);
  const before = snapshot(c, 'before');
  const { events, newSabDeletes } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: s.L, cleanupSource: true, selectedFiles: s.audio });
  const after = snapshot(c, 'after');
  compare(c, before, after);
  c.check(`no new SABnzbd history delete (${newSabDeletes})`, newSabDeletes === 0, 'safety');
  c.check(`log (WARN): Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`, has(events, `Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`, 'warn'), 'log');
  c.check('log: Not a download RMAB completed (manual or bulk import), skipping download cleanup', has(events, 'Not a download RMAB completed (manual or bulk import), skipping download cleanup'), 'log');
  for (const f of s.audio) c.check(`log: Already in place, skipping copy: ${f}`, has(events, `Already in place, skipping copy: ${f}`), 'log');
  c.check('log: Cover art already in place, skipping copy', has(events, 'Cover art already in place, skipping copy'), 'log');
  finish(c);
});

test('1C manual import of the media library root, cleanupSource off', async () => {
  const s = seed();
  const c = new CaseRun('1C-media-root');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  // The browser only offers "Select This Folder" where audio files are listed, so the root gets one loose file
  // (a byte copy of the generated seed audio).
  const loose = 'loose-phm.m4b';
  asApp(`cp ${q(`${s.L}/${s.audio[0]}`)} ${q(`${MEDIA}/${loose}`)}`);
  c.save('scenario.txt', `Case 1C. Media library root = ${MEDIA} (configured media_dir) holding L = ${s.L} (+ cover.jpg) and a loose generated file ${loose}.\nTrigger: manual import folderPath = ${MEDIA}, cleanupSource = false, selectedFiles = ["${loose}"].\nExpect: every file under /media before the trigger still present with the same sha (new files allowed).\n`);
  const before = snapshot(c, 'before');
  const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: MEDIA, cleanupSource: false, selectedFiles: [loose] });
  const after = snapshot(c, 'after');
  compare(c, before, after, { allowNew: true });
  c.check(`${MEDIA} still exists`, exists(MEDIA), 'safety');
  c.check('log: Not a download RMAB completed (manual or bulk import), skipping download cleanup', has(events, 'Not a download RMAB completed (manual or bulk import), skipping download cleanup'), 'log');
  finish(c);
});

test('1D download path that resolves to the library through a symlink', async () => {
  const s = seed();
  const c = new CaseRun('1D-symlink-into-library');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  c.save('indexer-config-off.json', await setRemoveAfterProcessing(rmab, 2, false));
  try {
    asApp(`ln -s ${q(s.L)} /downloads/linked-book`);
    c.save('scenario.txt', `Case 1D. Indexer 2 "Remove after processing" OFF (isolates source cleanup). /downloads/linked-book -> ${s.L} (symlink, created as ${PUID}:${PGID}).\nTrigger: manual import folderPath = /downloads/linked-book, cleanupSource = true, selectedFiles = ${JSON.stringify(s.audio)}.\nExpect: /media unchanged, /downloads/linked-book still exists, "Kept <n> source file(s)" logged.\n`);
    const before = snapshot(c, 'before');
    const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: '/downloads/linked-book', cleanupSource: true, selectedFiles: s.audio });
    const after = snapshot(c, 'after');
    compare(c, before, after);
    c.check('/downloads/linked-book still exists', exists('/downloads/linked-book'), 'safety');
    c.check(`log: Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`, has(events, `Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`), 'log');
  } finally {
    c.save('indexer-config-restored.json', await setRemoveAfterProcessing(rmab, 2, true));
  }
  finish(c);
});

test('1E download path that reaches the library through a second bind mount of the media volume', async () => {
  // The second mount comes from the media-bind compose override; without it there is nothing to test
  test.skip(!sh(`grep -E ' ${BIND} ' /proc/self/mountinfo || true`).trim(), 'needs --overrides media-bind');
  const s = seed();
  const c = new CaseRun('1E-second-bind-path');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  const viaBind = `${BIND}/${s.L.replace(/^\/media\//, '')}`;
  const mounts = sh(`grep -E ' (/media|${BIND}) ' /proc/self/mountinfo || true`);
  c.save('mounts.txt', mounts);
  c.save('scenario.txt', `Case 1E. Compose override mounts the same named media volume in rmab at /media and at ${BIND}.\nThe two spellings share no path prefix and no symlink; only dev+inode identity connects them.\nTrigger: manual import folderPath = ${viaBind}, cleanupSource = true, selectedFiles = ${JSON.stringify(s.audio)}. Remove after processing on.\nExpect: /media unchanged; "Kept <n> source file(s)" logged.\n`);
  const bindOk = exists(viaBind) && sh(`stat -c '%d:%i' ${q(viaBind)}`).trim() === sh(`stat -c '%d:%i' ${q(s.L)}`).trim();
  c.check(`${viaBind} is the same directory as L (dev:inode)`, bindOk, 'control');
  if (bindOk) {
    const before = snapshot(c, 'before');
    const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: viaBind, cleanupSource: true, selectedFiles: s.audio });
    const after = snapshot(c, 'after');
    compare(c, before, after);
    c.check(`${viaBind} still exists`, exists(viaBind), 'safety');
    c.check(`log: Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`, has(events, `Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`), 'log');
  }
  finish(c);
});

/** Case 4 state: the organized audio renamed to Book.m4b, plus cover.jpg. */
function prepareBookM4b(s: Seed) {
  restoreLibrary();
  asApp(`mv ${q(`${s.L}/${s.audio[0]}`)} ${q(`${s.L}/Book.m4b`)}`);
  addCover(s.L);
}

test('4A in-place re-import into a folder that holds Book.m4b, cleanupSource on', async () => {
  const s = seed();
  const c = new CaseRun('4A-reimport-in-place');
  const rmab = await Rmab.loginAdmin();
  prepareBookM4b(s);
  c.save('scenario.txt', `Case 4A. L = ${s.L} with the organized audio renamed to Book.m4b, plus cover.jpg.\nTrigger: manual import folderPath = L, cleanupSource = true, selectedFiles = ["Book.m4b"].\nExpect: Book.m4b and cover.jpg present with the same sha; in-place skips and "Kept 1 source file(s)" logged.\n`);
  const before = snapshot(c, 'before');
  const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: s.L, cleanupSource: true, selectedFiles: ['Book.m4b'] });
  const after = snapshot(c, 'after');
  compare(c, before, after);
  const book = `${s.L}/Book.m4b`;
  const cover = `${s.L}/cover.jpg`;
  c.check('Book.m4b present, same sha', !!before.media[book] && after.media[book] === before.media[book], 'safety');
  c.check(`cover.jpg present, non-zero (${fileSize(cover)}), same sha`, fileSize(cover) > 0 && after.media[cover] === before.media[cover], 'safety');
  c.check('log: Already in place, skipping copy: Book.m4b', has(events, 'Already in place, skipping copy: Book.m4b'), 'log');
  c.check('log: Cover art already in place, skipping copy', has(events, 'Cover art already in place, skipping copy'), 'log');
  c.check(`log: Kept 1 source file(s) that are part of the import target ${s.L}: Book.m4b`, has(events, `Kept 1 source file(s) that are part of the import target ${s.L}: Book.m4b`), 'log');
  finish(c);
});

test('4B import from a separate staging folder into a folder that holds Book.m4b, cleanupSource on', async () => {
  const s = seed();
  const c = new CaseRun('4B-reimport-from-staging');
  const rmab = await Rmab.loginAdmin();
  prepareBookM4b(s);
  // Generated fixture audio copied inside the stack (fake-arr holds the fixtures; both share /downloads).
  sh(`mkdir -p /downloads/manual/phm\nf=$(find /fixtures/phm-m4b -name '*.m4b' | head -1)\ncp "$f" '/downloads/manual/phm/Part 1.m4b'\nchown -R ${PUID}:${PGID} /downloads/manual`, { service: 'fake-arr' });
  c.save('scenario.txt', `Case 4B. L = ${s.L} holds Book.m4b + cover.jpg. Staged /downloads/manual/phm/Part 1.m4b (fixture phm-m4b, generated).\nTrigger: manual import folderPath = /downloads/manual/phm, cleanupSource = true, selectedFiles = ["Part 1.m4b"].\nExpect: Book.m4b same sha, imported file appears in L, staged file removed, /downloads kept.\n`);
  const before = snapshot(c, 'before');
  const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: '/downloads/manual/phm', cleanupSource: true, selectedFiles: ['Part 1.m4b'] });
  const after = snapshot(c, 'after');
  const d = compare(c, before, after, { allowNew: true });
  const book = `${s.L}/Book.m4b`;
  c.check('Book.m4b present, same sha', !!before.media[book] && after.media[book] === before.media[book], 'safety');
  const newInL = d.added.filter((p) => p.startsWith(`${s.L}/`));
  c.check(`imported file appears in L (${newInL.join(', ')})`, newInL.length > 0, 'control');
  c.check('/downloads/manual/phm/Part 1.m4b removed', !exists('/downloads/manual/phm/Part 1.m4b'), 'control');
  c.check('/downloads still exists', exists('/downloads'), 'safety');
  c.check('log: Not a download RMAB completed (manual or bulk import), skipping download cleanup', has(events, 'Not a download RMAB completed (manual or bulk import), skipping download cleanup'), 'log');
  c.check('log absent: Refusing to delete', !has(events, 'Refusing to delete'), 'log');
  finish(c);
});

test('5A manual import from an audiobook folder that also holds EPUBs', async () => {
  const s = seed();
  const c = new CaseRun('5A-audiobook-folder-with-epubs');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary();
  addCover(s.L);
  addEpub(s.L, 'a-other.epub');
  addEpub(s.L, 'b-this.epub');
  c.save('scenario.txt', `Case 5A. L = ${s.L} + cover.jpg + generated a-other.epub, b-this.epub (Kindle fix off).\nTrigger: manual import (audiobook id) folderPath = L, cleanupSource = true, selectedFiles = ${JSON.stringify(s.audio)}.\nExpect: /media unchanged (audio, cover, both EPUBs); "Kept <n> source file(s)" logged.\n`);
  const before = snapshot(c, 'before');
  const { events } = await manualImport(c, rmab, { audiobookId: s.audiobookId, folderPath: s.L, cleanupSource: true, selectedFiles: s.audio });
  const after = snapshot(c, 'after');
  compare(c, before, after);
  c.check(`log: Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`, has(events, `Kept ${s.audio.length} source file(s) that are part of the import target ${s.L}: ${s.audio.join(', ')}`), 'log');
  finish(c);
});

/** Create an ebook request for the seeded audiobook and queue organize_files exactly as JobQueueService.addJob does. */
function queueEbookOrganize(c: CaseRun, s: Seed, downloadPath: string) {
  const reqId = psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(s.userId)}, ${sqlStr(s.audiobookId)}, 'ebook', 'downloaded', 100, now(), now()) returning id`
  ).split('\n')[0];
  const payload = { requestId: reqId, audiobookId: s.audiobookId, downloadPath, cleanupSource: true };
  // Same shape as JobQueueService.addJob, with the Bull job id chosen up front so the app's
  // completion handler can find the DB row as soon as the job finishes.
  const bullId = `e2e-242-${Date.now()}`;
  const jobId = psql(
    `insert into jobs (id, bull_job_id, request_id, type, status, priority, payload, max_attempts, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(bullId)}, ${sqlStr(reqId)}, 'organize_files', 'pending', 8, ${sqlStr(JSON.stringify(payload))}::jsonb, 3, now(), now()) returning id`
  ).split('\n')[0];
  const js = `const Q=require('bull');const q=new Q('audiobook-jobs',process.env.REDIS_URL||'redis://127.0.0.1:6379');q.add('organize_files',${JSON.stringify({ ...payload, jobId })},{priority:8,jobId:${JSON.stringify(bullId)}}).then(j=>{console.log(j.id);return q.close();}).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});`;
  const added = sh(`cd /app && node -e ${q(js)}`).trim().split('\n').pop() || '';
  c.check(`Bull accepted the job (${added})`, added === bullId, 'control');
  c.save('trigger.json', { ebookRequestId: reqId, jobId, bullJobId: bullId, queue: 'audiobook-jobs', name: 'organize_files', payload });
  return reqId;
}

test('5B ebook organize from a media folder holding two EPUBs removes only the imported one', async () => {
  const s = seed();
  const c = new CaseRun('5B-ebook-two-epubs');
  restoreLibrary();
  const src = `${MEDIA}/Unsorted/Ebooks`;
  addEpub(src, 'a-other.epub');
  addEpub(src, 'b-this.epub');
  c.save('bull-check.txt', sh(`cd /app && node -e "console.log(require.resolve('bull'))" 2>&1 || true`));
  c.save('scenario.txt', `Case 5B. Source ${src} with generated a-other.epub and b-this.epub (Kindle fix off).\nTrigger: an ebook request for the seeded book (SQL insert, no UI path) and an organize_files job queued on the app's Bull queue with downloadPath = ${src}, cleanupSource = true.\nExpect: exactly the EPUB named in "Found ebook file" removed; the other unchanged; ebook target holds the imported copy.\n`);
  const before = snapshot(c, 'before');
  const since = markJobs();
  const reqId = queueEbookOrganize(c, s, src);
  try {
    c.save('organize-jobs.json', await waitOrganized(since, reqId));
  } catch (error) {
    c.check('organize job finished in time', false, 'control', String(error));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(reqId)}\n`);
  const after = snapshot(c, 'after');
  const found = /Found ebook file: (.+)$/.exec(events.find((e) => e.message.startsWith('Found ebook file: '))?.message || '')?.[1] || '';
  const other = ['a-other.epub', 'b-this.epub'].find((n) => n !== found) || '';
  const d = diffShas(before.media, after.media);
  c.save('media-diff.json', d);
  c.check(`imported EPUB identified by the log (${found || 'none'})`, !!found, 'control');
  c.check(`${found} removed from ${src}`, !!found && !exists(`${src}/${found}`), 'control');
  c.check(`${other} still present, same sha`, !!other && after.media[`${src}/${other}`] === before.media[`${src}/${other}`], 'safety');
  c.check(`ebook target holds the imported file (${s.L}/${found})`, !!found && exists(`${s.L}/${found}`), 'control');
  const unexpectedMissing = d.missing.filter((p) => p !== `${src}/${found}`);
  c.check(`every other /media file unchanged (${unexpectedMissing.length} missing, ${d.changed.length} changed)`, unexpectedMissing.length === 0 && d.changed.length === 0, 'safety', [...unexpectedMissing, ...d.changed].join(' | '));
  c.check(`log: Removed 1 selected source files from ${src}`, has(events, `Removed 1 selected source files from ${src}`), 'log');
  finish(c);
});

test('5C ebook re-import where the ebook target is the folder that holds the audiobook', async () => {
  const s = seed();
  const c = new CaseRun('5C-ebook-target-is-audiobook-folder');
  restoreLibrary();
  addCover(s.L);
  addEpub(s.L, 'Book.epub');
  psql(
    `insert into configuration (id, key, value, created_at, updated_at) values (gen_random_uuid(), 'ebook_path_template', '{author}/{title} {asin}', now(), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`
  );
  c.save('scenario.txt', `Case 5C. ebook_path_template = {author}/{title} {asin}, so the ebook target is L = ${s.L}, which holds the audiobook, cover.jpg and a generated Book.epub.\nTrigger: ebook request + organize_files job (Bull) with downloadPath = L, cleanupSource = true.\nExpect: /media unchanged; "Kept 1 source file(s) that are part of the import target <L>: Book.epub".\n`);
  const before = snapshot(c, 'before');
  const since = markJobs();
  const reqId = queueEbookOrganize(c, s, s.L);
  try {
    c.save('organize-jobs.json', await waitOrganized(since, reqId));
  } catch (error) {
    c.check('organize job finished in time', false, 'control', String(error));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(reqId)}\n`);
  const after = snapshot(c, 'after');
  compare(c, before, after);
  c.check(`log: Kept 1 source file(s) that are part of the import target ${s.L}: Book.epub`, has(events, `Kept 1 source file(s) that are part of the import target ${s.L}: Book.epub`), 'log');
  finish(c);
});

test('1F completed usenet download whose stored path resolves into the media library', async () => {
  const c = new CaseRun('1F-download-resolves-into-library');
  // Save the fake-client log of the earlier cases (a scenario load keeps the recorder; only POST /__control/reset clears it).
  evidencePath('242/fake-arr-requests-before-1F.json');
  fs.writeFileSync(evidencePath('242/fake-arr-requests-before-1F.json'), JSON.stringify(await fakeArr.requests(), null, 2));
  restoreLibrary();
  const name = 'Martian Incoming';
  const def = {
    name: 'usenet-incoming-242',
    description: 'One NZB release for book martian (fixture martian-m4b, generated tones) via fake SABnzbd.',
    book: 'martian',
    indexers: [{ id: 2, name: 'E2E Usenet', protocol: 'usenet', priority: 25 }],
    releases: [{ id: 'nzb-incoming', protocol: 'usenet', indexerId: 2, name, title: '{{author}} - {{title}} (Unabridged) [M4B]', sizeMB: 380, fixture: 'martian-m4b' }],
  };
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(res.ok).toBe(true);
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  const incoming = `${MEDIA}/incoming/${name}`;
  // SABnzbd's completed folder for this job is a link into the library (RMAB's own category sync keeps SAB on /downloads).
  asApp(`mkdir -p ${q(incoming)}\nln -s ${q(incoming)} ${q(`/downloads/${name}`)}`);
  const book = (await fakeArr.books()).martian;
  c.save('scenario.txt', `Case 1F. Inline scenario ${def.name}: NZB "${name}" for ${book.title} via fake SABnzbd, indexer 2 remove after processing on, mapping off.\nSABnzbd stores the job at /downloads/${name}, which is a symlink to ${incoming} (inside the media library).\nTrigger: POST /api/requests for ${book.title}; the download completes and is organized for real.\nExpect: ${incoming} kept with its files, no SABnzbd history delete for the nzo, "Download cleanup skipped: Refusing to delete ... it is inside the media library".\n`);
  c.save('scenario-definition.json', def);
  const before = snapshot(c, 'before');
  const since = markJobs();
  // Only this case's fake-client traffic: the recorder still holds the seed (3A) job and its legitimate history delete.
  const recSince = (await fakeArr.requests()).at(-1)?.seq ?? 0;
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitFor('request downloaded/available', async () => ['downloaded', 'available'].includes(psql(`select status from requests where id = ${sqlStr(requestId)}`)) || null, { timeoutMs: 300_000, intervalMs: 3_000 });
  await waitOrganized(since, requestId);
  await new Promise((r) => setTimeout(r, 2000));
  const after = snapshot(c, 'after');
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(requestId)}\n`);
  const recs = await fakeArr.requests(recSince);
  const nzoId = recs.find((r) => r.service === 'sab' && r.added?.some((a) => a.nzoId))?.added?.find((a) => a.nzoId)?.nzoId || '';
  const deletes = await sabHistoryDeletes(nzoId);
  c.save('sab-history-delete-requests.json', deletes);
  c.save('fake-sab-state.json', (await fakeArr.state()).nzbs);
  const incomingFiles = Object.keys(after.media).filter((p) => p.startsWith(`${incoming}/`));
  c.check(`${incoming} still exists with its files (${incomingFiles.length})`, exists(incoming) && incomingFiles.length > 0, 'safety');
  c.check(`/downloads/${name} (link) still exists`, exists(`/downloads/${name}`), 'control');
  c.check(`no SABnzbd history delete for ${nzoId} (${deletes.length})`, !!nzoId && deletes.length === 0, 'safety');
  c.check(`log: Download cleanup skipped: Refusing to delete /downloads/${name}: it is inside the media library`, has(events, `Download cleanup skipped: Refusing to delete /downloads/${name}: it is inside the media library`), 'log');
  const martianDirs = sh(`find ${q(MEDIA)} -path ${q(`${MEDIA}/incoming`)} -prune -o -name '*.m4b' -size +0 -printf '%h\\n' | sort -u`).split('\n').filter((d) => d && !d.startsWith(s0()));
  c.check(`library copy organized (${martianDirs.join(', ')})`, martianDirs.length > 0, 'control');
  void before;
  finish(c);
});

/** The seeded phm folder (so 1F can tell the martian folder apart). */
function s0() {
  return seed().L;
}
