/**
 * Component: E2E #558 helpers (approval tokens: setting, create, approve through a token)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Shared by 231-approve-parity (token rows on every image), 558-token-approve and
 * 558-token-legacy. Token secrets stay inside the disposable stack and its evidence.
 */

import { expect } from '@playwright/test';
import { Rmab } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { answer, seedRequest } from './231-footprint-helpers';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SETTING_KEY = 'api_tokens.allow_request_approval';
export const MSG = {
  allowlist: 'This endpoint is not available via API token authentication',
  flag: 'This API token is not allowed to approve requests.',
  settingOff: 'Approving requests with API tokens is turned off in Settings → API.',
  lifetime: 'A token that approves requests must expire within 90 days of its creation.',
  deny: 'API tokens can only approve requests. Deny in the web UI or in Discord.',
  release: 'API tokens cannot choose a release. Leave out selectedTorrent.',
  createExpiry: 'A token that approves requests must expire within 90 days.',
  createOtherUser: 'A token that approves requests can only be created for your own account.',
  createRole: 'Only an admin can create a token that approves requests.',
} as const;

/** True on images whose schema has api_tokens.can_approve_requests (the branch). */
export const approvalColumnPresent = () =>
  psql("select count(*) from information_schema.columns where table_name = 'api_tokens' and column_name = 'can_approve_requests'") === '1';

/** The column's definition: `boolean|NO|false` on the branch. */
export const approvalColumnDefinition = () =>
  psql("select concat_ws('|', data_type, is_nullable, column_default) from information_schema.columns where table_name = 'api_tokens' and column_name = 'can_approve_requests'");

export async function setApprovalSetting(admin: Rmab, on: boolean) {
  const res = await admin.raw('PATCH', '/api/admin/settings/api-tokens', { allowRequestApproval: on });
  expect(res.status, `approval setting -> ${on}`).toBe(200);
}

export const settingRow = () => psql(`select coalesce(value, 'sql-null') from configuration where key = ${sqlStr(SETTING_KEY)}`) || 'no row';

export interface CreatedToken {
  id: string;
  secret: string;
  client: Rmab;
}

/**
 * POST /api/user/api-tokens as `session`; returns the raw answer, `answer` (status + the `error` text
 * the token routes send on a refusal) and, on 201, the token.
 */
export async function createToken(session: Rmab, body: Record<string, unknown>, path = '/api/user/api-tokens') {
  const res = await session.raw('POST', path, body);
  const json: { token?: { id: string }; fullToken?: string; error?: string } | null = await res.json().catch(() => null);
  const token: CreatedToken | null = res.status === 201 ? { id: json!.token!.id, secret: json!.fullToken!, client: new Rmab(json!.fullToken!) } : null;
  const error = json?.error ?? null;
  return { status: res.status, error, token, body: json, answer: { status: res.status, error } };
}

export const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

export async function approveWith(client: Rmab, requestId: string, body: Record<string, unknown> = { action: 'approve' }) {
  return answer(await client.raw('POST', `/api/admin/requests/${requestId}/approve`, body));
}

export const requestStatus = (requestId: string) => psql(`select status from requests where id = ${sqlStr(requestId)}`);

/**
 * Token rows for the #231 parity spec. On every image an unflagged admin token on the approve
 * route is refused (403; the message differs). On the branch only, with the setting on: a flagged
 * token's deny 403 and named release 400 leave the row waiting; setting off 403; a session approve
 * with an admin-picked magnet is 200 "admin-selected torrent".
 */
export async function tokenParity(admin: Rmab, stamp: string) {
  const branch = approvalColumnPresent();
  const tokens: CreatedToken[] = [];
  if (branch) await setApprovalSetting(admin, true);

  return {
    branch,
    async check(userId: string, seeded: string[]) {
      const out: Record<string, unknown> = { branch };
      const plain = await createToken(admin, { name: `e2e-558-plain-${stamp}`, expiresAt: null });
      expect(plain.status, 'unflagged admin token created').toBe(201);
      tokens.push(plain.token!);
      const target = seedRequest(userId, `K${stamp}`.slice(0, 4), 'awaiting_approval');
      seeded.push(target.bookId);
      out.unflagged = await approveWith(plain.token!.client, target.requestId);
      expect.soft(out.unflagged, 'unflagged token refused').toMatchObject({ status: 403, message: branch ? MSG.flag : MSG.allowlist });
      if (!branch) return out;

      const flagged = await createToken(admin, { name: `e2e-558-flagged-${stamp}`, canApproveRequests: true, expiresAt: inDays(90) });
      expect(flagged.status, `flagged token created: ${flagged.error}`).toBe(201);
      tokens.push(flagged.token!);
      const client = flagged.token!.client;
      out.deny = await approveWith(client, target.requestId, { action: 'deny' });
      out.afterDeny = requestStatus(target.requestId);
      out.release = await approveWith(client, target.requestId, { action: 'approve', selectedTorrent: { title: 'x', downloadUrl: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111' } });
      out.afterRelease = requestStatus(target.requestId);
      await setApprovalSetting(admin, false);
      out.settingOff = await approveWith(client, target.requestId);
      await setApprovalSetting(admin, true);
      expect.soft(out.deny).toMatchObject({ status: 403, message: MSG.deny });
      expect.soft(out.afterDeny).toBe('awaiting_approval');
      expect.soft(out.release).toMatchObject({ status: 400, error: 'ValidationError', message: MSG.release });
      expect.soft(out.afterRelease).toBe('awaiting_approval');
      expect.soft(out.settingOff).toMatchObject({ status: 403, message: MSG.settingOff });

      // Sessions with the setting on: an admin-picked release still downloads
      const picked = seedRequest(userId, `M${stamp}`.slice(0, 4), 'awaiting_approval');
      seeded.push(picked.bookId);
      const pick = { title: 'E2E 558 Admin Pick [M4B]', downloadUrl: 'magnet:?xt=urn:btih:5585585585585585585585585585585585585585&dn=E2E%20558', size: 1000, seeders: 5, indexer: 'E2E Torrents' };
      out.sessionPick = await approveWith(admin, picked.requestId, { action: 'approve', selectedTorrent: pick });
      expect.soft(out.sessionPick).toEqual({ status: 200, error: null, message: 'Request approved and download started with admin-selected torrent', requestStatus: 'downloading' });
      return out;
    },
    async cleanup() {
      if (branch) await admin.raw('PATCH', '/api/admin/settings/api-tokens', { allowRequestApproval: false }).catch(() => null);
      for (const t of tokens) await admin.raw('DELETE', `/api/user/api-tokens/${t.id}`).catch(() => null);
    },
  };
}
