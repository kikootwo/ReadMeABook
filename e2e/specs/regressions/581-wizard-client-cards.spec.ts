/**
 * Component: E2E regression #581 (the Add Download Client cards never overlap)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Flags: --offline-fixtures --overrides abs-fake-metadata (no book appears). Exec bridge (psql).
 * At 375, 768, 1024, 1280 and 1536 px, for each of the five Add Download Client cards, measures in the
 * browser that the client name's text and its badge don't touch or intersect (>= 4 px apart on one line,
 * or the badge on a line below), that both sit inside the card's padding box, that cards sharing a row
 * have one height and that the card grid neither scrolls sideways nor runs past the viewport:
 *   1  the setup wizard's Download Client step (staged: setup is set incomplete and the page's own step
 *      state is moved to the step, as the earlier steps need live services; setup is never completed;
 *      no client added, so every card shows its Add button)
 *   2  Settings > Download Client (bootstrap's clients configured)
 * Shots: wizard 375 dark, 768/1024/1280/1536 light (-STAGED); Settings 1280 light and 375 dark.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, evidencePath, writeEvidence } from '../../lib/harness';
import { psql } from './242-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const DIR = '581';
const WIDTHS = [375, 768, 1024, 1280, 1536];
const MIN_GAP = 4;
type Scheme = 'light' | 'dark';


/** Every Add Download Client card, measured in the page */
const measure = (page: Page) => page.evaluate(() => {
  const heading = Array.from(document.querySelectorAll('h3')).find((h) => h.textContent?.trim() === 'Add Download Client')!;
  const grid = heading.nextElementSibling as HTMLElement;
  const cards = Array.from(grid.children).map((card) => {
    const h4 = card.querySelector('h4')!;
    const badge = h4.parentElement!.parentElement!.querySelector(':scope > span') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(h4);
    const n = range.getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const inner = { left: c.left + parseFloat(cs.borderLeftWidth), right: c.right - parseFloat(cs.borderRightWidth), top: c.top, bottom: c.bottom };
    const inside = (r: DOMRect) => r.left >= inner.left - 0.5 && r.right <= inner.right + 0.5 && r.top >= inner.top - 0.5 && r.bottom <= inner.bottom + 0.5;
    const sameLine = b.top < n.bottom && n.top < b.bottom;
    return {
      name: h4.textContent!.trim(),
      badge: badge.textContent!.trim(),
      gap: sameLine ? Math.round((b.left - n.right) * 10) / 10 : null,
      badgeBelow: b.top >= n.bottom - 0.5,
      nameInside: inside(n),
      badgeInside: inside(b),
      top: Math.round(c.top),
      height: Math.round(c.height),
      width: Math.round(c.width),
    };
  });
  const columns = cards.filter((c) => c.top === cards[0].top).length;
  const g = grid.getBoundingClientRect();
  return {
    cards,
    columns,
    gridOverflow: grid.scrollWidth > grid.clientWidth || g.right > window.innerWidth + 0.5,
    pageScrollWidth: document.documentElement.scrollWidth, // recorded only: the wizard's step bar is not part of this fix
    innerWidth: window.innerWidth,
  };
});

/** Failures for one width; empty when every card is clean */
function judge(m: Awaited<ReturnType<typeof measure>>): string[] {
  const bad: string[] = [];
  if (m.cards.length !== 5) bad.push(`${m.cards.length} cards, expected 5`);
  for (const c of m.cards) {
    if (c.gap !== null && c.gap < MIN_GAP) bad.push(`${c.name}: name and badge ${c.gap} px apart`);
    if (c.gap === null && !c.badgeBelow) bad.push(`${c.name}: badge neither beside nor below the name`);
    if (!c.nameInside) bad.push(`${c.name}: name leaves its card`);
    if (!c.badgeInside) bad.push(`${c.name}: badge leaves its card`);
  }
  const rows = new Map<number, number[]>();
  for (const c of m.cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c.height]);
  for (const [top, heights] of rows) if (new Set(heights).size > 1) bad.push(`row at ${top}: heights ${heights.join('/')}`);
  if (m.gridOverflow) bad.push('the card grid scrolls or runs past the viewport');
  return bad;
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: evidencePath(DIR, `${name}.jpg`), type: 'jpeg', quality: 80, fullPage: true });

async function runWidths(page: Page, where: string, shots: Partial<Record<number, Scheme>>, setScheme: (s: Scheme) => Promise<void>) {
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const width of WIDTHS) {
    for (const scheme of ['light', ...(shots[width] === 'dark' ? ['dark'] : [])] as Scheme[]) {
      await setScheme(scheme);
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const m = await measure(page);
      const bad = judge(m);
      results[`${width}-${scheme}`] = { ...m, failures: bad };
      failures.push(...bad.map((b) => `${where} ${width} ${scheme}: ${b}`));
      if (shots[width] === scheme) await shot(page, `${where}-${width}-${scheme}${where === 'wizard' ? '-STAGED' : ''}`);
    }
  }
  writeEvidence(`${DIR}/${where}-measures.json`, results);
  return failures;
}

async function newPage(browser: Browser, opts: { storageState?: string } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', ...opts });
  const page = await ctx.newPage();
  return { ctx, page, setScheme: (s: Scheme) => page.emulateMedia({ colorScheme: s }) };
}

test('1 setup wizard: Download Client step at five widths (staged)', async ({ browser }) => {
  test.setTimeout(180_000);
  psql(`update configuration set value = 'false' where key = 'setup_completed'`);
  try {
    const { ctx, page, setScheme } = await newPage(browser);
    await page.goto('/setup');
    await page.getByRole('heading').first().waitFor();
    /* eslint-disable @typescript-eslint/no-explicit-any -- React fiber internals are untyped */
    const found = await page.evaluate(() => {
      const el = document.querySelector('h1, h2') as any;
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
      for (let f = el[key]; f; f = f.return) {
        for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
          const s = h.memoizedState;
          if (s && typeof s === 'object' && 'currentStep' in s && h.queue?.dispatch) {
            (window as any).__setStep = (n: number) => h.queue.dispatch((p: any) => ({ ...p, backendMode: 'audiobookshelf', downloadDir: '/downloads', currentStep: n }));
            return true;
          }
        }
      }
      return false;
    });
    expect(found).toBe(true);
    const heading = page.getByRole('heading', { name: 'Configure Download Clients' });
    for (let n = 2; n < 15 && !(await heading.isVisible()); n++) {
      await page.evaluate((step) => (window as any).__setStep(step), n);
      await page.waitForTimeout(150);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    await expect(heading).toBeVisible();
    const intro = await page.getByText(/^Add at least one download client\./).textContent();
    writeEvidence(`${DIR}/wizard-intro.txt`, `${intro}\n`);
    expect(intro).toContain('(qBittorrent, Transmission, or Deluge)');
    expect(intro).toContain('(SABnzbd or NZBGet)');
    await expect(page.getByRole('button', { name: /^Add (qBittorrent|Transmission|Deluge|SABnzbd|NZBGet)$/ })).toHaveCount(5);
    const failures = await runWidths(page, 'wizard', { 375: 'dark', 768: 'light', 1024: 'light', 1280: 'light', 1536: 'light' }, setScheme);
    await ctx.close();
    expect(failures).toEqual([]);
  } finally {
    psql(`update configuration set value = 'true' where key = 'setup_completed'`);
  }
  expect(psql(`select value from configuration where key = 'setup_completed'`)).toBe('true');
});

test('2 Settings > Download Client at five widths', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page, setScheme } = await newPage(browser, { storageState: evidencePath('storage-state.json') });
  await page.goto('/admin/settings?tab=download');
  await expect(page.getByRole('heading', { name: 'Add Download Client' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configured Clients' }).or(page.getByText('No download clients configured yet'))).toBeVisible();
  const failures = await runWidths(page, 'settings', { 375: 'dark', 1280: 'light' }, setScheme);
  await ctx.close();
  expect(failures).toEqual([]);
});
