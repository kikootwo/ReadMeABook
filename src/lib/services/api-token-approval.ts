/**
 * Component: API Token Request Approval (setting, create rule, route checks, audit)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * An admin's own API token may approve requests (never deny) when both opt-ins hold: the
 * `api_tokens.allow_request_approval` setting is 'true' and the token was created with
 * canApproveRequests. Such a token must expire within 90 days of its creation.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import {
  API_TOKEN_PREFIX,
  APPROVAL_TOKEN_EXPIRY_GRACE_MS,
  APPROVAL_TOKEN_MAX_LIFETIME_MS,
} from '@/lib/constants/api-tokens';
import type { ApprovalResult } from './request-approval.service';

const logger = RMABLogger.create('ApiTokenApproval');

/** Configuration key of the switch in Settings → API (off unless exactly 'true'). */
export const TOKEN_APPROVAL_SETTING_KEY = 'api_tokens.allow_request_approval';

/**
 * Reads the switch straight from the database on every call (not the config cache), so turning
 * it off applies at once. Throws when the row cannot be read; callers refuse in that case.
 */
export async function isTokenApprovalEnabled(): Promise<boolean> {
  const row = await prisma.configuration.findUnique({ where: { key: TOKEN_APPROVAL_SETTING_KEY } });
  return row?.value === 'true';
}

/**
 * The expiry stored for a new approval token, or null when the requested one is refused:
 * missing, unparseable, not after now, or more than the cap plus the grace after now. A value
 * within the grace band is stored as exactly now + the cap, so the stored expiry is at most
 * 90 days after creation.
 */
export function approvalTokenExpiry(requested: string | null | undefined, nowMs: number): Date | null {
  if (!requested) return null;
  const ms = Date.parse(requested);
  if (Number.isNaN(ms) || ms <= nowMs) return null;
  const lifetime = ms - nowMs;
  if (lifetime <= APPROVAL_TOKEN_MAX_LIFETIME_MS) return new Date(ms);
  if (lifetime <= APPROVAL_TOKEN_MAX_LIFETIME_MS + APPROVAL_TOKEN_EXPIRY_GRACE_MS) {
    return new Date(nowMs + APPROVAL_TOKEN_MAX_LIFETIME_MS);
  }
  return null;
}

/** Use-time check: the token has an expiry at most the cap plus the grace after its creation. */
export function hasApprovalTokenLifetime(createdAt: Date | null | undefined, expiresAt: Date | null | undefined): boolean {
  if (!createdAt || !expiresAt) return false;
  const created = createdAt.getTime();
  const expires = expiresAt.getTime();
  if (Number.isNaN(created) || Number.isNaN(expires)) return false;
  return expires - created <= APPROVAL_TOKEN_MAX_LIFETIME_MS + APPROVAL_TOKEN_EXPIRY_GRACE_MS;
}

export type ApprovalTokenCreateCheck =
  | { ok: true; expiresAt: Date }
  | { ok: false; status: 400 | 403; error: string; reason: string };

/**
 * The rule for creating a token with canApproveRequests: an admin (role from the database),
 * for their own account, while the setting is on (403 otherwise), with an expiry at most 90 days
 * away (400 otherwise). Throws when the setting cannot be read.
 */
export async function checkApprovalTokenCreate(input: {
  callerId: string;
  callerRole: string;
  targetUserId: string;
  expiresAt: string | null | undefined;
  nowMs: number;
}): Promise<ApprovalTokenCreateCheck> {
  if (input.callerRole !== 'admin') {
    return { ok: false, status: 403, error: 'Only an admin can create a token that approves requests.', reason: 'role' };
  }
  if (input.targetUserId !== input.callerId) {
    return { ok: false, status: 403, error: 'A token that approves requests can only be created for your own account.', reason: 'other_user' };
  }
  if (!(await isTokenApprovalEnabled())) {
    return {
      ok: false,
      status: 403,
      error: 'Turn on "Allow API tokens to approve requests" in Settings → API first.',
      reason: 'setting_off',
    };
  }
  const expiresAt = approvalTokenExpiry(input.expiresAt, input.nowMs);
  if (!expiresAt) {
    return { ok: false, status: 400, error: 'A token that approves requests must expire within 90 days.', reason: 'expiry' };
  }
  return { ok: true, expiresAt };
}

/** Anything with the shape of an authenticated route request (fake requests in tests included). */
interface CallerLike {
  apiToken?: unknown;
  headers?: { get(name: string): string | null } | null;
}

/**
 * True for an API token caller: `req.apiToken` is set by requireAuth, and independently the
 * bearer value starts with the token prefix (a session JWT never does).
 */
export function isTokenCaller(req: CallerLike): boolean {
  if (req.apiToken) return true;
  const header = typeof req.headers?.get === 'function' ? req.headers.get('authorization') : null;
  if (!header) return false;
  const match = /^\s*bearer\s+(\S+)/i.exec(header);
  return !!match && match[1].startsWith(API_TOKEN_PREFIX);
}

export interface TokenRefusal {
  status: 400 | 403;
  error: string;
  message: string;
  reason: 'deny' | 'release';
}

/** Route pre-check for a token caller, before any row is read: deny 403, a named release 400. */
export function tokenApprovalRefusal(body: { action: string; selectedTorrent?: unknown }): TokenRefusal | null {
  if (body.action !== 'approve') {
    return {
      status: 403,
      error: 'Forbidden',
      message: 'API tokens can only approve requests. Deny in the web UI or in Discord.',
      reason: 'deny',
    };
  }
  if (body.selectedTorrent !== undefined && body.selectedTorrent !== null) {
    return {
      status: 400,
      error: 'ValidationError',
      message: 'API tokens cannot choose a release. Leave out selectedTorrent.',
      reason: 'release',
    };
  }
  return null;
}

export type TokenApprovalOutcome =
  | 'approved'
  | 'denied'
  | 'not_found'
  | 'invalid_status'
  | 'source_unavailable'
  | 'pick_rejected'
  | 'refused_deny'
  | 'refused_release'
  | 'invalid_body'
  | 'error';

/** The audit outcome and resulting request status for a service result (every code mapped). */
export function approvalOutcome(result: ApprovalResult): { outcome: TokenApprovalOutcome; status: string | null } {
  if (result.ok) {
    return result.action === 'approve' ? { outcome: 'approved', status: result.status } : { outcome: 'denied', status: 'denied' };
  }
  switch (result.code) {
    case 'not_found':
      return { outcome: 'not_found', status: null };
    case 'invalid_status':
      return { outcome: 'invalid_status', status: result.currentStatus };
    case 'source_unavailable':
      return { outcome: 'source_unavailable', status: 'awaiting_approval' };
    case 'pick_rejected':
      return { outcome: 'pick_rejected', status: 'awaiting_approval' };
    default: {
      const unmapped: never = result;
      return { outcome: 'error', status: String((unmapped as { code?: unknown }).code ?? null) };
    }
  }
}

/** The token fields an audit line carries (never the secret). */
export interface AuditToken {
  id?: string;
  name?: string;
  tokenPrefix?: string;
}

/**
 * One warn line per token decision or refusal. The message is constant; every variable value
 * (request id from the path, token name) goes in metadata, which the logger JSON-encodes.
 */
export function auditTokenApproval(entry: {
  requestId: string | undefined;
  outcome: TokenApprovalOutcome;
  status: string | null;
  token: AuditToken | undefined;
  adminId: string | undefined;
}): void {
  logger.warn('API token request approval', {
    requestId: entry.requestId ?? null,
    outcome: entry.outcome,
    status: entry.status,
    tokenId: entry.token?.id ?? null,
    tokenPrefix: entry.token?.tokenPrefix ?? null,
    tokenName: entry.token?.name ?? null,
    adminId: entry.adminId ?? null,
    via: 'api_token',
  });
}
