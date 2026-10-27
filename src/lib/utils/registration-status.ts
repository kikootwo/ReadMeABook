/**
 * Component: Registration Status Check
 * Documentation: documentation/backend/services/auth.md
 */

/**
 * True when an account's registration status refuses access (pending approval or rejected).
 * Null and 'approved' allow access, matching the sign-in checks in the auth providers.
 */
export function isRegistrationRefused(status: string | null | undefined): boolean {
  return status === 'pending_approval' || status === 'rejected';
}
