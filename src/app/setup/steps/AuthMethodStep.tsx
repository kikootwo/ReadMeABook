/**
 * Component: Authentication Method Selection Step
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

'use client';

import { Button } from '@/components/ui/Button';

interface AuthMethodStepProps {
  value: 'oidc' | 'manual' | 'both';
  onChange: (value: 'oidc' | 'manual' | 'both') => void;
  onNext: () => void;
  onBack: () => void;
}

export function AuthMethodStep({
  value,
  onChange,
  onNext,
  onBack,
}: AuthMethodStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Choose Authentication Method
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Select how users will authenticate to access ReadMeABook.
        </p>
      </div>

      <div className="space-y-4">
        <label
          className={`block p-4 border-2 rounded-lg cursor-pointer transition ${
            value === 'oidc'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <input
            type="radio"
            name="authMethod"
            value="oidc"
            checked={value === 'oidc'}
            onChange={() => onChange('oidc')}
            className="sr-only"
          />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              OIDC Provider
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Use Authentik, Keycloak, or other OIDC-compatible identity provider for
              single sign-on.
            </p>
          </div>
        </label>

        <label
          className={`block p-4 border-2 rounded-lg cursor-pointer transition ${
            value === 'manual'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <input
            type="radio"
            name="authMethod"
            value="manual"
            checked={value === 'manual'}
            onChange={() => onChange('manual')}
            className="sr-only"
          />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Manual Registration
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Users create accounts with username and password. Optional admin approval.
            </p>
          </div>
        </label>

        <label
          className={`block p-4 border-2 rounded-lg cursor-pointer transition ${
            value === 'both'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <input
            type="radio"
            name="authMethod"
            value="both"
            checked={value === 'both'}
            onChange={() => onChange('both')}
            className="sr-only"
          />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Both</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Enable OIDC as primary authentication with password-based registration as a
              fallback option.
            </p>
          </div>
        </label>
      </div>

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
              Recommendation
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              OIDC is recommended for better security and centralized user management. Choose
              "Both" if you want to provide a fallback option for users without OIDC access.
            </p>
          </div>
        </div>
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
