/**
 * Component: API token request-approval switch (Admin → Settings → API)
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';

interface TokenApprovalSettingProps {
  /** Called after a change is saved, so the token form can show or hide its approval option */
  onChange?: () => void;
}

export function TokenApprovalSetting({ onChange }: TokenApprovalSettingProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth('/api/admin/settings/api-tokens')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setEnabled((await response.json()).allowRequestApproval === true);
      })
      .catch(() => setError('Failed to load the API token approval setting'));
  }, []);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetchWithAuth('/api/admin/settings/api-tokens', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRequestApproval: next }),
      });
      if (!response.ok) throw new Error();
      setEnabled(next);
      onChange?.();
    } catch {
      setError('Failed to save the API token approval setting');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 space-y-2">
      <label className="flex items-start gap-2 text-sm text-gray-900 dark:text-gray-100">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === null || saving}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-0.5 rounded border-gray-300 dark:border-gray-600"
        />
        <span>
          <span className="font-medium">Allow API tokens to approve or deny requests</span>
          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            For apps that manage approvals away from the web UI, such as a mobile client. Only tokens an admin creates for
            their own account with &ldquo;Can approve requests&rdquo; ticked can approve, and they can&apos;t pick a
            release. Turning this off stops every such token at once; turning it back on restores them.
          </span>
        </span>
      </label>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
