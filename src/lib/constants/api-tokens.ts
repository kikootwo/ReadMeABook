/**
 * Component: API Token Constants
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Centralized API token constants used across authentication middleware and token routes.
 */

import { CANCELLABLE_STATUSES } from './request-statuses';

/** "a, b or c": the statuses a request can be cancelled from, for the cancel route's description */
const CANCELLABLE_LIST = `${CANCELLABLE_STATUSES.slice(0, -1).join(', ')} or ${CANCELLABLE_STATUSES[CANCELLABLE_STATUSES.length - 1]}`;

/** Prefix prepended to all generated API tokens for identification */
export const API_TOKEN_PREFIX = 'rmab_';

/** Number of random bytes used to generate the token's random portion */
export const TOKEN_RANDOM_BYTES = 32;

/** Length of the token prefix stored in the database for display (first 12 chars: "rmab_" + 7 hex chars) */
export const TOKEN_PREFIX_LENGTH = 12;

/** Maximum number of active (non-expired) API tokens a single user may hold */
export const MAX_TOKENS_PER_USER = 25;

/** A permission an allowlist entry needs on top of the allowlist itself (checked per token). */
export type ApiTokenPermission = 'approve_requests';

const DAY_MS = 24 * 60 * 60 * 1000;

/** An approval token must expire at most this many days after it is created. */
export const APPROVAL_TOKEN_MAX_DAYS = 90;

/** The longest lifetime an approval token is stored with (90 days, in milliseconds). */
export const APPROVAL_TOKEN_MAX_LIFETIME_MS = APPROVAL_TOKEN_MAX_DAYS * DAY_MS;

/**
 * A requested expiry up to this far past the cap (a local-date 90 days across a clock change,
 * a browser clock running ahead) is stored as exactly the cap; anything later is refused.
 */
export const APPROVAL_TOKEN_EXPIRY_GRACE_MS = DAY_MS;

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
  /** Opt-in permission the token must also hold (see api-token-auth.ts). */
  permission?: ApiTokenPermission;
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
  /** Set for opt-in endpoints (shown as "Opt-in" in the /api-docs UI). */
  permission?: ApiTokenPermission;
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
  { method: 'POST', path: '/api/requests/:id/cancel' },
  { method: 'GET', path: '/api/admin/metrics' },
  { method: 'GET', path: '/api/admin/downloads/active' },
  { method: 'GET', path: '/api/admin/requests/recent' },
  { method: 'POST', path: '/api/admin/requests/:id/approve', permission: 'approve_requests' },
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
      'Search Audible for audiobooks by title or author. Query params: `q` (required), `page` (optional). Returns enriched results including per-user request and library availability status. While the admin language filter is on, each page also carries `hiddenCount` (results in other languages left out) and `filterLanguage`, and a page can be empty with `hasMore: true`: keep paging while `hasMore` is true.',
    requiresAdmin: false,
  },
  {
    method: 'GET',
    path: '/api/requests',
    title: 'List requests',
    description:
      'Returns all audiobook requests visible to the authenticated user. Admins see all requests, users see their own. While a request is `processing`, `progress` is 100, except during the chapter merge, when it runs from 0 to 99.',
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
      'Returns a single audiobook request including audiobook details, download history, and recent job state. Users may only fetch requests they own; admins may fetch any. While a request is `processing`, `progress` is 100, except during the chapter merge, when it runs from 0 to 99.',
    requiresAdmin: false,
  },
  {
    method: 'POST',
    path: '/api/requests/:id/cancel',
    title: 'Cancel request',
    description:
      `Cancels a request whose status is ${CANCELLABLE_LIST}. RMAB stops its download and removes what it downloaded so far, unless another request still uses it; a download that already finished may stay in the download client to seed. Never deletes files from the library. Returns the request id, status and cancel time, a \`download\` outcome (removed, kept_seeding, kept_unlimited, kept_shared, kept_not_owned, kept_finished, retry_later, not_removed, none; a non-admin caller gets kept in place of kept_shared and kept_not_owned) and a message. Users may only cancel requests they own; admins may cancel any.`,
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
  {
    method: 'POST',
    path: '/api/admin/requests/:id/approve',
    title: 'Approve request',
    description:
      'Approves a request waiting for approval. Opt-in: an admin turns on "Allow API tokens to approve requests" in Settings → API, then creates a token for their own account with "Can approve requests" ticked; that token must expire within 90 days. Body: `{ "action": "approve" }`. The request downloads the release its requester picked (when it still passes the usual checks) or starts an automatic search. Approve only: `action: "deny"` returns 403 (deny in the web UI or Discord), and a `selectedTorrent` in the body returns 400. A request that is not waiting for approval returns 400 `InvalidStatus`. List waiting requests with `GET /api/requests?status=awaiting_approval`.',
    requiresAdmin: true,
    isWrite: true,
    permission: 'approve_requests',
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
  endpoint: AllowedEndpoint;
}

function compileEndpoint(ep: AllowedEndpoint): CompiledEndpoint {
  const method = ep.method.toUpperCase();
  if (!ep.path.includes(':')) {
    return { method, literal: ep.path, pattern: null, endpoint: ep };
  }
  const escaped = ep.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');
  return { method, literal: null, pattern: new RegExp(`^${regexSource}$`), endpoint: ep };
}

const COMPILED_ENDPOINTS: readonly CompiledEndpoint[] = API_TOKEN_ALLOWED_ENDPOINTS.map(compileEndpoint);

/**
 * Check whether a given method + path is on the API token allowlist.
 * Method comparison is case-insensitive. Supports dynamic single-segment
 * placeholders (`:id`) compiled at module load.
 */
export function isEndpointAllowed(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  return COMPILED_ENDPOINTS.some((ep) => compiledMatches(ep, upperMethod, path));
}

function compiledMatches(ep: CompiledEndpoint, upperMethod: string, path: string): boolean {
  if (ep.method !== upperMethod) return false;
  if (ep.literal !== null) return ep.literal === path;
  return ep.pattern!.test(path);
}

function permissionsOf(compiled: readonly CompiledEndpoint[], method: string, path: string): ApiTokenPermission[] {
  const upperMethod = method.toUpperCase();
  const found = new Set<ApiTokenPermission>();
  for (const ep of compiled) {
    if (compiledMatches(ep, upperMethod, path) && ep.endpoint.permission) found.add(ep.endpoint.permission);
  }
  return [...found];
}

/** Every entry of `endpoints` that matches method + path (pure; used by tests over any list). */
export function findMatchingEndpoints(endpoints: readonly AllowedEndpoint[], method: string, path: string): AllowedEndpoint[] {
  const upperMethod = method.toUpperCase();
  return endpoints.map(compileEndpoint).filter((ep) => compiledMatches(ep, upperMethod, path)).map((ep) => ep.endpoint);
}

/**
 * The permissions of EVERY entry of `endpoints` that matches (not only the first), so a broader
 * untagged entry added later can never hide a tagged one. Pure; used by tests over any list.
 */
export function collectEndpointPermissions(endpoints: readonly AllowedEndpoint[], method: string, path: string): ApiTokenPermission[] {
  return permissionsOf(endpoints.map(compileEndpoint), method, path);
}

/** The permissions a token needs for method + path on the real allowlist (every match counts). */
export function getEndpointPermissions(method: string, path: string): ApiTokenPermission[] {
  return permissionsOf(COMPILED_ENDPOINTS, method, path);
}
