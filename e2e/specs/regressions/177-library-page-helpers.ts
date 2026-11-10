/**
 * Component: E2E helpers for the Library page spec (#177: 177-library-page): seeds, sign-in, checks
 * Documentation: documentation/testing/e2e-harness.md
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Rmab, urls } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { activeLibraryId } from './177-library-helpers';

export const ASIN_PREFIX = 'B0E17P';
const GUID_PREFIX = 'e2e-177p-';

export function cleanupPageSeeds() {
  psql(
    `begin;
     delete from requests where audiobook_id in (select id from audiobooks where audible_asin like '${ASIN_PREFIX}%');
     delete from audiobooks where audible_asin like '${ASIN_PREFIX}%';
     delete from plex_library where plex_guid like '${GUID_PREFIX}%';
     delete from users where plex_username like 'lib177p%';
     commit;`
  );
}

function insertBook(asin: string, title: string, author: string): string {
  return psql(
    `insert into audiobooks (id, audible_asin, title, author, narrator, status, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(asin)}, ${sqlStr(title)}, ${sqlStr(author)}, 'Rowan Ashby', 'requested', now(), now())
     returning id`
  ).split('\n')[0];
}

function insertRequest(userId: string, bookId: string, status: string, progress = 0, error: string | null = null): string {
  return psql(
    `insert into requests (id, user_id, audiobook_id, type, status, progress, error_message, completed_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(userId)}, ${sqlStr(bookId)}, 'audiobook', ${sqlStr(status)}, ${progress},
             ${error ? sqlStr(error) : 'null'}, ${status === 'available' ? 'now()' : 'null'}, now(), now())
     returning id`
  ).split('\n')[0];
}

function insertRow(libraryId: string, key: string, asin: string, title: string, author: string) {
  psql(
    `insert into plex_library (id, plex_guid, title, author, narrator, duration, year, asin, file_path, plex_library_id, added_at, last_scanned_at, created_at, updated_at)
     values (gen_random_uuid(), ${sqlStr(GUID_PREFIX + key)}, ${sqlStr(title)}, ${sqlStr(author)}, 'Rowan Ashby', 41400000, 2021,
             ${sqlStr(asin)}, ${sqlStr(`/audiobooks/${author}/${title}`)}, ${sqlStr(libraryId)}, now(), now(), now(), now())`
  );
}

export const FAILED_ERROR = 'No release matched the search';
/** The delivered book's file path (the admin detail's Path row). */
export const DELIVERED_PATH = '/audiobooks/Ines Halloway/North of Quiet';
export const TITLES = {
  failed: 'The Glass Orchard',
  downloading: 'Salt and Lantern',
  approval: 'The Ninth Bell',
  denied: 'Paper Comets',
  release: 'Winter Ledger',
  delivered: 'North of Quiet',
  searching: 'Second Tide',
  pending: 'Thistle Road',
  scan: ['A Field of Small Engines', 'Harbor Lights', 'The Long Hum', 'Copper Season'],
};

export interface Viewer {
  id: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  user: any;
}

async function localLogin(username: string, password: string): Promise<Viewer> {
  const res = await fetch(`${urls.rmab()}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  expect(res.status, `local login ${username}: ${JSON.stringify(body)}`).toBe(200);
  return { id: body.user.id, username, accessToken: body.accessToken, refreshToken: body.refreshToken, user: body.user };
}

/**
 * A local user added by the admin (POST /api/admin/users), then signed in after any role change.
 * Not the sign-up route: it allows 5 sign-ups an hour per address, which a rerun on a kept stack or
 * another spec in the same stack would use up.
 */
export async function viewer(admin: Rmab, username: string, opts: { admin?: boolean } = {}): Promise<Viewer> {
  const password = `e2e-${username}-pass`;
  const res = await admin.raw('POST', '/api/admin/users', { username, password });
  const body = await res.json();
  expect(res.status, `add user ${username}: ${JSON.stringify(body)}`).toBe(201);
  const id: string = body.user.id;
  if (opts.admin) psql(`update users set role = 'admin' where id = ${sqlStr(id)}`);
  return localLogin(username, password);
}

/** A browser context signed in as `v` (the tokens and user the login page would store). */
export async function contextFor(browser: Browser, baseURL: string, v: Viewer, colorScheme: 'light' | 'dark' = 'light'): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    colorScheme,
    viewport: { width: 1280, height: 800 },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [
            { name: 'accessToken', value: v.accessToken },
            { name: 'refreshToken', value: v.refreshToken },
            { name: 'user', value: JSON.stringify(v.user) },
          ],
        },
      ],
    },
  });
}

/** Seeds ten request and library books across every status group; returns the request ids by key. */
export function seedBooks(ids: { requester: string; other: string; admin: string }): Record<string, string> {
  const libraryId = activeLibraryId();
  expect(libraryId, 'an active Audiobookshelf library id').toBeTruthy();
  const out: Record<string, string> = {};
  const add = (key: string, n: number, title: string, author: string, user: string, status: string, progress = 0, error: string | null = null) => {
    out[key] = insertRequest(user, insertBook(`${ASIN_PREFIX}${String(n).padStart(4, '0')}`, title, author), status, progress, error);
  };
  add('failed', 1, TITLES.failed, 'Mara Quill', ids.requester, 'failed', 0, FAILED_ERROR);
  add('downloading', 2, TITLES.downloading, 'Mara Quill', ids.requester, 'downloading', 42);
  add('approval', 3, TITLES.approval, 'Teodor Vance', ids.other, 'awaiting_approval');
  add('denied', 4, TITLES.denied, 'Teodor Vance', ids.other, 'denied');
  add('release', 5, TITLES.release, 'Ines Halloway', ids.admin, 'awaiting_release');
  add('searching', 7, TITLES.searching, 'Odette Marsh', ids.requester, 'searching');
  add('pending', 8, TITLES.pending, 'Ines Halloway', ids.other, 'pending');
  // Delivered: the library row carries the requested ASIN, so it merges into one book
  add('delivered', 6, TITLES.delivered, 'Ines Halloway', ids.requester, 'available', 100);
  insertRow(libraryId, 'delivered', `${ASIN_PREFIX}0006`, TITLES.delivered, 'Ines Halloway');
  psql(`update audiobooks set file_path = ${sqlStr(DELIVERED_PATH)} where audible_asin = '${ASIN_PREFIX}0006'`);
  const scanAuthors = ['Mara Quill', 'Odette Marsh', 'Odette Marsh', 'Teodor Vance'];
  TITLES.scan.forEach((title, i) => insertRow(libraryId, `scan-${i}`, `${ASIN_PREFIX}9${String(i).padStart(3, '0')}`, title, scanAuthors[i]));
  return out;
}

export const card = (page: Page, title: string) => page.locator('[data-library-card]', { hasText: title });

/** Records the page's list calls (GET /api/library without live=1). */
export function recordListCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (r.method() === 'GET' && url.pathname === '/api/library' && url.searchParams.get('live') !== '1') calls.push(url.search);
  });
  return calls;
}

/** Drops the focus an Esc close returns to its opener (its ring reads as a selected state in a shot). */
export async function blurFocus(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * The lowest contrast of a card's status line against its background, over every card that shows a
 * status (computed colours drawn on a canvas, so oklch values are compared as sRGB).
 */
export async function lowestStatusLineContrast(page: Page): Promise<{ ratio: number; text: string }> {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let worst = { ratio: Infinity, text: '' };
    for (const c of Array.from(document.querySelectorAll('[data-library-card]'))) {
      const line = c.querySelector('p.text-xs') as HTMLElement | null;
      if (!line || !line.textContent?.trim()) continue;
      const fg = lum(rgb(getComputedStyle(line).color));
      const bg = lum(rgb(getComputedStyle(document.body).backgroundColor));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < worst.ratio) worst = { ratio: Math.round(ratio * 100) / 100, text: line.textContent.trim() };
    }
    return worst;
  });
}

/** Header layout figures: page/row overflow, logo truncation, nav overflow and item overlap (px). */
export async function headerFigures(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')!;
    const row = header.querySelector(':scope > div > div') as HTMLElement;
    const logo = header.querySelector('a[href="/"] span') as HTMLElement;
    const nav = header.querySelector('nav') as HTMLElement | null;
    const navShown = !!nav && getComputedStyle(nav).display !== 'none';
    const kids = Array.from(row.children).filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getBoundingClientRect());
    let overlap = 0;
    for (let i = 1; i < kids.length; i++) overlap = Math.max(overlap, kids[i - 1].right - kids[i].left);
    return {
      width: window.innerWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      rowOverflow: row.scrollWidth - row.clientWidth,
      logoTruncated: logo.scrollWidth > logo.clientWidth,
      navShown,
      navOverflow: navShown ? nav!.scrollWidth - nav!.clientWidth : 0,
      overlap,
      username: (header.querySelector('button span.hidden') as HTMLElement | null)?.textContent ?? null,
    };
  });
}

/** Option B (not shipped): the inline nav kept at 768 with smaller text and gaps, username and version hidden. */
export const HEADER_OPTION_B_CSS = `
@media (min-width: 768px) {
  header nav.hidden { display: flex !important; gap: 0.75rem !important; font-size: 0.875rem !important; }
  header .lg\\:hidden { display: none !important; }
  header .sm\\:block { display: none !important; }
}`;
