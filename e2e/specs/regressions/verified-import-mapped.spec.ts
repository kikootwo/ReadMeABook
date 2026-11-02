/**
 * Component: E2E verified-import cleanup case 7 (broad mapped client path never bounds the parent sweep)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Stack override sab-remote: fake SABnzbd sees the shared downloads volume at /sab-remote. RMAB maps
 * /sab-remote -> /downloads (a broad mapped path) while its own download_dir is /downloads/rmab. The
 * release is stored by SABnzbd under <complete_dir>/x/y (sabStorageDir, like SABnzbd sorting), i.e.
 * /downloads/x/y/<name> in RMAB: inside the mapped path, outside download_dir.
 */

import { test, expect } from '@playwright/test';
import { ctl, fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { markJobs, exists, setRemoveAfterProcessing } from './242-helpers';
import { MEDIA, asApp, q, eventsSince, fmtEvents, sabHistoryDeletes, requestState, Evidence, has, saveState, waitRequestDone, waitOrganized } from './verified-import-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

test('7 broad mapped path: the download is removed, but no folder above it inside the mapped path', async () => {
  const e = new Evidence('7-broad-mapped-path');
  const def = {
    name: 'verified-usenet-nested',
    book: 'phm',
    indexers: [{ id: 2, name: 'E2E Usenet', protocol: 'usenet', priority: 25 }],
    releases: [{ id: 'nzb', protocol: 'usenet', indexerId: 2, title: '{{author}} - {{title}} (Unabridged) [M4B]', sizeMB: 380, fixture: 'phm-m4b', sabStorageDir: 'x/y' }],
  };
  const load = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(load.ok).toBe(true);
  e.save('scenario-definition.json', def);
  const book = (await fakeArr.books()).phm;
  const rmab = await Rmab.loginAdmin();
  e.save('indexer-config.json', await setRemoveAfterProcessing(rmab, 2, true));

  // Pre-create the nested folders as the app user (fake SABnzbd would create them as root, and a
  // root-owned parent would stop any sweep by permissions instead of by design)
  asApp('mkdir -p /downloads/rmab /downloads/x/y');
  const paths = await rmab.raw('PUT', '/api/admin/settings/paths', {
    downloadDir: '/downloads/rmab',
    mediaDir: MEDIA,
    metadataTaggingEnabled: true,
    chapterMergingEnabled: false,
    plexFormatCoercionEnabled: true,
    fileRenameEnabled: false,
  });
  e.save('paths-update.json', { status: paths.status, body: await paths.json().catch(() => ({})) });
  expect(paths.ok).toBe(true);
  const put = await rmab.raw('PUT', '/api/admin/settings/download-clients/e2e-sab', { remotePathMappingEnabled: true, remotePath: '/sab-remote', localPath: '/downloads' });
  e.save('sab-client-update.json', { status: put.status, body: await put.json().catch(() => ({})) });
  expect(put.ok).toBe(true);

  const name = book.title;
  const download = `/downloads/x/y/${name}`;
  e.save('scenario.txt', `Case 7. download_dir /downloads/rmab; SABnzbd client maps /sab-remote -> /downloads (broad); fake SABnzbd stores the release under /sab-remote/x/y.\nTrigger: POST /api/requests for ${name}; remove after processing on.\nExpect: ${download} removed and archived in SABnzbd; /downloads/x/y and /downloads/x kept (the nearest root above is only the mapped path); log "Nearest root above ... is a mapped download path".\nOn main 6d23138: the sweep is bounded by /downloads and removes /downloads/x/y and /downloads/x.\n`);
  const since = markJobs();
  const created = await rmab.requestBook(book);
  const requestId = created.request.id;
  await waitRequestDone(requestId);
  await waitOrganized(since, requestId).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  const events = eventsSince(since);
  e.save('rmab-job-events.log', `${fmtEvents(events)}\n`);
  e.save('request-state.tsv', `${requestState(requestId)}\n`);
  saveState(e, 'after', ['/downloads', MEDIA]);
  const nzoId = (await fakeArr.requests()).flatMap((r) => (r.service === 'sab' ? r.added || [] : [])).find((a) => a.releaseId === 'nzb')?.nzoId || '';
  const deletes = await sabHistoryDeletes(nzoId);
  e.save('sab-history-delete-requests.json', deletes);

  e.check(`${download} removed`, !exists(download), 'control');
  e.check('/downloads/x/y kept', exists('/downloads/x/y'), 'safety');
  e.check('/downloads/x kept', exists('/downloads/x'), 'safety');
  e.check('/downloads kept', exists('/downloads'), 'safety');
  e.check(`SABnzbd history delete recorded for ${nzoId}`, !!nzoId && deletes.length > 0, 'control');
  e.check(
    `log: Nearest root above ${download} is a mapped download path, leaving parent directories alone`,
    has(events, `Nearest root above ${download} is a mapped download path, leaving parent directories alone`),
    'log'
  );
  e.save('library.txt', asApp(`find ${q(MEDIA)} -type f -printf '%s %p\\n' | sort -k2`));
  expect(e.finish()).toEqual([]);
});
