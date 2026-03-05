/**
 * Component: API Token Type Definitions
 * Documentation: documentation/backend/services/api-tokens.md
 */

/** Base API token as returned by user-facing endpoints */
export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  role: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Extended API token with cross-user fields, returned by admin endpoints */
export interface AdminApiToken extends ApiToken {
  createdBy: string;
  createdById: string;
  tokenUser: string;
  tokenUserId: string;
}
