/**
 * Component: Sticky Pagination with Progress Bar
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface StickyPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  sectionRef: React.RefObject<HTMLElement | null>;
  label: string; // e.g., "Popular Audiobooks"
}

export function StickyPagination({
  currentPage,
  totalPages,
  onPageChange,
  sectionRef,
  label,
}: StickyPaginationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [jumpPage, setJumpPage] = useState(currentPage.toString());

  // Update jump page input when current page changes externally
  useEffect(() => {
    setJumpPage(currentPage.toString());
  }, [currentPage]);

  // Intersection Observer to show/hide pagination based on section visibility
  useEffect(() => {
    if (!sectionRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Show pagination when section is in viewport
        setIsVisible(entry.isIntersecting && entry.intersectionRatio > 0.1);
      },
      {
        threshold: [0, 0.1, 0.5, 1],
        rootMargin: '-60px 0px -60px 0px', // Account for header/footer
      }
    );

    observer.observe(sectionRef.current);

    return () => observer.disconnect();
  }, [sectionRef]);

  if (totalPages <= 1) {
    return null;
  }

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(jumpPage, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page);
    } else {
      // Reset to current page if invalid
      setJumpPage(currentPage.toString());
    }
  };

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0'
      }`}
    >
      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg rounded-full shadow-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Section Label - Hidden on small screens */}
          <div className="hidden md:block text-xs font-medium text-gray-600 dark:text-gray-400 pr-2 border-r border-gray-300 dark:border-gray-600">
            {label}
          </div>

          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1}
            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800
                     text-gray-700 dark:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>

          {/* Page Info & Jump */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Page
            </span>
            <form onSubmit={handleJumpSubmit} className="inline-flex">
              <input
                type="text"
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                onBlur={handleJumpSubmit}
                className="w-10 px-1.5 py-0.5 text-center text-sm font-medium rounded
                         bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         border border-gray-300 dark:border-gray-600
                         focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                aria-label="Current page"
              />
            </form>
            <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
              of {totalPages}
            </span>
          </div>

          {/* Next Button */}
          <button
            onClick={handleNext}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800
                     text-gray-700 dark:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
            aria-label="Next page"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
