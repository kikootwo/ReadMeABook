/**
 * Component: E2E helpers for the #542 Explicit mark spec (user sessions, ABS item reads, API key swap)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { expect, type Browser } from '@playwright/test';
import { Abs, Rmab, snap, urls } from '../../lib/harness';

const PASSWORD = 'e2e-542-explicit-pass';

export interface UserSession {
  id: string;
  name: string;
  rmab: Rmab;
  storage: { cookies: never[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
}

/** A documentation-range address (TEST-NET-2) per name: the register route keys its limit on a valid client address. */
const addressFor = (name: string) => `198.51.100.${([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 254) + 1}`;

/**
 * Register a local user (registration on, no approval) with auto-approve on, and keep its tokens as a
 * browser storage state. The register route allows 5 attempts an hour per client address.
 */
export async function registerSession(admin: Rmab, username: string): Promise<UserSession> {
  const res = await fetch(`${urls.rmab()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': addressFor(username) },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await res.json();
  expect(res.status, `register ${username}: ${JSON.stringify(body)}`).toBe(200);
  expect((await admin.raw('PUT', `/api/admin/users/${body.user.id}`, { role: 'user', autoApproveRequests: true })).status).toBe(200);
  const origin = new URL(urls.rmab()).origin;
  return {
    id: body.user.id,
    name: username,
    rmab: new Rmab(body.accessToken),
    storage: { cookies: [], origins: [{ origin, localStorage: [
      { name: 'accessToken', value: body.accessToken },
      ...(body.refreshToken ? [{ name: 'refreshToken', value: body.refreshToken }] : []),
      { name: 'user', value: JSON.stringify(body.user) },
    ] }] },
  };
}

/** A browser context for a user (or the admin's storage file); shots wait for transitions and images. */
export async function browse(browser: Browser, storage: UserSession['storage'] | string, width: number, height: number, dark: boolean) {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', storageState: storage });
  const page = await ctx.newPage();
  const shot = async (dir: string, name: string) => {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)
      && Array.from(document.images).every((i) => i.complete));
    await page.waitForTimeout(300);
    await snap(page, dir, name);
  };
  const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return { ctx, page, shot, overflowX };
}

export interface ItemState {
  explicit: unknown;
  title: string;
  authors: string[];
  asin: string | null;
  tags: string[];
  updatedAt: number;
}

/** The item as ABS holds it now (root). */
export async function itemState(abs: Abs, itemId: string): Promise<ItemState> {
  type Metadata = { explicit?: unknown; title: string; authors?: { name: string }[]; asin?: string | null };
  const item = await abs.req<{ media: { metadata: Metadata; tags: string[] }; updatedAt: number }>('GET', `/api/items/${itemId}`);
  const m = item.media.metadata;
  return {
    explicit: m.explicit,
    title: m.title,
    authors: (m.authors || []).map((a) => a.name),
    asin: m.asin ?? null,
    tags: item.media.tags,
    updatedAt: item.updatedAt,
  };
}

/** ABS permissions for a "user" account; update on, explicit access as given. */
export const userPermissions = (accessExplicitContent: boolean, update = false) => ({
  download: true, update, delete: false, upload: false, accessAllLibraries: true, accessAllTags: true, accessExplicitContent,
});

/** Create an ABS "user" account; returns its id and a client signed in as it. */
export async function absUser(abs: Abs, username: string, accessExplicitContent: boolean, update = false): Promise<{ id: string; client: Abs }> {
  const password = `${PASSWORD}-${username}`;
  const created = await abs.req<{ user: { id: string } }>('POST', '/api/users', {
    username, password, type: 'user', isActive: true, permissions: userPermissions(accessExplicitContent, update), librariesAccessible: [], itemTagsSelected: [],
  });
  const login = await (await fetch(`${urls.abs()}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json();
  return { id: created.user.id, client: new Abs(login.user.accessToken || login.user.token) };
}

/** A new ABS API key for a user (root creates it). */
export async function absApiKey(abs: Abs, userId: string, name: string): Promise<string> {
  const key = await abs.req<{ apiKey: { apiKey: string } }>('POST', '/api/api-keys', { name, userId, isActive: true });
  expect(key.apiKey?.apiKey, `API key ${name}`).toBeTruthy();
  return key.apiKey.apiKey;
}

/** Point RMAB at another ABS API key, keeping the other ABS settings (as the settings page sends them). */
export async function setAbsKey(admin: Rmab, apiToken: string) {
  const s = (await admin.get<{ audiobookshelf: Record<string, unknown> }>('/api/admin/settings')).audiobookshelf;
  const res = await admin.raw('PUT', '/api/admin/settings/audiobookshelf', {
    serverUrl: s.serverUrl, apiToken, libraryId: s.libraryId, triggerScanAfterImport: s.triggerScanAfterImport, tagRequester: s.tagRequester === true,
  });
  expect(res.status, `switch the ABS key: ${await res.clone().text()}`).toBe(200);
}

/** GET as another ABS client: the status only (200 readable, 403 hidden). */
export async function readStatus(client: Abs, itemId: string): Promise<number> {
  return (await fetch(`${urls.abs()}/api/items/${itemId}`, { headers: { Authorization: `Bearer ${client.token}` } })).status;
}

/** PUT the mark through the API as a session; status and body. */
export async function putExplicit(rmab: Rmab, requestId: string, explicit: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await rmab.raw('PUT', `/api/requests/${requestId}/explicit`, { explicit });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
