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
export const AREA_JS = `[...document.querySelectorAll('div.overflow-y-auto.overscroll-contain')].find((el) => el.querySelector('h2'))`;

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
  disc: Disc | null;
}

/** Where the "more" disc sits against the box, the bottom fade and the next section's divider. */
export interface Disc {
  /** disc top − bottom-fade top (0 = the disc only covers faded text). */
  topVsFade: number | null;
  /** disc bottom − box bottom (the disc hangs below the box by this much). */
  belowBox: number;
  /** next section's top (its border-t divider), or the content column's bottom − the disc's hit-area bottom. */
  gapToNext: number;
  nextIsSection: boolean;
  /** An ancestor (below the scroll area) whose overflow cuts the disc off, or null. */
  clippedBy: string | null;
  /** elementFromPoint 3px above the disc's bottom edge is the disc (null: that point is off screen). */
  bottomEdgeHit: boolean | null;
  inside: boolean;
  boxClientH: number;
  rects: { box: number[]; disc: number[]; nextTop: number };
}

/** Browser-side: Disc for the modal scroll area `area`, or null when there is no disc. */
export const DISC_FN = `((area) => {
  const more = area.querySelector('[data-testid="book-summary-more"]');
  if (!more) return null;
  const wrapper = more.parentElement;
  const box = wrapper.querySelector('[data-testid="book-summary-scroll"]');
  const fade = wrapper.querySelector('[data-testid="book-summary-fade-bottom"]');
  const m = more.getBoundingClientRect(), b = box.getBoundingClientRect(), f = fade ? fade.getBoundingClientRect() : null;
  const hitBottom = m.bottom - (parseFloat(getComputedStyle(more, '::after').bottom) || 0);
  const next = wrapper.nextElementSibling;
  const nextTop = next ? next.getBoundingClientRect().top : wrapper.parentElement.getBoundingClientRect().bottom;
  let clippedBy = null;
  for (let el = wrapper; el && el !== area; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const r = el.getBoundingClientRect();
    if (m.top < r.top || m.bottom > r.bottom || m.left < r.left || m.right > r.right) { clippedBy = el.tagName + '.' + el.className.split(' ').slice(0, 3).join('.'); break; }
  }
  const a = area.getBoundingClientRect();
  const probeY = m.bottom - 3, probeX = (m.left + m.right) / 2;
  const onScreen = probeY > a.top && probeY < a.bottom && probeY < innerHeight;
  const hit = onScreen ? document.elementFromPoint(probeX, probeY) : null;
  const r1 = (n) => Math.round(n * 10) / 10;
  return {
    topVsFade: f ? r1(m.top - f.top) : null,
    belowBox: r1(m.bottom - b.bottom),
    gapToNext: r1(nextTop - hitBottom),
    nextIsSection: !!next,
    clippedBy,
    bottomEdgeHit: onScreen ? !!(hit && more.contains(hit)) : null,
    inside: m.left >= b.left && m.right <= b.right && m.top >= b.bottom - 25 && m.bottom <= Math.min(b.bottom + 24, nextTop),
    boxClientH: box.clientHeight,
    rects: { box: [b.left, b.top, b.right, b.bottom].map(r1), disc: [m.left, m.top, m.right, m.bottom].map(r1), nextTop: r1(nextTop) },
  };
})`;

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
      disc: ${DISC_FN}(area),
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

export const settle = (page: Page, ms = 700) => page.waitForTimeout(ms);
