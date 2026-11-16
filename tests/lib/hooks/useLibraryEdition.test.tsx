/**
 * Component: Library edition lookup for the details modal (#325)
 * Documentation: documentation/fixes/file-hash-matching.md
 */

// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Lookup = { audiobook: Record<string, unknown> | null; isLoading: boolean; error: unknown };
const lookups = vi.hoisted(() => new Map<string, Lookup>());
const useAudiobookDetailsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: (asin: string | null, options?: { retryOnError?: boolean }) => {
    useAudiobookDetailsMock(asin, options);
    return (asin && lookups.get(asin)) || { audiobook: null, isLoading: false, error: null };
  },
}));

const { useLibraryEdition } = await import('@/lib/hooks/useLibraryEdition');

const REQUESTED = 'B082BHJMFF';
const LIBRARY = 'B072R1CY4P';
const libraryBook = { asin: LIBRARY, title: 'Library Edition' };

const lookedUp = () => useAudiobookDetailsMock.mock.calls.map(([asin]) => asin).filter(Boolean);

describe('useLibraryEdition', () => {
  beforeEach(() => {
    lookups.clear();
    useAudiobookDetailsMock.mockClear();
    lookups.set(LIBRARY, { audiobook: libraryBook, isLoading: false, error: null });
  });

  it('a different library ASIN: looks it up and returns its record', () => {
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, true));

    expect(lookedUp()).toEqual([LIBRARY]);
    expect(result.current).toEqual({ libraryAsin: LIBRARY, libraryBook, isLoading: false });
  });

  it.each([
    ['no library ASIN', null],
    ['an undefined library ASIN', undefined],
    ['the same ASIN in another case', REQUESTED.toLowerCase()],
  ])('%s: looks nothing up and returns nothing', (_label, libraryAsin) => {
    lookups.set(REQUESTED.toLowerCase(), { audiobook: { title: 'Should not be used' }, isLoading: false, error: null });
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, libraryAsin, true));

    expect(lookedUp()).toEqual([]);
    expect(result.current).toEqual({ libraryAsin: null, libraryBook: null, isLoading: false });
  });

  it('a closed modal looks nothing up', () => {
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, false));

    expect(lookedUp()).toEqual([]);
    expect(result.current).toEqual({ libraryAsin: null, libraryBook: null, isLoading: false });
  });

  it('looks the library ASIN up with retry after an error turned off', () => {
    renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, true));

    expect(useAudiobookDetailsMock).toHaveBeenCalledWith(LIBRARY, { retryOnError: false });
  });

  it('while the lookup runs: loading', () => {
    lookups.set(LIBRARY, { audiobook: null, isLoading: true, error: null });
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, true));

    expect(result.current).toEqual({ libraryAsin: LIBRARY, libraryBook: null, isLoading: true });
  });

  it.each([
    ['an error', new Error('Not found')],
    ['no record', null],
  ])('a lookup that ends with %s: no record, with the library ASIN kept for the notice', (_label, error) => {
    lookups.set(LIBRARY, { audiobook: null, isLoading: false, error });
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, true));

    expect(result.current).toEqual({ libraryAsin: LIBRARY, libraryBook: null, isLoading: false });
  });

  it('a lookup with an error that is loading again: not loading, no record', () => {
    lookups.set(LIBRARY, { audiobook: null, isLoading: true, error: new Error('Not found') });
    const { result } = renderHook(() => useLibraryEdition(REQUESTED, LIBRARY, true));

    expect(result.current).toEqual({ libraryAsin: LIBRARY, libraryBook: null, isLoading: false });
  });
});
