/**
 * Component: Admin Users Management Page
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { authenticatedFetcher, fetchJSON } from '@/lib/utils/api';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { GlobalUserSettingsModal } from '@/components/admin/users/GlobalUserSettingsModal';
import { UserPermissionsModal } from '@/components/admin/users/UserPermissionsModal';

interface User {
  id: string;
  plexId: string;
  plexUsername: string;
  plexEmail: string;
  role: 'user' | 'admin';
  isSetupAdmin: boolean;
  authProvider: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  autoApproveRequests: boolean | null;
  interactiveSearchAccess: boolean | null;
  downloadAccess: boolean | null;
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

// Tinted-dot status badge following admin design system
function RoleBadge({ role, isSetupAdmin }: { role: 'user' | 'admin'; isSetupAdmin: boolean }) {
  if (isSetupAdmin) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-500" />
        Setup Admin
      </span>
    );
  }
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-700 dark:text-purple-400">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-purple-500" />
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-600 dark:text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-400" />
      User
    </span>
  );
}

function PermissionBadge({
  user,
  globalAutoApprove,
  onClick,
}: {
  user: User;
  globalAutoApprove: boolean;
  onClick: () => void;
}) {
  let badge: React.ReactNode;
  if (user.role === 'admin') {
    badge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Full Access
      </span>
    );
  } else if (globalAutoApprove) {
    badge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400">
        Global Default
      </span>
    );
  } else if (user.autoApproveRequests ?? false) {
    badge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        Auto-Approve
      </span>
    );
  } else {
    badge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-500/10 text-gray-600 dark:text-gray-400">
        Manual
      </span>
    );
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
    >
      {badge}
      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function UserActionsCell({ user, onEdit, onDelete }: { user: User; onEdit: (u: User) => void; onDelete: (u: User) => void }) {
  if (user.isSetupAdmin) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-600 cursor-not-allowed" title="Setup admin role cannot be changed">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span>Protected</span>
      </span>
    );
  }
  if (user.authProvider === 'oidc') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-600 cursor-not-allowed" title="OIDC user roles are managed by the identity provider">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>OIDC Managed</span>
      </span>
    );
  }
  if (user.authProvider === 'local') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => onEdit(user)}
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span>Edit Role</span>
        </button>
        <button
          onClick={() => onDelete(user)}
          className="inline-flex items-center gap-1 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          title="Delete user and all their requests"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span>Delete</span>
        </button>
      </div>
    );
  }
  // plex or other
  return (
    <button
      onClick={() => onEdit(user)}
      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      <span>Edit Role</span>
    </button>
  );
}

function AdminUsersPageContent() {
  const { data, error, mutate } = useSWR('/api/admin/users', authenticatedFetcher);
  const { data: pendingData, error: pendingError, mutate: mutatePending } = useSWR(
    '/api/admin/users/pending',
    authenticatedFetcher
  );
  const { data: globalAutoApproveData, error: globalAutoApproveError, mutate: mutateGlobalAutoApprove } = useSWR(
    '/api/admin/settings/auto-approve',
    authenticatedFetcher
  );
  const { data: globalInteractiveSearchData, mutate: mutateGlobalInteractiveSearch } = useSWR(
    '/api/admin/settings/interactive-search',
    authenticatedFetcher
  );
  const { data: globalDownloadAccessData, mutate: mutateGlobalDownloadAccess } = useSWR(
    '/api/admin/settings/download-access',
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
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    user: User | null;
  }>({ isOpen: false, user: null });
  const [deleting, setDeleting] = useState(false);
  const [globalAutoApprove, setGlobalAutoApprove] = useState<boolean>(false);
  const [globalInteractiveSearch, setGlobalInteractiveSearch] = useState<boolean>(true);
  const [globalDownloadAccess, setGlobalDownloadAccess] = useState<boolean>(true);
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [permissionsUserId, setPermissionsUserId] = useState<string | null>(null);
  const toast = useToast();

  const isLoading = !data && !error;
  const pendingUsers: PendingUser[] = pendingData?.users || [];

  // Sync global auto-approve state (default to true if not set)
  useEffect(() => {
    if (globalAutoApproveData?.autoApproveRequests !== undefined) {
      setGlobalAutoApprove(globalAutoApproveData.autoApproveRequests);
    } else if (globalAutoApproveData !== undefined && globalAutoApproveData.autoApproveRequests === undefined) {
      setGlobalAutoApprove(true);
    }
  }, [globalAutoApproveData]);

  // Sync global interactive search state (default to true if not set)
  useEffect(() => {
    if (globalInteractiveSearchData?.interactiveSearchAccess !== undefined) {
      setGlobalInteractiveSearch(globalInteractiveSearchData.interactiveSearchAccess);
    } else if (globalInteractiveSearchData !== undefined && globalInteractiveSearchData.interactiveSearchAccess === undefined) {
      setGlobalInteractiveSearch(true);
    }
  }, [globalInteractiveSearchData]);

  // Sync global download access state (default to true if not set)
  useEffect(() => {
    if (globalDownloadAccessData?.downloadAccess !== undefined) {
      setGlobalDownloadAccess(globalDownloadAccessData.downloadAccess);
    } else if (globalDownloadAccessData !== undefined && globalDownloadAccessData.downloadAccess === undefined) {
      setGlobalDownloadAccess(true);
    }
  }, [globalDownloadAccessData]);

  const handleGlobalAutoApproveToggle = async (newValue: boolean) => {
    setGlobalAutoApprove(newValue);
    try {
      await fetchJSON('/api/admin/settings/auto-approve', {
        method: 'PATCH',
        body: JSON.stringify({ autoApproveRequests: newValue }),
      });
      toast.success(`Global auto-approve ${newValue ? 'enabled' : 'disabled'}`);
      mutateGlobalAutoApprove();
      mutate();
    } catch (err) {
      setGlobalAutoApprove(!newValue);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update auto-approve setting';
      toast.error(errorMsg);
    }
  };

  const handleGlobalInteractiveSearchToggle = async (newValue: boolean) => {
    setGlobalInteractiveSearch(newValue);
    try {
      await fetchJSON('/api/admin/settings/interactive-search', {
        method: 'PATCH',
        body: JSON.stringify({ interactiveSearchAccess: newValue }),
      });
      toast.success(`Global interactive search ${newValue ? 'enabled' : 'disabled'}`);
      mutateGlobalInteractiveSearch();
      mutate();
    } catch (err) {
      setGlobalInteractiveSearch(!newValue);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update interactive search setting';
      toast.error(errorMsg);
    }
  };

  const handleUserAutoApproveToggle = async (user: User, newValue: boolean) => {
    const previousUsers = data?.users || [];
    const optimisticUsers = previousUsers.map((u: User) =>
      u.id === user.id ? { ...u, autoApproveRequests: newValue } : u
    );
    mutate({ users: optimisticUsers }, false);
    try {
      await fetchJSON(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: user.role, autoApproveRequests: newValue }),
      });
      toast.success(`Auto-approve ${newValue ? 'enabled' : 'disabled'} for ${user.plexUsername}`);
      mutate();
    } catch (err) {
      mutate({ users: previousUsers }, false);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update user auto-approve setting';
      toast.error(errorMsg);
    }
  };

  const handleUserInteractiveSearchToggle = async (user: User, newValue: boolean) => {
    const previousUsers = data?.users || [];
    const optimisticUsers = previousUsers.map((u: User) =>
      u.id === user.id ? { ...u, interactiveSearchAccess: newValue } : u
    );
    mutate({ users: optimisticUsers }, false);
    try {
      await fetchJSON(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: user.role, interactiveSearchAccess: newValue }),
      });
      toast.success(`Interactive search ${newValue ? 'enabled' : 'disabled'} for ${user.plexUsername}`);
      mutate();
    } catch (err) {
      mutate({ users: previousUsers }, false);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update user interactive search setting';
      toast.error(errorMsg);
    }
  };

  const handleGlobalDownloadAccessToggle = async (newValue: boolean) => {
    setGlobalDownloadAccess(newValue);
    try {
      await fetchJSON('/api/admin/settings/download-access', {
        method: 'PATCH',
        body: JSON.stringify({ downloadAccess: newValue }),
      });
      toast.success(`Global download access ${newValue ? 'enabled' : 'disabled'}`);
      mutateGlobalDownloadAccess();
      mutate();
    } catch (err) {
      setGlobalDownloadAccess(!newValue);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update download access setting';
      toast.error(errorMsg);
    }
  };

  const handleUserDownloadAccessToggle = async (user: User, newValue: boolean) => {
    const previousUsers = data?.users || [];
    const optimisticUsers = previousUsers.map((u: User) =>
      u.id === user.id ? { ...u, downloadAccess: newValue } : u
    );
    mutate({ users: optimisticUsers }, false);
    try {
      await fetchJSON(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: user.role, downloadAccess: newValue }),
      });
      toast.success(`Download access ${newValue ? 'enabled' : 'disabled'} for ${user.plexUsername}`);
      mutate();
    } catch (err) {
      mutate({ users: previousUsers }, false);
      const errorMsg = err instanceof Error ? err.message : 'Failed to update user download access setting';
      toast.error(errorMsg);
    }
  };

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
      mutate();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update user';
      toast.error(errorMsg);
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
    if (processingUserId) return;
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
      mutatePending();
      if (isApprove) mutate();
      closeConfirmDialog();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `Failed to ${isApprove ? 'approve' : 'reject'} user`;
      toast.error(errorMsg);
    } finally {
      setProcessingUserId(null);
    }
  };

  const showDeleteDialog = (user: User) => {
    setDeleteDialog({ isOpen: true, user });
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteDialog({ isOpen: false, user: null });
  };

  const handleDeleteUser = async () => {
    if (!deleteDialog.user) return;
    try {
      setDeleting(true);
      const response = await fetchJSON(`/api/admin/users/${deleteDialog.user.id}`, {
        method: 'DELETE',
      });
      toast.success(response.message || `User "${deleteDialog.user.plexUsername}" has been deleted`);
      mutate();
      closeDeleteDialog();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete user';
      toast.error(errorMsg);
    } finally {
      setDeleting(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch (err) {
      toast.error('Failed to copy to clipboard');
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
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error Loading Users</h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load users'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const users: User[] = data?.users || [];
  const permissionsUser = permissionsUserId ? users.find((u) => u.id === permissionsUserId) ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* Header — stacks on mobile, row on sm+ */}
        <div className="sticky top-0 z-10 mb-6 sm:mb-8 bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
                User Management
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Manage user roles and permissions
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto flex-shrink-0">
              <button
                onClick={() => setGlobalSettingsOpen(true)}
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">Global User Permissions</span>
                <span className="sm:hidden">Permissions</span>
              </button>
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Pending Users Section */}
        {pendingUsers.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4">
              <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200 mb-1 flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Pending Registrations ({pendingUsers.length})
              </h2>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 mb-4">
                The following users are awaiting approval to access the system.
              </p>
              <div className="space-y-3">
                {pendingUsers.map((user) => (
                  <div
                    key={user.id}
                    className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800/40 rounded-xl overflow-hidden"
                  >
                    {/* Pending card — info */}
                    <div className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        {user.plexUsername}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {user.plexEmail || 'No email'}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Registered: {new Date(user.createdAt).toLocaleString()} &middot; Provider: {user.authProvider}
                      </div>
                    </div>
                    {/* Pending card — actions, full-width on mobile */}
                    <div className="px-4 py-3 border-t border-amber-100 dark:border-amber-800/30 flex gap-2">
                      <button
                        onClick={() => showApproveDialog(user)}
                        disabled={processingUserId === user.id}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-500/20 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {processingUserId === user.id ? 'Processing...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => showRejectDialog(user)}
                        disabled={processingUserId === user.id}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-200/60 dark:border-red-500/20 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Users — Mobile card list (sm:hidden) */}
        <div className="space-y-3 sm:hidden">
          {users.map((user) => (
            <div
              key={user.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Card header — avatar + name + role badge */}
              <div className="px-4 py-3 flex items-start gap-3">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.plexUsername}
                    className="h-10 w-10 rounded-full flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full flex-shrink-0 mt-0.5 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug truncate">
                      {user.plexUsername}
                    </div>
                    <RoleBadge role={user.role} isSetupAdmin={user.isSetupAdmin} />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {user.plexEmail || 'No email'}
                  </div>
                </div>
              </div>

              {/* Card body — labeled fields */}
              <div className="px-4 pb-3 pt-2 space-y-2 border-t border-gray-100 dark:border-gray-700/60">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                      Permissions
                    </div>
                    <PermissionBadge
                      user={user}
                      globalAutoApprove={globalAutoApprove}
                      onClick={() => setPermissionsUserId(user.id)}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                      Requests
                    </div>
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {user._count.requests}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                    Last Login
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                    User ID
                  </div>
                  <button
                    onClick={() => copyToClipboard(user.plexId, 'User ID')}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors inline-flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {user.plexId.length > 16 ? `${user.plexId.substring(0, 16)}…` : user.plexId}
                  </button>
                </div>
              </div>

              {/* Card actions */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/60">
                <UserActionsCell user={user} onEdit={showEditDialog} onDelete={showDeleteDialog} />
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No users found</p>
            </div>
          )}
        </div>

        {/* Users Table — hidden on mobile, visible on sm+ */}
        <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
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
                  Permissions
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
                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.plexUsername}
                          className="h-10 w-10 rounded-full mr-3 flex-shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full mr-3 flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {user.plexUsername}
                        </div>
                        <div
                          className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                          title={`Click to copy: ${user.plexId}`}
                          onClick={() => copyToClipboard(user.plexId, 'User ID')}
                        >
                          <span className="inline-flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            ID: {user.plexId.length > 12 ? `${user.plexId.substring(0, 12)}...` : user.plexId}
                          </span>
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
                    <RoleBadge role={user.role} isSetupAdmin={user.isSetupAdmin} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <PermissionBadge
                      user={user}
                      globalAutoApprove={globalAutoApprove}
                      onClick={() => setPermissionsUserId(user.id)}
                    />
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
                    <UserActionsCell user={user} onEdit={showEditDialog} onDelete={showDeleteDialog} />
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
            About User Management
          </h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• <strong>User:</strong> Can request audiobooks, view own requests, and search the catalog</li>
            <li>• <strong>Admin:</strong> Full system access including settings, user management, and all requests</li>
            <li>• <strong>Setup Admin:</strong> The initial admin account — protected, cannot be changed or deleted</li>
            <li>• <strong>Permissions:</strong> Click a user&apos;s permission badge to manage individual settings. Use Global User Permissions for system-wide defaults. Admins always have full access.</li>
            <li>• <strong>OIDC Users:</strong> Role management is handled by the identity provider. Cannot be deleted.</li>
            <li>• <strong>Plex Users:</strong> Role can be changed, but cannot be deleted (access managed by Plex).</li>
            <li>• <strong>Local Users:</strong> Can have roles freely assigned. Can be deleted (requests are preserved).</li>
            <li>• You cannot change your own role or delete yourself for security reasons</li>
          </ul>
        </div>

        {/* Edit User Dialog — bottom sheet on mobile */}
        {editDialog.isOpen && editDialog.user && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black bg-opacity-50 p-0 sm:p-4">
            <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md">
              {/* Dialog header */}
              <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Edit User Role
                </h3>
                <button
                  onClick={hideEditDialog}
                  className="p-2 -mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label="Close dialog"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-5 py-5 space-y-4">
                {/* User Info */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-xl">
                  {editDialog.user.avatarUrl ? (
                    <img
                      src={editDialog.user.avatarUrl}
                      alt={editDialog.user.plexUsername}
                      className="h-12 w-12 rounded-full flex-shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-600 flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
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
                    <label className="flex items-start gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                      <input
                        type="radio"
                        name="role"
                        value="user"
                        checked={editRole === 'user'}
                        onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
                        className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 flex-shrink-0"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">User</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Can request audiobooks and view own requests
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                      <input
                        type="radio"
                        name="role"
                        value="admin"
                        checked={editRole === 'admin'}
                        onChange={(e) => setEditRole(e.target.value as 'user' | 'admin')}
                        className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 flex-shrink-0"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Admin</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Full system access including settings and user management
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Dialog footer */}
              <div className="sticky bottom-0 bg-white dark:bg-gray-800 px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button
                  onClick={hideEditDialog}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={saveUserRole}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Delete User Dialog */}
        <ConfirmModal
          isOpen={deleteDialog.isOpen}
          onClose={closeDeleteDialog}
          onConfirm={handleDeleteUser}
          title="Delete User"
          message={
            deleteDialog.user
              ? `Are you sure you want to delete "${deleteDialog.user.plexUsername}"? The user will be permanently deleted, but their ${deleteDialog.user._count.requests} request(s) will be preserved for historical records. This action cannot be undone.`
              : ''
          }
          confirmText="Delete User"
          cancelText="Cancel"
          isLoading={deleting}
          variant="danger"
        />

        {/* Global User Settings Modal */}
        <GlobalUserSettingsModal
          isOpen={globalSettingsOpen}
          onClose={() => setGlobalSettingsOpen(false)}
          globalAutoApprove={globalAutoApprove}
          onToggleAutoApprove={handleGlobalAutoApproveToggle}
          globalInteractiveSearch={globalInteractiveSearch}
          onToggleInteractiveSearch={handleGlobalInteractiveSearchToggle}
          globalDownloadAccess={globalDownloadAccess}
          onToggleDownloadAccess={handleGlobalDownloadAccessToggle}
        />

        {/* User Permissions Modal */}
        <UserPermissionsModal
          isOpen={permissionsUser !== null}
          onClose={() => setPermissionsUserId(null)}
          user={permissionsUser}
          globalAutoApprove={globalAutoApprove}
          globalInteractiveSearch={globalInteractiveSearch}
          globalDownloadAccess={globalDownloadAccess}
          onToggleAutoApprove={(user, newValue) => {
            handleUserAutoApproveToggle(user as User, newValue);
          }}
          onToggleInteractiveSearch={(user, newValue) => {
            handleUserInteractiveSearchToggle(user as User, newValue);
          }}
          onToggleDownloadAccess={(user, newValue) => {
            handleUserDownloadAccessToggle(user as User, newValue);
          }}
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
