/**
 * Component: API Token Request Approval Guard
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * API tokens may approve or deny requests only when every gate passes:
 *   1. The admin setting `api_tokens.allow_request_approval` is on (off by default).
 *   2. The token was created with `canApproveRequests` (set once, at creation, never edited).
 *   3. The token's effective role is admin (an admin token of a demoted owner acts as `user`).
 * A token can only approve with the requester's own pick or an automatic search: it can never
 * name a release itself (enforced in the approve route).
 */

import { prisma } from '@/lib/db';

/** Configuration key for the admin switch. Absent or anything but 'true' means off. */
export const TOKEN_APPROVAL_SETTING_KEY = 'api_tokens.allow_request_approval';

/** Extra rights a token must carry for some allowlisted endpoints */
export type ApiTokenPermission = 'approve_requests';

/** The token details the middleware passes to route handlers */
export interface ApiTokenInfo {
  id: string;
  name: string;
  tokenPrefix: string;
  canApproveRequests: boolean;
}

/** Read straight from the database (not the config cache) so turning it off applies at once */
export async function isTokenApprovalEnabled(): Promise<boolean> {
  const row = await prisma.configuration.findUnique({ where: { key: TOKEN_APPROVAL_SETTING_KEY } });
  return row?.value === 'true';
}

/** Why a token may not use an endpoint that needs `permission`, or null when it may */
export async function tokenPermissionRefusal(
  permission: ApiTokenPermission,
  token: ApiTokenInfo,
  role: string
): Promise<string | null> {
  // 'approve_requests' is the only permission so far
  if (permission === 'approve_requests' && !token.canApproveRequests) {
    return 'This API token cannot approve requests. Create a new token with "Can approve requests" ticked.';
  }
  if (role !== 'admin') return 'Only an admin API token can approve requests';
  if (!(await isTokenApprovalEnabled())) {
    return 'An admin has not allowed API tokens to approve requests (Settings → API)';
  }
  return null;
}

/**
 * Why a token may not be created with `canApproveRequests`, or null when it may. Only an admin, for
 * their own admin account, while the admin setting is on.
 */
export async function approvalTokenCreateRefusal(opts: {
  creatorId: string;
  targetUserId: string;
  targetRole: string;
}): Promise<string | null> {
  if (opts.targetRole !== 'admin') return 'Only admins can create a token that approves requests';
  if (opts.creatorId !== opts.targetUserId) {
    return 'A token that approves requests can only be created for your own account';
  }
  if (!(await isTokenApprovalEnabled())) {
    return 'Allow API tokens to approve requests in Settings → API first';
  }
  return null;
}
