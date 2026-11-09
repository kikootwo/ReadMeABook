/**
 * Component: E2E helpers for the #325a / #284 part B specs (284-library-follow, 284-cover-legacy)
 * Documentation: documentation/testing/e2e-harness.md
 */

import crypto from 'node:crypto';
import { expect, type Browser } from '@playwright/test';
import { evidencePath, snap, stackExecSync, stackLogsSync, urls, waitFor, type Abs, type Rmab } from '../../lib/harness';

export const SCHEDULES = ['plex_recently_added_check', 'plex_library_scan', 'audible_refresh'];
export const SCAN_TYPES = `('scan_plex','plex_library_scan')`;
export const FAKE_PROXY = 'http://fake-arr:9898';

export type FixtureBook = { asin: string; title: string; author: string; narrator: string };

export const printenv = (service: string, name: string) => {
  try {
    return stackExecSync(service, ['printenv', name]).trim();
  } catch {
    return '';
  }
};

export const sha256 = (data: ArrayBuffer | Buffer) => crypto.createHash('sha256').update(Buffer.from(data as ArrayBuffer)).digest('hex');

/** The offline fixture books (made-up titles) by key. */
export function fixtureBooks(): Record<'martian' | 'artemis' | 'phm', FixtureBook> {
  const index = JSON.parse(stackExecSync('fake-arr', ['cat', '/fixtures/index.json']));
  return { martian: index.books.martian, artemis: index.books.artemis, phm: index.books.phm };
}

/** Turn the scan schedules off, adding each job id to `disabled` as it goes (to turn back on later). */
export async function disableSchedules(rmab: Rmab, disabled: string[]) {
  const { jobs } = await rmab.get<{ jobs: { id: string; type: string }[] }>('/api/admin/jobs');
  for (const type of SCHEDULES) {
    const job = jobs.find((j) => j.type === type);
    expect((await rmab.raw('PUT', `/api/admin/jobs/${job!.id}`, { enabled: false })).status, `disable ${type}`).toBe(200);
    disabled.push(job!.id);
  }
}

/** Wait out RMAB's boot burst of overdue triggers (it can still fire a just-disabled job once). */
export async function waitStartupSettled() {
  let lastOverdue = -1;
  let changedAt = Date.now();
  await waitFor('RMAB startup jobs settled', async () => {
    const logs = stackLogsSync('rmab');
    const overdue = (logs.match(/is overdue, triggering now/g) || []).length;
    if (overdue !== lastOverdue) {
      lastOverdue = overdue;
      changedAt = Date.now();
    }
    const refresh = [/\[AudibleRefresh\] Starting Audible data refresh/g, /\[AudibleRefresh\] (Cleanup complete|Error:)/g].map((r) => (logs.match(r) || []).length);
    const scans = [/\[ScanLibrary\] Scanning library/g, /\[ScanLibrary\] (Matched \d+\/\d+ requests|Error:)/g].map((r) => (logs.match(r) || []).length);
    return Date.now() - changedAt > 20_000 && refresh[1] >= refresh[0] && scans[1] >= scans[0] ? true : null;
  }, { timeoutMs: 420_000, intervalMs: 3_000 });
}

/** A browser context on the RMAB origin as the admin; `settled` waits for transitions and images, then snaps. */
export async function session(browser: Browser, width: number, height: number, dark: boolean) {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL, viewport: { width, height }, colorScheme: dark ? 'dark' : 'light',
    storageState: evidencePath('storage-state.json'),
  });
  const page = await ctx.newPage();
  /** Shots wait for finite CSS transitions/animations (the cards fade in) and images to finish. */
  const settled = async (dir: string, name: string) => {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)
      && Array.from(document.images).every((i) => i.complete));
    await page.waitForTimeout(300);
    await snap(page, dir, name);
  };
  return { ctx, page, settled };
}

/** Real ABS calls on one item: rematch it through the fake metadata, give it a generated cover. */
export function absItem(browser: Browser, abs: Abs, itemId: string) {
  const auth = { Authorization: `Bearer ${abs.token}` };
  return {
    rematch: async (asin: string) => {
      await abs.req('POST', `/api/items/${itemId}/match`, { provider: 'audible', asin, overrideDefaults: true, overrideDetails: true });
      const now = (await abs.req('GET', `/api/items/${itemId}`)).media?.metadata?.asin || '';
      expect(now, `precondition: the ABS item now holds ${asin}`).toBe(asin);
    },
    /** Upload a generated cover; returns the sha256 of the cover ABS now serves. */
    setCover: async (color: string, label: string) => {
      const form = new FormData();
      form.append('cover', new Blob([new Uint8Array(await generatedCover(browser, color, label))], { type: 'image/jpeg' }), `cover-${label}.jpg`);
      const res = await fetch(`${urls.abs()}/api/items/${itemId}/cover`, { method: 'POST', headers: auth, body: form });
      expect(res.ok, `precondition: ABS took cover ${label} (${res.status})`).toBe(true);
      // ABS picks the cover format from Accept (a bare */* gets webp); ask as RMAB's axios download does.
      const served = await fetch(`${urls.abs()}/api/items/${itemId}/cover`, { headers: { ...auth, Accept: 'application/json, text/plain, */*' } });
      expect(served.ok, `precondition: ABS serves cover ${label}`).toBe(true);
      return sha256(await served.arrayBuffer());
    },
  };
}

/** The cover RMAB serves at a card's coverArtUrl (or at a cache path). */
export async function rmabCover(url: unknown) {
  if (typeof url !== 'string' || !url.startsWith('/')) return { url, status: 0, sha: null as string | null };
  const res = await fetch(`${urls.rmab()}${url}`);
  return { url, status: res.status, sha: res.ok ? sha256(await res.arrayBuffer()) : null };
}

/** A generated square cover: a colour field with a big letter (no real artwork). */
export async function generatedCover(browser: Browser, color: string, label: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent(`<body style="margin:0;width:400px;height:400px;background:${color};display:flex;align-items:center;justify-content:center;font:bold 220px sans-serif;color:#fff">${label}</body>`);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 90 });
  await page.close();
  return jpeg;
}
