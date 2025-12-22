/**
 * Component: OIDC Configuration Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface OIDCConfigStepProps {
  oidcProviderName: string;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcAccessControlMethod: string;
  oidcAccessGroupClaim: string;
  oidcAccessGroupValue: string;
  oidcAllowedEmails: string;
  oidcAllowedUsernames: string;
  oidcAdminClaimEnabled: boolean;
  oidcAdminClaimName: string;
  oidcAdminClaimValue: string;
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function OIDCConfigStep({
  oidcProviderName,
  oidcIssuerUrl,
  oidcClientId,
  oidcClientSecret,
  oidcAccessControlMethod,
  oidcAccessGroupClaim,
  oidcAccessGroupValue,
  oidcAllowedEmails,
  oidcAllowedUsernames,
  oidcAdminClaimEnabled,
  oidcAdminClaimName,
  oidcAdminClaimValue,
  onUpdate,
  onNext,
  onBack,
}: OIDCConfigStepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/setup/test-oidc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuerUrl: oidcIssuerUrl,
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResult({
          success: true,
          message: 'OIDC discovery successful! Provider configuration validated.',
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'OIDC discovery failed',
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    if (!testResult?.success) {
      setTestResult({
        success: false,
        message: 'Please test the OIDC configuration before proceeding',
      });
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Configure OIDC Provider
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Set up single sign-on authentication with your OIDC provider (Authentik, Keycloak, etc.)
        </p>
      </div>

      {/* Provider Connection */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
          Provider Connection
        </h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Provider Name
          </label>
          <Input
            type="text"
            placeholder="Authentik"
            value={oidcProviderName}
            onChange={(e) => onUpdate('oidcProviderName', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Display name for the login button (e.g., "Authentik", "Keycloak", "SSO")
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Issuer URL
          </label>
          <Input
            type="url"
            placeholder="https://auth.example.com/application/o/readmeabook/"
            value={oidcIssuerUrl}
            onChange={(e) => onUpdate('oidcIssuerUrl', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The OIDC issuer URL from your identity provider configuration
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Client ID
          </label>
          <Input
            type="text"
            placeholder="readmeabook"
            value={oidcClientId}
            onChange={(e) => onUpdate('oidcClientId', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The OAuth2 client ID from your OIDC provider
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Client Secret
          </label>
          <Input
            type="password"
            placeholder="Enter client secret"
            value={oidcClientSecret}
            onChange={(e) => onUpdate('oidcClientSecret', e.target.value)}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The OAuth2 client secret from your OIDC provider
          </p>
        </div>

        <Button
          onClick={testConnection}
          loading={testing}
          disabled={!oidcIssuerUrl || !oidcClientId || !oidcClientSecret}
          variant="outline"
          className="w-full"
        >
          Test OIDC Configuration
        </Button>

        {testResult && (
          <div
            className={`rounded-lg p-4 ${
              testResult.success
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
            }`}
          >
            <div className="flex gap-3">
              <svg
                className={`w-6 h-6 flex-shrink-0 ${
                  testResult.success
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                {testResult.success ? (
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
              <div>
                <h3
                  className={`text-sm font-medium ${
                    testResult.success
                      ? 'text-green-800 dark:text-green-200'
                      : 'text-red-800 dark:text-red-200'
                  }`}
                >
                  {testResult.success ? 'Success' : 'Error'}
                </h3>
                <p
                  className={`text-sm mt-1 ${
                    testResult.success
                      ? 'text-green-700 dark:text-green-300'
                      : 'text-red-700 dark:text-red-300'
                  }`}
                >
                  {testResult.message}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
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
                Configuration Tips
              </p>
              <ul className="text-sm text-blue-700 dark:text-blue-300 mt-1 space-y-1">
                <li>• The redirect URI will be: {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/oidc/callback` : '[Your Domain]/api/auth/oidc/callback'}</li>
                <li>• Configure this redirect URI in your OIDC provider settings</li>
                <li>• Required scopes: openid, profile, email, groups</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Access Control */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
          Access Control
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Control who can log in to your application. This is separate from admin permissions.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Access Control Method
          </label>
          <select
            value={oidcAccessControlMethod}
            onChange={(e) => onUpdate('oidcAccessControlMethod', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="open">Open Access (anyone can log in)</option>
            <option value="group_claim">Group/Claim Based</option>
            <option value="allowed_list">Allowed List (emails/usernames)</option>
            <option value="admin_approval">Admin Approval Required</option>
          </select>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {oidcAccessControlMethod === 'open' && 'Anyone who can authenticate with your OIDC provider will have access'}
            {oidcAccessControlMethod === 'group_claim' && 'Only users with a specific group/claim can access'}
            {oidcAccessControlMethod === 'allowed_list' && 'Only explicitly allowed users can access'}
            {oidcAccessControlMethod === 'admin_approval' && 'New users must be approved by an admin before access is granted'}
          </p>
        </div>

        {oidcAccessControlMethod === 'group_claim' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Group Claim Name
              </label>
              <Input
                type="text"
                placeholder="groups"
                value={oidcAccessGroupClaim}
                onChange={(e) => onUpdate('oidcAccessGroupClaim', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                The OIDC claim field that contains group membership (usually "groups" or "roles")
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Required Group
              </label>
              <Input
                type="text"
                placeholder="readmeabook-users"
                value={oidcAccessGroupValue}
                onChange={(e) => onUpdate('oidcAccessGroupValue', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Users must be in this group to access the application
              </p>
            </div>
          </>
        )}

        {oidcAccessControlMethod === 'allowed_list' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Allowed Emails (comma-separated)
              </label>
              <Input
                type="text"
                placeholder="user1@example.com, user2@example.com"
                value={oidcAllowedEmails}
                onChange={(e) => onUpdate('oidcAllowedEmails', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Enter email addresses separated by commas
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Allowed Usernames (comma-separated)
              </label>
              <Input
                type="text"
                placeholder="john_doe, jane_smith"
                value={oidcAllowedUsernames}
                onChange={(e) => onUpdate('oidcAllowedUsernames', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Enter usernames separated by commas
              </p>
            </div>
          </>
        )}
      </div>

      {/* Admin Role Mapping */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
          Admin Role Mapping
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Automatically grant admin permissions based on OIDC claims (e.g., group membership). The first user will always become admin.
        </p>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="admin-claim-enabled"
            checked={oidcAdminClaimEnabled}
            onChange={(e) => onUpdate('oidcAdminClaimEnabled', e.target.checked)}
            className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <div className="flex-1">
            <label
              htmlFor="admin-claim-enabled"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              Enable Admin Role Mapping
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Automatically grant admin role to users with specific OIDC claim values
            </p>
          </div>
        </div>

        {oidcAdminClaimEnabled && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Admin Claim Name
              </label>
              <Input
                type="text"
                placeholder="groups"
                value={oidcAdminClaimName}
                onChange={(e) => onUpdate('oidcAdminClaimName', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                The OIDC claim field to check for admin role (usually "groups" or "roles")
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Admin Claim Value
              </label>
              <Input
                type="text"
                placeholder="readmeabook-admin"
                value={oidcAdminClaimValue}
                onChange={(e) => onUpdate('oidcAdminClaimValue', e.target.value)}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Users with this value in their claim will be granted admin role
              </p>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
              <div className="flex gap-3">
                <svg
                  className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
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
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Example Configuration
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    In Authentik: Create a group called "readmeabook-admin", add users to it, and set "Admin Claim Value" to "readmeabook-admin"
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
        <Button onClick={onBack} variant="outline">
          Back
        </Button>
        <Button onClick={handleNext}>Next</Button>
      </div>
    </div>
  );
}
