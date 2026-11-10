/**
 * Component: E2E regression #232 (a denied request stays denied)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * A local user with interactive search access and approval required requests a book; the admin
 * denies it; the user's approval setting then changes to auto-approve. The user can't search
 * releases for, or pick a release for, the denied request (403 RequestDenied; on main the pick
 * started a download, because select-torrent re-checks approval on current settings only). The
 * admin still can: the admin's search returns results and the admin's pick starts the download.
 * API-level (real routes, real Prowlarr fake, real download job queue). The admin cancels the
 * request at the end, so nothing is left downloading for later specs.
 */

import { test, expect } from '@playwright/test';
import { fakeArr, urls, writeEvidence, Rmab } from '../../lib/harness';

// A fresh name per run, so the spec can run again on the same stack
const USER = { username: `carol232-${Date.now().toString(36)}`, password: 'e2e-carol-232-pass' };

async function registerUser(admin: Rmab): Promise<{ id: string; rmab: Rmab }> {
  const settings = await admin.raw('PUT', '/api/admin/settings/registration', { enabled: true, requireAdminApproval: false });
  expect(settings.status, 'registration turned on').toBe(200);
  const res = await fetch(`${urls.rmab()}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USER),
  });
  const body = await res.json();
  expect(res.status, `register: ${JSON.stringify(body)}`).toBe(200);
  expect(body.user.role).toBe('user');
  return { id: body.user.id, rmab: new Rmab(body.accessToken) };
}

async function setUser(admin: Rmab, id: string, autoApproveRequests: boolean) {
  const res = await admin.raw('PUT', `/api/admin/users/${id}`, { role: 'user', autoApproveRequests, interactiveSearchAccess: true });
  expect(res.status, `user settings (autoApprove ${autoApproveRequests})`).toBe(200);
}

const statusOf = async (admin: Rmab, id: string) => (await admin.get<{ request: { status: string } }>(`/api/requests/${id}`)).request.status;

test('#232: a user can\'t search or pick a release for a denied request; an admin still can', async () => {
  await fakeArr.scenario('preview');
  const book = (await fakeArr.books()).martian;
  const admin = await Rmab.loginAdmin();
  const user = await registerUser(admin);
  await setUser(admin, user.id, false); // approval required

  const created = await user.rmab.requestBook(book);
  expect(created.request.status, 'the request waits for approval').toBe('awaiting_approval');
  const requestId = created.request.id;

  const deny = await admin.post<{ success: boolean }>(`/api/admin/requests/${requestId}/approve`, { action: 'deny' });
  expect(deny.success).toBe(true);
  expect(await statusOf(admin, requestId)).toBe('denied');

  // The precondition: the user is now auto-approved
  await setUser(admin, user.id, true);

  const userSearch = await user.rmab.raw('POST', `/api/requests/${requestId}/interactive-search`, {});
  const userSearchBody = await userSearch.json();

  const adminSearch = await admin.post<{ success: boolean; results: Array<Record<string, unknown>> }>(`/api/requests/${requestId}/interactive-search`, {});
  expect(adminSearch.success, 'the admin can still search').toBe(true);
  expect(adminSearch.results.length, 'the admin\'s search found releases').toBeGreaterThan(0);
  const torrent = adminSearch.results[0];

  const userPick = await user.rmab.raw('POST', `/api/requests/${requestId}/select-torrent`, { torrent });
  const userPickBody = await userPick.json();
  const afterUserPick = await statusOf(admin, requestId);

  const adminPick = await admin.raw('POST', `/api/requests/${requestId}/select-torrent`, { torrent });
  const adminPickBody = await adminPick.json();
  const afterAdminPick = await statusOf(admin, requestId);

  writeEvidence('232/denied-pick.json', {
    requestId,
    userSearch: { status: userSearch.status, body: userSearchBody },
    adminSearch: { results: adminSearch.results.length, picked: torrent.title },
    userPick: { status: userPick.status, body: userPickBody, requestStatusAfter: afterUserPick },
    adminPick: { status: adminPick.status, success: adminPickBody.success, message: adminPickBody.message, requestStatusAfter: afterAdminPick },
  });

  expect.soft(userSearch.status, 'user search on a denied request').toBe(403);
  expect.soft(userSearchBody.error).toBe('RequestDenied');
  expect.soft(userPick.status, 'user pick on a denied request').toBe(403);
  expect.soft(userPickBody.error).toBe('RequestDenied');
  expect.soft(afterUserPick, 'the request stays denied after the user\'s pick').toBe('denied');
  expect.soft(adminPick.status, 'admin pick on a denied request').toBe(200);
  expect.soft(afterAdminPick, 'the admin\'s pick starts the download').toBe('downloading');

  // Leave nothing downloading: other specs request martian
  const cancel = await admin.raw('POST', `/api/requests/${requestId}/cancel`);
  expect.soft(cancel.status, 'cleanup: the admin cancels the request').toBe(200);
});
