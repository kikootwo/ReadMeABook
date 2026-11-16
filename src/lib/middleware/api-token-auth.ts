/**
 * Component: API Token Authentication (lookup, allowlist, permissions)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Used by requireAuth and getOptionalAuthUser for `rmab_` bearer tokens. A token passes an
 * endpoint only when the endpoint is on the allowlist AND every permission of every matching
 * allowlist entry passes; an unknown permission refuses.
 */

import crypto from 'crypto';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import type { TokenPayload } from '../utils/jwt';
import { getEndpointPermissions, isEndpointAllowed, type ApiTokenPermission } from '../constants/api-tokens';
import { getRegistrationRefusal } from '../services/auth/local-account-status';
import { hasApprovalTokenLifetime, isTokenApprovalEnabled } from '../services/api-token-approval';

const logger = RMABLogger.create('Auth');

/** The token behind an API token request (set on `req.apiToken`; never the secret). */
export interface ApiTokenContext {
  id: string;
  name: string;
  tokenPrefix: string;
  canApproveRequests: boolean;
}

export interface ApiTokenAuth {
  user: TokenPayload;
  token: ApiTokenContext;
  createdAt: Date;
  expiresAt: Date | null;
}

export type ApiTokenAccess =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: 'Forbidden' | 'ServiceUnavailable'; message: string };

export const NOT_ALLOWED_MESSAGE = 'This endpoint is not available via API token authentication';

/**
 * Authenticate a static API token (rmab_ prefix). Null when unknown, expired, or its user is
 * missing, deleted, pending approval or rejected. Updates lastUsedAt in the background.
 */
export async function authenticateApiToken(token: string): Promise<ApiTokenAuth | null> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: {
      tokenUser: {
        select: {
          id: true,
          plexId: true,
          plexUsername: true,
          role: true,
          deletedAt: true,
          registrationStatus: true,
        },
      },
    },
  });

  if (!apiToken) return null;

  // Check expiration
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    logger.warn('API token expired', { tokenPrefix: apiToken.tokenPrefix });
    return null;
  }

  // Reject tokens for missing, soft-deleted, pending-approval or rejected users
  const user = apiToken.tokenUser;
  const refusal = user ? getRegistrationRefusal(user.registrationStatus) : null;
  if (!user || user.deletedAt || refusal) {
    logger.warn('API token used by a missing, deleted or unapproved user', {
      tokenPrefix: apiToken.tokenPrefix,
      userId: user?.id,
      reason: !user ? 'missing' : user.deletedAt ? 'deleted' : refusal,
    });
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  }).catch((err) => {
    logger.debug('Failed to update API token lastUsedAt', {
      error: err instanceof Error ? err.message : String(err),
      tokenId: apiToken.id,
    });
  });

  // Use the token's target user (userId), not the creator (createdById).
  // The token's role is an upper bound: it never exceeds the owner's current role.
  return {
    user: {
      sub: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      role: apiToken.role === 'admin' && user.role === 'admin' ? 'admin' : 'user',
    },
    token: {
      id: apiToken.id,
      name: apiToken.name,
      tokenPrefix: apiToken.tokenPrefix,
      canApproveRequests: apiToken.canApproveRequests === true,
    },
    createdAt: apiToken.createdAt,
    expiresAt: apiToken.expiresAt,
  };
}

function forbidden(message: string): ApiTokenAccess {
  return { ok: false, status: 403, error: 'Forbidden', message };
}

/** approve_requests: the token flag, the effective admin role, a 90-day lifetime, the setting. */
async function checkApprovePermission(auth: ApiTokenAuth): Promise<ApiTokenAccess> {
  if (auth.token.canApproveRequests !== true) {
    return forbidden('This API token is not allowed to approve requests.');
  }
  if (auth.user.role !== 'admin') {
    return forbidden('Approving requests with an API token needs an admin account.');
  }
  if (!hasApprovalTokenLifetime(auth.createdAt, auth.expiresAt)) {
    return forbidden('A token that approves requests must expire within 90 days of its creation.');
  }
  let enabled: boolean;
  try {
    enabled = await isTokenApprovalEnabled();
  } catch (error) {
    logger.error('Could not read the API token approval setting; refusing request', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      status: 503,
      error: 'ServiceUnavailable',
      message: 'Could not read the API token approval setting. Try again shortly.',
    };
  }
  if (!enabled) {
    return forbidden('Approving requests with API tokens is turned off in Settings → API.');
  }
  return { ok: true };
}

/** One permission; the default refuses (and a new union member without a case fails the typecheck). */
async function checkPermission(permission: ApiTokenPermission, auth: ApiTokenAuth): Promise<ApiTokenAccess> {
  switch (permission) {
    case 'approve_requests':
      return checkApprovePermission(auth);
    default: {
      const unknown: never = permission;
      logger.warn('API token endpoint needs an unknown permission', { permission: String(unknown) });
      return forbidden(NOT_ALLOWED_MESSAGE);
    }
  }
}

/** Every permission must pass (checked in order; the first refusal is returned). */
export async function checkTokenPermissions(
  permissions: readonly ApiTokenPermission[],
  auth: ApiTokenAuth
): Promise<ApiTokenAccess> {
  for (const permission of permissions) {
    const access = await checkPermission(permission, auth);
    if (!access.ok) return access;
  }
  return { ok: true };
}

/** The access check for an authenticated token: the allowlist, then every collected permission. */
export async function checkTokenEndpointAccess(method: string, path: string, auth: ApiTokenAuth): Promise<ApiTokenAccess> {
  if (!isEndpointAllowed(method, path)) {
    logger.warn('API token used on restricted endpoint', { method, path });
    return forbidden(NOT_ALLOWED_MESSAGE);
  }
  const access = await checkTokenPermissions(getEndpointPermissions(method, path), auth);
  if (!access.ok) {
    logger.warn('API token refused by an endpoint permission', {
      method,
      path,
      tokenPrefix: auth.token.tokenPrefix,
      tokenName: auth.token.name,
      status: access.status,
      reason: access.message,
    });
  }
  return access;
}
