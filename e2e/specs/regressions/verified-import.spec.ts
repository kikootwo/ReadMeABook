/**
 * Component: E2E verified-import cleanup (delete only what verifiably reached the library), cases 1-6
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Seed: scenario usenet-smoke (fake SABnzbd, indexer 2, "Remove after processing" on) imports book phm
 * into the library L; a copy of /media taken inside rmab restores L before every case. Cases trigger
 * real manual imports (POST /api/admin/manual-import, as the UI does) or a real usenet download, and
 * check files on the stack's volumes by sha256. Checks are recorded per case in
 * <evidence>/verified-import/<case>/result.json; a test fails when any check fails.
 *
 * Case 3 (interrupted copy) freezes the app's node process with SIGSTOP the moment a partial file
 * appears in L (a watcher inside rmab; a host-side `docker pause` cannot react within the copy), checks
 * the frozen state, then SIGKILLs it. supervisord restarts the app and Bull re-runs the stalled job.
 * This tests the rename-into-place protocol and re-run recovery, not fsync durability.
 */

import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { evidencePath, waitFor, fakeArr, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { markJobs, newJobsWhere, exists, setRemoveAfterProcessing } from './242-helpers';
import {
  MEDIA, sh, asApp, q, psql, sqlStr, eventsSince, fmtEvents, sabHistoryDeletes, requestState,
  Evidence, has, fixtureFiles, stageFixture, sha, isSymlink, partialsIn, setTagging, appPid, startDetached,
  readOut, restoreLibrary, saveState, manualImport, requestError, waitRequestDone, waitOrganized,
} from './verified-import-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const BACKUP = '/tmp/rmab-e2e-verified-backup';
const SEED_FILE = () => evidencePath('verified-import/seed.json');

interface Seed {
  audiobookId: string;
  L: string;
  /** The organized audio file in L. */
  file: string;
}

const seed = (): Seed => {
  if (!fs.existsSync(SEED_FILE())) throw new Error('seed missing: the seed test did not complete');
  return JSON.parse(fs.readFileSync(SEED_FILE(), 'utf8'));
};

function finish(e: Evidence) {
  expect(e.finish()).toEqual([]);
}

test.describe.configure({ mode: 'default' });

test('seed: usenet download of phm into the library', async () => {
  const e = new Evidence('seed');
  await fakeArr.scenario('usenet-smoke');
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  e.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  const since = markJobs();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitRequestDone(requestId);
  await waitOrganized(since, requestId);
  const L = sh(`find ${q(MEDIA)} -name '*.m4b' -size +0 -printf '%h\\n' | sort -u`).split('\n').filter(Boolean)[0] || '';
  const file = L ? sh(`find ${q(L)} -maxdepth 1 -name '*.m4b' -printf '%f\\n' | sort | head -1`).trim() : '';
  const audiobookId = psql(`select audiobook_id from requests where id = ${sqlStr(requestId)}`);
  e.save('rmab-job-events.log', `${fmtEvents(eventsSince(since))}\n`);
  e.check(`library folder found (${L})`, !!L && !!file, 'control');
  sh(`rm -rf ${q(BACKUP)}\ncp -a ${q(MEDIA)} ${q(BACKUP)}`);
  const s: Seed = { audiobookId, L, file };
  fs.writeFileSync(SEED_FILE(), JSON.stringify(s, null, 2));
  e.save('seed.json', s);
  finish(e);
});

test('4 truncated library file from an older version is re-copied, then the source is removed', async () => {
  const s = seed();
  const e = new Evidence('4-truncated-target');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary(BACKUP);
  setTagging(false);
  const src = '/downloads/manual/trunc';
  asApp(`mkdir -p ${q(src)}\ncp ${q(`${s.L}/${s.file}`)} ${q(`${src}/${s.file}`)}`);
  const full = sha(`${src}/${s.file}`);
  asApp(`size=$(stat -c %s ${q(`${s.L}/${s.file}`)})\nhead -c $((size / 2)) ${q(`${s.L}/${s.file}`)} > /tmp/rmab-e2e-half\ncat /tmp/rmab-e2e-half > ${q(`${s.L}/${s.file}`)}\nrm -f /tmp/rmab-e2e-half`);
  e.save('scenario.txt', `Case 4. L/${s.file} truncated to half its size in place (a prefix of the source). Staged full copy at ${src}/${s.file}. Tagging off (so the placed bytes are the source bytes).\nTrigger: manual import ${src}, cleanupSource on, selectedFiles [${s.file}].\nExpect: L/${s.file} re-copied (sha equal to the source), source removed afterwards.\nOn main 6d23138: the truncated file counts as "already exists", is kept, and the source is deleted.\n`);
  saveState(e, 'before', [s.L, src]);
  const since = markJobs();
  const { events } = await manualImport(e, rmab, since, { audiobookId: s.audiobookId, folderPath: src, cleanupSource: true, selectedFiles: [s.file] });
  saveState(e, 'after', [s.L, '/downloads/manual']);
  e.check(`L/${s.file} sha equals the full source`, sha(`${s.L}/${s.file}`) === full, 'safety');
  e.check('source removed after a verified copy', !exists(`${src}/${s.file}`), 'safety');
  e.check(`no partial file left in L (${partialsIn(s.L).join(', ')})`, partialsIn(s.L).length === 0, 'safety');
  e.check(`log: Copied: ${s.file}`, has(events, `Copied: ${s.file}`), 'log');
  setTagging(true);
  finish(e);
});

test('5 same-named library file with different bytes is never overwritten and keeps the source; identical bytes allow removal', async () => {
  const s = seed();
  const e = new Evidence('5-same-name');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary(BACKUP);
  setTagging(false);
  const libSha = sha(`${s.L}/${s.file}`);
  const diff = '/downloads/manual/samename';
  const same = '/downloads/manual/identical';
  asApp(
    [
      `mkdir -p ${q(diff)} ${q(same)}`,
      `ffmpeg -nostdin -loglevel error -f lavfi -i sine=frequency=880:duration=6 -c:a aac -b:a 64k -f mp4 -y ${q(`${diff}/${s.file}`)}`,
      `cp ${q(`${s.L}/${s.file}`)} ${q(`${same}/${s.file}`)}`,
    ].join('\n')
  );
  const diffSha = sha(`${diff}/${s.file}`);
  e.save('scenario.txt', `Case 5. L/${s.file} exists. A: ${diff}/${s.file} is a different generated tone with the same name. B: ${same}/${s.file} is a byte copy of the library file. Tagging off.\nTriggers: manual import A, then B; cleanupSource on, selectedFiles [${s.file}].\nExpect A: library file untouched, source kept, "Not imported, left untouched". Expect B: library file untouched, source removed.\nOn main 6d23138: A's copy is skipped by name and the source is deleted anyway.\n`);
  saveState(e, 'before', [s.L, '/downloads/manual']);

  const sinceA = markJobs();
  const a = await manualImport(e, rmab, sinceA, { audiobookId: s.audiobookId, folderPath: diff, cleanupSource: true, selectedFiles: [s.file] });
  e.save('rmab-job-events-A.log', `${fmtEvents(a.events)}\n`);
  e.check('A: library file unchanged', sha(`${s.L}/${s.file}`) === libSha, 'safety');
  e.check('A: different-content source kept', exists(`${diff}/${s.file}`) && sha(`${diff}/${s.file}`) === diffSha, 'safety');
  e.check(`log A: Not imported, left untouched: ${s.file}`, has(a.events, `Not imported, left untouched: ${s.file}`), 'log');

  const sinceB = markJobs();
  const b = await manualImport(e, rmab, sinceB, { audiobookId: s.audiobookId, folderPath: same, cleanupSource: true, selectedFiles: [s.file] });
  e.save('rmab-job-events-B.log', `${fmtEvents(b.events)}\n`);
  saveState(e, 'after', [s.L, '/downloads/manual']);
  e.check('B: library file unchanged', sha(`${s.L}/${s.file}`) === libSha, 'safety');
  e.check('B: identical source removed', !exists(`${same}/${s.file}`), 'control');
  setTagging(true);
  finish(e);
});

test('6 library entry that is a symlink to a seeding file is left alone by an in-place re-import', async () => {
  const s = seed();
  const e = new Evidence('6-symlinked-library-entry');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary(BACKUP);
  const seedDir = '/downloads/seed';
  asApp(`mkdir -p ${q(seedDir)}\nmv ${q(`${s.L}/${s.file}`)} ${q(`${seedDir}/${s.file}`)}\nln -s ${q(`${seedDir}/${s.file}`)} ${q(`${s.L}/${s.file}`)}`);
  const seedSha = sha(`${seedDir}/${s.file}`);
  e.save('scenario.txt', `Case 6. L/${s.file} is a symlink to ${seedDir}/${s.file} (a seeding copy).\nTrigger: manual import folderPath L (in place), cleanupSource on, selectedFiles [${s.file}].\nExpect: L/${s.file} still a symlink to the seeding file; the seeding file unchanged.\nOn v1.2.4 / main 6d23138: the link is unlinked (the guard checked only the link's target).\n`);
  saveState(e, 'before', [s.L, seedDir]);
  const since = markJobs();
  const { events } = await manualImport(e, rmab, since, { audiobookId: s.audiobookId, folderPath: s.L, cleanupSource: true, selectedFiles: [s.file] });
  saveState(e, 'after', [s.L, seedDir]);
  e.check(`L/${s.file} is still a symlink`, isSymlink(`${s.L}/${s.file}`), 'safety');
  e.check('symlink still points at the seeding file', sh(`readlink ${q(`${s.L}/${s.file}`)} || true`).trim() === `${seedDir}/${s.file}`, 'safety');
  e.check('seeding file unchanged', exists(`${seedDir}/${s.file}`) && sha(`${seedDir}/${s.file}`) === seedSha, 'safety');
  e.check(`log: Not imported, left untouched: ${s.file} (existing target is not a regular file)`, has(events, `Not imported, left untouched: ${s.file} (existing target is not a regular file)`), 'log');
  finish(e);
});

test('2 manual import with selected files removes only the files verified in the library', async () => {
  const s = seed();
  const e = new Evidence('2-manual-partial');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary(BACKUP);
  const src = '/downloads/manual/partial';
  stageFixture('phm-mp3', src);
  const files = fixtureFiles('phm-mp3');
  const blocked = files[1];
  sh(`chmod 000 ${q(`${src}/${blocked}`)}`);
  e.save('scenario.txt', `Case 2. Staged fixture phm-mp3 (${files.join(', ')}) at ${src}; ${blocked} made unreadable for the app user (chmod 000 as root).\nTrigger: manual import ${src}, cleanupSource on, selectedFiles = all ${files.length}.\nExpect: the readable files removed after their copies are verified; ${blocked} kept; warning lists it; request shows "1 of ${files.length} files not imported".\nOn main 6d23138: every selected file is unlinked, including the one never imported.\n`);
  saveState(e, 'before', [src]);
  const since = markJobs();
  const { events, requestId } = await manualImport(e, rmab, since, { audiobookId: s.audiobookId, folderPath: src, cleanupSource: true, selectedFiles: files });
  saveState(e, 'after', [s.L, '/downloads/manual']);
  for (const f of files.filter((n) => n !== blocked)) e.check(`${f} removed`, !exists(`${src}/${f}`), 'control');
  e.check(`${blocked} (not imported) kept`, exists(`${src}/${blocked}`), 'safety');
  e.check(`log: Kept 1 source file(s) not verified in the library: ${blocked}`, has(events, `Kept 1 source file(s) not verified in the library: ${blocked}`), 'log');
  const r = requestId ? requestError(requestId) : { status: '', errorMessage: '' };
  e.check(`request message "1 of ${files.length} files not imported; source files kept" (${r.status}: ${r.errorMessage})`, r.errorMessage === `1 of ${files.length} files not imported; source files kept`, 'log');
  sh(`chmod 644 ${q(`${src}/${blocked}`)} 2>/dev/null || true`);
  finish(e);
});

test('3 interrupted copy: never a truncated file under the final name; the re-run completes it before the source goes', async () => {
  test.setTimeout(900_000);
  const s = seed();
  const e = new Evidence('3-interrupted-copy');
  const rmab = await Rmab.loginAdmin();
  restoreLibrary(BACKUP);
  setTagging(false);
  const src = '/downloads/manual/big';
  const name = 'Big Noise.flac';
  // About 600 MB of generated noise: incompressible, so the copy takes long enough to catch.
  asApp(`mkdir -p ${q(src)}\nffmpeg -nostdin -loglevel error -f lavfi -i anoisesrc=d=3600:sample_rate=44100:amplitude=0.5 -ac 2 -c:a flac -compression_level 0 -y ${q(`${src}/${name}`)}`);
  const srcSha = sha(`${src}/${name}`);
  const srcSize = Number(sh(`stat -c %s ${q(`${src}/${name}`)}`).trim());
  const pid = appPid();
  const out = '/tmp/rmab-e2e-freeze.out';
  const finalPath = `${s.L}/${name}`;
  startDetached(
    'rmab-e2e-freeze',
    [
      // Tight inner loop (shell builtins only); the clock is read every 5000 rounds
      `L=${q(s.L)}; FINAL=${q(finalPath)}; PID=${pid}; OUT=${q(out)}; END=$(( $(date +%s) + 300 ))`,
      'while [ "$(date +%s)" -lt "$END" ]; do',
      '  i=0',
      '  while [ $i -lt 5000 ]; do',
      '    i=$((i+1))',
      '    if [ -e "$FINAL" ]; then echo "final-first" > "$OUT"; exit 0; fi',
      '    for f in "$L"/.rmab-partial-*.part; do',
      '      if [ -f "$f" ]; then kill -STOP "$PID"; echo "frozen $f" > "$OUT"; exit 0; fi',
      '    done',
      '  done',
      'done',
      'echo "timeout" > "$OUT"',
    ].join('\n'),
    out
  );
  e.save('scenario.txt', `Case 3. Generated ${srcSize}-byte FLAC at ${src}/${name}; tagging off. A watcher inside rmab SIGSTOPs the app (pid ${pid}) the moment a partial appears in L, then the spec checks the frozen state and SIGKILLs it; supervisord restarts the app and Bull re-runs the stalled organize job.\nExpect while frozen: a partial in L, no ${name} under the final name, source present. Expect after the re-run: L/${name} sha equal to the source, no partial left, source removed only then.\nFAIL (not skip) if the final file appears before any partial.\nOn main 6d23138: the copy writes the final name directly, so the watcher sees the final file first.\n`);
  const since = markJobs();
  const res = await rmab.raw('POST', '/api/admin/manual-import', { audiobookId: s.audiobookId, folderPath: src, cleanupSource: true, selectedFiles: [name] });
  e.check(`manual import accepted (HTTP ${res.status})`, res.ok, 'control');
  const watch = await waitFor('watcher verdict', async () => readOut(out) || null, { timeoutMs: 300_000, intervalMs: 500 }).catch(() => 'no verdict');
  e.save('watcher.txt', `${watch}\n`);
  e.check(`a partial appeared before the final file (${watch})`, watch.startsWith('frozen '), 'safety');

  if (watch.startsWith('frozen ')) {
    const frozen = {
      partials: partialsIn(s.L),
      finalExists: exists(finalPath),
      sourceExists: exists(`${src}/${name}`),
      appState: sh(`grep '^State:' /proc/${pid}/status || true`).trim(),
    };
    e.save('frozen-state.json', frozen);
    e.check(`frozen: partial present in L (${frozen.partials.join(', ')})`, frozen.partials.length > 0, 'safety');
    e.check('frozen: no file under the final name', !frozen.finalExists, 'safety');
    e.check('frozen: source still present', frozen.sourceExists, 'safety');
    e.check(`frozen: app process stopped (${frozen.appState})`, /T \(stopped\)/.test(frozen.appState), 'control');
    sh(`kill -KILL ${pid}`);

    await waitFor(
      'app restarted and the organize job re-ran to completion',
      async () => {
        const done = exists(finalPath) && partialsIn(s.L).length === 0 && !exists(`${src}/${name}`);
        return done || null;
      },
      { timeoutMs: 600_000, intervalMs: 5_000 }
    ).catch((error) => e.check('re-run finished in time', false, 'control', String(error)));
    await new Promise((r) => setTimeout(r, 2_000));
    e.save('rmab-job-events.log', `${fmtEvents(eventsSince(since))}\n`);
    e.save('jobs.tsv', psql(`select id, status, attempts, coalesce(error_message,'') from jobs where type = 'organize_files' and ${newJobsWhere(since)}`));
    saveState(e, 'after', [s.L]);
    e.check(`after re-run: L/${name} sha equals the source`, exists(finalPath) && sha(finalPath) === srcSha, 'safety');
    e.check('after re-run: no partial file left in L', partialsIn(s.L).length === 0, 'safety');
    e.check('after re-run: source removed (only after the verified copy)', !exists(`${src}/${name}`), 'control');
  } else {
    // Never leave the app stopped
    sh(`kill -CONT ${pid} 2>/dev/null || true`);
  }
  setTagging(true);
  finish(e);
});

test('1 usenet download with one unreadable file: download and client history kept, partial import shown', async () => {
  const e = new Evidence('1-usenet-partial');
  const def = {
    name: 'verified-usenet-multi',
    book: 'martian',
    indexers: [{ id: 2, name: 'E2E Usenet', protocol: 'usenet', priority: 25 }],
    releases: [{ id: 'nzb-mp3', protocol: 'usenet', indexerId: 2, title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 300, fixture: 'martian-mp3' }],
  };
  const load = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(load.ok).toBe(true);
  e.save('scenario-definition.json', def);
  const book = (await fakeArr.books()).martian;
  const rmab = await Rmab.loginAdmin();
  e.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  const files = fixtureFiles('martian-mp3');
  const blocked = files[files.length - 1];
  const download = `/downloads/${book.title}`;
  const out = '/tmp/rmab-e2e-chmod.out';
  startDetached(
    'rmab-e2e-chmod',
    [
      `F=${q(`${download}/${blocked}`)}; OUT=${q(out)}; END=$(( $(date +%s) + 600 ))`,
      'while [ "$(date +%s)" -lt "$END" ]; do',
      '  i=0',
      '  while [ $i -lt 5000 ]; do',
      '    i=$((i+1))',
      '    if [ -f "$F" ]; then chmod 000 "$F"; echo "chmod $F" > "$OUT"; exit 0; fi',
      '  done',
      'done',
      'echo timeout > "$OUT"',
    ].join('\n'),
    out
  );
  e.save('scenario.txt', `Case 1. Inline scenario: usenet release of ${book.title} (fixture martian-mp3: ${files.join(', ')}) via fake SABnzbd, remove after processing on. A watcher makes ${blocked} unreadable (chmod 000 as root) the moment it lands in ${download}.\nTrigger: POST /api/requests; search, grab, download and organize run for real.\nExpect: the other files imported; ${download} kept with every file; no SABnzbd history delete; request downloaded with "1 of ${files.length} files not imported; source files kept"; WARN "Download cleanup skipped".\nOn main 6d23138: the download folder is removed although ${blocked} was never imported.\n`);
  const since = markJobs();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitRequestDone(requestId);
  await waitOrganized(since, requestId).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  e.save('watcher.txt', `${readOut(out)}\n`);
  const events = eventsSince(since);
  e.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  e.save('request-state.tsv', `${requestState(requestId)}\n`);
  saveState(e, 'after', [MEDIA, download]);
  // This case's NZB (the seed's own download was archived earlier in the run)
  const nzoId = (await fakeArr.requests()).flatMap((r) => (r.service === 'sab' ? r.added || [] : [])).find((a) => a.releaseId === 'nzb-mp3')?.nzoId || '';
  const deletes = await sabHistoryDeletes(nzoId);
  e.save('sab-history-delete-requests.json', deletes);
  const r = requestError(requestId);

  e.check(`watcher made ${blocked} unreadable before organize (${readOut(out)})`, readOut(out).startsWith('chmod '), 'control');
  for (const f of files) e.check(`${download}/${f} kept`, exists(`${download}/${f}`), 'safety');
  e.check(`no SABnzbd history delete for ${nzoId} (${deletes.length})`, !!nzoId && deletes.length === 0, 'safety');
  // The request message is set at import; library matching (status available) clears it later
  e.check(`request not failed (${r.status}: ${r.errorMessage})`, ['downloaded', 'available'].includes(r.status), 'control');
  e.check(`log (WARN): 1 of ${files.length} files not imported; source files kept`, has(events, `1 of ${files.length} files not imported; source files kept`, 'warn'), 'log');
  e.check(`log (WARN): Download cleanup skipped: 1 of ${files.length} files not verified in the library; download kept`, has(events, `Download cleanup skipped: 1 of ${files.length} files not verified in the library; download kept`, 'warn'), 'log');
  sh(`chmod 644 ${q(`${download}/${blocked}`)} 2>/dev/null || true`);
  finish(e);
});
