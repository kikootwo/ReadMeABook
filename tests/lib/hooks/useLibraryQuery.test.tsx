/**
 * Component: Library page query state (URL parsing, replace not push, debounce, re-read on navigation)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, routerMock, setMockPathname, setMockSearchParams } from '../../helpers/mock-next-navigation';
import { libraryQueryString, parseLibraryQuery, useLibraryQuery } from '@/lib/hooks/useLibraryQuery';

const UUID = '0b6c7b1e-3c55-4f4e-9d1b-2f1f6f0f5a11';

describe('parseLibraryQuery', () => {
  it('drops every value the API would refuse', () => {
    const q = parseLibraryQuery(
      new URLSearchParams(`q=${'x'.repeat(250)}&status=problem,bogus,problem&source=scan,nope&requestedBy=${UUID},not-a-uuid&sort=weird&group=series&order=desc`)
    );
    expect(q).toEqual({ q: 'x'.repeat(200), status: ['problem'], source: ['scan'], requestedBy: [UUID], sort: 'added', group: 'none' });
  });

  it('caps requestedBy at 50 ids', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(parseLibraryQuery(new URLSearchParams(`requestedBy=${ids.join(',')}`)).requestedBy).toHaveLength(50);
  });

  it('writes defaults out and keeps a fixed order', () => {
    expect(libraryQueryString({ q: '', status: [], source: [], requestedBy: [], sort: 'added', group: 'none' })).toBe('');
    expect(libraryQueryString({ q: 'a b', status: ['problem'], source: [], requestedBy: [], sort: 'title', group: 'author' })).toBe(
      'q=a+b&status=problem&sort=title&group=author'
    );
  });
});

describe('useLibraryQuery', () => {
  beforeEach(() => {
    resetMockRouter();
    setMockPathname('/library');
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('reads the URL once, validated, and rewrites it with replace (never push)', () => {
    setMockSearchParams('status=problem,bogus&sort=title');
    const { result } = renderHook(() => useLibraryQuery());
    expect(result.current.query).toMatchObject({ status: ['problem'], sort: 'title' });
    expect(routerMock.replace).toHaveBeenCalledWith('/library?status=problem&sort=title', { scroll: false });
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('debounces typing by 300 ms before the query (and URL) change', () => {
    const { result } = renderHook(() => useLibraryQuery());
    act(() => result.current.setInput('du'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setInput('dune'));
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.query.q).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.query.q).toBe('dune');
    expect(routerMock.replace).toHaveBeenLastCalledWith('/library?q=dune', { scroll: false });
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('filters write at once; Clear all keeps sort and group', () => {
    const { result } = renderHook(() => useLibraryQuery());
    act(() => result.current.toggleStatus('problem'));
    act(() => result.current.setGroup('author'));
    act(() => result.current.setInput('x'));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.clearAll());
    expect(result.current.query).toEqual({ q: '', status: [], source: [], requestedBy: [], sort: 'added', group: 'author' });
    expect(result.current.input).toBe('');
  });

  it('adopts a URL it did not write (header Library link while on ?q=x), but not its own writes', () => {
    setMockSearchParams('q=x');
    const { result, rerender } = renderHook(() => useLibraryQuery());
    expect(result.current.query.q).toBe('x');
    act(() => result.current.toggleStatus('problem'));
    act(() => result.current.toggleStatus('denied'));
    // The first write arrives after the second was issued: not a navigation
    setMockSearchParams('q=x&status=problem');
    rerender();
    expect(result.current.query.status).toEqual(['problem', 'denied']);
    setMockSearchParams('q=x&status=problem%2Cdenied');
    rerender();
    expect(result.current.query.status).toEqual(['problem', 'denied']);
    // Now a real navigation to /library
    setMockSearchParams('');
    rerender();
    expect(result.current.query).toMatchObject({ q: '', status: [] });
    expect(result.current.input).toBe('');
  });
});
