/**
 * Component: Minimum Score Threshold Slider
 * Documentation: documentation/settings-pages.md
 *
 * Optional control for the ranking algorithm's minimum-score threshold used by
 * automatic searches. Range 0-100, default 50. Higher = stricter (may find
 * nothing), lower = more lenient (grabs weaker releases). A value of 0 still
 * relies on the independent title/author match gate to reject wrong books.
 */

'use client';

import React from 'react';

interface MinScoreSliderProps {
  /** Display label for this threshold (e.g. "Audiobooks"). */
  label: string;
  /** Natural-language media noun used in help text (e.g. "audiobook"). */
  mediaLabel: string;
  /** Current threshold value (0-100). */
  value: number;
  /** Called with the new value when the slider moves. */
  onChange: (value: number) => void;
}

export function MinScoreSlider({ label, mediaLabel, value, onChange }: MinScoreSliderProps) {
  // Color the numeric readout by zone: lenient (low), balanced (mid), strict (high).
  const getValueColor = (v: number): string => {
    if (v === 0) return 'text-red-700 dark:text-red-400';
    if (v < 35) return 'text-yellow-600 dark:text-yellow-500';
    if (v > 75) return 'text-orange-600 dark:text-orange-400';
    return 'text-green-600 dark:text-green-500';
  };

  // Fill the track up to the current position (blue fill = configured strictness).
  const getSliderBackground = (v: number): string => {
    return `linear-gradient(to right,
      #3b82f6 0%,
      #3b82f6 ${v}%,
      #e5e7eb ${v}%,
      #e5e7eb 100%)`;
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <span className={`text-sm font-bold min-w-[48px] text-right ${getValueColor(value)}`}>
          {value}/100
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">0</span>
        <div className="flex-1 relative">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={value}
            onChange={(e) => onChange(parseInt(e.target.value, 10))}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer min-score-slider"
            style={{ background: getSliderBackground(value) }}
          />
          <style jsx>{`
            .min-score-slider::-webkit-slider-thumb {
              appearance: none;
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: white;
              border: 2px solid #3b82f6;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            }
            .min-score-slider::-moz-range-thumb {
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: white;
              border: 2px solid #3b82f6;
              cursor: pointer;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            }
          `}</style>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-8">100</span>
      </div>

      {value === 0 && (
        <div className="mt-3 p-3 rounded-lg text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200">
          ⚠️ <span className="font-medium">Threshold disabled.</span> At 0, automatic
          searches accept the highest-ranked {mediaLabel} that matches the title and
          author, no matter how poor its quality (seeders, size, format). Wrong books
          are still rejected by the match check, but you may download low-quality
          releases. Raise this if you want a quality floor.
        </div>
      )}
    </div>
  );
}
