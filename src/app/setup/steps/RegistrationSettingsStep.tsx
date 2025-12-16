/**
 * Component: Registration Settings Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { Button } from '@/components/ui/Button';

interface RegistrationSettingsStepProps {
  requireAdminApproval: boolean;
  onUpdate: (field: string, value: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

export function RegistrationSettingsStep({
  requireAdminApproval,
  onUpdate,
  onNext,
  onBack,
}: RegistrationSettingsStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Registration Settings
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Configure how manual user registration will work.
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                User Registration
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Manual registration is enabled. Users can create accounts with username
                and password.
              </p>
            </div>
            <div className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-3 py-1 rounded-full text-sm font-medium">
              Enabled
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                Require Admin Approval
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                New user accounts must be approved by an administrator before they can
                log in. Recommended for additional security.
              </p>
            </div>
            <button
              onClick={() => onUpdate('requireAdminApproval', !requireAdminApproval)}
              className={`
                relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                ${requireAdminApproval ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                  transition duration-200 ease-in-out
                  ${requireAdminApproval ? 'translate-x-5' : 'translate-x-0'}
                `}
              />
            </button>
          </div>
        </div>

        {requireAdminApproval && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex gap-3">
              <svg
                className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Admin Approval Workflow
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  When a user registers, their account will be created with "pending
                  approval" status. They won't be able to log in until you approve their
                  account in the admin panel.
                </p>
              </div>
            </div>
          </div>
        )}

        {!requireAdminApproval && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <div className="flex gap-3">
              <svg
                className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                  Auto-Approval Enabled
                </p>
                <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
                  Users will be automatically approved and can log in immediately after
                  registration. Consider enabling admin approval for better security.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 dark:text-gray-100">
          Rate Limiting
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Registration is automatically rate-limited to 5 attempts per hour per IP
          address to prevent abuse.
        </p>
      </div>

      <div className="flex justify-between pt-4">
        <Button onClick={onBack} variant="outline">
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
