/**
 * Component: Global User Settings Modal
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { Modal } from '@/components/ui/Modal';

interface GlobalUserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalAutoApprove: boolean;
  onToggleAutoApprove: (newValue: boolean) => void;
  globalInteractiveSearch: boolean;
  onToggleInteractiveSearch: (newValue: boolean) => void;
  globalDownloadAccess: boolean;
  onToggleDownloadAccess: (newValue: boolean) => void;
}

export function GlobalUserSettingsModal({
  isOpen,
  onClose,
  globalAutoApprove,
  onToggleAutoApprove,
  globalInteractiveSearch,
  onToggleInteractiveSearch,
  globalDownloadAccess,
  onToggleDownloadAccess,
}: GlobalUserSettingsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Global User Settings" size="sm">
      <div className="space-y-6">
        {/* Auto-Approve Setting */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => onToggleAutoApprove(!globalAutoApprove)}
            className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5"
            style={{ backgroundColor: globalAutoApprove ? '#3b82f6' : '#d1d5db' }}
            role="switch"
            aria-checked={globalAutoApprove}
            aria-label="Auto-Approve All Requests"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                globalAutoApprove ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <div className="flex-1">
            <label
              onClick={() => onToggleAutoApprove(!globalAutoApprove)}
              className="block text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Auto-Approve All Requests
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              When enabled, all user requests are automatically processed. When disabled, you can set per-user approval settings from the users table.
            </p>
          </div>
        </div>

        {/* Interactive Search Access Setting */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => onToggleInteractiveSearch(!globalInteractiveSearch)}
            className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5"
            style={{ backgroundColor: globalInteractiveSearch ? '#3b82f6' : '#d1d5db' }}
            role="switch"
            aria-checked={globalInteractiveSearch}
            aria-label="Interactive Search Access"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                globalInteractiveSearch ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <div className="flex-1">
            <label
              onClick={() => onToggleInteractiveSearch(!globalInteractiveSearch)}
              className="block text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Interactive Search Access
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              When enabled, all users can manually search and select torrents/ebooks. When disabled, you can grant access per-user from the users table.
            </p>
          </div>
        </div>

        {/* Download Access Setting */}
        <div className="flex items-start gap-4">
          <button
            onClick={() => onToggleDownloadAccess(!globalDownloadAccess)}
            className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5"
            style={{ backgroundColor: globalDownloadAccess ? '#3b82f6' : '#d1d5db' }}
            role="switch"
            aria-checked={globalDownloadAccess}
            aria-label="Download Access"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                globalDownloadAccess ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <div className="flex-1">
            <label
              onClick={() => onToggleDownloadAccess(!globalDownloadAccess)}
              className="block text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer"
            >
              Download Access
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              When enabled, all users can download audiobook files. When disabled, you can grant access per-user from the users table.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
