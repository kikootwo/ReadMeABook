/**
 * Component: Hide Available Toggle
 * Documentation: UI toggle for hiding titles already in the user's library
 */

'use client';

import React from 'react';

interface HideAvailableToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function HideAvailableToggle({ enabled, onToggle }: HideAvailableToggleProps) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      aria-label={enabled ? 'Show available titles' : 'Hide available titles'}
      aria-pressed={enabled}
      title={enabled ? 'Hide available (on)' : 'Hide available (off)'}
      className={`
        p-1.5 rounded-md transition-all duration-200
        ${enabled
          ? 'bg-blue-500/20 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 dark:ring-blue-400/30 shadow-inner'
          : 'text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-gray-700/50'
        }
      `}
    >
      <svg
        className="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        {enabled ? (
          <>
            {/* Eye with slash — hidden state */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 3l18 18"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.5 10.677a2 2 0 002.823 2.823"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7.362 7.561C5.68 8.74 4.279 10.42 3 12c1.889 2.991 5.282 6 9 6 1.55 0 3.043-.523 4.395-1.35M12 6c3.718 0 7.111 3.009 9 6-.947 1.498-2.057 2.876-3.362 3.939"
            />
          </>
        ) : (
          <>
            {/* Open eye — visible state */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6c3.718 0 7.111 3.009 9 6-1.889 2.991-5.282 6-9 6s-7.111-3.009-9-6c1.889-2.991 5.282-6 9-6z"
            />
            <circle
              cx="12"
              cy="12"
              r="2"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
    </button>
  );
}
