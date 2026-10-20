/**
 * Component: E2E regression: long book summaries scroll in their own box, not the whole details modal
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Measures the details modal's scroll-area overflow (scrollHeight - clientHeight) for 1.8k/3.9k/8.1k-char
 * real Audnexus summaries across viewports, covers and the admin approval page, plus edge cases and
 * real-input checks (wheel, CDP touch swipe, keyboard, axe). Everything is recorded in
 * summary-scroll/metrics.json before any assertion, so the same spec gives the "before" numbers on main
 * (where it fails). Admin-page run needs the exec bridge (psql) and is skipped without it.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, Rmab, execBridgeAvailable, writeEvidence, waitFor, type Book } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import {
  FX, VIEWPORTS, vp, openSession, openFromSearch, waitForSummary, measure, parkBoxAtEnd, shot,
  wheelAtEnd, swipeAtEnd, keyboardReach, axeModal, type FixtureKey, type Geometry, type Session,
} from './summary-scroll-helpers';

interface Row extends Geometry { surface: string; cover: string; theme: string; vpName: string; text: FixtureKey }

test('summary-scroll: a long summary scrolls inside its own box and the modal keeps its height', async ({ browser }) => {
  test.setTimeout(45 * 60_000);
  const books = await fakeArr.books();
  const book: Book = books.phm;
  const rows: Row[] = [];
  const checks: Record<string, unknown> = {};
  const save = () => writeEvidence('summary-scroll/metrics.json', { rows, checks });

  const sample = async (s: Session, text: FixtureKey, meta: { surface?: string; cover?: string; theme?: string; vpName: string }, open?: () => Promise<void>) => {
    if (open) { s.routes.text = FX[text]; await open(); } else await openFromSearch(s, book, FX[text]);
    const row = { surface: 'search', cover: 'square', theme: 'light', ...meta, text, ...(await measure(s.page)) };
    rows.push(row);
    save();
    return row;
  };

  await test.step('overflow matrix, edge cases and real input per viewport (light)', async () => {
    for (const v of VIEWPORTS) {
      const s = await openSession(browser, v);
      for (const text of ['whitespace', 'mid', 'huge', 'long'] as FixtureKey[]) await sample(s, text, { vpName: v.name });
      await shot(s.page, `long-${v.name}-light`);
      if (v.name === '375x812') {
        await parkBoxAtEnd(s.page);
        await shot(s.page, 'long-375x812-light-end');
        checks.axe375 = await axeModal(s.page);
      }
      if (v.touch) {
        await openFromSearch(s, book, FX.long);
        checks[`touch${v.name}`] = await swipeAtEnd(s.page);
      }
      if (v.name === '1366x657') checks.wheel1366x657 = await wheelAtEnd(s.page);
      if (v.name === '1440x900') {
        checks.keyboard1440x900 = await keyboardReach(s.page, book.author);
        await shot(s.page, 'long-1440x900-light-focus');
        await openFromSearch(s, book, FX.long);
        checks.axe1440 = await axeModal(s.page);
      }
      if (v.name === '375x812' || v.name === '1440x900') {
        for (const text of ['short', 'giant', 'wolves', 'boxset', 'token'] as FixtureKey[]) {
          await sample(s, text, { vpName: v.name });
          if (text === 'short' || (v.name === '375x812' && text === 'token') || (v.name === '1440x900' && (text === 'giant' || text === 'boxset'))) {
            await shot(s.page, `${text}-${v.name}-light`);
          }
        }
      }
      if (v.name === '2560x1440') {
        await sample(s, 'nineLines', { vpName: v.name });
        await sample(s, 'tenLines', { vpName: v.name });
        await shot(s.page, 'tenLines-2560x1440-light');
      }
      save();
      await s.ctx.close();
    }
  });

  await test.step('dark mode at phone and desktop sizes', async () => {
    for (const name of ['375x812', '1440x900']) {
      const s = await openSession(browser, vp(name), { dark: true });
      await sample(s, 'long', { vpName: name, theme: 'dark' });
      await shot(s.page, `long-${name}-dark`);
      if (name === '1440x900') {
        await parkBoxAtEnd(s.page);
        await shot(s.page, 'long-1440x900-dark-end');
      }
      await sample(s, 'short', { vpName: name, theme: 'dark' });
      await shot(s.page, `short-${name}-dark`);
      await s.ctx.close();
    }
  });

  await test.step('2:3 covers at 1440x900', async () => {
    const s = await openSession(browser, vp('1440x900'), { tallCovers: true });
    for (const text of ['whitespace', 'mid', 'huge', 'long'] as FixtureKey[]) await sample(s, text, { vpName: '1440x900', cover: '2:3' });
    await shot(s.page, 'long-1440x900-cover23-light');
    await s.ctx.close();
  });

  await test.step('admin approval page (second action row) at 1440x900', async () => {
    if (!execBridgeAvailable()) {
      checks.admin = { skipped: 'no exec bridge (psql)' };
      return;
    }
    const rmab = await Rmab.loginAdmin();
    const artemis: Book = books.artemis;
    const { request } = await rmab.requestBook(artemis);
    // No smoke release matches Artemis, so the request settles; then park it in the approval queue.
    await waitFor('artemis request settles', async () => !['pending', 'searching'].includes(psql(`select status from requests where id = ${sqlStr(request.id)}`)) || null, { timeoutMs: 120_000, intervalMs: 2_000 });
    psql(`update requests set status = 'awaiting_approval' where id = ${sqlStr(request.id)}`);
    const s = await openSession(browser, vp('1440x900'));
    const openAdmin = async () => {
      await s.page.goto('/admin');
      const card = s.page.locator('div.border-amber-200', { hasText: artemis.title }).first();
      await card.getByRole('button', { name: 'View book details' }).click();
      await waitForSummary(s.page, s.routes.text ?? '');
    };
    for (const text of ['whitespace', 'mid', 'huge', 'long'] as FixtureKey[]) await sample(s, text, { vpName: '1440x900', surface: 'admin' }, openAdmin);
    await shot(s.page, 'long-1440x900-admin-light');
    await s.ctx.close();
  });

  save();

  // ---- Assertions (soft: every expectation is reported, and the numbers are already on disk) ----
  const pick = (surface: string, cover: string, vpName: string, text: FixtureKey, theme = 'light') =>
    rows.find((r) => r.surface === surface && r.cover === cover && r.vpName === vpName && r.text === text && r.theme === theme);

  for (const r of rows) {
    const tag = `${r.surface}/${r.cover}/${r.theme}/${r.vpName}/${r.text}`;
    expect.soft(r.hOverflow, `${tag}: no sideways scroll`).toBe(0);
    if (r.text === 'whitespace') {
      expect.soft(r.heading, `${tag}: whitespace-only summary renders no section`).toBe(false);
      continue;
    }
    const cap = r.vw < 640 ? Math.floor(0.38 * r.vh) + 1 : 241;
    expect.soft(r.summaryH ?? Infinity, `${tag}: box within its cap (${cap}px)`).toBeLessThanOrEqual(cap);
    const overflowing = (r.boxScrollH ?? 0) > (r.summaryH ?? 0) + 1;
    expect.soft(r.region, `${tag}: region only when the text overflows`).toBe(overflowing ? 'region' : null);
    expect.soft(r.tabindex, `${tag}: tab stop only when the text overflows`).toBe(overflowing ? '0' : null);
    if (overflowing) {
      expect.soft(r.label, `${tag}: region is labelled "Summary"`).toBe('Summary');
      expect.soft(r.fadeBottom, `${tag}: bottom fade hints at more text`).toBe(true);
      expect.soft(r.summaryH ?? 0, `${tag}: box never below the 6rem floor`).toBeGreaterThanOrEqual(95);
    }
    expect.soft(r.overscrollY, `${tag}: overscroll chains to the modal`).toBe('auto');
  }
  for (const r of rows.filter((x) => x.text === 'short')) expect.soft(r.region, `short summary at ${r.vpName}: natural height`).toBeNull();

  const groups = new Map<string, Row[]>();
  for (const r of rows.filter((x) => ['mid', 'long', 'huge'].includes(x.text))) {
    const k = `${r.surface}/${r.cover}/${r.theme}/${r.vpName}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    expect.soft(new Set(g.map((r) => r.overflow)).size, `${k}: modal overflow is the same for 1.8k/3.9k/8.1k chars (${g.map((r) => `${r.text}=${r.overflow}`).join(', ')})`).toBe(1);
  }
  for (const text of ['mid', 'long', 'huge'] as FixtureKey[]) {
    for (const name of ['1440x900', '2560x1440']) expect.soft(pick('search', 'square', name, text)?.overflow, `${name} default settings, ${text}: the modal does not scroll`).toBe(0);
  }
  expect.soft(pick('search', 'square', '2560x1440', 'nineLines')?.region, '2560x1440: 9 lines fit under the 15rem cap').toBeNull();
  expect.soft(pick('search', 'square', '2560x1440', 'tenLines')?.region, '2560x1440: 10 lines overflow the 15rem cap').toBe('region');

  const ok = (name: string) => (checks[name] as { ok?: boolean } | undefined)?.ok;
  expect.soft(ok('wheel1366x657'), 'wheel at the summary end scrolls the modal').toBe(true);
  expect.soft(ok('touch375x812'), 'touch swipe from inside the summary at its end scrolls the sheet (375x812)').toBe(true);
  expect.soft(ok('touch812x375'), 'touch swipe from inside the summary at its end scrolls the sheet (812x375)').toBe(true);
  expect.soft(ok('keyboard1440x900'), 'Tab reaches the summary region and PageDown scrolls it').toBe(true);
  expect.soft(ok('axe375'), 'axe: no scrollable-region-focusable violation (375x812)').toBe(true);
  expect.soft(ok('axe1440'), 'axe: no scrollable-region-focusable violation (1440x900)').toBe(true);
});
