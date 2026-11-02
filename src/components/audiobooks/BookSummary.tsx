/**
 * Component: Book Summary (details modal)
 * Documentation: documentation/frontend/components.md
 *
 * Renders the "Summary" heading and the book summary in its own capped scroll
 * box, so a long Audnexus summary never stretches the details modal. Returns a
 * fragment: both nodes are flex items of the modal's content column, which lets
 * the box absorb the space that's left (between min(6rem, natural height) and
 * 15rem) on screens at least 640px wide and 500px tall. Elsewhere (phones,
 * landscape phones) it is a fixed 38dvh cap and the sheet scrolls.
 * The box becomes a focusable, labelled region only when its text overflows,
 * and then shows a bottom fade plus a "more" chevron until the end is reached.
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
  /** Text overruns the cap by at most SLACK_PX: the cap is lifted instead of scrolling. */
  slack: boolean;
}

// Absorbs fractional scrollTop at the ends; any larger hidden remainder still gets a fade.
const EDGE_TOLERANCE_PX = 1;
// A summary this close to the cap is shown whole rather than scrolled for a few pixels.
const SLACK_PX = 12;
// The chevron scrolls one box height minus the two fades (bottom h-6 + top h-4), so the line cut off
// at the bottom lands clear of the top fade.
const FADE_OVERLAP_PX = 40;
const MIN_STEP_PX = 24;
const SLACK_MAX_HEIGHT = `calc(var(--summary-cap) + ${SLACK_PX}px)`;

const INITIAL_STATE: ScrollState = { overflowing: false, atTop: true, atBottom: true, scrollbarWidth: 0, slack: false };

// Shrinking (absorbing leftover height) only where there is height to share; phones keep the sheet scroll.
const WRAPPER_CLASS =
  'relative flex flex-col shrink-0 [@media(min-width:640px)_and_(min-height:500px)]:shrink basis-[content] h-24 ' +
  '[--summary-cap:38dvh] [@media(min-width:640px)_and_(min-height:500px)]:[--summary-cap:15rem] max-h-(--summary-cap)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function BookSummary({ text }: BookSummaryProps) {
  const headingId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<ScrollState>(INITIAL_STATE);
  const [focused, setFocused] = useState(false);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const wrapper = wrapperRef.current;
    if (!box || !wrapper) return;
    // The cap in px, read back from the wrapper (minus the slack while it is lifted). Compared with the
    // natural text height, never with the current box height, so lifting the cap cannot flip it back.
    const slackOn = wrapper.style.maxHeight !== '';
    const capPx = parseFloat(getComputedStyle(wrapper).maxHeight) - (slackOn ? SLACK_PX : 0);
    const natural = box.scrollHeight;
    const overCap = natural - capPx;
    const maxScroll = box.scrollHeight - box.clientHeight;
    const next: ScrollState = {
      overflowing: maxScroll > 1,
      atTop: box.scrollTop <= EDGE_TOLERANCE_PX,
      atBottom: box.scrollTop >= maxScroll - EDGE_TOLERANCE_PX,
      scrollbarWidth: Math.max(0, box.offsetWidth - box.clientWidth),
      slack: Number.isFinite(capPx) && overCap > 1 && overCap <= SLACK_PX,
    };
    setState((prev) =>
      prev.overflowing === next.overflowing &&
      prev.atTop === next.atTop &&
      prev.atBottom === next.atBottom &&
      prev.scrollbarWidth === next.scrollbarWidth &&
      prev.slack === next.slack
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

  // Lifting the cap changes the box height; measure again once that has rendered.
  useLayoutEffect(() => {
    measure();
  }, [measure, state.slack]);

  const scrollForMore = () => {
    const box = boxRef.current;
    if (!box) return;
    box.scrollBy({ top: Math.max(box.clientHeight - FADE_OVERLAP_PX, MIN_STEP_PX), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const { overflowing, atTop, atBottom, scrollbarWidth, slack } = state;
  // Stay a focusable region while focused, so focus never drops to <body> if the text stops overflowing.
  const regionProps = overflowing || focused
    ? { role: 'region' as const, 'aria-labelledby': headingId, tabIndex: 0 }
    : {};
  const fadeInset = { right: scrollbarWidth };
  const showMore = overflowing && !atBottom;

  return (
    <>
      <h3
        id={headingId}
        className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700/50 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3"
      >
        Summary
      </h3>
      {/* Flex item that shrinks: basis = natural height, auto min = min(natural, h-24); owns the cap */}
      <div
        ref={wrapperRef}
        data-testid="book-summary"
        className={WRAPPER_CLASS}
        style={slack ? { maxHeight: SLACK_MAX_HEIGHT } : undefined}
      >
        <div
          ref={boxRef}
          data-testid="book-summary-scroll"
          className={`min-h-0 ${overflowing ? 'overflow-y-auto' : 'overflow-y-hidden'} overflow-x-hidden overscroll-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
        {showMore && (
          <div
            aria-hidden="true"
            data-testid="book-summary-fade-bottom"
            className="pointer-events-none absolute left-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-gray-900 to-transparent"
            style={fadeInset}
          />
        )}
        {showMore && (
          // Pointer affordance only: keyboard and screen-reader users scroll the focusable region itself.
          // -bottom-2 + h-8: the disc's top meets the bottom fade's top (box - 24px), so it only covers text
          // the fade already marks as cut off; it hangs 8px below the box, inside the next section's mt-6.
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="book-summary-more"
            onMouseDown={(e) => e.preventDefault()}
            onClick={scrollForMore}
            className="absolute -bottom-2 w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 shadow-md text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors after:absolute after:-inset-1.5"
            style={{ right: scrollbarWidth + 4 }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
    </>
  );
}
