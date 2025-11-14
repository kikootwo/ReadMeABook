/**
 * Component: Client-Side JWT Utilities
 * Documentation: documentation/frontend/routing-auth.md
 */

interface JWTPayload {
  sub: string;
  plexId: string;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

/**
 * Decode JWT without verification (client-side only)
 * Note: This does NOT verify the signature - only use for reading claims
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded as JWTPayload;
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return decoded.exp < now;
}

/**
 * Get milliseconds until token expires
 */
export function getTokenExpiryMs(token: string): number | null {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = decoded.exp - now;
  return expiresIn > 0 ? expiresIn * 1000 : 0;
}

/**
 * Get milliseconds until token should be refreshed (5 mins before expiry)
 */
export function getRefreshTimeMs(token: string): number | null {
  const expiryMs = getTokenExpiryMs(token);
  if (expiryMs === null) {
    return null;
  }

  const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  const refreshTime = expiryMs - REFRESH_BUFFER_MS;
  return refreshTime > 0 ? refreshTime : 0;
}
