/**
 * Component: Request Selection Hook Tests
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRequestSelection } from '@/app/admin/components/useRequestSelection';

const PAGE = ['a', 'b', 'c'];

function setup(initialKey = '/api/admin/requests?page=1') {
  return renderHook(({ k }) => useRequestSelection(k), { initialProps: { k: initialKey } });
}

describe('useRequestSelection', () => {
  it('toggles rows and reports the header state: none, some, all', () => {
    const { result } = setup();
    expect(result.current.headerState(PAGE)).toBe('none');
    act(() => result.current.toggle('a'));
    expect(result.current.headerState(PAGE)).toBe('some');
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('c'));
    expect(result.current.headerState(PAGE)).toBe('all');
    act(() => result.current.toggle('a'));
    expect([...result.current.ids]).toEqual(['b', 'c']);
  });

  it('the header selects the visible page only, and clears it', () => {
    const { result } = setup();
    act(() => result.current.setPage(PAGE, true));
    expect(result.current.count).toBe(3);
    act(() => result.current.setPage(PAGE, false));
    expect(result.current.count).toBe(0);
    expect(result.current.headerState([])).toBe('none');
  });

  it('a new list URL (filter, search, sort, page, page size, back/forward) clears it', () => {
    const { result, rerender } = setup();
    act(() => result.current.setPage(PAGE, true));
    rerender({ k: '/api/admin/requests?page=2' });
    expect(result.current.count).toBe(0);
    // Coming back does not bring the old selection back
    rerender({ k: '/api/admin/requests?page=1' });
    expect(result.current.count).toBe(0);
  });

  it('prunes rows that left the page without counting as an admin change', () => {
    const { result } = setup();
    act(() => result.current.setPage(PAGE, true));
    const version = result.current.version;
    const before = result.current.ids;
    act(() => result.current.prune(['a', 'b', 'c', 'd']));
    expect(result.current.ids).toBe(before); // unchanged: same set, no re-render churn
    act(() => result.current.prune(['a', 'c']));
    expect([...result.current.ids]).toEqual(['a', 'c']);
    expect(result.current.version).toBe(version);
  });

  it('keepOnly keeps the given ids that are selected; not an admin change', () => {
    const { result } = setup();
    act(() => result.current.setPage(PAGE, true));
    const version = result.current.version;
    act(() => result.current.keepOnly(['b', 'z']));
    expect([...result.current.ids]).toEqual(['b']);
    expect(result.current.version).toBe(version);
  });

  it('toggle, page select, clear and a reset move the version', () => {
    const { result, rerender } = setup();
    const v0 = result.current.version;
    act(() => result.current.toggle('a'));
    const v1 = result.current.version;
    expect(v1).toBeGreaterThan(v0);
    act(() => result.current.clear());
    const v2 = result.current.version;
    expect(v2).toBeGreaterThan(v1);
    rerender({ k: 'other' });
    expect(result.current.version).toBeGreaterThan(v2);
  });
});
