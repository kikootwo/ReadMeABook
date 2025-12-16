/**
 * Component: Admin Users Management Page
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { authenticatedFetcher, fetchJSON } from '@/lib/utils/api';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

interface User {
  id: string;
  plexId: string;
  plexUsername: string;
  plexEmail: string;
  role: 'user' | 'admin';
  isSetupAdmin: boolean;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  _count: {
    requests: number;
  };
}

interface PendingUser {
  id: string;
  plexUsername: string;
  plexEmail: string | null;
  authProvider: string;
  createdAt: string;
}

function AdminUsersPageContent() {
  const { data, error, mutate } = useSWR('/api/admin/users', authenticatedFetcher);
  const { data: pendingData, error: pendingError, mutate: mutatePending } = useSWR(
    '/api/admin/users/pending',
    authenticatedFetcher
  );
  const [editDialog, setEditDialog] = useState<{
    isOpen: boolean;
    user: User | null;
  }>({ isOpen: false, user: null });
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');
  const [saving, setSaving] = useState(false);
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'approve' | 'reject' | null;
    user: PendingUser | null;
  }>({ isOpen: false, type: null, user: null });
  const toast = useToast();

  const isLoading = !data && !error;
  const pendingUsers: PendingUser[] = pendingData?.users || [];

  const showEditDialog = (user: User) => {
    setEditRole(user.role);
    setEditDialog({ isOpen: true, user });
  };

  const hideEditDialog = () => {
    setEditDialog({ isOpen: false, user: null });
  };

  const saveUserRole = async () => {
    if (!editDialog.user) return;

    try {
      setSaving(true);
      await fetchJSON(`/api/admin/users/${editDialog.user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: editRole }),
      });
      toast.success(`User "${editDialog.user.plexUsername}" updated successfully`);
      hideEditDialog();
      mutate(); // Refresh users list
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update user';
      toast.error(errorMsg);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const showApproveDialog = (user: PendingUser) => {
    setConfirmDialog({ isOpen: true, type: 'approve', user });
  };

  const showRejectDialog = (user: PendingUser) => {
    setConfirmDialog({ isOpen: true, type: 'reject', user });
  };

  const closeConfirmDialog = () => {
    if (processingUserId) return; // Don't close while processing
    setConfirmDialog({ isOpen: false, type: null, user: null });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog.user) return;

    const isApprove = confirmDialog.type === 'approve';
    try {
      setProcessingUserId(confirmDialog.user.id);
      await fetchJSON(`/api/admin/users/${confirmDialog.user.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approve: isApprove }),
      });
      toast.success(
        isApprove
          ? `User "${confirmDialog.user.plexUsername}" has been approved`
          : `User "${confirmDialog.user.plexUsername}" has been rejected`
      );
      mutatePending(); // Refresh pending users list
      if (isApprove) mutate(); // Refresh approved users list
      closeConfirmDialog();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `Failed to ${isApprove ? 'approve' : 'reject'} user`;
      toast.error(errorMsg);
      console.error(err);
    } finally {
      setProcessingUserId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Users
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load users'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const users: User[] = data?.users || [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              User Management
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Manage user roles and permissions
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {/* Pending Users Section */}
        {pendingUsers.length > 0 && (
          <div className="mb-8">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
              <h2 className="text-lg font-semibold text-yellow-900 dark:text-yellow-200 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Pending Registrations ({pendingUsers.length})
              </h2>
              <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-4">
                The following users are awaiting approval to access the system.
              </p>
              <div className="space-y-3">
                {pendingUsers.map((user) => (
                  <div
                    key={user.id}
                    className="bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {user.plexUsername}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {user.plexEmail || 'No email'}
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            Registered: {new Date(user.createdAt).toLocaleString()} •
                            Provider: {user.authProvider}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => showApproveDialog(user)}
                        disabled={processingUserId === user.id}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {processingUserId === user.id ? 'Processing...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => showRejectDialog(user)}
                        disabled={processingUserId === user.id}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {processingUserId === user.id ? 'Processing...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Requests
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last Login
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {user.avatarUrl && (
                        <img
                          src={user.avatarUrl}
                          alt={user.plexUsername}
                          className="h-10 w-10 rounded-full mr-3"
                        />
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {user.plexUsername}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Plex ID: {user.plexId}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {user.plexEmail || 'N/A'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {user.role.toUpperCase()}
                      </span>
                      {user.isSetupAdmin && (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          SETUP ADMIN
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {user._count.requests}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {user.isSetupAdmin ? (
                      <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-600 cursor-not-allowed" title="Setup admin role cannot be changed">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span>Protected</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => showEditDialog(user)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Edit Role</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No users found</p>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            About User Roles
          </h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• <strong>User:</strong> Can request audiobooks, view own requests, and search the catalog</li>
            <li>• <strong>Admin:</strong> Full system access including settings, user management, and all requests</li>
            <li>• <strong>Setup Admin:</strong> The initial admin account created during setup - this account's role is protected and cannot be changed</li>
            <li>• You cannot change your own role for security reasons</li>
          </ul>
        </div>

        {/* Edit User Dialog */}
        {editDialog.isOpen && editDialog.user && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Edit User Role
              </h3>
              <div className="space-y-4 mb-6">
                {/* User Info */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  {editDialog.user.avatarUrl && (
                    <img
                      src={editDialog.user.avatarUrl}
                      alt={editDialog.user.plexUsername}
                      className="h-12 w-12 rounded-full"
                    />
                  )}
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {editDialog.user.plexUsername}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {editDialog.user.plexEmail || 'No email'}
                    </div>
                  </div>
                </div>

                {/* Role Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Role
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        value="user"
                        checked={editRole === 'user'}
                        onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
                        className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          User
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Can request audiobooks and view own requests
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="role"
                        value="admin"
                        checked={editRole === 'admin'}
                        onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
                        className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Admin
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Full system access including settings and user management
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={hideEditDialog}
                  disabled={saving}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={saveUserRole}
                  disabled={saving}
                  className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm Approve/Reject Dialog */}
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          onClose={closeConfirmDialog}
          onConfirm={handleConfirmAction}
          title={confirmDialog.type === 'approve' ? 'Approve Registration' : 'Reject Registration'}
          message={
            confirmDialog.type === 'approve'
              ? `Are you sure you want to approve the registration for "${confirmDialog.user?.plexUsername}"? They will be able to log in immediately.`
              : `Are you sure you want to reject and delete the registration for "${confirmDialog.user?.plexUsername}"? This action cannot be undone.`
          }
          confirmText={confirmDialog.type === 'approve' ? 'Approve' : 'Reject'}
          cancelText="Cancel"
          isLoading={processingUserId !== null}
          variant={confirmDialog.type === 'reject' ? 'danger' : 'primary'}
        />
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <ToastProvider>
      <AdminUsersPageContent />
    </ToastProvider>
  );
}
