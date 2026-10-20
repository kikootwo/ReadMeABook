/**
 * Component: E2E smoke spec (login → home → search → request → grab → complete → organize → library)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, expect, type Page } from '@playwright/test';
import { snap, env, evidencePath, writeEvidence, waitFor, fakeArr, keyLeaks, authState, loginAdminUi, Rmab, Abs } from '../lib/harness';

const shot = (page: Page, name: string) => snap(page, 'smoke', name);

test('smoke: a requested book is grabbed, downloaded, organized and shows up in the library', async ({ page }) => {
  await fakeArr.scenario('smoke');
  const book = (await fakeArr.books()).phm;
  const plexMode = env('E2E_BACKEND') === 'plex';

  await test.step('sign in through the local admin form', async () => {
    await loginAdminUi(page, { beforeToggle: () => shot(page, '00-login-plex-mode') });
    await shot(page, '01-home');
  });

  await test.step('search Audible and request the book from its card', async () => {
    await page.goto('/search');
    await page.getByPlaceholder('Search by title, author, or narrator...').fill(book.title);
    const card = page.locator(`article[aria-label^="View details for ${book.title} by"]`).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await shot(page, '02-search-results');
    await card.hover();
    await card.getByRole('button', { name: 'Request', exact: true }).click();
    await shot(page, '03-requested');
  });

  const rmab = await Rmab.loginAdmin();
  const findMine = async () => {
    const body = await rmab.get<{ requests: any[] }>('/api/requests?limit=100');
    return body.requests.find((r) => r.audiobook?.title === book.title) || null;
  };
  const request = await waitFor('request row', findMine, { timeoutMs: 30_000 });
  writeEvidence('smoke/request-created.json', request);

  await test.step('fake Prowlarr is searched and fake qBittorrent receives the top release', async () => {
    const add = await waitFor(
      'qBittorrent add of release "good"',
      async () => (await fakeArr.requests()).find((r) => r.service === 'qbit' && r.path === '/api/v2/torrents/add' && r.added?.some((a) => a.releaseId === 'good')),
      { timeoutMs: 180_000 }
    );
    expect(add.status).toBe(200);
    await page.goto('/requests');
    await shot(page, '04-requests-downloading');
  });

  await test.step('download completes and files are organized', async () => {
    const done = await waitFor(
      'request downloaded/available',
      async () => {
        const r = await findMine();
        return r && ['downloaded', 'available'].includes(r.status) ? r : null;
      },
      { timeoutMs: 300_000, intervalMs: 3_000 }
    );
    writeEvidence('smoke/request-downloaded.json', done);
    await page.goto('/requests');
    await shot(page, '05-requests-downloaded');
  });

  await test.step(`${plexMode ? 'fake Plex' : 'Audiobookshelf'} has the book and RMAB marks it available`, async () => {
    if (plexMode) {
      // fake Plex lists <media>/audiobooks/<Author>/<Title> folders, so the organized book is the album.
      const album = await waitFor('fake Plex album', async () => (await fakeArr.plexLibrary()).albums.find((a) => a.title === book.title) || null, { timeoutMs: 180_000, intervalMs: 5_000 });
      writeEvidence('smoke/plex-album.json', album);
    } else {
      const abs = await Abs.login();
      const libraryId = authState().absLibraryId;
      const item = await waitFor(
        'ABS library item',
        async () => {
          await abs.req('POST', `/api/libraries/${libraryId}/scan`).catch(() => undefined);
          const items = await abs.libraryItems(libraryId);
          return items.find((i) => i.media?.metadata?.title === book.title) || null;
        },
        { timeoutMs: 180_000, intervalMs: 5_000 }
      );
      writeEvidence('smoke/abs-item.json', { id: item.id, path: item.path, title: item.media?.metadata?.title, numAudioFiles: item.media?.numAudioFiles });
    }
    const available = await waitFor(
      'request available',
      async () => {
        if (plexMode) await rmab.triggerScheduledJob('plex_library_scan').catch(() => undefined);
        await rmab.triggerScheduledJob('plex_recently_added_check').catch(() => undefined);
        const r = await findMine();
        return r?.status === 'available' ? r : null;
      },
      { timeoutMs: 240_000, intervalMs: 10_000 }
    );
    writeEvidence('smoke/request-available.json', available);
    await page.goto('/requests');
    await shot(page, '06-requests-available');
    await page.goto('/search');
    await page.getByPlaceholder('Search by title, author, or narrator...').fill(book.title);
    await expect(page.locator(`article[aria-label^="View details for ${book.title} by"]`).first().getByText('In Your Library')).toBeVisible({ timeout: 60_000 });
    await shot(page, '07-in-your-library');
  });

  await test.step('the Prowlarr API key never left the Prowlarr origin', async () => {
    const records = await fakeArr.requests();
    writeEvidence('smoke/fake-arr-requests.json', records);
    expect(keyLeaks(records, env('PROWLARR_API_KEY'))).toEqual([]);
  });
});
