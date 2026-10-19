/**
 * Component: E2E regression #242 case 3B (usenet download with remote path mapping on)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Stack override: fake SABnzbd runs with DOWNLOADS_DIR=/sab-remote, the shared downloads volume
 * mounted there, so it reports storage /sab-remote/<name>. RMAB maps /sab-remote -> /downloads.
 * No-regression control: source removed, library copy kept, before and after.
 */

import { test, expect } from '@playwright/test';
import { waitFor, fakeArr, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { MEDIA, sh, q, psql, sqlStr, dbNow, listing, exists, eventsSince, fmtEvents, waitOrganized, sabHistoryDeletes, setRemoveAfterProcessing, requestState, CaseRun } from './242-helpers';

// Needs docker exec into the stack (sha256 snapshots, psql, symlinks, Bull): untainted runs only.
test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

test('3B usenet download with remote path mapping on: source removed, library copy kept', async () => {
  const c = new CaseRun('3B-usenet-mapping-on');
  await fakeArr.scenario('usenet-smoke');
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  c.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));
  const put = await rmab.raw('PUT', '/api/admin/settings/download-clients/e2e-sab', { remotePathMappingEnabled: true, remotePath: '/sab-remote', localPath: '/downloads' });
  c.save('sab-client-update.json', { status: put.status, body: await put.json().catch(() => ({})) });
  expect(put.ok).toBe(true);
  const sabConfig = await ctl('/state').then((r) => r.json());
  c.save('fake-sab-categories-before.json', sabConfig.sabCategories);
  c.save(
    'scenario.txt',
    `Case 3B. Scenario usenet-smoke. fake SABnzbd complete_dir = /sab-remote (compose override; same downloads volume). RMAB SABnzbd client: remote path mapping on, /sab-remote -> /downloads. Remove after processing on.\nTrigger: POST /api/requests for ${book.title}.\nExpect: as 3A, plus download_history.download_path = /downloads/<name> (mapped) and "Download completed" with organizePath "/downloads/<name> (mapped)".\n`
  );
  c.save('listing-before.txt', `# /media\n${listing('/media')}\n\n# /downloads\n${listing('/downloads')}\n`);
  const since = dbNow();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitFor('request downloaded/available', async () => ['downloaded', 'available'].includes(psql(`select status from requests where id = ${sqlStr(requestId)}`)) || null, { timeoutMs: 300_000, intervalMs: 3_000 });
  await waitOrganized(since, requestId);
  await new Promise((r) => setTimeout(r, 2000));

  const name = book.title;
  const events = eventsSince(since);
  c.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  c.save('request-state.tsv', `${requestState(requestId)}\n`);
  c.save('listing-after.txt', `# /media\n${listing('/media')}\n\n# /downloads\n${listing('/downloads')}\n`);
  const recs = await fakeArr.requests();
  const nzoId = recs.find((r) => r.service === 'sab' && r.added?.some((a) => a.nzoId))?.added?.find((a) => a.nzoId)?.nzoId || '';
  const deletes = await sabHistoryDeletes(nzoId);
  c.save('sab-history-delete-requests.json', deletes);
  const state = await fakeArr.state();
  c.save('fake-sab-state.json', { nzbs: state.nzbs, sabCategories: state.sabCategories });
  const dh = psql(`select download_path, download_status from download_history where request_id = ${sqlStr(requestId)} order by created_at desc limit 1`).split('\t');
  const dirs = sh(`find ${q(MEDIA)} -name '*.m4b' -size +0 -printf '%h\\n' | sort -u`).split('\n').filter(Boolean);

  c.check(`/downloads/${name} removed`, !exists(`/downloads/${name}`), 'safety');
  c.check('/downloads still exists', exists('/downloads'), 'safety');
  c.check(`library has a non-zero .m4b (${dirs.join(', ')})`, dirs.length === 1, 'safety');
  c.check(`SABnzbd history delete recorded for ${nzoId}`, !!nzoId && deletes.length > 0, 'control');
  c.check('nzo gone from SABnzbd history', !state.nzbs.history.some((h: any) => h.nzo_id === nzoId), 'control');
  c.check(`download_history path = /downloads/${name} (mapped; got ${dh[0]})`, dh[0] === `/downloads/${name}`, 'control');
  c.check(`download_history status completed (${dh[1]})`, dh[1] === 'completed', 'control');
  const completed = events.find((e) => e.message === 'Download completed');
  c.check(`log: Download completed, organizePath /downloads/${name} (mapped) (${completed?.metadata || 'absent'})`, !!completed && completed.metadata.includes(`/downloads/${name} (mapped)`), 'log');
  c.check(`log: Removing download files from filesystem: /downloads/${name}`, events.some((e) => e.message.includes(`Removing download files from filesystem: /downloads/${name}`)), 'log');
  c.check(`log: Removed directory: /downloads/${name}`, events.some((e) => e.message.includes(`Removed directory: /downloads/${name}`)), 'log');
  c.check(`log: Successfully post-processed download ${nzoId} via sabnzbd`, events.some((e) => e.message.includes(`Successfully post-processed download ${nzoId} via sabnzbd`)), 'log');

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
