/**
 * Component: Test Setup
 * Documentation: documentation/README.md
 */

import React from 'react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/image', () => ({
  default: (props: { src: string | { src: string } }) => {
    const resolvedSrc = typeof props.src === 'string' ? props.src : props.src?.src;
    return React.createElement('img', { ...props, src: resolvedSrc });
  },
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.TZ = 'UTC';
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = () => {
    throw new Error('fetch was called without a mock in tests');
  };

  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    };
  }

  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = (id: number) => {
      clearTimeout(id as unknown as NodeJS.Timeout);
    };
  }

  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (typeof window !== 'undefined') {
    window.scrollTo = window.scrollTo || vi.fn();
    window.open = window.open || vi.fn();
    window.matchMedia = window.matchMedia || ((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
  }
});
