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
