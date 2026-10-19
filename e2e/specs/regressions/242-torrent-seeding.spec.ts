/**
 * Component: E2E regression #242 case 2 (torrent keeps seeding: source untouched, library copy present)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Inline scenario: one torrent release for book martian (fixture martian-mp3, generated tones) on
 * indexer 1 via fake qBittorrent, path mapping off. A no-regression control: passes before and after.
 * Uses martian so the smoke spec (book phm) can run on the same stack afterwards.
 */

import { test, expect } from '@playwright/test';
import { waitFor, fakeArr, ctl, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab } from '../../lib/harness';
import { MEDIA, sh, q, psql, sqlStr, dbNow, shas, listing, exists, eventsSince, fmtEvents, waitOrganized, requestState, CaseRun, fmtShas } from './242-helpers';

// Needs docker exec into the stack (sha256 snapshots, psql, symlinks, Bull): untainted runs only.
test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

test('2 torrent download keeps seeding: source untouched, library copy present', async () => {
  const c = new CaseRun('2-torrent-keeps-seeding');
  const def = {
    name: 'torrent-seeding-242',
    description: 'One multi-file mp3 torrent for book martian (fixture martian-mp3, generated tones).',
    book: 'martian',
    indexers: [{ id: 1, name: 'E2E Torrents', protocol: 'torrent', priority: 25 }],
    releases: [{ id: 'good', title: '{{author}} - {{title}} (Unabridged) [MP3 64kbps]', sizeMB: 420, seeders: 60, fixture: 'martian-mp3' }],
  };
  const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition: def }) });
  expect(res.ok).toBe(true);
  const book = (await fakeArr.books()).martian;
  const rmab = await Rmab.loginAdmin();
  // Save the indexer settings the way the Settings page does (stores protocol: torrent).
  const idx = await rmab.get<{ indexers: any[]; flagConfigs: any[] }>('/api/admin/settings/prowlarr/indexers');
  const put = await rmab.raw('PUT', '/api/admin/settings/prowlarr/indexers', { indexers: idx.indexers, flagConfigs: idx.flagConfigs });
  expect(put.ok).toBe(true);
  c.save('indexer-config.json', psql(`select value from configuration where key = 'prowlarr_indexers'`));
  c.save('scenario-definition.json', def);
  c.save(
    'scenario.txt',
    `Case 2. Inline scenario ${def.name}: torrent "${book.title}" (fixture martian-mp3) on indexer 1 via fake qBittorrent, path mapping off.\nTrigger: POST /api/requests for ${book.title}; search, grab, download and organize run for real.\nExpect: /downloads/${book.title}/ intact (sha equal to the fixture), library .mp3 files present, torrent still seeding, no torrents/delete call, no download cleanup.\n`
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
  const media = shas('/media');
  c.save('sha256-media-after.txt', fmtShas(media));
  const rel = (out: string) => out.split('\n').filter(Boolean).map((l) => l.replace(/ +\.\//, '  ')).sort().join('\n');
  const src = rel(sh(`cd ${q(`/downloads/${name}`)} && find . -type f -exec sha256sum {} +`));
  const fixture = rel(sh(`cd /fixtures/martian-mp3 && find . -type f -exec sha256sum {} +`, { service: 'fake-arr' }));
  c.save('sha256-download-folder.txt', `${src}\n`);
  c.save('sha256-fixture.txt', `${fixture}\n`);
  const state = await fakeArr.state();
  c.save('fake-qbit-torrents.json', state.torrents);
  const qbitCalls = await fakeArr.requests().then((r) => r.filter((x) => x.service === 'qbit'));
  c.save('qbit-requests.json', qbitCalls.map((r) => ({ seq: r.seq, method: r.method, path: r.path, status: r.status })));

  c.check(`/downloads/${name}/ exists`, exists(`/downloads/${name}`), 'safety');
  c.check('download folder files match the fixture (sha256)', !!src && src === fixture, 'safety');
  const mp3 = Object.keys(media).filter((p) => p.startsWith(`${MEDIA}/`) && p.endsWith('.mp3'));
  const nonZero = mp3.filter((p) => Number(sh(`stat -c %s ${q(p)}`).trim()) > 0);
  c.check(`library has non-zero .mp3 files (${nonZero.length})`, nonZero.length > 0, 'control');
  const t = state.torrents.find((x: any) => x.releaseId === 'good');
  c.check(`torrent "good" still present and seeding (${t?.state})`, !!t && ['uploading', 'stalledUP', 'queuedUP', 'forcedUP'].includes(t.state), 'safety');
  c.check('no qBittorrent torrents/delete call', !qbitCalls.some((r) => r.path.includes('/torrents/delete')), 'safety');
  const found = events.find((e) => e.message.startsWith('Indexer found in config: yes'));
  c.check(`log: Indexer found in config: yes, protocol torrent (${found?.metadata || 'absent'})`, !!found && /"protocol":\s*"torrent"/.test(found.metadata), 'log');
  c.check('log absent: Removing download files from filesystem:', !events.some((e) => e.message.includes('Removing download files from filesystem:')), 'safety');
  c.check('log absent: Cleaning up download', !events.some((e) => e.message.includes('Cleaning up download')), 'safety');

  const failed = c.finish();
  expect(failed.map((f) => `${f.kind}: ${f.name}`)).toEqual([]);
});
