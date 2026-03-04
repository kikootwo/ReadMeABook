/**
 * Component: Unified Pagination Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnifiedPagination, PaginationSection } from '@/components/ui/UnifiedPagination';

type ObserverEntry = {
  isIntersecting: boolean;
  intersectionRatio: number;
  target: Element;
};

function makeSections(
  overrides?: Partial<PaginationSection>[]
): [PaginationSection, PaginationSection] {
  const defaults: [PaginationSection, PaginationSection] = [
    {
      label: 'Popular',
      accentColor: 'bg-blue-500',
      currentPage: 1,
      totalPages: 3,
      onPageChange: vi.fn(),
      sectionRef: { current: document.createElement('section') },
      onScrollToSection: vi.fn(),
    },
    {
      label: 'New Releases',
      accentColor: 'bg-emerald-500',
      currentPage: 1,
      totalPages: 2,
      onPageChange: vi.fn(),
      sectionRef: { current: document.createElement('section') },
      onScrollToSection: vi.fn(),
    },
  ];

  if (overrides) {
    overrides.forEach((o, i) => {
      if (o) Object.assign(defaults[i], o);
    });
  }

  return defaults;
}

describe('UnifiedPagination', () => {
  const observers: { callback: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];

  beforeEach(() => {
    observers.length = 0;

    class MockIntersectionObserver {
      callback: IntersectionObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }

    (global as any).IntersectionObserver = MockIntersectionObserver;
  });

  it('renders nothing when both sections have only one page', () => {
    const sections = makeSections([{ totalPages: 1 }, { totalPages: 1 }]);
    const { container } = render(<UnifiedPagination sections={sections} />);
    // The pill should be hidden (pointer-events-none, opacity-0)
    const root = container.querySelector('div.fixed') as HTMLElement;
    expect(root).toHaveClass('pointer-events-none');
  });

  it('shows pagination when the dominant section is visible and has pages', () => {
    const sections = makeSections();
    const { container } = render(<UnifiedPagination sections={sections} />);

    const root = container.querySelector('div.fixed') as HTMLElement;
    expect(root).toHaveClass('opacity-0');

    // Simulate first section becoming visible with high ratio
    act(() => {
      observers[0].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.5,
            target: sections[0].sectionRef.current as Element,
          } as ObserverEntry,
        ],
        observers[0] as unknown as IntersectionObserver
      );
    });

    expect(root).toHaveClass('opacity-100');
  });

  it('hides when footer becomes visible', () => {
    const sections = makeSections();
    const footerRef = { current: document.createElement('footer') };
    const { container } = render(
      <UnifiedPagination sections={sections} footerRef={footerRef} />
    );

    const root = container.querySelector('div.fixed') as HTMLElement;

    // Make section visible
    act(() => {
      observers[0].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.5,
            target: sections[0].sectionRef.current as Element,
          } as ObserverEntry,
        ],
        observers[0] as unknown as IntersectionObserver
      );
    });

    expect(root).toHaveClass('opacity-100');

    // Footer observer is the 3rd (index 2): section0, section1, footer
    act(() => {
      observers[2].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.1,
            target: footerRef.current as Element,
          } as ObserverEntry,
        ],
        observers[2] as unknown as IntersectionObserver
      );
    });

    expect(root).toHaveClass('opacity-0');
  });

  it('calls onPageChange for prev/next buttons', () => {
    const sections = makeSections([{ currentPage: 2, totalPages: 4 }]);
    const { container } = render(<UnifiedPagination sections={sections} />);

    // Make section visible so controls render interactably
    act(() => {
      observers[0].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.5,
            target: sections[0].sectionRef.current as Element,
          } as ObserverEntry,
        ],
        observers[0] as unknown as IntersectionObserver
      );
    });

    fireEvent.click(screen.getByLabelText('Next page'));
    expect(sections[0].onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(sections[0].onPageChange).toHaveBeenCalledWith(1);
  });

  it('handles page jump input', () => {
    const sections = makeSections([{ currentPage: 2, totalPages: 5 }]);
    render(<UnifiedPagination sections={sections} />);

    // Make section visible
    act(() => {
      observers[0].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.5,
            target: sections[0].sectionRef.current as Element,
          } as ObserverEntry,
        ],
        observers[0] as unknown as IntersectionObserver
      );
    });

    const input = screen.getByLabelText('Jump to page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    expect(sections[0].onPageChange).toHaveBeenCalledWith(4);
  });

  it('uses pointer-events-none when hidden', () => {
    const sections = makeSections();
    const { container } = render(<UnifiedPagination sections={sections} />);
    const root = container.querySelector('div.fixed') as HTMLElement;
    expect(root).toHaveClass('pointer-events-none');
  });
});
