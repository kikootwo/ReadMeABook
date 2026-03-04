/**
 * Component: Unified Pagination — context-aware floating paginator
 * Documentation: documentation/frontend/components.md
 *
 * Replaces two overlapping StickyPagination instances with a single pill
 * that automatically tracks which section dominates the viewport and shows
 * controls for that section. Transitions smoothly when the dominant section
 * changes. Includes a two-dot section indicator for manual switching.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export interface PaginationSection {
  /** Display label, e.g. "Popular Audiobooks" */
  label: string;
  /** Tailwind color class applied to the active accent dot, e.g. "bg-blue-500" */
  accentColor: string;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Ref to the section element — used for intersection tracking */
  sectionRef: React.RefObject<HTMLElement | null>;
  /** Called when user clicks this section's dot while it's inactive — should scroll to section */
  onScrollToSection: () => void;
}

interface UnifiedPaginationProps {
  sections: [PaginationSection, PaginationSection];
  footerRef?: React.RefObject<HTMLElement | null>;
}

// ---------------------------------------------------------------------------
// Small page-jump form — isolated to prevent key re-mounts on section switch
// ---------------------------------------------------------------------------

interface PageJumpProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function PageJump({ currentPage, totalPages, onPageChange }: PageJumpProps) {
  const [value, setValue] = useState(currentPage.toString());

  // Sync when page changes externally (e.g. after scrollIntoView + setState)
  useEffect(() => {
    setValue(currentPage.toString());
  }, [currentPage]);

  const commit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
        onPageChange(parsed);
      } else {
        setValue(currentPage.toString());
      }
    },
    [value, currentPage, totalPages, onPageChange]
  );

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-gray-500 dark:text-gray-400 select-none whitespace-nowrap">
        Page
      </span>
      <form onSubmit={commit} className="inline-flex">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          className="w-10 px-1.5 py-0.5 text-center text-sm font-medium rounded-md
                     bg-black/[0.04] dark:bg-white/[0.08]
                     text-gray-900 dark:text-gray-100
                     border border-gray-300/60 dark:border-white/10
                     focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent
                     transition-all duration-150"
          aria-label="Jump to page"
        />
      </form>
      <span className="text-sm text-gray-500 dark:text-gray-400 select-none whitespace-nowrap">
        of {totalPages}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnifiedPagination({ sections, footerRef }: UnifiedPaginationProps) {
  // Index of the currently dominant section (0 or 1)
  const [activeIndex, setActiveIndex] = useState<0 | 1>(0);
  // Whether the label+controls area is mid-transition (drives opacity fade)
  const [isTransitioning, setIsTransitioning] = useState(false);

  const [footerVisible, setFooterVisible] = useState(false);
  // Per-section raw intersection ratios [0,1]
  const ratiosRef = useRef<[number, number]>([0, 0]);
  // Whether each section has any meaningful intersection
  const [sectionVisible, setSectionVisible] = useState<[boolean, boolean]>([false, false]);

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine if the pill should be shown at all:
  // - at least one section is meaningfully visible
  // - footer is not visible
  // - the active section has >1 page
  const activeSectionHasPages = sections[activeIndex].totalPages > 1;
  const eitherSectionVisible = sectionVisible[0] || sectionVisible[1];
  const shouldShow = eitherSectionVisible && !footerVisible && activeSectionHasPages;

  // ------------------------------------------------------------------
  // Track which section each instance belongs to via intersection ratio
  // ------------------------------------------------------------------
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sections.forEach((section, idx) => {
      if (!section.sectionRef.current) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          ratiosRef.current[idx as 0 | 1] = entry.intersectionRatio;
          const isVisible = entry.isIntersecting && entry.intersectionRatio > 0.05;

          setSectionVisible((prev) => {
            const next: [boolean, boolean] = [...prev] as [boolean, boolean];
            next[idx as 0 | 1] = isVisible;
            return next;
          });

          // Determine dominant section (whichever has more viewport coverage)
          const [r0, r1] = ratiosRef.current;
          const dominant: 0 | 1 = r0 >= r1 ? 0 : 1;

          setActiveIndex((current) => {
            if (current !== dominant) {
              // Trigger cross-fade transition
              setIsTransitioning(true);

              if (transitionTimerRef.current) {
                clearTimeout(transitionTimerRef.current);
              }
              transitionTimerRef.current = setTimeout(() => {
                setIsTransitioning(false);
              }, 320);

              return dominant;
            }
            return current;
          });
        },
        {
          // Dense threshold array gives us smooth ratio tracking
          threshold: Array.from({ length: 21 }, (_, i) => i / 20),
          rootMargin: '-60px 0px -80px 0px',
        }
      );

      observer.observe(section.sectionRef.current);
      observers.push(observer);
    });

    return () => {
      observers.forEach((o) => o.disconnect());
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections[0].sectionRef, sections[1].sectionRef]);

  // ------------------------------------------------------------------
  // Footer observer
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!footerRef?.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setFooterVisible(entry.isIntersecting),
      { threshold: [0, 0.01] }
    );
    observer.observe(footerRef.current);
    return () => observer.disconnect();
  }, [footerRef]);

  // ------------------------------------------------------------------
  // Derived values for the currently active section
  // ------------------------------------------------------------------
  const active = sections[activeIndex];

  const handlePrev = () => {
    if (active.currentPage > 1) active.onPageChange(active.currentPage - 1);
  };
  const handleNext = () => {
    if (active.currentPage < active.totalPages) active.onPageChange(active.currentPage + 1);
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div
      className={`
        fixed bottom-6 left-1/2 -translate-x-1/2 z-40
        transition-all duration-300 ease-out
        ${shouldShow
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-4 opacity-0 pointer-events-none'
        }
      `}
      aria-hidden={!shouldShow}
    >
      {/* Pill surface */}
      <div
        className="
          flex items-center gap-0
          bg-white/90 dark:bg-gray-900/90
          backdrop-blur-xl
          rounded-full
          shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)]
          dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.3)]
          border border-gray-200/60 dark:border-white/[0.08]
          px-1.5 py-1.5
          overflow-hidden
        "
      >
        {/* Section selector dots — left side */}
        <div className="flex flex-col gap-1 pl-2 pr-3">
          {sections.map((section, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                key={section.label}
                onClick={() => {
                  if (!isActive) section.onScrollToSection();
                }}
                disabled={isActive}
                title={section.label}
                aria-label={`Switch to ${section.label}`}
                className={`
                  w-1.5 rounded-full transition-all duration-300 ease-out
                  ${isActive
                    ? `${section.accentColor} h-4 opacity-100`
                    : 'bg-gray-300 dark:bg-gray-600 h-1.5 opacity-60 hover:opacity-90 hover:scale-110 cursor-pointer'
                  }
                `}
              />
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200 dark:bg-white/10 mr-3 flex-shrink-0" />

        {/* Label + controls — cross-fades on section switch */}
        <div
          className={`
            flex items-center gap-3
            transition-opacity duration-200 ease-in-out
            ${isTransitioning ? 'opacity-0' : 'opacity-100'}
          `}
          // key forces full remount on switch so input state resets cleanly
          key={activeIndex}
        >
          {/* Section label — hidden on small screens */}
          <span className="hidden sm:block text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap pr-1 select-none">
            {active.label}
          </span>

          {/* Previous */}
          <button
            onClick={handlePrev}
            disabled={active.currentPage === 1}
            aria-label="Previous page"
            className="
              p-1.5 rounded-full
              text-gray-600 dark:text-gray-300
              hover:bg-black/[0.06] dark:hover:bg-white/[0.08]
              active:bg-black/[0.1] dark:active:bg-white/[0.12]
              active:scale-95
              disabled:opacity-25 disabled:cursor-not-allowed
              transition-all duration-150
            "
          >
            <ChevronLeftIcon className="w-4 h-4" strokeWidth={2} />
          </button>

          {/* Page jump */}
          <PageJump
            currentPage={active.currentPage}
            totalPages={active.totalPages}
            onPageChange={active.onPageChange}
          />

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={active.currentPage === active.totalPages}
            aria-label="Next page"
            className="
              p-1.5 rounded-full
              text-gray-600 dark:text-gray-300
              hover:bg-black/[0.06] dark:hover:bg-white/[0.08]
              active:bg-black/[0.1] dark:active:bg-white/[0.12]
              active:scale-95
              disabled:opacity-25 disabled:cursor-not-allowed
              transition-all duration-150
            "
          >
            <ChevronRightIcon className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Right padding balance */}
        <div className="w-2" />
      </div>
    </div>
  );
}
