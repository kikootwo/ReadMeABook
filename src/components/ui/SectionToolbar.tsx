/**
 * Component: Section Toolbar
 * Documentation: Responsive toolbar that shows inline controls on sm+ and collapses to popover on mobile
 */

'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSmartDropdownPosition } from '@/hooks/useSmartDropdownPosition';
import { HideAvailableToggle } from '@/components/ui/HideAvailableToggle';
import { SquareCoversToggle } from '@/components/ui/SquareCoversToggle';
import { CardSizeControls } from '@/components/ui/CardSizeControls';

interface SectionToolbarProps {
  hideAvailable: boolean;
  onToggleHideAvailable: (v: boolean) => void;
  squareCovers: boolean;
  onToggleSquareCovers: (v: boolean) => void;
  cardSize: number;
  onCardSizeChange: (v: number) => void;
}

export function SectionToolbar({
  hideAvailable,
  onToggleHideAvailable,
  squareCovers,
  onToggleSquareCovers,
  cardSize,
  onCardSizeChange,
}: SectionToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { containerRef, dropdownRef, style } = useSmartDropdownPosition(isOpen);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, containerRef, dropdownRef]);

  return (
    <div className="ml-auto flex items-center gap-1">
      {/* Inline controls — visible at sm and above */}
      <div className="hidden sm:flex items-center gap-1">
        <HideAvailableToggle enabled={hideAvailable} onToggle={onToggleHideAvailable} />
        <SquareCoversToggle enabled={squareCovers} onToggle={onToggleSquareCovers} />
        <CardSizeControls size={cardSize} onSizeChange={onCardSizeChange} />
      </div>

      {/* Collapsed ellipsis trigger — visible below sm */}
      <div className="sm:hidden" ref={containerRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label="View options"
          aria-expanded={isOpen}
          className={`
            p-1.5 rounded-md transition-all duration-200
            ${isOpen
              ? 'bg-blue-500/20 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 dark:ring-blue-400/30'
              : 'text-gray-600 dark:text-gray-400 hover:bg-white/20 dark:hover:bg-gray-700/50'
            }
          `}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {/* Portal dropdown */}
        {isOpen && typeof document !== 'undefined' && style && createPortal(
          <div
            ref={dropdownRef}
            style={style}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-lg ring-1 ring-black/5 dark:ring-white/10 z-50 py-1 min-w-[220px] animate-in fade-in duration-150"
          >
            {/* Hide Available */}
            <button
              onClick={() => onToggleHideAvailable(!hideAvailable)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className={`
                p-1 rounded-md transition-all duration-200
                ${hideAvailable
                  ? 'bg-blue-500/20 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 dark:ring-blue-400/30 shadow-inner'
                  : 'text-gray-500 dark:text-gray-400'
                }
              `}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {hideAvailable ? (
                    <>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 10.677a2 2 0 002.823 2.823" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.362 7.561C5.68 8.74 4.279 10.42 3 12c1.889 2.991 5.282 6 9 6 1.55 0 3.043-.523 4.395-1.35M12 6c3.718 0 7.111 3.009 9 6-.947 1.498-2.057 2.876-3.362 3.939" />
                    </>
                  ) : (
                    <>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6c3.718 0 7.111 3.009 9 6-1.889 2.991-5.282 6-9 6s-7.111-3.009-9-6c1.889-2.991 5.282-6 9-6z" />
                      <circle cx="12" cy="12" r="2" strokeWidth={2} />
                    </>
                  )}
                </svg>
              </span>
              <span className="text-gray-700 dark:text-gray-300">Hide Available</span>
              {hideAvailable && (
                <span className="ml-auto text-xs text-blue-600 dark:text-blue-400 font-medium">On</span>
              )}
            </button>

            {/* Square Covers */}
            <button
              onClick={() => onToggleSquareCovers(!squareCovers)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span className={`
                p-1 rounded-md transition-all duration-200
                ${squareCovers
                  ? 'bg-blue-500/20 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30 dark:ring-blue-400/30 shadow-inner'
                  : 'text-gray-500 dark:text-gray-400'
                }
              `}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9h4M3 15h4M21 9h-4M21 15h-4" opacity={squareCovers ? 1 : 0.4} />
                </svg>
              </span>
              <span className="text-gray-700 dark:text-gray-300">Square Covers</span>
              {squareCovers && (
                <span className="ml-auto text-xs text-blue-600 dark:text-blue-400 font-medium">On</span>
              )}
            </button>

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700 my-1" />

            {/* Card Size */}
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="p-1 text-gray-500 dark:text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <span className="text-gray-700 dark:text-gray-300">Card Size</span>
              <div className="ml-auto">
                <CardSizeControls size={cardSize} onSizeChange={onCardSizeChange} />
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
