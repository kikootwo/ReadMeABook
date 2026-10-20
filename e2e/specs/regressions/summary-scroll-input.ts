/**
 * Component: E2E real-input checks for the book-summary scroll regression (chevron, wheel, touch, keyboard, focus, axe)
 * Documentation: documentation/testing/e2e-harness.md
 */

import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { AREA_JS, DISC_FN, parkBoxAtEnd, scrollState, settle, shot, shotBox, type Disc } from './summary-scroll-helpers';

/**
 * Pointer path for the "more" chevron: the disc sits over the bottom fade (hanging below the box, never past
 * the next section's divider); each click scrolls the box (never the modal) by its height minus 40px until
 * the end, where the chevron goes away. Takes `midShot` (+ a box crop) after the first click.
 * Page-side click events are counted, and a smooth scroll that starts late (a loaded host can stall the
 * renderer for a few hundred ms) gets up to 2s more; each step records both, so a dropped click and a
 * slow animation are told apart in metrics.json.
 */
export async function chevronWalk(page: Page, midShot?: string) {
  const more = page.getByTestId('book-summary-more');
  if (!(await more.count())) return { ok: false, reason: 'no chevron' };
  await page.evaluate(`(() => { window.__summaryMoreClicks = 0;
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-testid="book-summary-more"]')) window.__summaryMoreClicks += 1; }, true);
    (${AREA_JS}).querySelector('[data-testid="book-summary"]').scrollIntoView({ block: 'center' }); })()`);
  await settle(page, 300);
  const disc = (await page.evaluate(`${DISC_FN}(${AREA_JS})`)) as Disc;
  const inside = disc.inside;
  const expectedStep = Math.max(disc.boxClientH - 40, 24);
  const steps: { modalTop: number; boxTop: number | null; clickEvents: number; extraWaitMs: number }[] = [];
  const start = await scrollState(page);
  const clickEvents = () => page.evaluate('window.__summaryMoreClicks') as Promise<number>;
  let clicks = 0;
  while (clicks < 40 && (await more.count())) {
    const before = await scrollState(page);
    await more.click();
    clicks += 1;
    await settle(page, 700);
    let after = await scrollState(page);
    let extraWaitMs = 0;
    while (!((after.boxTop ?? 0) > (before.boxTop ?? 0)) && extraWaitMs < 2000) {
      await settle(page, 100);
      extraWaitMs += 100;
      after = await scrollState(page);
    }
    steps.push({ modalTop: after.modalTop, boxTop: after.boxTop, clickEvents: await clickEvents(), extraWaitMs });
    if (!((after.boxTop ?? 0) > (before.boxTop ?? 0))) break;
    if (clicks === 1 && midShot) {
      await shot(page, midShot);
      await shotBox(page, `${midShot}-box`);
    }
  }
  const end = await scrollState(page);
  const gone = (await more.count()) === 0;
  const focusMoved = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'book-summary-more');
  const boxMoved = steps.length > 0 && (steps[0].boxTop ?? 0) > (start.boxTop ?? 0);
  const modalStill = steps.every((s) => s.modalTop === start.modalTop);
  const clicksDelivered = (await clickEvents()) === clicks;
  const atEnd = end.boxTop !== null && end.boxMax !== null && end.boxTop >= end.boxMax - 1;
  const late = steps.filter((s) => s.extraWaitMs > 0).length;
  // The first step is never clamped by the end here (every walked text is several boxes long).
  const firstStep = steps.length ? (steps[0].boxTop ?? 0) - (start.boxTop ?? 0) : 0;
  const stepOk = Math.abs(firstStep - expectedStep) <= 1;
  return {
    ok: inside && boxMoved && stepOk && modalStill && gone && atEnd && !focusMoved && clicksDelivered,
    inside, boxMoved, firstStep, expectedStep, stepOk, modalStill, gone, atEnd, focusMoved, clicksDelivered, clicks, late, disc, start, steps, end,
  };
}

/** Two animation frames: lets scroll-driven React state (fades, chevron) render before a read or a shot. */
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * End-state evidence: the box is at its end, the chevron and the bottom fade are gone (waited for, then
 * checked), and only then the shot is taken. Returns the checked state for metrics.json.
 */
export async function endShot(page: Page, name: string, opts: { park?: boolean; box?: boolean } = {}) {
  if (opts.park ?? true) await parkBoxAtEnd(page);
  await frames(page);
  let state = await endState(page);
  for (let waited = 0; (state.more || state.fadeBottom) && waited < 2000; waited += 100) {
    await settle(page, 100);
    state = await endState(page);
  }
  await shot(page, name);
  if (opts.box) await shotBox(page, `${name}-box`);
  return { ok: state.atEnd && !state.more && !state.fadeBottom, ...state };
}

const endState = (page: Page) =>
  page.evaluate(`(() => { const a = ${AREA_JS}; const box = a.querySelector('[data-testid="book-summary-scroll"]');
    return { atEnd: !!box && box.scrollTop >= box.scrollHeight - box.clientHeight - 1,
      more: !!a.querySelector('[data-testid="book-summary-more"]'), fadeBottom: !!a.querySelector('[data-testid="book-summary-fade-bottom"]') }; })()`) as Promise<{ atEnd: boolean; more: boolean; fadeBottom: boolean }>;

/**
 * Real-browser focus check (Chromium blurs an element the moment it loses its tabindex): with the region
 * focused, cap the text so the box stops overflowing; focus must stay on the box with its tab stop, and
 * the tab stop goes on blur.
 */
export async function focusRetention(page: Page) {
  const read = () => page.evaluate(`(() => { const box = (${AREA_JS}).querySelector('[data-testid="book-summary-scroll"]');
    return { focused: document.activeElement === box, tabindex: box.getAttribute('tabindex'), overflow: box.scrollHeight - box.clientHeight }; })()`) as Promise<{ focused: boolean; tabindex: string | null; overflow: number }>;
  await page.evaluate(`(${AREA_JS}).querySelector('[data-testid="book-summary-scroll"]').focus()`);
  const before = await read();
  await page.evaluate(`(() => { const p = (${AREA_JS}).querySelector('[data-testid="book-summary-scroll"] p'); p.style.maxHeight = '20px'; p.style.overflow = 'hidden'; })()`);
  await frames(page);
  await settle(page, 300);
  const shrunk = await read();
  await page.evaluate(`(${AREA_JS}).querySelector('[data-testid="book-summary-scroll"]').blur()`);
  await frames(page);
  const blurred = await read();
  return {
    ok: before.focused && before.tabindex === '0' && shrunk.overflow <= 1 && shrunk.focused && shrunk.tabindex === '0' && !blurred.focused && blurred.tabindex === null,
    before, shrunk, blurred,
  };
}

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
