/**
 * Component: BookDate Recommendation Card
 * Documentation: documentation/features/bookdate-prd.md
 */

'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSwipeable } from 'react-swipeable';

interface RecommendationCardProps {
  recommendation: any;
  onSwipe: (action: 'left' | 'right' | 'up', markedAsKnown?: boolean) => void;
  onShowDetails?: () => void; // Callback to show details modal
  stackPosition?: number; // 0 = top, 1 = middle, 2 = bottom
  isAnimating?: boolean; // True during exit/advance animations
  isDraggable?: boolean; // False for cards behind the top card
}

export function RecommendationCard({
  recommendation,
  onSwipe,
  onShowDetails,
  stackPosition = 0,
  isAnimating = false,
  isDraggable = true,
}: RecommendationCardProps) {
  const [showToast, setShowToast] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const handleSwipeRight = () => {
    setShowToast(true);
  };

  const handleToastAction = (action: 'request' | 'known' | 'cancel') => {
    setShowToast(false);
    if (action === 'request') {
      onSwipe('right', false);
    } else if (action === 'known') {
      onSwipe('right', true);
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipeStart: () => {
      if (isDraggable && !isAnimating) {
        setIsDragging(true);
      }
    },
    onSwiping: (eventData) => {
      // Only update drag offset if card is draggable and not animating
      if (isDraggable && !isAnimating) {
        setDragOffset({ x: eventData.deltaX, y: eventData.deltaY });
        setIsDragging(true); // Ensure dragging state is set
      }
    },
    onSwiped: (eventData) => {
      setIsDragging(false);

      // Only process swipe if card is draggable and not animating
      if (!isDraggable || isAnimating) {
        setDragOffset({ x: 0, y: 0 });
        return;
      }

      // Check final position when user releases - must be at 100px threshold
      const finalX = eventData.deltaX;
      const finalY = eventData.deltaY;
      const threshold = 100;

      // Determine which direction had the strongest swipe at release
      if (Math.abs(finalX) > Math.abs(finalY)) {
        // Horizontal swipe
        if (finalX > threshold) {
          handleSwipeRight();
        } else if (finalX < -threshold) {
          onSwipe('left');
        }
      } else {
        // Vertical swipe
        if (finalY < -threshold) {
          onSwipe('up');
        }
      }

      // Reset drag offset
      setDragOffset({ x: 0, y: 0 });
    },
    // Enable mouse tracking for desktop
    trackMouse: true,
    preventScrollOnSwipe: true,
    // Don't use built-in delta threshold - we'll check manually in onSwiped
    delta: 0,
  });

  // Escape hatch: reset drag state if user clicks elsewhere
  const handleCardClick = (e: React.MouseEvent) => {
    if (isDragging && !isAnimating) {
      // If we're stuck dragging, reset everything
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
    }
  };

  const getOverlayOpacity = (threshold: number, value: number) => {
    return Math.min(Math.abs(value) / threshold, 1);
  };

  // Determine which overlay to show based on dominant direction
  const getDominantDirection = () => {
    const absX = Math.abs(dragOffset.x);
    const absY = Math.abs(dragOffset.y);

    if (absX < 50 && absY < 50) return null; // No overlay if not dragged enough

    if (absX > absY) {
      return dragOffset.x > 0 ? 'right' : 'left';
    } else {
      return dragOffset.y < 0 ? 'up' : null; // Only up swipe for vertical
    }
  };

  const dominantDirection = getDominantDirection();

  return (
    <>
      <div
        {...swipeHandlers}
        onClick={handleCardClick}
        className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden select-none max-h-[80vh] md:max-h-[85vh] flex flex-col"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(${dragOffset.x * 0.05}deg)`,
          transition: dragOffset.x === 0 && dragOffset.y === 0 ? 'transform 0.3s ease-out' : 'none',
          cursor: isDraggable ? 'grab' : 'default',
        }}
      >
        {/* Details button - only show for top card */}
        {stackPosition === 0 && onShowDetails && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!isAnimating) {
                // Reset any stuck drag state when clicking the button
                setDragOffset({ x: 0, y: 0 });
                setIsDragging(false);
                onShowDetails();
              }
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onMouseUp={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              if (!isAnimating) {
                setDragOffset({ x: 0, y: 0 });
                setIsDragging(false);
                onShowDetails();
              }
            }}
            type="button"
            className="absolute top-4 right-4 z-30 p-2.5 bg-white dark:bg-gray-800 backdrop-blur-sm rounded-full shadow-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 active:scale-95"
            title="View details"
            aria-label="View details"
            style={{ touchAction: 'none', cursor: 'pointer' }}
          >
            <svg
              className="w-5 h-5 text-gray-700 dark:text-gray-300 pointer-events-none"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        )}

        {/* Drag overlay indicators - show only dominant direction */}
        {dominantDirection === 'right' && (
          <div
            className="absolute inset-0 bg-green-500 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: getOverlayOpacity(100, dragOffset.x) * 0.4 }}
          >
            <div className="bg-white rounded-full p-6 shadow-lg flex flex-col items-center gap-2">
              <span className="text-6xl">✅</span>
              <span className="text-xl font-bold text-green-600">Request</span>
            </div>
          </div>
        )}
        {dominantDirection === 'left' && (
          <div
            className="absolute inset-0 bg-red-500 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: getOverlayOpacity(100, dragOffset.x) * 0.4 }}
          >
            <div className="bg-white rounded-full p-6 shadow-lg flex flex-col items-center gap-2">
              <span className="text-6xl">❌</span>
              <span className="text-xl font-bold text-red-600">Dislike</span>
            </div>
          </div>
        )}
        {dominantDirection === 'up' && (
          <div
            className="absolute inset-0 bg-blue-500 flex items-center justify-center pointer-events-none z-10"
            style={{ opacity: getOverlayOpacity(100, dragOffset.y) * 0.4 }}
          >
            <div className="bg-white rounded-full p-6 shadow-lg flex flex-col items-center gap-2">
              <span className="text-6xl">⬆️</span>
              <span className="text-xl font-bold text-blue-600">Dismiss</span>
            </div>
          </div>
        )}

        {/* Cover image - smaller on mobile to fit all content */}
        <div className="w-full relative bg-gray-200 dark:bg-gray-700 flex-shrink-0" style={{ maxHeight: 'min(25vh, 300px)' }}>
          {recommendation.coverUrl && !coverError ? (
            <Image
              src={recommendation.coverUrl}
              alt={recommendation.title}
              width={400}
              height={400}
              className="object-contain w-full h-auto"
              style={{ maxHeight: 'min(25vh, 300px)' }}
              unoptimized
              onError={() => setCoverError(true)}
            />
          ) : (
            <Image
              src="/placeholder_cover.svg"
              alt={recommendation.title}
              width={400}
              height={400}
              className="object-contain w-full h-auto"
              style={{ maxHeight: 'min(25vh, 300px)' }}
            />
          )}
        </div>

        {/* Book info - reduced padding on mobile */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <h3 className="text-xl md:text-2xl font-bold mb-2 text-gray-900 dark:text-white line-clamp-2">
            {recommendation.title}
          </h3>
          <p className="text-base md:text-lg text-gray-600 dark:text-gray-400 mb-1">
            {recommendation.author}
          </p>
          {recommendation.narrator && (
            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-500 mb-2">
              Narrated by {recommendation.narrator}
            </p>
          )}
          {recommendation.rating && (
            <div className="flex items-center mb-2">
              <span className="text-yellow-500 text-lg md:text-xl">⭐</span>
              <span className="ml-2 text-base md:text-lg font-semibold text-gray-700 dark:text-gray-300">
                {Number(recommendation.rating).toFixed(1)}
              </span>
            </div>
          )}
          {recommendation.description && (
            <p className="text-xs md:text-sm text-gray-700 dark:text-gray-300 line-clamp-3 md:line-clamp-4 mb-2">
              {recommendation.description}
            </p>
          )}
          {recommendation.aiReason && (
            <div className="mt-2 md:mt-4 p-2 md:p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-xs text-blue-700 dark:text-blue-300 italic line-clamp-3">
                💡 {recommendation.aiReason}
              </p>
            </div>
          )}
        </div>

        {/* Desktop buttons - only show for top card */}
        {stackPosition === 0 && (
          <div className="hidden md:flex justify-center gap-4 p-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => {
                if (!isAnimating) {
                  setDragOffset({ x: 0, y: 0 });
                  setIsDragging(false);
                  onSwipe('left');
                }
              }}
              disabled={isAnimating}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-full font-medium transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ❌ Not Interested
            </button>
            <button
              onClick={() => {
                if (!isAnimating) {
                  setDragOffset({ x: 0, y: 0 });
                  setIsDragging(false);
                  onSwipe('up');
                }
              }}
              disabled={isAnimating}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-medium transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ⬆️ Dismiss
            </button>
            <button
              onClick={() => {
                if (!isAnimating) {
                  setDragOffset({ x: 0, y: 0 });
                  setIsDragging(false);
                  handleSwipeRight();
                }
              }}
              disabled={isAnimating}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-full font-medium transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ✅ Request
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Toast */}
      {showToast && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Request "{recommendation.title}"?
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Do you want to request this audiobook, or have you already read/listened to and enjoyed it?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleToastAction('cancel')}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleToastAction('known')}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Mark as Liked
              </button>
              <button
                onClick={() => handleToastAction('request')}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Request
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
