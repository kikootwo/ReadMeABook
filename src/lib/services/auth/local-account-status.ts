/**
 * Component: Account Registration Status Checks
 * Documentation: documentation/backend/services/auth.md
 */

/** Messages the sign-in routes return for a refused account. */
export const PENDING_APPROVAL_MESSAGE = 'Account pending admin approval.';
export const REJECTED_ACCOUNT_ERROR = 'Account has been rejected';

export type RegistrationRefusal = 'pending_approval' | 'rejected';

/**
 * Registration states the sign-in and session checks refuse (local and admin
 * sign-in, token login, access tokens, API tokens, refresh). Anything else (approved,
 * or null on older rows) is allowed, matching the regular local login.
 */
export function getRegistrationRefusal(
  registrationStatus: string | null | undefined
): RegistrationRefusal | null {
  if (registrationStatus === 'pending_approval') return 'pending_approval';
  if (registrationStatus === 'rejected') return 'rejected';
  return null;
}

/** Why a session-style check refuses an account (log reasons only, never shown to the caller). */
export type SessionRefusal = 'missing' | 'deleted' | RegistrationRefusal | 'sessions_revoked';

/** The account fields the session check reads. */
export interface SessionAccountState {
  deletedAt?: Date | null;
  registrationStatus?: string | null;
  sessionsInvalidatedAt?: Date | null;
}

/**
 * The rule `requireAuth` applies to an access token, shared with every other
 * credential that acts for an account (download links). Refuses a missing,
 * soft-deleted, pending or rejected account, and a credential issued (`iat`,
 * seconds) before the account's sessions were revoked.
 */
export function getSessionRefusal(
  user: SessionAccountState | null | undefined,
  issuedAt: number | undefined
): SessionRefusal | null {
  if (!user) return 'missing';
  if (user.deletedAt) return 'deleted';
  const refusal = getRegistrationRefusal(user.registrationStatus);
  if (refusal) return refusal;
  if (user.sessionsInvalidatedAt && issuedAt &&
      issuedAt < Math.floor(user.sessionsInvalidatedAt.getTime() / 1000)) {
    return 'sessions_revoked';
  }
  return null;
}
