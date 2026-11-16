/**
 * Component: "Can approve requests" option for the API token create forms
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

interface ApprovalTokenOptionProps {
  /** Shown only when the server offers approval tokens to this caller for this token */
  available: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ApprovalTokenOption({ available, checked, onChange }: ApprovalTokenOptionProps) {
  if (!available) return null;

  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-900/20 p-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Can approve requests</span>
          <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
            This token can approve requests that are waiting for approval. It cannot deny them: denying
            still needs an admin in the web UI or Discord. It must expire within 90 days. Turning off
            &ldquo;Allow API tokens to approve requests&rdquo; in Settings &rarr; API stops it at once.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Badge shown next to a token that can approve requests */
export function ApprovalTokenBadge() {
  return (
    <span className="ml-2 inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
      Can approve requests
    </span>
  );
}
