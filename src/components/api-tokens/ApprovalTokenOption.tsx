/**
 * Component: "Can approve requests" option and badge for API tokens
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

interface ApprovalTokenOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The form's expiry choice ('never', '30d', ...) */
  expiry: string;
}

/** Create-form checkbox. Render only when the server allows approval tokens for this caller. */
export function ApprovalTokenOption({ checked, onChange, expiry }: ApprovalTokenOptionProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
        />
        <span>
          <span className="font-medium">Can approve requests</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Lets an app such as a mobile client approve or deny requests waiting for approval. It can&apos;t pick a
            release: approving uses the requester&apos;s pick or an automatic search. This can&apos;t be changed later.
          </span>
        </span>
      </label>
      {checked && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Anyone holding this token can approve or deny requests as you. Keep it private, and revoke it if a device is
          lost.
          {expiry === 'never' && ' This token never expires: an expiry limits the damage if it leaks.'}
        </p>
      )}
    </div>
  );
}

/** Marks a token that can approve requests in a token list */
export function ApprovalTokenBadge() {
  return (
    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
      Can approve requests
    </span>
  );
}
