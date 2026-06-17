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

/**
 * Shape of an allowed endpoint entry.
 * `path` may be a literal (e.g. `/api/requests`) or contain `:name` placeholders
 * that match a single path segment (e.g. `/api/requests/:id`).
 */
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
  /** True for endpoints that mutate state. Surfaced in the /api-docs UI. */
  isWrite?: boolean;
}

/**
 * Endpoints that API tokens are permitted to call.
 * JWT-authenticated sessions are NOT restricted by this list.
 */
export const API_TOKEN_ALLOWED_ENDPOINTS: readonly AllowedEndpoint[] = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'GET', path: '/api/audiobooks/search' },
  { method: 'GET', path: '/api/requests' },
  { method: 'POST', path: '/api/requests' },
  { method: 'GET', path: '/api/requests/:id' },
  { method: 'DELETE', path: '/api/requests/:id' },
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
    path: '/api/audiobooks/search',
    title: 'Search audiobooks',
    description:
      'Search Audible for audiobooks by title or author. Query params: `q` (required), `page` (optional). Returns enriched results including per-user request and library availability status.',
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
    method: 'POST',
    path: '/api/requests',
    title: 'Create request',
    description:
      'Create a new audiobook request on behalf of the token owner. Body: `{ "audiobook": { "asin", "title", "author", "narrator?", "description?", "coverArtUrl?" } }`. Follows the user\'s normal auto-approve rules; returns named error codes (`already_available`, `being_processed`, `duplicate`, `ignored`, `user_not_found`) on rejection.',
    requiresAdmin: false,
    isWrite: true,
  },
  {
    method: 'GET',
    path: '/api/requests/:id',
    title: 'Get request by ID',
    description:
      'Returns a single audiobook request including audiobook details, download history, and recent job state. Users may only fetch requests they own; admins may fetch any.',
    requiresAdmin: false,
  },
  {
    method: 'DELETE',
    path: '/api/requests/:id',
    title: 'Delete request',
    description:
      'Soft-deletes a request with cascading cleanup: removes media files from disk, deletes the library item from Audiobookshelf/Plex, and handles download client torrents/NZBs respecting seeding configuration. Users may only delete requests they own; admins may delete any. The request can be re-created after deletion.',
    requiresAdmin: false,
    isWrite: true,
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
 * Compiled allowlist used by `isEndpointAllowed`. Patterns with `:name`
 * placeholders are compiled to anchored regexes that match a single path
 * segment (`[^/]+`); literal paths use string equality.
 */
interface CompiledEndpoint {
  method: string;
  literal: string | null;
  pattern: RegExp | null;
}

function compileEndpoint(ep: AllowedEndpoint): CompiledEndpoint {
  const method = ep.method.toUpperCase();
  if (!ep.path.includes(':')) {
    return { method, literal: ep.path, pattern: null };
  }
  const escaped = ep.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');
  return { method, literal: null, pattern: new RegExp(`^${regexSource}$`) };
}

const COMPILED_ENDPOINTS: readonly CompiledEndpoint[] = API_TOKEN_ALLOWED_ENDPOINTS.map(compileEndpoint);

/**
 * Check whether a given method + path is on the API token allowlist.
 * Method comparison is case-insensitive. Supports dynamic single-segment
 * placeholders (`:id`) compiled at module load.
 */
export function isEndpointAllowed(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  return COMPILED_ENDPOINTS.some((ep) => {
    if (ep.method !== upperMethod) return false;
    if (ep.literal !== null) return ep.literal === path;
    return ep.pattern!.test(path);
  });
}
