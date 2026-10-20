/**
 * Component: Book Summary (details modal)
 * Documentation: documentation/frontend/components.md
 *
 * Renders the "Summary" heading and the book summary in its own capped scroll
 * box, so a long Audnexus summary never stretches the details modal. Returns a
 * fragment: both nodes are flex items of the modal's content column, which lets
 * the box absorb the space that's left (between min(6rem, natural height) and
 * 15rem) on sm+ screens. On phones it is a fixed 38dvh cap and the sheet scrolls.
 * The box becomes a focusable, labelled region only when its text overflows.
 */

'use client';

import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

interface BookSummaryProps {
  text: string;
}

interface ScrollState {
  overflowing: boolean;
  atTop: boolean;
  atBottom: boolean;
  scrollbarWidth: number;
}

const EDGE_TOLERANCE_PX = 4;

const INITIAL_STATE: ScrollState = { overflowing: false, atTop: true, atBottom: true, scrollbarWidth: 0 };

export function BookSummary({ text }: BookSummaryProps) {
  const headingId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<ScrollState>(INITIAL_STATE);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const maxScroll = box.scrollHeight - box.clientHeight;
    const next: ScrollState = {
      overflowing: maxScroll > 1,
      atTop: box.scrollTop <= EDGE_TOLERANCE_PX,
      atBottom: box.scrollTop >= maxScroll - EDGE_TOLERANCE_PX,
      scrollbarWidth: Math.max(0, box.offsetWidth - box.clientWidth),
    };
    setState((prev) =>
      prev.overflowing === next.overflowing &&
      prev.atTop === next.atTop &&
      prev.atBottom === next.atBottom &&
      prev.scrollbarWidth === next.scrollbarWidth
        ? prev
        : next
    );
  }, []);

  // Re-measure when the text changes (ResizeObserver is a no-op in tests), on
  // scroll, and whenever the box or its text is resized by layout.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(box);
      if (textRef.current) observer.observe(textRef.current);
    }
    return () => {
      box.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure, text]);

  const { overflowing, atTop, atBottom, scrollbarWidth } = state;
  const regionProps = overflowing
    ? { role: 'region' as const, 'aria-labelledby': headingId, tabIndex: 0 }
    : {};
  const fadeInset = { right: scrollbarWidth };

  return (
    <>
      <h3
        id={headingId}
        className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700/50 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3"
      >
        Summary
      </h3>
      {/* Flex item that shrinks: basis = natural height, auto min = min(natural, h-24) */}
      <div
        data-testid="book-summary"
        className="relative flex flex-col shrink-0 sm:shrink basis-[content] h-24 max-h-[38dvh] sm:max-h-[15rem]"
      >
        <div
          ref={boxRef}
          data-testid="book-summary-scroll"
          className="min-h-0 max-h-[38dvh] sm:max-h-[15rem] overflow-y-auto overflow-x-hidden overscroll-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          {...regionProps}
        >
          <p
            ref={textRef}
            className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words text-[15px]"
          >
            {text}
          </p>
        </div>
        {overflowing && !atTop && (
          <div
            aria-hidden="true"
            data-testid="book-summary-fade-top"
            className="pointer-events-none absolute left-0 top-0 h-4 bg-gradient-to-b from-white dark:from-gray-900 to-transparent"
            style={fadeInset}
          />
        )}
        {overflowing && !atBottom && (
          <div
            aria-hidden="true"
            data-testid="book-summary-fade-bottom"
            className="pointer-events-none absolute left-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-gray-900 to-transparent"
            style={fadeInset}
          />
        )}
      </div>
    </>
  );
}
