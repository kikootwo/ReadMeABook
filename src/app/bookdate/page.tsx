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

export default function BookDatePage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastSwipe, setLastSwipe] = useState<any>(null);
  const [showUndo, setShowUndo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadRecommendations();
  }, []);

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
        // Move back to previous card
        setCurrentIndex(Math.max(0, currentIndex - 1));
        setLastSwipe(null);
        setShowUndo(false);

        // Reload recommendations to include restored card
        await loadRecommendations();
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

  // Loading state
  if (loading) {
    return <LoadingScreen />;
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

      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4">
        {/* Progress indicator */}
        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
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
            className="fixed bottom-8 left-8 px-6 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-lg font-medium shadow-lg transition-all animate-fade-in"
          >
            ↩️ {lastSwipe.action === 'left' ? 'Undo Dislike' : 'Undo Dismiss'}
          </button>
        )}

        {/* Mobile swipe hint */}
        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400 md:hidden">
          <p>Swipe left to reject, right to request, up to dismiss</p>
        </div>
      </main>
    </div>
  );
}
