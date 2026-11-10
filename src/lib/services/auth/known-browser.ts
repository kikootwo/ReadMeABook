/**
 * Component: Known-Browser Cookie
 * Documentation: documentation/backend/services/auth.md
 *
 * A browser that has passed an account's password check gets a signed, httpOnly cookie.
 * Its later sign-in attempts for that account are counted under their own limit instead
 * of the account and address limits. The cookie carries no session and no access.
 *
 * Value: v1.<userId>.<issuedAtSeconds>.<mac>, mac = base64url HMAC-SHA256 over the user id,
 * the issue time and a hash of the account's stored password hash, keyed by a purpose key
 * derived from the access-token secret. A password change, a deleted account or a new
 * secret ends every cookie for that account.
 *
 * Counts: one account has at most SLOTS_PER_ACCOUNT known-browser buckets. A cookie's
 * slot comes from its MAC, so a fifth browser shares a slot (and its count) with one of
 * the others; no cookie is ended to make room.
 */

import crypto from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { derivePurposeKey } from '@/lib/utils/jwt';

export const KNOWN_BROWSER_COOKIE = 'rmab_known_browser';

const VERSION = 'v1';
const PURPOSE = 'known-browser:v1';
const MAC_BYTES = 32;
const MAX_COOKIE_CHARS = 256;
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const FUTURE_SKEW_SECONDS = 5 * 60;
const BUCKET_ID_CHARS = 32;
export const SLOTS_PER_ACCOUNT = 4;

/** The fields of the signed-in account row the cookie is bound to */
export interface KnownBrowserAccount {
  id: string;
  authToken: string | null;
}

function passwordBinding(authToken: string): string {
  return crypto.createHash('sha256').update(authToken).digest('hex');
}

function computeMac(userId: string, issuedAt: number, authToken: string): Buffer {
  const binding = passwordBinding(authToken);
  return crypto
    .createHmac('sha256', derivePurposeKey(PURPOSE))
    .update(`rmab-known-browser|${VERSION}|${userId}|${issuedAt}|${binding}`)
    .digest();
}

/**
 * Bucket id for a cookie that is valid for this account, or null (an unknown browser).
 * Never throws; any malformed, expired or mismatched value is simply unknown.
 */
export function knownBrowserBucket(
  cookieValue: string | undefined,
  account: KnownBrowserAccount | null,
  nowMs: number = Date.now()
): string | null {
  if (!cookieValue || cookieValue.length > MAX_COOKIE_CHARS) return null;
  if (!account || !account.authToken) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, userId, issuedAtText, macText] = parts;
  if (userId !== account.id) return null;

  if (!/^\d{1,12}$/.test(issuedAtText)) return null;
  const issuedAt = Number(issuedAtText);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (issuedAt > nowSeconds + FUTURE_SKEW_SECONDS || nowSeconds - issuedAt > MAX_AGE_SECONDS) return null;

  if (!/^[A-Za-z0-9_-]+$/.test(macText)) return null;
  const presented = Buffer.from(macText, 'base64url');
  if (presented.length !== MAC_BYTES) return null;

  const expected = computeMac(userId, issuedAt, account.authToken);
  if (!crypto.timingSafeEqual(presented, expected)) return null;

  // Slot from the recomputed MAC (encoding variants of one cookie share it); the password
  // binding gives the account fresh buckets after a password change
  const slot = expected[0] % SLOTS_PER_ACCOUNT;
  return crypto
    .createHash('sha256')
    .update(`${userId}|${passwordBinding(account.authToken)}|${slot}`)
    .digest('hex')
    .slice(0, BUCKET_ID_CHARS);
}

/** Read the cookie from a sign-in request */
export function readKnownBrowserCookie(request: NextRequest): string | undefined {
  return request.cookies.get(KNOWN_BROWSER_COOKIE)?.value;
}

/** True when the request reached the app over https (first X-Forwarded-Proto value) */
function arrivedOverHttps(request: NextRequest): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  return proto?.split(',')[0].trim().toLowerCase() === 'https';
}

/** Set (or renew) the cookie for this account on a successful sign-in response */
export function setKnownBrowserCookie(
  response: NextResponse,
  request: NextRequest,
  account: KnownBrowserAccount,
  nowMs: number = Date.now()
): void {
  if (!account.authToken) return;
  const issuedAt = Math.floor(nowMs / 1000);
  const mac = computeMac(account.id, issuedAt, account.authToken).toString('base64url');
  response.cookies.set(KNOWN_BROWSER_COOKIE, `${VERSION}.${account.id}.${issuedAt}.${mac}`, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: MAX_AGE_SECONDS,
    // By request scheme: browsers drop a Secure cookie set over plain http
    secure: arrivedOverHttps(request),
  });
}
