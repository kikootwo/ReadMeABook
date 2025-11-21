/**
 * Component: BookDate Main Page
 * Documentation: documentation/features/bookdate-prd.md
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { RecommendationCard } from '@/components/bookdate/RecommendationCard';
import { LoadingScreen } from '@/components/bookdate/LoadingScreen';
import { SettingsWidget } from '@/components/bookdate/SettingsWidget';

export default function BookDatePage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastSwipe, setLastSwipe] = useState<any>(null);
  const [showUndo, setShowUndo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    setCheckingOnboarding(true);

    try {
      const accessToken = localStorage.getItem('accessToken');

      if (!accessToken) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/bookdate/preferences', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Failed to check onboarding status:', data.error);
        // Continue to recommendations anyway on error
        loadRecommendations();
        return;
      }

      // Check if user has completed onboarding
      if (!data.onboardingComplete) {
        // First time user - show onboarding settings
        setIsOnboarding(true);
        setShowSettings(true);
        setLoading(false);
      } else {
        // Existing user - load recommendations normally
        loadRecommendations();
      }

    } catch (error: any) {
      console.error('Check onboarding error:', error);
      // Continue to recommendations anyway on error
      loadRecommendations();
    } finally {
      setCheckingOnboarding(false);
    }
  };

  const handleOnboardingComplete = () => {
    // Onboarding is done, now load recommendations
    setIsOnboarding(false);
    setShowSettings(false);
    loadRecommendations();
  };

  const loadRecommendations = async () => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = localStorage.getItem('accessToken');

      if (!accessToken) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/bookdate/recommendations', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to load recommendations');
        return;
      }

      setRecommendations(data.recommendations || []);
      setCurrentIndex(0);

    } catch (error: any) {
      console.error('Load recommendations error:', error);
      setError(error.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = async (
    action: 'left' | 'right' | 'up',
    markedAsKnown = false
  ) => {
    const recommendation = recommendations[currentIndex];

    try {
      const accessToken = localStorage.getItem('accessToken');

      await fetch('/api/bookdate/swipe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recommendationId: recommendation.id,
          action,
          markedAsKnown,
        }),
      });

      // Store last swipe for undo functionality
      if (action !== 'right') {
        setLastSwipe({ recommendation, action, index: currentIndex });
        setShowUndo(true);

        // Hide undo button after 3 seconds
        setTimeout(() => {
          setShowUndo(false);
        }, 3000);
      }

      // Move to next recommendation
      setCurrentIndex(currentIndex + 1);

      // Check if we need to load more recommendations
      if (currentIndex + 1 >= recommendations.length) {
        // At the end - could auto-load more or show empty state
      }

    } catch (error) {
      console.error('Swipe error:', error);
      // Don't block user, just log error
    }
  };

  const handleUndo = async () => {
    if (!lastSwipe || lastSwipe.action === 'right') {
      return;
    }

    try {
      const accessToken = localStorage.getItem('accessToken');

      const response = await fetch('/api/bookdate/undo', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        setLastSwipe(null);
        setShowUndo(false);

        // Reload recommendations to include restored card (which will be at index 0)
        await loadRecommendations();
        // Reset to first card (the restored card is now at the front)
        setCurrentIndex(0);
      }
    } catch (error) {
      console.error('Undo error:', error);
    }
  };

  const handleGenerateMore = async () => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = localStorage.getItem('accessToken');

      const response = await fetch('/api/bookdate/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to generate recommendations');
        return;
      }

      setRecommendations(data.recommendations || []);
      setCurrentIndex(0);

    } catch (error: any) {
      console.error('Generate error:', error);
      setError(error.message || 'Failed to generate recommendations');
    } finally {
      setLoading(false);
    }
  };

  // Loading state (checking onboarding or loading recommendations)
  if (loading || checkingOnboarding) {
    return <LoadingScreen />;
  }

  // Onboarding state - show settings modal only
  if (isOnboarding) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="text-center max-w-md">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Welcome to BookDate!
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Let's customize your recommendations to get started
            </p>
          </div>
        </div>

        {/* Settings Widget */}
        <SettingsWidget
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          isOnboarding={isOnboarding}
          onOnboardingComplete={handleOnboardingComplete}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              ⚠️ Could not load recommendations
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {error}
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={loadRecommendations}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => router.push('/settings')}
                className="px-6 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state - no recommendations
  if (recommendations.length === 0 || currentIndex >= recommendations.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
          <div className="text-center max-w-md">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              🎉 You've seen all our current recommendations!
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Want more suggestions based on your preferences?
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={handleGenerateMore}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Get More Recommendations
              </button>
              <button
                onClick={() => router.push('/')}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentRec = recommendations[currentIndex];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />

      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-2 md:p-4">
        {/* Settings button */}
        <button
          onClick={() => setShowSettings(true)}
          className="fixed top-20 right-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg transition-all z-10"
          aria-label="Open settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Progress indicator */}
        <div className="mb-2 md:mb-4 text-sm text-gray-600 dark:text-gray-400">
          {currentIndex + 1} / {recommendations.length}
        </div>

        {/* Recommendation card */}
        <RecommendationCard
          recommendation={currentRec}
          onSwipe={handleSwipe}
        />

        {/* Undo button */}
        {showUndo && lastSwipe && (
          <button
            onClick={handleUndo}
            className="fixed bottom-4 md:bottom-8 left-4 md:left-8 px-4 md:px-6 py-2 md:py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-lg font-medium shadow-lg transition-all animate-fade-in text-sm md:text-base"
          >
            ↩️ {lastSwipe.action === 'left' ? 'Undo Dislike' : 'Undo Dismiss'}
          </button>
        )}

        {/* Mobile swipe hint - more compact on mobile */}
        <div className="mt-2 md:mt-6 text-center text-xs md:text-sm text-gray-500 dark:text-gray-400 md:hidden">
          <p>Swipe left to reject, right to request, up to dismiss</p>
        </div>
      </main>

      {/* Settings Widget */}
      <SettingsWidget
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        isOnboarding={isOnboarding}
        onOnboardingComplete={handleOnboardingComplete}
      />
    </div>
  );
}
