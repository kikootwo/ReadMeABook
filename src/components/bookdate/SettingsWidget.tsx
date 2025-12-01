/**
 * Component: BookDate Settings Widget
 * Documentation: documentation/features/bookdate.md
 */

'use client';

import { useState, useEffect } from 'react';

interface SettingsWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  isOnboarding?: boolean; // If true, this is first-time onboarding
  onOnboardingComplete?: () => void; // Called when onboarding is saved
}

export function SettingsWidget({ isOpen, onClose, isOnboarding = false, onOnboardingComplete }: SettingsWidgetProps) {
  const [libraryScope, setLibraryScope] = useState<'full' | 'rated'>('full');
  const [customPrompt, setCustomPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load current preferences
  useEffect(() => {
    if (isOpen) {
      loadPreferences();
    }
  }, [isOpen]);

  const loadPreferences = async () => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = localStorage.getItem('accessToken');
      const response = await fetch('/api/bookdate/preferences', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load preferences');
      }

      const data = await response.json();
      setLibraryScope(data.libraryScope || 'full');
      setCustomPrompt(data.customPrompt || '');
    } catch (error: any) {
      console.error('Load preferences error:', error);
      setError(error.message || 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const accessToken = localStorage.getItem('accessToken');
      const trimmedPrompt = customPrompt.trim();
      const response = await fetch('/api/bookdate/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          libraryScope,
          customPrompt: trimmedPrompt || null, // Send null if empty
          onboardingComplete: isOnboarding ? true : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save preferences');
      }

      setSuccessMessage('Preferences saved successfully!');

      // If this is onboarding, call the completion callback after a short delay
      if (isOnboarding && onOnboardingComplete) {
        setTimeout(() => {
          onOnboardingComplete();
          onClose();
        }, 500);
      } else {
        // Clear success message after 3 seconds for normal saves
        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      }

    } catch (error: any) {
      console.error('Save preferences error:', error);
      setError(error.message || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Settings Panel */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl z-50 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {isOnboarding ? 'Welcome to BookDate!' : 'BookDate Preferences'}
              </h2>
              {isOnboarding && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Customize your recommendations before we begin
                </p>
              )}
            </div>
            {!isOnboarding && (
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            )}
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Error Message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Success Message */}
              {successMessage && (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-300 text-sm">
                  {successMessage}
                </div>
              )}

              {/* Library Scope */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Library Scope
                </label>
                <div className="space-y-3">
                  <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700/50 ${libraryScope === 'full' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                    <input
                      type="radio"
                      name="libraryScope"
                      value="full"
                      checked={libraryScope === 'full'}
                      onChange={(e) => setLibraryScope(e.target.value as 'full' | 'rated')}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="ml-3 flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">
                        Full Library
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Get recommendations based on your entire library
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700/50 ${libraryScope === 'rated' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600'}`}>
                    <input
                      type="radio"
                      name="libraryScope"
                      value="rated"
                      checked={libraryScope === 'rated'}
                      onChange={(e) => setLibraryScope(e.target.value as 'full' | 'rated')}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="ml-3 flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">
                        Rated Books Only
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Only consider books you've rated for recommendations
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Custom Prompt */}
              <div className="mb-6">
                <label htmlFor="customPrompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Custom Prompt Modifier
                  <span className="text-gray-500 dark:text-gray-400 font-normal ml-2">
                    (Optional)
                  </span>
                </label>
                <textarea
                  id="customPrompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="e.g., I prefer mysteries set in historical periods, or narrators with British accents..."
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>Add preferences to guide recommendations</span>
                  <span>{customPrompt.length}/1000</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                >
                  {saving ? 'Saving...' : isOnboarding ? "Let's Go!" : 'Save Preferences'}
                </button>
                {!isOnboarding && (
                  <button
                    onClick={onClose}
                    className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
