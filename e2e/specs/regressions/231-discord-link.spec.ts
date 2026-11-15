/**
 * Component: E2E regression #231 PR 1 (an admin links a Discord user ID to an account)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Over HTTP against the real image (default flags; exec bridge for psql), no UI:
 *   1  the admin links their own account and another user's; GET /api/admin/users lists both and the
 *      admin's role is unchanged
 *   2  the same ID for a second user: 409; a malformed ID: 400; nothing written
 *   3  refusals: the user's own session 403, an admin API token 403 (not on the allowlist)
 *   4  deleting the linked user clears the column, and the second user can then take the ID
 *   cleanup: links removed, the admin API token revoked
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, env, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { viewer } from './177-library-page-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);

const DIR = '231';
const linkPath = (id: string) => `/api/admin/users/${id}/discord`;
const storedLink = (id: string) => psql(`select coalesce(discord_user_id, '') from users where id = ${sqlStr(id)}`);

async function put(client: Rmab, id: string, discordUserId: unknown) {
  const res = await client.raw('PUT', linkPath(id), { discordUserId });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('231: admin-only Discord link; duplicate 409; user and API token 403; delete frees the ID', async () => {
  const stamp = Date.now();
  const SELF_ID = `7${stamp}11`;
  const OTHER_ID = `7${stamp}22`;
  const admin = await Rmab.loginAdmin();
  const result: Record<string, unknown> = { selfId: SELF_ID, otherId: OTHER_ID };
  let tokenId = '';
  let adminId = '';
  let second = '';

  try {
    const users = await admin.get<{ users: { id: string; plexUsername: string; role: string }[] }>('/api/admin/users');
    adminId = users.users.find((u) => u.plexUsername === env('E2E_ADMIN_USER'))?.id ?? '';
    expect(adminId, 'admin row').not.toBe('');
    const first = await viewer(admin, `d231a${stamp.toString(36)}`);
    second = (await viewer(admin, `d231b${stamp.toString(36)}`)).id;

    // 1 links
    const self = await put(admin, adminId, SELF_ID);
    const other = await put(admin, first.id, ` ${OTHER_ID} `);
    result.link = { self, other };
    expect(self).toEqual({ status: 200, body: { user: { id: adminId, discordUserId: SELF_ID } } });
    expect(other).toEqual({ status: 200, body: { user: { id: first.id, discordUserId: OTHER_ID } } });
    const listed = (await admin.get<{ users: { id: string; role: string; discordUserId: string | null }[] }>('/api/admin/users')).users;
    const row = (id: string) => listed.find((u) => u.id === id);
    result.listed = { admin: row(adminId), first: row(first.id), second: row(second) };
    expect(row(adminId)).toMatchObject({ role: 'admin', discordUserId: SELF_ID });
    expect(row(first.id)).toMatchObject({ discordUserId: OTHER_ID });
    expect(row(second)).toMatchObject({ discordUserId: null });

    // 2 duplicate and malformed
    const duplicate = await put(admin, second, OTHER_ID);
    const malformed = await put(admin, second, `<@${OTHER_ID}>`);
    result.refused = { duplicate, malformed };
    expect(duplicate).toEqual({ status: 409, body: { error: 'Conflict', message: 'This Discord account is already linked to another user' } });
    expect(malformed.status).toBe(400);
    expect(storedLink(second), 'second user still unlinked').toBe('');

    // 3 a user session and an admin API token
    const userSession = await put(new Rmab(first.accessToken), first.id, null);
    const token = await admin.post<{ fullToken: string; token: { id: string; role: string } }>('/api/user/api-tokens', { name: `e2e-231-${stamp}` });
    tokenId = token.token.id;
    expect(token.token.role).toBe('admin');
    const apiToken = await put(new Rmab(token.fullToken), second, `7${stamp}33`);
    result.forbidden = { userSession, apiToken };
    expect(userSession.status).toBe(403);
    expect(apiToken.status).toBe(403);
    expect(apiToken.body?.message).toBe('This endpoint is not available via API token authentication');
    expect(storedLink(first.id), 'first user link unchanged').toBe(OTHER_ID);
    expect(storedLink(second), 'second user still unlinked').toBe('');

    // 4 delete frees the ID
    const del = await admin.raw('DELETE', `/api/admin/users/${first.id}`);
    result.deleteStatus = del.status;
    expect(del.status).toBe(200);
    result.afterDelete = psql(`select concat_ws('|', (deleted_at is not null)::text, coalesce(discord_user_id, '')) from users where id = ${sqlStr(first.id)}`);
    expect(result.afterDelete, 'deleted row: deleted_at set, link cleared').toBe('true|');
    const retaken = await put(admin, second, OTHER_ID);
    result.retaken = retaken;
    expect(retaken).toEqual({ status: 200, body: { user: { id: second, discordUserId: OTHER_ID } } });
    expect(storedLink(second)).toBe(OTHER_ID);
  } finally {
    const cleanup: Record<string, number> = {};
    if (adminId) cleanup.self = (await put(admin, adminId, null)).status;
    if (second) cleanup.second = (await put(admin, second, '')).status;
    if (tokenId) cleanup.token = (await admin.raw('DELETE', `/api/user/api-tokens/${tokenId}`)).status;
    result.cleanup = cleanup;
    writeEvidence(`${DIR}/result.json`, result);
  }
  expect(result.cleanup).toEqual({ self: 200, second: 200, token: 200 });
});
