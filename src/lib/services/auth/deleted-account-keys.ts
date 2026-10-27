/**
 * Component: Deleted Account Sign-in Keys
 * Documentation: documentation/backend/services/auth.md
 *
 * A soft-deleted account keeps its row (requests and history stay with it), but its
 * sign-in keys are renamed so the next sign-in by that person creates a new account.
 */

import { randomUUID } from 'crypto';

export interface DeletableAccountKeys {
  authProvider: string | null;
  plexId: string;
  plexUsername: string;
  oidcSubject: string | null;
}

export interface FreedAccountKeys {
  plexId: string;
  oidcSubject: string | null;
}

/**
 * The keys a deleted account is stored under.
 * - Local accounts: `local-<username>-deleted-<ms>` (kept in the `local-` space, which
 *   Plex and OIDC sign-in never use, and which the admin login looks up).
 * - Plex, OIDC and older rows without a provider: `<key>-deleted-<random uuid>`, so no
 *   Plex id or IdP subject (some IdPs let users choose theirs) can equal it.
 * The OIDC subject column, when set, is freed the same way, since OIDC sign-in also
 * looks accounts up by it.
 */
export function freedAccountKeys(account: DeletableAccountKeys, now: number = Date.now()): FreedAccountKeys {
  const suffix = `-deleted-${randomUUID()}`;
  return {
    plexId: account.authProvider === 'local'
      ? `local-${account.plexUsername}-deleted-${now}`
      : `${account.plexId}${suffix}`,
    oidcSubject: account.oidcSubject ? `${account.oidcSubject}${suffix}` : null,
  };
}
