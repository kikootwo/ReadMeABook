/**
 * Component: API Token Constants
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Centralized API token constants used across authentication middleware and token routes.
 */

/** Prefix prepended to all generated API tokens for identification */
export const API_TOKEN_PREFIX = 'rmab_';

/** Number of random bytes used to generate the token's random portion */
export const TOKEN_RANDOM_BYTES = 32;

/** Length of the token prefix stored in the database for display (first 12 chars: "rmab_" + 7 hex chars) */
export const TOKEN_PREFIX_LENGTH = 12;

/** Maximum number of active (non-expired) API tokens a single user may hold */
export const MAX_TOKENS_PER_USER = 25;

// ---------------------------------------------------------------------------
// Endpoint allowlist — restricts which routes API tokens may access
// ---------------------------------------------------------------------------

/** Shape of an allowed endpoint entry */
export interface AllowedEndpoint {
  method: string;
  path: string;
}

/** Extended metadata used by the interactive API docs page */
export interface EndpointDoc {
  method: string;
  path: string;
  title: string;
  description: string;
  requiresAdmin: boolean;
}

/**
 * Endpoints that API tokens are permitted to call.
 * JWT-authenticated sessions are NOT restricted by this list.
 */
export const API_TOKEN_ALLOWED_ENDPOINTS: readonly AllowedEndpoint[] = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'GET', path: '/api/requests' },
  { method: 'GET', path: '/api/admin/metrics' },
  { method: 'GET', path: '/api/admin/downloads/active' },
  { method: 'GET', path: '/api/admin/requests/recent' },
] as const;

/**
 * Full documentation metadata for each allowed endpoint.
 * Consumed by the /api-docs interactive page.
 */
export const API_TOKEN_ENDPOINT_DOCS: readonly EndpointDoc[] = [
  {
    method: 'GET',
    path: '/api/auth/me',
    title: 'Get current user',
    description:
      'Returns the authenticated user\'s profile information including username, role, and account details.',
    requiresAdmin: false,
  },
  {
    method: 'GET',
    path: '/api/requests',
    title: 'List requests',
    description:
      'Returns all audiobook requests visible to the authenticated user. Admins see all requests, users see their own.',
    requiresAdmin: false,
  },
  {
    method: 'GET',
    path: '/api/admin/metrics',
    title: 'System metrics',
    description:
      'Returns system health metrics including request counts, download statistics, and library size.',
    requiresAdmin: true,
  },
  {
    method: 'GET',
    path: '/api/admin/downloads/active',
    title: 'Active downloads',
    description:
      'Returns currently active downloads including progress, speed, and ETA.',
    requiresAdmin: true,
  },
  {
    method: 'GET',
    path: '/api/admin/requests/recent',
    title: 'Recent requests',
    description:
      'Returns the most recent audiobook requests across all users.',
    requiresAdmin: true,
  },
] as const;

/**
 * Check whether a given method + path is on the API token allowlist.
 * Method comparison is case-insensitive.
 */
export function isEndpointAllowed(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  return API_TOKEN_ALLOWED_ENDPOINTS.some(
    (ep) => ep.method === upperMethod && ep.path === path
  );
}
