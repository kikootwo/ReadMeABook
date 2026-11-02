/**
 * Component: Admin Users Row Actions + Delete Confirmation Text
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import React from 'react';

export interface UserActionsTarget {
  id: string;
  plexUsername: string;
  isSetupAdmin: boolean;
  authProvider: string | null;
  _count: { requests: number };
}

const EDIT_ICON = 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
const DELETE_ICON = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';
const LOCK_ICON = 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z';
const INFO_ICON = 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

function Icon({ d }: { d: string }) {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

/** What happens when this person comes back, by how they sign in. */
function returningUserText(authProvider: string | null): string {
  if (authProvider === 'local') {
    return 'If they register again, they get a new account with the User role, which waits for approval when new users need admin approval.';
  }
  if (authProvider === 'oidc') {
    return 'If they sign in with single sign-on again, they get a new account with the User role (or Admin, if your admin role mapping says so), which waits for approval when OIDC access is set to admin approval.';
  }
  return 'If they sign in with Plex again, they get a new account with the User role and default permissions.';
}

/** Confirmation text for deleting a user (any provider). */
export function deleteUserConfirmMessage(user: UserActionsTarget): string {
  return `Delete "${user.plexUsername}"? Their ${user._count.requests} request(s) are kept. ${returningUserText(user.authProvider)} This cannot be undone.`;
}

/**
 * Row actions: Edit Role (not for OIDC, whose roles come from the identity provider) and
 * Delete for every provider. The setup admin is protected; nobody can delete themselves.
 */
export function UserActionsCell<T extends UserActionsTarget>({
  user,
  currentUserId,
  onEdit,
  onDelete,
}: {
  user: T;
  currentUserId: string | null;
  onEdit: (u: T) => void;
  onDelete: (u: T) => void;
}) {
  if (user.isSetupAdmin) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-600 cursor-not-allowed" title="Setup admin role cannot be changed">
        <Icon d={LOCK_ICON} />
        <span>Protected</span>
      </span>
    );
  }

  const canDelete = user.id !== currentUserId;

  return (
    <div className="flex items-center gap-3">
      {user.authProvider === 'oidc' ? (
        <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-600 cursor-not-allowed" title="OIDC user roles are managed by the identity provider">
          <Icon d={INFO_ICON} />
          <span>OIDC Managed</span>
        </span>
      ) : (
        <button
          onClick={() => onEdit(user)}
          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          <Icon d={EDIT_ICON} />
          <span>Edit Role</span>
        </button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(user)}
          className="inline-flex items-center gap-1 text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          title="Delete user (their requests are kept)"
        >
          <Icon d={DELETE_ICON} />
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}
