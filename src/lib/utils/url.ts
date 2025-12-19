/**
 * URL Utilities for OAuth and Redirects
 * Documentation: documentation/backend/services/environment.md
 */

/**
 * Get application base URL for OAuth callbacks and redirects
 *
 * Priority order:
 * 1. PUBLIC_URL - Primary documented environment variable
 * 2. NEXTAUTH_URL - Legacy fallback for backward compatibility
 * 3. BASE_URL - Alternative fallback
 * 4. http://localhost:3030 - Development default
 *
 * @returns Normalized base URL (no trailing slash)
 *
 * @example
 * // With PUBLIC_URL set
 * process.env.PUBLIC_URL = 'https://example.com/'
 * getBaseUrl() // Returns: 'https://example.com'
 *
 * // Without any env vars (development)
 * getBaseUrl() // Returns: 'http://localhost:3030'
 */
export function getBaseUrl(): string {
  const publicUrl = process.env.PUBLIC_URL?.trim();
  const nextAuthUrl = process.env.NEXTAUTH_URL?.trim();
  const baseUrl = process.env.BASE_URL?.trim();

  // Priority: PUBLIC_URL > NEXTAUTH_URL > BASE_URL > localhost
  let url = publicUrl || nextAuthUrl || baseUrl || 'http://localhost:3030';

  // Normalize: remove trailing slash
  url = url.replace(/\/$/, '');

  // Validate URL format
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    console.warn(`[URL Utility] Invalid base URL format: ${url}. URLs must start with http:// or https://`);
  }

  // Production warning if using localhost
  if (process.env.NODE_ENV === 'production' && url.includes('localhost')) {
    console.warn('[URL Utility] ⚠️  WARNING: Using localhost URL in production. OAuth callbacks may fail. Set PUBLIC_URL environment variable.');
  }

  // Log which variable is being used (debug only)
  if (process.env.LOG_LEVEL === 'debug') {
    const source = publicUrl ? 'PUBLIC_URL' :
                   nextAuthUrl ? 'NEXTAUTH_URL' :
                   baseUrl ? 'BASE_URL' :
                   'default (localhost)';
    console.debug(`[URL Utility] Using base URL from ${source}: ${url}`);
  }

  return url;
}

/**
 * Build full OAuth callback URL
 *
 * @param path - Callback path (e.g., '/api/auth/oidc/callback')
 * @returns Full callback URL
 *
 * @example
 * getCallbackUrl('/api/auth/oidc/callback')
 * // Returns: 'https://example.com/api/auth/oidc/callback'
 */
export function getCallbackUrl(path: string): string {
  const baseUrl = getBaseUrl();

  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${baseUrl}${normalizedPath}`;
}
