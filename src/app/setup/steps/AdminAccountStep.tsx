/**
 * Component: Admin Account Setup Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface AdminAccountStepProps {
  adminUsername: string;
  adminPassword: string;
  onUpdate: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function AdminAccountStep({
  adminUsername,
  adminPassword,
  onUpdate,
  onNext,
  onBack,
}: AdminAccountStepProps) {
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{ username?: string; password?: string; confirm?: string }>({});

  const validate = () => {
    const newErrors: { username?: string; password?: string; confirm?: string } = {};

    // Validate username
    if (!adminUsername || adminUsername.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    // Validate password
    if (!adminPassword || adminPassword.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    // Validate password confirmation
    if (adminPassword !== confirmPassword) {
      newErrors.confirm = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validate()) {
      onNext();
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white mb-2">Create Admin Account</h2>
        <p className="text-gray-400">
          Set up your administrator account to manage the application
        </p>
      </div>

      <div className="space-y-4">
        {/* Username */}
        <div>
          <label htmlFor="adminUsername" className="block text-sm font-medium text-gray-300 mb-2">
            Username
          </label>
          <input
            type="text"
            id="adminUsername"
            value={adminUsername}
            onChange={(e) => onUpdate('adminUsername', e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="admin"
            autoComplete="username"
          />
          {errors.username && (
            <p className="mt-1 text-sm text-red-400">{errors.username}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            This will be your local admin username (minimum 3 characters)
          </p>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="adminPassword" className="block text-sm font-medium text-gray-300 mb-2">
            Password
          </label>
          <input
            type="password"
            id="adminPassword"
            value={adminPassword}
            onChange={(e) => onUpdate('adminPassword', e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="••••••••"
            autoComplete="new-password"
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-400">{errors.password}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Choose a strong password (minimum 8 characters)
          </p>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-2">
            Confirm Password
          </label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            placeholder="••••••••"
            autoComplete="new-password"
          />
          {errors.confirm && (
            <p className="mt-1 text-sm text-red-400">{errors.confirm}</p>
          )}
        </div>

        {/* Info Box */}
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="text-sm text-blue-300">
              <p className="font-medium mb-1">About Admin Accounts</p>
              <p className="text-blue-400">
                This local admin account is separate from media server authentication. Use it to access
                admin settings and manage the application.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3 pt-4">
        <Button
          onClick={onBack}
          variant="outline"
          className="flex-1"
        >
          Back
        </Button>
        <Button
          onClick={handleNext}
          className="flex-1 bg-orange-600 hover:bg-orange-700"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
