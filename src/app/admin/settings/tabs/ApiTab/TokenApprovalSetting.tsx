/**
 * Component: "Allow API tokens to approve requests" switch (Settings → API, saves on toggle)
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

import { useEffect, useId, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';

const PATH = '/api/admin/settings/api-tokens';

interface TokenApprovalSettingProps {
  /** Called with the saved value after each change (the token list refreshes its create options) */
  onChanged?: (allowed: boolean) => void;
}

export function TokenApprovalSetting({ onChanged }: TokenApprovalSettingProps) {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const switchId = `${id}-switch`;
  const helpId = `${id}-help`;

  useEffect(() => {
    let active = true;
    fetchWithAuth(PATH)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (active) setOn(data.allowRequestApproval === true);
      })
      .catch(() => {
        if (active) setError('Could not load this setting');
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async () => {
    if (on === null || saving) return;
    const next = !on;
    setSaving(true);
    setError(null);
    try {
      const response = await fetchWithAuth(PATH, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRequestApproval: next }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      setOn(data.allowRequestApproval === true);
      onChanged?.(data.allowRequestApproval === true);
    } catch {
      setError('Could not save this setting');
    } finally {
      setSaving(false);
    }
  };

  const checked = on === true;
  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50">
      <div className="flex items-start gap-4">
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-describedby={helpId}
          disabled={on === null || saving}
          onClick={toggle}
          className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5 disabled:opacity-60"
          style={{ backgroundColor: checked ? '#3b82f6' : '#d1d5db' }}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <div className="flex-1 min-w-0">
          <label htmlFor={switchId} className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
            Allow API tokens to approve requests
          </label>
          <div id={helpId} className="text-sm text-gray-500 dark:text-gray-400 mt-1 space-y-1">
            <p>
              Off by default. While on, an admin can create a token for their own account that approves
              waiting requests (approve only, expiring within 90 days).
            </p>
            <p>Turning this off stops every approval token immediately; turning it back on restores the unexpired ones.</p>
            <p>Signing a user out does not affect their API tokens: revoke the token instead.</p>
          </div>
          {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
