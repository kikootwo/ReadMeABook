/**
 * Component: Local Account Sign-in Checks
 * Documentation: documentation/backend/services/auth.md
 */

/** Messages both local sign-in routes return for a refused account. */
export const PENDING_APPROVAL_MESSAGE = 'Account pending admin approval.';
export const REJECTED_ACCOUNT_ERROR = 'Account has been rejected';

export type RegistrationRefusal = 'pending_approval' | 'rejected';

/**
 * Registration states a local sign-in refuses. Anything else (approved, or null on
 * older rows) is allowed to sign in, matching the regular local login.
 */
export function getRegistrationRefusal(
  registrationStatus: string | null | undefined
): RegistrationRefusal | null {
  if (registrationStatus === 'pending_approval') return 'pending_approval';
  if (registrationStatus === 'rejected') return 'rejected';
  return null;
}
