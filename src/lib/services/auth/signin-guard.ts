/**
 * Component: Sign-in Attempt Limits
 * Documentation: documentation/backend/services/auth.md
 *
 * Shared by POST /api/auth/admin/login and POST /api/auth/local/login. Each password
 * check is reserved first, in one synchronous step, and refunded when the password is
 * right:
 * - a browser holding a valid known-browser cookie for the account: its own bucket only
 *   (when that table has no room, it is counted like any other browser);
 * - any other browser: the account bucket and the client address bucket, all or none.
 * Unknown names are counted like real ones and get a password check against a fixed
 * dummy hash, so both answer the same way.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { NextRequest, NextResponse } from 'next/server';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { clientAddressKey } from '@/lib/utils/client-address';
import { formatRetryAfter, refund, reserve, type RateLimitRefusal, type Reservation } from '@/lib/utils/rateLimit';
import {
  knownBrowserBucket,
  readKnownBrowserCookie,
  setKnownBrowserCookie,
  type KnownBrowserAccount,
} from './known-browser';

const logger = RMABLogger.create('Auth.SignInLimits');

/** bcrypt (cost 10, the cost every stored hash uses) of a random string; not a secret */
export const DUMMY_PASSWORD_HASH = '$2b$10$NzbmpVLqLXNf19VV5rN/eOO54.6iw5bfCN8dCbNIpB5bTp0.q6onW';

const LOGGED_USERNAME_CHARS = 64;
const ACCOUNT_KEY_CHARS = 32;

export type SignInAccount = KnownBrowserAccount;

export type SignInBeginResult = { ok: true } | { ok: false; error: string; retryAfterSeconds: number };

export interface SignInGuard {
  /** Reserve this attempt. Call after the account lookup and before the password check. */
  begin(normalizedUsername: string, account: SignInAccount | null): SignInBeginResult;
  /** Refund this attempt's reservations when the password was right */
  settle(passwordValid: boolean): void;
  /** On a full sign-in, mark this browser as known for the account */
  remember(response: NextResponse): void;
}

/** A username as it may appear in a log line */
export function loggedUsername(username: unknown): string {
  return String(username).slice(0, LOGGED_USERNAME_CHARS);
}

function refusalText(refusal: RateLimitRefusal): string {
  const wait = formatRetryAfter(refusal.retryAfterSeconds);
  if (refusal.reason === 'full') {
    return `Sign-in is busy. Try again in ${wait}.`;
  }
  if (refusal.namespace === 'signin-known-browser') {
    return `Too many sign-in attempts from this browser. Try again in ${wait}.`;
  }
  if (refusal.namespace === 'signin-address') {
    return `Too many sign-in attempts from your network. Try again in ${wait}.`;
  }
  return `Too many sign-in attempts for this account. Try again in ${wait}, or sign in from a browser you've used with this account before.`;
}

function logRefusal(refusal: RateLimitRefusal, username: string, account: SignInAccount | null): void {
  if (!refusal.firstRefusal) return;
  const minutes = Math.max(1, Math.ceil(refusal.retryAfterSeconds / 60));
  if (refusal.namespace === 'signin-known-browser') {
    logger.warn('Sign-in attempts paused for a known browser', { userId: account?.id, minutes });
  } else if (refusal.namespace === 'signin-address') {
    logger.warn('Sign-in attempts paused for an address', { address: refusal.key, minutes });
  } else {
    logger.warn('Sign-in attempts paused for an account', { username: loggedUsername(username), minutes });
  }
}

/** The guard for one sign-in request */
export function createSignInGuard(request: NextRequest): SignInGuard {
  let account: SignInAccount | null = null;
  let reservations: Reservation[] = [];
  let passwordValid = false;

  return {
    begin(normalizedUsername, found) {
      account = found;
      const browser = knownBrowserBucket(readKnownBrowserCookie(request), found);
      let result = browser ? reserve([{ namespace: 'signin-known-browser', key: browser }]) : null;
      // No browser cookie, or no room for its bucket: the account and address limits apply
      if (!result || (!result.ok && result.refusal.reason === 'full')) {
        result = reserve([
          {
            namespace: 'signin-account',
            key: crypto.createHash('sha256').update(normalizedUsername).digest('hex').slice(0, ACCOUNT_KEY_CHARS),
          },
          { namespace: 'signin-address', key: clientAddressKey(request.headers) },
        ]);
      }
      if (!result.ok) {
        logRefusal(result.refusal, normalizedUsername, found);
        return { ok: false, error: refusalText(result.refusal), retryAfterSeconds: result.refusal.retryAfterSeconds };
      }
      reservations = result.reservations;
      return { ok: true };
    },
    settle(valid) {
      passwordValid = valid;
      if (valid) refund(reservations);
      reservations = [];
    },
    remember(response) {
      if (account && passwordValid) setKnownBrowserCookie(response, request, account);
    },
  };
}

/** After a password change, keep the browser that made it known (for the new password) */
export function renewKnownBrowser(response: NextResponse, request: NextRequest, account: SignInAccount): void {
  setKnownBrowserCookie(response, request, account);
}

/**
 * Check a password against the account's stored hash. No account, or a stored hash that
 * can't be read, checks against the dummy hash instead and is always invalid.
 */
export async function verifyPassword(account: SignInAccount | null, password: string): Promise<boolean> {
  if (account) {
    try {
      const storedHash = getEncryptionService().decrypt(account.authToken || '');
      return await bcrypt.compare(password, storedHash);
    } catch (error) {
      logger.error('Password verification failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
  return false;
}

/** The 429 answer for a refused sign-in */
export function tooManyAttemptsResponse(error: string, retryAfterSeconds: number): NextResponse {
  return NextResponse.json({ error }, { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } });
}
