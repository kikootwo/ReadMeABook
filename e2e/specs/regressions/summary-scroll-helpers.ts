/**
 * Component: E2E helpers for the book-summary scroll regression (routes, modal open, geometry)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * The details modal is opened through the real UI (search → card click). Two context routes keep the
 * run fast and deterministic: search responses are fetched once and replayed, and each details
 * response is the live one with `audiobook.description` swapped for the fixture under test.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, firefox, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { evidencePath, loginAdminUi, type Book } from '../../lib/harness';

export type FixtureKey = 'short' | 'mid' | 'long' | 'huge' | 'giant' | 'wolves' | 'boxset' | 'token' | 'nineLines' | 'tenLines' | 'whitespace';
export const FX: Record<FixtureKey, string> = JSON.parse(fs.readFileSync(path.join(__dirname, 'summary-scroll-fixtures.json'), 'utf8'));

export interface Vp { name: string; width: number; height: number; touch?: boolean }
export const VIEWPORTS: Vp[] = [
  { name: '375x812', width: 375, height: 812, touch: true },
  { name: '812x375', width: 812, height: 375, touch: true },
  { name: '1366x657', width: 1366, height: 657 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '2560x1440', width: 2560, height: 1440 },
];
export const vp = (name: string) => VIEWPORTS.find((v) => v.name === name)!;

/** Summary injected into the next details response (null = live description). */
export class SummaryRoutes {
  text: string | null = null;
  private search = new Map<string, string>();
  private details = new Map<string, any>();

  async install(ctx: BrowserContext) {
    await ctx.route(/\/api\/audiobooks\/search\?/, async (route) => {
      const url = route.request().url();
      const cached = this.search.get(url);
      if (cached) return route.fulfill({ status: 200, contentType: 'application/json', body: cached });
      const res = await route.fetch();
      const body = await res.text();
      if (res.ok()) this.search.set(url, body);
      return route.fulfill({ response: res, body });
    });
    await ctx.route(/\/api\/audiobooks\/[A-Z0-9]{10}(\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const key = new URL(route.request().url()).pathname;
      let base = this.details.get(key);
      if (!base) {
        const res = await route.fetch();
        if (!res.ok()) return route.fulfill({ response: res });
        base = await res.json();
        this.details.set(key, base);
      }
      const body = this.text === null ? base : { ...base, audiobook: { ...base.audiobook, description: this.text } };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
}

export type Engine = 'chromium' | 'webkit' | 'firefox';
export interface Session { ctx: BrowserContext; page: Page; routes: SummaryRoutes; engine: Engine }

/** `browser` may be the spec's Chromium fixture or a manually launched WebKit/Firefox (see launchEngine). */
export async function openSession(browser: Browser, v: Vp, opts: { dark?: boolean; tallCovers?: boolean } = {}): Promise<Session> {
  const engine = browser.browserType().name() as Engine;
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL,
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 1,
    // Firefox has no isMobile emulation; it still gets touch (coarse pointer) on phone sizes.
    ...(engine === 'firefox' ? {} : { isMobile: Boolean(v.touch) }),
    hasTouch: Boolean(v.touch),
    colorScheme: opts.dark ? 'dark' : 'light',
  });
  if (opts.tallCovers) {
    await ctx.addInitScript(() => localStorage.setItem('preferences', JSON.stringify({ cardSize: 5, squareCovers: false })));
  }
  const routes = new SummaryRoutes();
  await routes.install(ctx);
  const page = await ctx.newPage();
  await loginAdminUi(page);
  return { ctx, page, routes, engine };
}

/** WebKit or Firefox from the pinned Playwright image (the spec's `browser` fixture is Chromium). */
export const launchEngine = (engine: Exclude<Engine, 'chromium'>): Promise<Browser> => (engine === 'webkit' ? webkit : firefox).launch();

/** The details modal's scroll area (the only overscroll-contain scroller that holds an h2 title). */
const AREA_JS = `[...document.querySelectorAll('div.overflow-y-auto.overscroll-contain')].find((el) => el.querySelector('h2'))`;

/** Wait until the modal shows `text` (trimmed; empty = no summary section) and layout has settled. */
export async function waitForSummary(page: Page, text: string) {
  const want = text.trim();
  await expect
    .poll(
      () => page.evaluate(`(() => { const a = ${AREA_JS}; if (!a || !a.querySelector('h2')) return null;
        const p = a.querySelector('p.whitespace-pre-wrap'); return p ? p.textContent.trim() : ''; })()`),
      { timeout: 60_000, message: 'details modal with the injected summary' }
    )
    .toBe(want);
  // Modal zoom/slide-in is 300ms; then two frames for ResizeObserver-driven state.
  await page.waitForTimeout(450);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Search → click the book's card (real input path) → modal with `text` as its summary. */
export async function openFromSearch(s: Session, book: Book, text: string) {
  s.routes.text = text;
  await s.page.goto('/search');
  await s.page.getByPlaceholder('Search by title, author, or narrator...').fill(book.title);
  const card = s.page.locator(`article[aria-label^="View details for ${book.title} by"]`).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click({ position: { x: 8, y: 8 } });
  await waitForSummary(s.page, text);
}

export interface Geometry {
  vw: number; vh: number; coarse: boolean; modalH: number;
  areaClientH: number; areaScrollH: number; overflow: number; hOverflow: number;
  summaryChars: number; summaryH: number | null; boxScrollH: number | null;
  region: string | null; tabindex: string | null; label: string | null; overscrollY: string | null;
  heading: boolean; fadeTop: boolean; fadeBottom: boolean; more: boolean; lifted: boolean;
}

export async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(`(() => {
    const area = ${AREA_JS};
    const p = area.querySelector('p.whitespace-pre-wrap');
    const box = area.querySelector('[data-testid="book-summary-scroll"]');
    const label = box && box.getAttribute('aria-labelledby') ? document.getElementById(box.getAttribute('aria-labelledby')).textContent.trim() : null;
    return {
      vw: innerWidth, vh: innerHeight, coarse: matchMedia('(pointer: coarse)').matches,
      modalH: area.parentElement.offsetHeight,
      areaClientH: area.clientHeight, areaScrollH: area.scrollHeight, overflow: area.scrollHeight - area.clientHeight,
      hOverflow: Math.max(area.scrollWidth - area.clientWidth, box ? box.scrollWidth - box.clientWidth : 0),
      summaryChars: p ? p.textContent.length : 0,
      summaryH: box ? box.clientHeight : p ? p.offsetHeight : null,
      boxScrollH: box ? box.scrollHeight : null,
      region: box ? box.getAttribute('role') : null, tabindex: box ? box.getAttribute('tabindex') : null, label,
      overscrollY: box ? getComputedStyle(box).overscrollBehaviorY : null,
      heading: [...area.querySelectorAll('h3')].some((h) => h.textContent.trim().toLowerCase() === 'summary'),
      fadeTop: !!area.querySelector('[data-testid="book-summary-fade-top"]'),
      fadeBottom: !!area.querySelector('[data-testid="book-summary-fade-bottom"]'),
      more: !!area.querySelector('[data-testid="book-summary-more"]'),
      lifted: !!(box && box.parentElement.style.maxHeight),
    };
  })()`);
}

/** The "Summary" h3 in the modal (on main too, where there is no box): `${HEADING_JS}` is an expression. */
const HEADING_JS = `[...(${AREA_JS}).querySelectorAll('h3')].find((h) => h.textContent.trim().toLowerCase() === 'summary')`;

/** The summary heading at the top of the viewport, box scrolled to its start (phone evidence). */
export async function showBoxTop(page: Page) {
  await page.evaluate(`(() => {
    const box = (${AREA_JS}).querySelector('[data-testid="book-summary-scroll"]');
    if (box) box.scrollTop = 0;
    const h = ${HEADING_JS};
    if (h) h.scrollIntoView({ block: 'start' });
  })()`);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Screenshot of the summary heading + box (padded, clipped to the viewport) for a close look at the fade and chevron. */
export async function shotBox(page: Page, name: string) {
  const r = (await page.evaluate(`(() => { const h = ${HEADING_JS}; if (!h || !h.nextElementSibling) return null;
    const t = h.getBoundingClientRect(), b = h.nextElementSibling.getBoundingClientRect();
    const y = Math.max(0, t.top - 8), bottom = Math.min(innerHeight, b.bottom + 24);
    return { x: Math.max(0, b.left - 16), y, width: Math.min(innerWidth, b.width + 32), height: bottom - y }; })()`)) as { x: number; y: number; width: number; height: number } | null;
  if (!r || r.height <= 0) return;
  await page.screenshot({ path: evidencePath('summary-scroll', `${name}.png`), clip: r });
}

/**
 * Pointer path for the "more" chevron: it must sit inside the box; each click scrolls the box (never the
 * modal) until the end, where the chevron goes away. Takes `midShot` after the first click.
 */
export async function chevronWalk(page: Page, midShot?: string) {
  const more = page.getByTestId('book-summary-more');
  if (!(await more.count())) return { ok: false, reason: 'no chevron' };
  await page.evaluate(`(${AREA_JS}).querySelector('[data-testid="book-summary"]').scrollIntoView({ block: 'center' })`);
  await settle(page, 300);
  const rects = (await page.evaluate(`(() => { const a = ${AREA_JS};
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, right: b.right, bottom: b.bottom, left: b.left }; };
    return { box: r(a.querySelector('[data-testid="book-summary-scroll"]')), more: r(a.querySelector('[data-testid="book-summary-more"]')) }; })()`)) as Record<'box' | 'more', { top: number; right: number; bottom: number; left: number }>;
  const inside = rects.more.top >= rects.box.top && rects.more.bottom <= rects.box.bottom && rects.more.left >= rects.box.left && rects.more.right <= rects.box.right;
  const steps: { modalTop: number; boxTop: number | null }[] = [];
  const start = await scrollState(page);
  let clicks = 0;
  while (clicks < 40 && (await more.count())) {
    const before = await scrollState(page);
    await more.click();
    clicks += 1;
    await settle(page, 700);
    const after = await scrollState(page);
    steps.push({ modalTop: after.modalTop, boxTop: after.boxTop });
    if (!((after.boxTop ?? 0) > (before.boxTop ?? 0))) break;
    if (clicks === 1 && midShot) await shot(page, midShot);
  }
  const end = await scrollState(page);
  const gone = (await more.count()) === 0;
  const focusMoved = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'book-summary-more');
  const boxMoved = steps.length > 0 && (steps[0].boxTop ?? 0) > (start.boxTop ?? 0);
  const modalStill = steps.every((s) => s.modalTop === start.modalTop);
  const atEnd = end.boxTop !== null && end.boxMax !== null && end.boxTop >= end.boxMax - 1;
  return { ok: inside && boxMoved && modalStill && gone && atEnd && !focusMoved, inside, boxMoved, modalStill, gone, atEnd, focusMoved, clicks, rects, start, steps, end };
}

/** Scroll the summary box to its end and centre it in the modal; returns the modal's scrollTop. */
export async function parkBoxAtEnd(page: Page): Promise<{ modalTop: number; modalMax: number; x: number; y: number } | null> {
  return page.evaluate(`(() => {
    const area = ${AREA_JS};
    const box = area.querySelector('[data-testid="book-summary-scroll"]');
    if (!box) return null;
    box.scrollTop = box.scrollHeight;
    box.scrollIntoView({ block: 'center' });
    const r = box.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    const top = Math.max(r.top, a.top), bottom = Math.min(r.bottom, a.bottom);
    return { modalTop: area.scrollTop, modalMax: area.scrollHeight - area.clientHeight, x: Math.round(r.left + r.width / 2), y: Math.round((top + bottom) / 2) };
  })()`);
}

export const scrollState = (page: Page) =>
  page.evaluate(`(() => { const area = ${AREA_JS}; const box = area.querySelector('[data-testid="book-summary-scroll"]');
    return { modalTop: area.scrollTop, boxTop: box ? box.scrollTop : null, boxMax: box ? box.scrollHeight - box.clientHeight : null }; })()`) as Promise<{ modalTop: number; boxTop: number | null; boxMax: number | null }>;

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: evidencePath('summary-scroll', `${name}.png`), fullPage: false });
}

const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);

/** Mouse wheel over the summary once it is at its end: the modal itself must scroll on. */
export async function wheelAtEnd(page: Page) {
  const park = await parkBoxAtEnd(page);
  if (!park) return { ok: false, reason: 'no summary box' };
  const before = await scrollState(page);
  await page.mouse.move(park.x, park.y);
  await page.mouse.wheel(0, 240);
  await settle(page);
  const after = await scrollState(page);
  return { ok: after.modalTop > before.modalTop, park, before, after };
}

/**
 * Real touch swipe that starts inside the summary at its end: CDP touchStart/touchMove/touchEnd, which
 * runs Chromium's gesture and scroll-chaining path (Input.synthesizeScrollGesture is inert in headless).
 * Verified to tell the cases apart: overscroll auto → the sheet moves; contain → stuck.
 */
export async function swipeAtEnd(page: Page) {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const park = await parkBoxAtEnd(page);
  if (!park) return { ok: false, coarse, reason: 'no summary box' };
  await settle(page, 600);
  const before = await scrollState(page);
  const cdp = await page.context().newCDPSession(page);
  const distance = 220;
  const steps = 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: park.x, y: park.y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: park.x, y: park.y - (distance * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(page, 900);
  const after = await scrollState(page);
  await cdp.detach();
  return { ok: coarse && after.modalTop > before.modalTop, coarse, park, before, after };
}

/** Tab from the author link (or the close button) until focus lands on the summary region, then PageDown. */
export async function keyboardReach(page: Page, author: string) {
  const link = page.getByRole('link', { name: author, exact: true }).last();
  const start = (await link.count()) ? 'author link' : 'close button';
  if (start === 'author link') await link.focus();
  else await page.getByRole('button', { name: 'Close' }).last().focus();
  let tabs = 0;
  let reached = false;
  while (tabs < 8 && !reached) {
    await page.keyboard.press('Tab');
    tabs += 1;
    reached = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'book-summary-scroll' && document.activeElement?.getAttribute('role') === 'region');
  }
  const before = await scrollState(page);
  if (reached) await page.keyboard.press('PageDown');
  await settle(page, 400);
  const after = await scrollState(page);
  return { ok: reached && (after.boxTop ?? 0) > (before.boxTop ?? 0), start, tabs, reached, before, after };
}

let axeSource: string | null = null;

/** axe-core (pinned e2e devDependency) over the modal, injected through CDP, so the app's CSP is untouched. */
export async function axeModal(page: Page) {
  try {
    axeSource ??= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    await page.evaluate(axeSource);
    const result = await page.evaluate(`(async () => {
      const r = await axe.run(${AREA_JS}.parentElement, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    })()`) as { id: string; impact: string; nodes: number }[];
    return { ok: !result.some((v) => v.id === 'scrollable-region-focusable'), violations: result };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
