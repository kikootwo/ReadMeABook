/**
 * Component: AuthTab - Authentication Settings
 * Documentation: documentation/settings-pages.md
 */

'use client';

import { useEffect } from 'react';
import { OIDCSection } from './OIDCSection';
import { RegistrationSection } from './RegistrationSection';
import { PendingUsersTable } from './PendingUsersTable';
import { useAuthSettings } from './useAuthSettings';
import type { Settings } from '../../lib/types';

interface AuthTabProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onValidationChange: (section: string, isValid: boolean) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function AuthTab({
  settings,
  onChange,
  onValidationChange,
  onSuccess,
  onError
}: AuthTabProps) {
  const {
    pendingUsers,
    loadingPendingUsers,
    testing,
    oidcTestResult,
    fetchPendingUsers,
    testOIDCConnection,
    approveUser,
  } = useAuthSettings({ onSuccess, onError });

  // Fetch pending users when the tab is loaded and registration with approval is enabled
  useEffect(() => {
    if (settings.registration.enabled && settings.registration.requireAdminApproval) {
      fetchPendingUsers();
    }
  }, [settings.registration.enabled, settings.registration.requireAdminApproval, fetchPendingUsers]);

  const handleOIDCChange = (oidcSettings: typeof settings.oidc) => {
    onChange({
      ...settings,
      oidc: oidcSettings,
    });
    onValidationChange('oidc', false);
  };

  const handleRegistrationChange = (registrationSettings: typeof settings.registration) => {
    onChange({
      ...settings,
      registration: registrationSettings,
    });
    onValidationChange('registration', false);
  };

  const handleOIDCTest = async (issuerUrl: string, clientId: string, clientSecret: string) => {
    const isValid = await testOIDCConnection(issuerUrl, clientId, clientSecret);
    if (isValid) {
      onValidationChange('oidc', true);
    }
    return isValid;
  };

  // Check if no auth methods are enabled and no local users exist
  const showNoAuthWarning = settings.backendMode !== 'plex' &&
    !settings.oidc.enabled &&
    !settings.registration.enabled &&
    !settings.hasLocalUsers;

  // Check if only manual registration is enabled but no admin users exist
  const showNoAdminWarning = settings.backendMode !== 'plex' &&
    !settings.oidc.enabled &&
    settings.registration.enabled &&
    !settings.hasLocalAdmins;

  // Check if registration is disabled but local users can still log in
  const showRegistrationDisabledInfo = settings.backendMode !== 'plex' &&
    !settings.oidc.enabled &&
    !settings.registration.enabled &&
    settings.hasLocalUsers;

  // Show pending users table if registration with approval is enabled
  const showPendingUsers = settings.registration.enabled &&
    settings.registration.requireAdminApproval;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* OIDC Settings Section */}
      <OIDCSection
        settings={settings.oidc}
        onChange={handleOIDCChange}
        onTest={handleOIDCTest}
        testing={testing}
        testResult={oidcTestResult}
        onValidationChange={() => onValidationChange('oidc', true)}
      />

      {/* Registration Settings Section */}
      <RegistrationSection
        settings={settings.registration}
        onChange={handleRegistrationChange}
      />

      {/* Warning: No auth methods enabled AND no local users exist */}
      {showNoAuthWarning && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
                No Authentication Methods Available
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                You must enable at least one authentication method (OIDC or Manual Registration) since no local users exist.
                Saving with both disabled will lock you out of the system.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Warning: Only manual registration enabled but no admin users exist */}
      {showNoAdminWarning && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
                No Admin Users Exist
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                Manual registration is enabled but no local admin users exist. New users will be able to register but you will be locked out of admin features.
                Please enable OIDC or ensure at least one local admin user exists before saving.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info: Registration disabled but local users can still log in */}
      {showRegistrationDisabledInfo && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                Manual Registration Disabled
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                New user registration is disabled. Existing local users can still log in with their credentials.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Pending Users Section */}
      {showPendingUsers && (
        <PendingUsersTable
          pendingUsers={pendingUsers}
          loading={loadingPendingUsers}
          onApprove={approveUser}
        />
      )}
    </div>
  );
}
