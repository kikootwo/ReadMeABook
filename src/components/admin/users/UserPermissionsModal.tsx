/**
 * Component: User Permissions Modal
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { Modal } from '@/components/ui/Modal';

interface UserPermissionsUser {
  id: string;
  plexUsername: string;
  plexEmail: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  autoApproveRequests: boolean | null;
  interactiveSearchAccess: boolean | null;
  downloadAccess: boolean | null;
}

interface UserPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserPermissionsUser | null;
  globalAutoApprove: boolean;
  globalInteractiveSearch: boolean;
  globalDownloadAccess: boolean;
  onToggleAutoApprove: (user: UserPermissionsUser, newValue: boolean) => void;
  onToggleInteractiveSearch: (user: UserPermissionsUser, newValue: boolean) => void;
  onToggleDownloadAccess: (user: UserPermissionsUser, newValue: boolean) => void;
}

interface PermissionToggleProps {
  label: string;
  ariaLabel: string;
  value: boolean;
  disabled: boolean;
  disabledMessage?: string;
  description: string;
  onToggle: () => void;
}

function PermissionToggle({ label, ariaLabel, value, disabled, disabledMessage, description, onToggle }: PermissionToggleProps) {
  return (
    <div className="flex items-start gap-4 p-3 border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={`relative inline-flex h-5 w-10 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5 ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
        style={{ backgroundColor: value ? '#3b82f6' : '#d1d5db' }}
        disabled={disabled}
        role="switch"
        aria-checked={value}
        aria-label={ariaLabel}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </div>
        {disabledMessage ? (
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {disabledMessage}
          </p>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function UserPermissionsModal({
  isOpen,
  onClose,
  user,
  globalAutoApprove,
  globalInteractiveSearch,
  globalDownloadAccess,
  onToggleAutoApprove,
  onToggleInteractiveSearch,
  onToggleDownloadAccess,
}: UserPermissionsModalProps) {
  if (!user) return null;

  const isAdmin = user.role === 'admin';

  // Auto-Approve resolution
  const isAutoApproveGlobalOverride = !isAdmin && globalAutoApprove;
  const isAutoApproveDisabled = isAdmin || isAutoApproveGlobalOverride;
  const autoApproveValue = isAdmin ? true : isAutoApproveGlobalOverride ? true : (user.autoApproveRequests ?? false);

  // Interactive Search resolution
  const isSearchGlobalOverride = !isAdmin && globalInteractiveSearch;
  const isSearchDisabled = isAdmin || isSearchGlobalOverride;
  const searchValue = isAdmin ? true : isSearchGlobalOverride ? true : (user.interactiveSearchAccess ?? false);

  // Download Access resolution
  const isDownloadGlobalOverride = !isAdmin && globalDownloadAccess;
  const isDownloadDisabled = isAdmin || isDownloadGlobalOverride;
  const downloadValue = isAdmin ? true : isDownloadGlobalOverride ? true : (user.downloadAccess ?? false);

  const getDisabledMessage = (isAdminUser: boolean, isGlobalOverride: boolean, adminMessage: string, globalMessage: string): string | undefined => {
    if (isAdminUser) return adminMessage;
    if (isGlobalOverride) return globalMessage;
    return undefined;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="User Permissions" size="sm">
      <div className="space-y-6">
        {/* User Info */}
        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={user.plexUsername}
              className="h-10 w-10 rounded-full"
            />
          )}
          <div>
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {user.plexUsername}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {user.plexEmail || 'No email'}
            </div>
          </div>
          <span
            className={`ml-auto px-2 py-0.5 text-xs font-semibold rounded-full ${
              isAdmin
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {user.role.toUpperCase()}
          </span>
        </div>

        {/* Permissions Section */}
        <div>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Permissions
          </h3>

          <div className="space-y-3">
            {/* Auto-Approve Permission */}
            <PermissionToggle
              label="Auto-Approve Requests"
              ariaLabel="Auto-Approve Requests"
              value={autoApproveValue}
              disabled={isAutoApproveDisabled}
              disabledMessage={getDisabledMessage(
                isAdmin, isAutoApproveGlobalOverride,
                'Admin requests are always auto-approved',
                'Controlled by global auto-approve setting'
              )}
              description="When enabled, this user's requests are automatically processed without admin approval"
              onToggle={() => onToggleAutoApprove(user, !autoApproveValue)}
            />

            {/* Interactive Search Access Permission */}
            <PermissionToggle
              label="Interactive Search Access"
              ariaLabel="Interactive Search Access"
              value={searchValue}
              disabled={isSearchDisabled}
              disabledMessage={getDisabledMessage(
                isAdmin, isSearchGlobalOverride,
                'Admins always have interactive search access',
                'Controlled by global interactive search setting'
              )}
              description="When enabled, this user can manually search and select torrents and ebooks"
              onToggle={() => onToggleInteractiveSearch(user, !searchValue)}
            />

            {/* Download Access Permission */}
            <PermissionToggle
              label="Download Access"
              ariaLabel="Download Access"
              value={downloadValue}
              disabled={isDownloadDisabled}
              disabledMessage={getDisabledMessage(
                isAdmin, isDownloadGlobalOverride,
                'Admins always have download access',
                'Controlled by global download access setting'
              )}
              description="When enabled, this user can download audiobook files directly"
              onToggle={() => onToggleDownloadAccess(user, !downloadValue)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
