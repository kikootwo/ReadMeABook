/**
 * Component: Request Selection (admin table bulk actions)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * The selected request ids of the visible page. A new `resetKey` (the list URL: filters,
 * search, sort, page and page size, however they changed, back/forward included) clears it.
 * `version` moves only on the admin's own changes (toggle, page select, clear, reset),
 * never on prune or keepOnly, so a run's result can stay until the admin changes the selection.
 */

import { useCallback, useState } from 'react';

interface SelectionState {
  key: string;
  ids: ReadonlySet<string>;
  version: number;
}

export type HeaderState = 'all' | 'some' | 'none';

export interface RequestSelection {
  ids: ReadonlySet<string>;
  count: number;
  version: number;
  toggle: (id: string) => void;
  /** Header checkbox: select every id on the page, or clear them */
  setPage: (pageIds: string[], checked: boolean) => void;
  clear: () => void;
  /** Keep only `ids` (after a run: the ones not done); not an admin change */
  keepOnly: (ids: Iterable<string>) => void;
  /** Drop ids no longer on the page (another tab deleted them); not an admin change */
  prune: (pageIds: string[]) => void;
  headerState: (pageIds: string[]) => HeaderState;
}

export function useRequestSelection(resetKey: string): RequestSelection {
  const [state, setState] = useState<SelectionState>({ key: resetKey, ids: new Set(), version: 0 });

  // The list changed (filter, search, sort, page, page size): start over, during render
  let current = state;
  if (state.key !== resetKey) {
    current = { key: resetKey, ids: new Set(), version: state.version + 1 };
    setState(current);
  }

  const update = useCallback(
    (next: (ids: ReadonlySet<string>) => ReadonlySet<string>, adminChange: boolean) =>
      setState((prev) => {
        const ids = next(prev.ids);
        if (ids === prev.ids && !adminChange) return prev;
        return { key: prev.key, ids, version: adminChange ? prev.version + 1 : prev.version };
      }),
    []
  );

  const toggle = useCallback((id: string) => update((ids) => {
    const next = new Set(ids);
    if (!next.delete(id)) next.add(id);
    return next;
  }, true), [update]);

  const setPage = useCallback((pageIds: string[], checked: boolean) => update((ids) => {
    const next = new Set(ids);
    for (const id of pageIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    return next;
  }, true), [update]);

  const clear = useCallback(() => update(() => new Set(), true), [update]);

  const keepOnly = useCallback((keep: Iterable<string>) => update((ids) => {
    const wanted = new Set(keep);
    return new Set([...ids].filter((id) => wanted.has(id)));
  }, false), [update]);

  const prune = useCallback((pageIds: string[]) => update((ids) => {
    const onPage = new Set(pageIds);
    const kept = [...ids].filter((id) => onPage.has(id));
    return kept.length === ids.size ? ids : new Set(kept);
  }, false), [update]);

  const ids = current.ids;
  const headerState = useCallback((pageIds: string[]): HeaderState => {
    const selectedOnPage = pageIds.filter((id) => ids.has(id)).length;
    if (selectedOnPage === 0) return 'none';
    return selectedOnPage === pageIds.length ? 'all' : 'some';
  }, [ids]);

  return { ids, count: ids.size, version: current.version, toggle, setPage, clear, keepOnly, prune, headerState };
}
