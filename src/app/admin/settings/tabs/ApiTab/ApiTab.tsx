/**
 * Component: API Token Management Tab (Admin)
 * Documentation: documentation/backend/services/api-tokens.md
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { ConfirmDialog } from '@/app/admin/components/ConfirmDialog';
import { useApiTokens } from '@/lib/hooks/useApiTokens';
import { getInstanceUrl } from '@/lib/utils/client-url';
import Link from 'next/link';
import type { AdminApiToken } from '@/lib/types/api-tokens';

interface UserOption {
  id: string;
  plexUsername: string;
  role: string;
}

export function ApiTab() {
  const api = useApiTokens<AdminApiToken>({ basePath: '/api/admin/api-tokens' });

  // Admin-specific state
  const [users, setUsers] = useState<UserOption[]>([]);
  const [newTokenUserId, setNewTokenUserId] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/admin/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users.map((u: any) => ({ id: u.id, plexUsername: u.plexUsername, role: u.role })));
      }
    } catch {
      // Non-critical, user selector just won't populate
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async () => {
    const extraBody: Record<string, string> = {};
    if (newTokenUserId) extraBody.userId = newTokenUserId;
    const created = await api.handleCreate(extraBody);
    // Reset admin-specific fields only when create succeeds
    if (created) {
      setNewTokenUserId('');
    }
  };

  const handleCancel = () => {
    api.resetForm();
    setNewTokenUserId('');
  };

  if (api.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">API Tokens</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manage API tokens for all users. Create tokens for any user for programmatic access.{' '}
          <Link href="/api-docs" className="text-blue-600 dark:text-blue-400 hover:underline">
            View API documentation
          </Link>
        </p>
      </div>

      {/* Error display */}
      {api.error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">
          {api.error}
        </div>
      )}

      {/* Newly created token banner */}
      {api.createdToken && (
        <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Token created successfully! Copy it now — it won&apos;t be shown again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 text-sm bg-white dark:bg-gray-900 px-3 py-2 rounded border border-green-300 dark:border-green-700 text-gray-900 dark:text-gray-100 font-mono break-all">
                  {api.createdToken}
                </code>
                <button
                  onClick={api.handleCopy}
                  className="flex-shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  {api.copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
                <button
                  type="button"
                  aria-label="Dismiss token banner"
                  onClick={api.dismissCreatedToken}
                  className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200"
                >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Create token form */}
      {api.showCreateForm ? (
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 space-y-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Create New Token</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={api.newTokenName}
                onChange={(e) => api.setNewTokenName(e.target.value)}
                placeholder="e.g., Home Assistant, Webhook"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Expiration
              </label>
              <select
                value={api.newTokenExpiry}
                onChange={(e) => api.setNewTokenExpiry(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="never">Never</option>
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="1y">1 year</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                User (acts as)
              </label>
              <select
                value={newTokenUserId}
                onChange={(e) => setNewTokenUserId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Current user (default)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.plexUsername} ({u.role})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Token will inherit the selected user&apos;s role
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={api.creating || !api.newTokenName.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white transition-colors"
            >
              {api.creating ? 'Creating...' : 'Create Token'}
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => api.setShowCreateForm(true)}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Create New Token
        </button>
      )}

      {/* Token list */}
      {api.tokens.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <p className="mt-2 text-sm">No API tokens yet</p>
          <p className="text-xs mt-1">Create a token to enable programmatic API access</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Token</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Acts As</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Role</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Created By</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Last Used</th>
                <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Expires</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {api.tokens.map((token) => (
                <tr key={token.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-3 px-2 text-gray-900 dark:text-gray-100 font-medium">{token.name}</td>
                  <td className="py-3 px-2">
                    <code className="text-xs bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded text-gray-600 dark:text-gray-400 font-mono">
                      {token.tokenPrefix}...
                    </code>
                  </td>
                  <td className="py-3 px-2 text-gray-500 dark:text-gray-400">{token.tokenUser}</td>
                  <td className="py-3 px-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      token.role === 'admin'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}>
                      {token.role}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-gray-500 dark:text-gray-400">{token.createdBy}</td>
                  <td className="py-3 px-2 text-gray-500 dark:text-gray-400">{api.formatDate(token.lastUsedAt)}</td>
                  <td className="py-3 px-2 text-gray-500 dark:text-gray-400">
                    {token.expiresAt ? (
                      <span className={new Date(token.expiresAt) < new Date() ? 'text-red-500' : ''}>
                        {api.formatDate(token.expiresAt)}
                        {new Date(token.expiresAt) < new Date() && ' (expired)'}
                      </span>
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <button
                      onClick={() => api.setConfirmRevokeId(token.id)}
                      disabled={api.deletingId === token.id}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 transition-colors disabled:opacity-50"
                    >
                      {api.deletingId === token.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Usage instructions */}
      <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Usage</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Include the token in the <code className="px-1 py-0.5 bg-gray-200 dark:bg-gray-800 rounded text-xs">Authorization</code> header:
        </p>
        <pre className="text-xs bg-gray-900 dark:bg-black text-gray-100 p-3 rounded-lg overflow-x-auto">
{`curl -H "Authorization: Bearer rmab_your_token_here" \\
  ${getInstanceUrl()}/api/requests`}
        </pre>
      </div>

      {/* Revoke confirmation dialog */}
      <ConfirmDialog
        isOpen={api.confirmRevokeId !== null}
        title="Revoke API token"
        message={
          <>
            Are you sure you want to revoke{' '}
            <span className="font-medium text-gray-700 dark:text-gray-200">
              &ldquo;{api.tokens.find((t) => t.id === api.confirmRevokeId)?.name ?? 'this token'}&rdquo;
            </span>
            ? Any integrations using this token will immediately lose access. This cannot be undone.
          </>
        }
        confirmLabel="Revoke token"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={api.handleDeleteConfirmed}
        onCancel={() => api.setConfirmRevokeId(null)}
      />
    </div>
  );
}
