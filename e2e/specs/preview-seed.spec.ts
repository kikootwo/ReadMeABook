/**
 * Component: E2E preview seed (requests in several states + a library with a book; no teardown)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Run by `node e2e/run.mjs preview --image <ref>` against the rmab-e2e-preview stack on 127.0.0.1:3400.
 */

import { test, expect } from '@playwright/test';
import { snap, evidencePath, writeEvidence, waitFor, fakeArr, Rmab } from '../lib/harness';

test.skip(process.env.E2E_PHASE !== 'preview', 'preview seeding only runs via run.mjs preview');
test.use({ storageState: evidencePath('storage-state.json') });

test('preview: seed available, downloading and failed requests', async ({ page }) => {
  const rmab = await Rmab.loginAdmin();
  const books = await fakeArr.books();
  await fakeArr.scenario('preview');
  for (const key of ['phm', 'martian', 'artemis']) await rmab.requestBook(books[key]);
  const status = async (key: string) => (await rmab.findRequest(books[key].asin))?.status;
  await waitFor('phm in the library', async () => {
    await rmab.triggerScheduledJob('plex_recently_added_check').catch(() => undefined);
    return (await status('phm')) === 'available';
  }, { timeoutMs: 420_000, intervalMs: 10_000 });
  await waitFor('martian downloading', async () => (await status('martian')) === 'downloading', { timeoutMs: 180_000, intervalMs: 3_000 });
  await waitFor('artemis failed', async () => (await status('artemis')) === 'failed', { timeoutMs: 300_000, intervalMs: 3_000 });
  const requests = await rmab.get<{ requests: any[] }>('/api/requests?limit=100');
  writeEvidence('preview/requests.json', requests.requests.map((r) => ({ title: r.audiobook?.title, status: r.status, progress: r.progress })));
  expect(new Set(requests.requests.map((r) => r.status))).toEqual(new Set(['available', 'downloading', 'failed']));
  await page.goto('/requests');
  await snap(page, 'preview', 'requests');
  await page.goto('/');
  await snap(page, 'preview', 'home');
});
