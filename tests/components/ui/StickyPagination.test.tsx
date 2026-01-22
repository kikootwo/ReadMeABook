/**
 * Component: Sticky Pagination Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StickyPagination } from '@/components/ui/StickyPagination';

type ObserverEntry = {
  isIntersecting: boolean;
  intersectionRatio: number;
  target: Element;
};

describe('StickyPagination', () => {
  const observers: { callback: IntersectionObserverCallback }[] = [];

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

  it('returns null when there is only one page', () => {
    const sectionRef = { current: document.createElement('div') };
    const { container } = render(
      <StickyPagination
        currentPage={1}
        totalPages={1}
        onPageChange={vi.fn()}
        sectionRef={sectionRef}
        label="Popular"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('shows and hides based on section and footer visibility', () => {
    const sectionRef = { current: document.createElement('div') };
    const footerRef = { current: document.createElement('div') };

    const { container } = render(
      <StickyPagination
        currentPage={2}
        totalPages={5}
        onPageChange={vi.fn()}
        sectionRef={sectionRef}
        footerRef={footerRef}
        label="Popular"
      />
    );

    const root = container.querySelector('div.fixed') as HTMLElement;
    expect(root).toHaveClass('opacity-0');

    act(() => {
      observers[0].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.2,
            target: sectionRef.current as Element,
          } as ObserverEntry,
        ],
        observers[0] as unknown as IntersectionObserver
      );
    });

    expect(root).toHaveClass('opacity-100');

    act(() => {
      observers[1].callback(
        [
          {
            isIntersecting: true,
            intersectionRatio: 0.2,
            target: footerRef.current as Element,
          } as ObserverEntry,
        ],
        observers[1] as unknown as IntersectionObserver
      );
    });

    expect(root).toHaveClass('opacity-0');
  });

  it('handles navigation and jump input updates', () => {
    const sectionRef = { current: document.createElement('div') };
    const onPageChange = vi.fn();

    render(
      <StickyPagination
        currentPage={2}
        totalPages={4}
        onPageChange={onPageChange}
        sectionRef={sectionRef}
        label="Popular"
      />
    );

    fireEvent.click(screen.getByLabelText('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(1);

    const input = screen.getByLabelText('Current page') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    expect(onPageChange).toHaveBeenCalledWith(4);

    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input.value).toBe('2');
  });
});
