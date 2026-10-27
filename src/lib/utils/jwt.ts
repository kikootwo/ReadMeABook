/**
 * Component: JWT Token Utilities
 * Documentation: documentation/backend/services/auth.md
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { RMABLogger } from './logger';

const logger = RMABLogger.create('JWT');

const ACCESS_TOKEN_EXPIRY = '1h'; // 1 hour
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

// When JWT_SECRET / JWT_REFRESH_SECRET are not provided (e.g. installs that bypass the unified
// container entrypoint), secrets are derived from CONFIG_ENCRYPTION_KEY via HKDF-SHA256.
// Changing any of these values changes every derived secret and invalidates all sessions.
const DERIVATION_SALT = 'readmeabook:jwt-secret-derivation';
const DERIVED_SECRET_BYTES = 32;
const ACCESS_SECRET_INFO = 'readmeabook:jwt:access:v1';
const REFRESH_SECRET_INFO = 'readmeabook:jwt:refresh:v1';

interface JwtSecrets {
  access: string;
  refresh: string;
  download: string;
}

let resolvedSecrets: JwtSecrets | null = null;

function resolveSecret(
  envName: 'JWT_SECRET' | 'JWT_REFRESH_SECRET',
  info: string
): { value: string; derived: boolean } {
  const explicit = process.env[envName];
  if (explicit) {
    return { value: explicit, derived: false };
  }

  const masterKey = process.env.CONFIG_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error(
      `${envName} is not set and cannot be derived: set JWT_SECRET and JWT_REFRESH_SECRET, or CONFIG_ENCRYPTION_KEY`
    );
  }

  const derived = crypto.hkdfSync('sha256', masterKey, DERIVATION_SALT, info, DERIVED_SECRET_BYTES);
  return { value: Buffer.from(derived).toString('base64'), derived: true };
}

/**
 * Resolve signing secrets on first use and memoize them.
 * Never resolved at module load, so `next build` works without secrets in the environment.
 */
function getSecrets(): JwtSecrets {
  if (resolvedSecrets) {
    return resolvedSecrets;
  }

  const access = resolveSecret('JWT_SECRET', ACCESS_SECRET_INFO);
  const refresh = resolveSecret('JWT_REFRESH_SECRET', REFRESH_SECRET_INFO);

  const derivedNames = [
    access.derived ? 'JWT_SECRET' : null,
    refresh.derived ? 'JWT_REFRESH_SECRET' : null,
  ].filter((name): name is string => name !== null);

  if (derivedNames.length > 0) {
    logger.info('JWT secrets not set in environment; derived from CONFIG_ENCRYPTION_KEY', {
      derived: derivedNames.join(', '),
    });
  }

  resolvedSecrets = {
    access: access.value,
    refresh: refresh.value,
    download: process.env.JWT_DOWNLOAD_SECRET || access.value + '-download',
  };
  return resolvedSecrets;
}

export interface TokenPayload {
  sub: string; // User ID
  plexId: string;
  username: string;
  role: string;
  iat?: number; // Issued-at (auto-set by jsonwebtoken)
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iat?: number; // Issued-at (auto-set by jsonwebtoken)
}

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecrets().access, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

/**
 * Generate refresh token (long-lived)
 */
export function generateRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = {
    sub: userId,
    type: 'refresh',
  };

  return jwt.sign(payload, getSecrets().refresh, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

/**
 * Verify access token
 * Throws (rather than returning null) if secrets are unconfigured, so misconfiguration is loud.
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  const { access } = getSecrets();
  try {
    const decoded = jwt.verify(token, access) as TokenPayload;
    return decoded;
  } catch (error) {
    logger.error('Access token verification failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  const { refresh } = getSecrets();
  try {
    const decoded = jwt.verify(token, refresh) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      return null;
    }
    return decoded;
  } catch (error) {
    logger.error('Refresh token verification failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

const DOWNLOAD_TOKEN_EXPIRY = '30d';

export interface DownloadTokenPayload {
  sub: string; // userId
  requestId: string;
  type: 'download';
  iat?: number; // Issued-at (auto-set by jsonwebtoken)
}

/**
 * Generate download token (30-day, stateless, URL-embeddable)
 */
export function generateDownloadToken(userId: string, requestId: string): string {
  const payload: DownloadTokenPayload = { sub: userId, requestId, type: 'download' };
  return jwt.sign(payload, getSecrets().download, { expiresIn: DOWNLOAD_TOKEN_EXPIRY });
}

/**
 * Verify download token
 */
export function verifyDownloadToken(token: string): DownloadTokenPayload | null {
  const { download } = getSecrets();
  try {
    const decoded = jwt.verify(token, download) as DownloadTokenPayload;
    if (decoded.type !== 'download') return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): any {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}
