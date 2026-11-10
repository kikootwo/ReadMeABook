/**
 * Component: E2E regression #290 (admin Add Torrent: a magnet link or a .torrent file on a request)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Flags `--offline-fixtures --overrides abs-fake-metadata`; exec bridge (psql). Fake qBittorrent only.
 *   0  phm (admin) fails on its only listed release -> `failed`; martian (admin) and artemis (a local
 *      user) find nothing listed -> `awaiting_search`
 *   1  refusals on artemis: the user's session, the user's API token and an admin's API token get the
 *      same 403 for a real id and a made-up one; over 3 MiB (declared and chunked) 413; bad base64 400;
 *      no enabled torrent client 409 (dialog notice shot); no job row, status unchanged after each
 *   2  phm: menu -> dialog -> paste the unlisted magnet (shots); fake qBittorrent adds that hash; Library
 *      history reads "Found on Manual" while downloading (shot); downloaded
 *   3  martian with a pre-existing `Books` category at /other: a bad file shows the server's error, then
 *      the generated .torrent uploads; the fake gets the same sha256 under <hash>.torrent, category Books,
 *      autoTMM=false, no create/edit call, Books still /other; jobs row holds a placeholder; downloaded
 *   4  artemis: dialog at 375 dark (shot); two submits at once -> one 200, one 409, one job, one add
 *   5  the local user: no Add Torrent on My Requests or the Library detail (shot)
 *   afterAll: qBittorrent enabled with category readmeabook, `Books` removed, test tokens revoked
 */

import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fakeArr, execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, urls, snap, waitFor } from '../../lib/harness';
import { CaseRun } from './242-helpers';
import { QBIT, VIEWS, adminPage, lastSeq, callsSince, putCategory } from './46-helpers';
import { viewer, contextFor, card, type Viewer } from './177-library-page-helpers';
import {
  DIR, ADD_PATH, loadScenario, releaseTorrent, addTorrent, addTorrentChunked, requestStatus, jobCount, waitStatus,
  manualHistory, storedFilePayload, addsFor, openActions, settle,
} from './290-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const NO_CLIENT = 'No torrent client is set up. Add qBittorrent, Transmission or Deluge in Settings > Download Clients.';
const MIB = 1024 * 1024;
const ids: Record<'phm' | 'martian' | 'artemis', string> = { phm: '', martian: '', artemis: '' };
const titles: Record<string, string> = {};
let admin: Rmab;
let reader: Viewer;
const tokens: { owner: Rmab; id: string }[] = [];

test.afterAll(async () => {
  const rmab = await Rmab.loginAdmin();
  try {
    await rmab.raw('PUT', `/api/admin/settings/download-clients/${QBIT}`, { enabled: true });
    await putCategory(rmab, QBIT, 'readmeabook');
  } finally {
    await fakeArr.removeCategory('qbit', 'Books');
    for (const t of tokens) await t.owner.raw('DELETE', `/api/user/api-tokens/${t.id}`).catch(() => undefined);
  }
});

const dialogAdd = (page: Page) => page.getByRole('button', { name: 'Add', exact: true });

/** Menu -> Add Torrent; waits for the dialog's magnet field. */
async function openDialog(page: Page, title: string) {
  await openActions(page, title);
  await page.getByRole('menuitem', { name: 'Add Torrent' }).click();
  await page.getByLabel('Magnet link').waitFor({ timeout: 15_000 });
}

test('0 three requests: one failed, two with nothing found', async () => {
  test.setTimeout(420_000);
  const c = new CaseRun('0-setup', DIR);
  admin = await Rmab.loginAdmin();
  await loadScenario();
  const books = await fakeArr.books();
  for (const key of Object.keys(ids)) titles[key] = books[key].title;
  reader = await viewer(admin, `r290${Date.now().toString(36)}`);
  ids.phm = (await admin.requestBook(books.phm)).request.id;
  ids.martian = (await admin.requestBook(books.martian)).request.id;
  ids.artemis = (await new Rmab(reader.accessToken).requestBook(books.artemis)).request.id;
  if ((await waitStatus(ids.artemis, ['awaiting_search', 'awaiting_approval'], 'artemis')) === 'awaiting_approval') {
    await admin.post(`/api/admin/requests/${ids.artemis}/approve`, { action: 'approve' });
  }
  const states = {
    phm: await waitStatus(ids.phm, ['failed'], 'phm'),
    martian: await waitStatus(ids.martian, ['awaiting_search'], 'martian'),
    artemis: await waitStatus(ids.artemis, ['awaiting_search'], 'artemis'),
  };
  c.save('requests.json', { ids, titles, states, reader: reader.username });
  c.check(`statuses ${JSON.stringify(states)}`, states.phm === 'failed' && states.martian === 'awaiting_search' && states.artemis === 'awaiting_search', 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('1 refusals leave no job and the status as it was', async ({ browser }) => {
  test.setTimeout(300_000);
  const c = new CaseRun('1-refusals', DIR);
  const id = ids.artemis;
  const magnet = (await releaseTorrent('magnet-artemis')).magnet;
  const jobsBefore = jobCount(id);
  const unchanged = (step: string) => {
    const now = { jobs: jobCount(id), status: requestStatus(id) };
    c.check(`${step}: no job row, still awaiting_search (${JSON.stringify(now)})`, now.jobs === jobsBefore && now.status === 'awaiting_search');
  };
  const sameForAnyId = async (who: string, client: Rmab) => {
    const real = await addTorrent(client, id, { magnet });
    const madeUp = await addTorrent(client, randomUUID(), { magnet });
    c.save(`403-${who}.json`, { real, madeUp });
    c.check(`${who}: 403 (${real.status}), same answer for a made-up id`, real.status === 403 && JSON.stringify(real) === JSON.stringify(madeUp));
    unchanged(who);
  };

  const session = new Rmab(reader.accessToken);
  await sameForAnyId('user-session', session);
  const userToken = await session.post<{ fullToken: string; token: { id: string; role: string } }>('/api/user/api-tokens', { name: 'e2e-290-user' });
  tokens.push({ owner: session, id: userToken.token.id });
  await sameForAnyId('user-token', new Rmab(userToken.fullToken));
  const adminToken = await admin.post<{ fullToken: string; token: { id: string; role: string } }>('/api/user/api-tokens', { name: 'e2e-290-admin' });
  tokens.push({ owner: admin, id: adminToken.token.id });
  c.check(`admin token role ${adminToken.token.role}`, adminToken.token.role === 'admin', 'control');
  await sameForAnyId('admin-token', new Rmab(adminToken.fullToken));

  const declared = await addTorrent(admin, id, { torrentFile: 'A'.repeat(3 * MIB) });
  const chunked = await addTorrentChunked(admin.token, id, 3 * MIB + 64 * 1024);
  const badBase64 = await addTorrent(admin, id, { torrentFile: 'not*base64!' });
  c.save('size-and-base64.json', { declared, chunked, badBase64 });
  c.check(`over 3 MiB with Content-Length: 413 (${declared.status})`, declared.status === 413);
  c.check(`over 3 MiB chunked: 413 (${chunked.status})`, chunked.status === 413);
  unchanged('413');
  c.check(`bad base64: 400 ${JSON.stringify(badBase64.body)}`, badBase64.status === 400 && (badBase64.body as { message?: string })?.message === 'Not a valid .torrent file');
  unchanged('400');

  const disable = await admin.raw('PUT', `/api/admin/settings/download-clients/${QBIT}`, { enabled: false });
  c.check(`qBittorrent disabled (${disable.status})`, disable.ok, 'control');
  try {
    const noClient = await addTorrent(admin, id, { magnet });
    c.save('409-no-client.json', noClient);
    c.check(`no torrent client: 409 NoDownloadClient (${noClient.status})`, noClient.status === 409 && (noClient.body as { error?: string })?.error === 'NoDownloadClient');
    unchanged('409');
    const { page, close } = await adminPage(browser, VIEWS.light);
    await openDialog(page, titles.artemis);
    await expect(page.getByText(NO_CLIENT)).toBeVisible({ timeout: 15_000 });
    c.check('Add is disabled under the notice', await dialogAdd(page).isDisabled());
    await settle(page);
    await snap(page, `${DIR}/shots`, 'dialog-no-torrent-client-1280-light');
    await close();
  } finally {
    await admin.raw('PUT', `/api/admin/settings/download-clients/${QBIT}`, { enabled: true });
  }
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('2 an admin pastes a magnet on a failed request', async ({ browser }) => {
  test.setTimeout(420_000);
  const c = new CaseRun('2-magnet', DIR);
  const id = ids.phm;
  const release = await releaseTorrent('magnet-phm');
  const since = await lastSeq();
  const { page, close } = await adminPage(browser, VIEWS.light);
  await openActions(page, titles.phm);
  await expect(page.getByRole('menuitem', { name: 'Add Torrent' })).toBeVisible();
  await settle(page);
  await snap(page, `${DIR}/shots`, 'menu-add-torrent-1280-light');
  await page.getByRole('menuitem', { name: 'Add Torrent' }).click();
  const field = page.getByLabel('Magnet link');
  await expect(field).toBeFocused();
  await settle(page);
  await snap(page, `${DIR}/shots`, 'dialog-empty-1280-light');
  await field.fill(release.magnet);
  await snap(page, `${DIR}/shots`, 'dialog-magnet-1280-light');

  // The POST is held in the browser until the "sending" shot is taken, then sent unchanged
  let release_!: () => void;
  const held = new Promise<void>((r) => (release_ = r));
  await page.route((u) => u.pathname === ADD_PATH(id), async (route) => {
    await held;
    await route.continue();
  });
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === ADD_PATH(id), { timeout: 60_000 });
  await dialogAdd(page).click();
  await expect(page.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  await snap(page, `${DIR}/shots`, 'dialog-sending-1280-light');
  release_();
  const res = await answer;
  c.save('answer.json', { status: res.status(), body: await res.json() });
  c.check(`200 (${res.status()})`, res.status() === 200);
  await expect(page.getByText('Torrent added. Downloading now.')).toBeVisible({ timeout: 15_000 });
  await expect(field).toHaveCount(0);

  const status = await waitStatus(id, ['downloading'], 'phm', 60_000);
  const adds = await waitFor('fake qBittorrent add', async () => ((await addsFor(since, release.infoHash)).added.length ? addsFor(since, release.infoHash) : null), { timeoutMs: 60_000 });
  c.save('qbit-adds.json', adds.adds.map((r) => ({ seq: r.seq, body: r.body, added: r.added, duplicates: r.duplicates })));
  c.check(`one add of the magnet's hash, release magnet-phm (${JSON.stringify(adds.added.map((r) => r.added))})`, adds.added.length === 1 && adds.added[0].added?.[0].releaseId === 'magnet-phm');
  c.check(`category readmeabook (${JSON.stringify(adds.added[0]?.body)})`, adds.added[0]?.body?.category === 'readmeabook');
  const history = await manualHistory(id);
  c.save('download-history.txt', `${history.join('\n')}\n`);
  const manual = history.at(-1)?.split('|') ?? [];
  c.check(`history: indexer Manual, no indexer id, the hash (${history.at(-1)})`, status === 'downloading' && manual[0] === 'Manual' && manual[1] === '' && manual[2] === release.infoHash);

  await page.goto('/library');
  await card(page, titles.phm).first().click();
  const detail = page.getByRole('dialog', { name: titles.phm });
  await expect(detail.getByText('Found on Manual')).toBeVisible({ timeout: 30_000 });
  c.check(`still downloading at the shot (${requestStatus(id)})`, requestStatus(id) === 'downloading', 'control');
  await settle(page);
  await snap(page, `${DIR}/shots`, 'request-after-add-1280-light');
  await close();
  c.check(`then downloaded (${await waitStatus(id, ['downloaded', 'available'], 'phm')})`, true, 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('3 an admin uploads a .torrent; a pre-existing custom category is left as it was', async ({ browser }) => {
  test.setTimeout(420_000);
  const c = new CaseRun('3-upload', DIR);
  const id = ids.martian;
  const release = await releaseTorrent('file-martian');
  const bytes = Buffer.from(release.torrentFile!, 'base64');
  await fakeArr.seedCategory('qbit', 'Books', '/other');
  const put = await putCategory(admin, QBIT, 'Books');
  c.check(`client category Books, not owned (${put.status}, ${JSON.stringify(put.stored?.ownedCategory)})`, put.status === 200 && put.stored?.ownedCategory === undefined, 'control');
  const since = await lastSeq();

  const { page, close } = await adminPage(browser, VIEWS.light);
  await openDialog(page, titles.martian);
  const jobsBefore = jobCount(id);
  await page.getByTestId('add-torrent-file').setInputFiles({ name: 'broken.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from('d4:infoi1ee') });
  await dialogAdd(page).click();
  // The dialog's own alert (Next's route announcer is an empty role=alert too)
  await expect(page.locator('p[role="alert"]')).toHaveText('Not a valid .torrent file', { timeout: 15_000 });
  c.check(`bad file: no job, still awaiting_search (${jobCount(id)}, ${requestStatus(id)})`, jobCount(id) === jobsBefore && requestStatus(id) === 'awaiting_search');
  await settle(page);
  await snap(page, `${DIR}/shots`, 'dialog-error-bad-file-1280-light');

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByTestId('add-torrent-file').setInputFiles({ name: 'fixture-book-two.torrent', mimeType: 'application/x-bittorrent', buffer: bytes });
  await expect(page.getByText('fixture-book-two.torrent')).toBeVisible();
  await expect(page.getByLabel('Magnet link')).toBeDisabled();
  await snap(page, `${DIR}/shots`, 'dialog-file-chosen-1280-light');
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === ADD_PATH(id), { timeout: 60_000 });
  await dialogAdd(page).click();
  const res = await answer;
  c.save('answer.json', { status: res.status(), body: await res.json() });
  c.check(`200 (${res.status()})`, res.status() === 200);
  await expect(page.getByText('Torrent added. Downloading now.')).toBeVisible({ timeout: 15_000 });
  await close();

  const adds = await waitFor('fake qBittorrent upload', async () => ((await addsFor(since, release.infoHash)).added.length ? addsFor(since, release.infoHash) : null), { timeoutMs: 60_000 });
  const add = adds.added[0];
  const calls = await callsSince(since, 'qbit');
  const catCalls = calls.filter((r) => /\/torrents\/(create|edit)Category$/.test(r.path));
  c.save('qbit-calls.json', calls.map((r) => ({ seq: r.seq, path: r.path, body: r.body, files: r.files, added: r.added })));
  c.check(`one add, release file-martian (${adds.added.length})`, adds.added.length === 1 && add.added?.[0].releaseId === 'file-martian');
  c.check(`bytes identical: sha256 ${add.files?.[0]?.sha256} = ${release.sha256}, ${add.files?.[0]?.bytes} bytes`, add.files?.length === 1 && add.files[0].sha256 === release.sha256 && add.files[0].bytes === bytes.length);
  c.check(`file name ${add.files?.[0]?.filename}`, add.files?.[0]?.filename === `${release.infoHash}.torrent`);
  c.check(`add: Books, autoTMM=false, savepath set (${JSON.stringify(add.body)})`, add.body?.category === 'Books' && add.body.autoTMM === 'false' && !!add.body.savepath);
  c.check(`no create/edit category call (${catCalls.map((r) => r.body?.category).join(',')})`, catCalls.length === 0);
  const books = (await fakeArr.state()).qbitCategories.Books;
  c.check(`Books still at /other (${JSON.stringify(books)})`, books?.savePath === '/other');
  const payload = storedFilePayload(id, release.torrentFile!);
  c.save('job-payload.json', payload);
  c.check(`jobs row: placeholder ${payload.stored}, no row holds the bytes (${payload.rowsHoldingBytes})`, JSON.parse(payload.stored).omitted === true && payload.rowsHoldingBytes === 0);
  const history = await manualHistory(id);
  c.save('download-history.txt', `${history.join('\n')}\n`);
  c.check(`history: Manual, the file's hash (${history.at(-1)})`, history.at(-1)?.startsWith(`Manual||${release.infoHash}|`) === true);
  c.check(`then downloaded (${await waitStatus(id, ['downloaded', 'available'], 'martian')})`, true, 'control');
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('4 a double submit queues one download', async ({ browser }) => {
  test.setTimeout(420_000);
  const c = new CaseRun('4-double-submit', DIR);
  const id = ids.artemis;
  const release = await releaseTorrent('magnet-artemis');
  const { page, close } = await adminPage(browser, VIEWS.dark);
  await openDialog(page, titles.artemis);
  await page.getByLabel('Magnet link').fill(release.magnet);
  await settle(page);
  await snap(page, `${DIR}/shots`, 'dialog-375-dark');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await close();

  const since = await lastSeq();
  const answers = await Promise.all([addTorrent(admin, id, { magnet: release.magnet }), addTorrent(admin, id, { magnet: release.magnet })]);
  c.save('answers.json', answers);
  const statuses = answers.map((a) => a.status).sort();
  c.check(`one 200, one 409 (${statuses.join(',')})`, statuses[0] === 200 && statuses[1] === 409);
  await waitStatus(id, ['downloaded', 'available'], 'artemis');
  const adds = await addsFor(since, release.infoHash);
  c.save('qbit-adds.json', adds.adds.map((r) => ({ seq: r.seq, added: r.added, duplicates: r.duplicates })));
  c.check(`one download job (${jobCount(id, 'download_torrent')})`, jobCount(id, 'download_torrent') === 1);
  c.check(`one add, no repeat (${adds.added.length}, ${adds.duplicates.length})`, adds.added.length === 1 && adds.duplicates.length === 0);
  expect(c.finish().map((f) => f.name)).toEqual([]);
});

test('5 the requester sees no Add Torrent', async ({ browser }) => {
  test.setTimeout(180_000);
  const c = new CaseRun('5-user-view', DIR);
  const ctx = await contextFor(browser, urls.rmab(), reader);
  const page = await ctx.newPage();
  await page.goto('/requests');
  await expect(page.getByText(titles.artemis).first()).toBeVisible({ timeout: 30_000 });
  c.check(`My Requests: no Add Torrent (${await page.getByText('Add Torrent').count()})`, (await page.getByText('Add Torrent').count()) === 0);
  await settle(page);
  await snap(page, `${DIR}/shots`, 'user-view-no-item-1280-light');
  await page.goto('/library');
  await card(page, titles.artemis).first().click();
  const detail = page.getByRole('dialog', { name: titles.artemis });
  await expect(detail).toBeVisible({ timeout: 30_000 });
  c.check(`Library detail: no Add Torrent (${await page.getByText('Add Torrent').count()})`, (await page.getByText('Add Torrent').count()) === 0);
  await ctx.close();
  expect(c.finish().map((f) => f.name)).toEqual([]);
});
