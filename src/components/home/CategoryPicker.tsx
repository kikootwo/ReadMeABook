/**
 * Component: Home Section Category Picker
 * Documentation: documentation/features/home-sections.md
 *
 * Audible top-level categories, each expandable to its sub-categories, with a name filter.
 * Already-added categories stay listed but disabled.
 */

'use client';

import React, { useId, useMemo, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { AudibleCategory } from '@/lib/hooks/useHomeSections';

interface Props {
  categories: AudibleCategory[];
  existingIds: Set<string | null>;
  onPick: (category: { id: string; name: string }) => void;
  onCancel: () => void;
}

/** Keyboard focus: the filter input's violet ring, inset so the list's overflow does not clip it. */
const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ' +
  'focus-visible:bg-gray-100 dark:focus-visible:bg-gray-700';

const ROW =
  'w-full text-left py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ' +
  `${FOCUS} transition-colors break-words ` +
  'disabled:text-gray-400 dark:disabled:text-gray-500 disabled:hover:bg-transparent disabled:cursor-default';
const PARENT_TEXT = 'font-medium text-gray-900 dark:text-gray-100';
const SUB_TEXT = 'text-gray-700 dark:text-gray-300';

function AddedTag({ added }: { added: boolean }) {
  if (!added) return null;
  return <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">Added</span>;
}

export function CategoryPicker({ categories, existingIds, onPick, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const idPrefix = useId();
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const matches = (name: string) => name.toLowerCase().includes(q);
    return categories
      .map((cat) => {
        const subs = cat.subcategories ?? [];
        const matchingSubs = q ? subs.filter((s) => matches(s.name)) : subs;
        const selfMatch = !q || matches(cat.name);
        return { cat, subs, matchingSubs, selfMatch, visible: selfMatch || matchingSubs.length > 0 };
      })
      .filter((g) => g.visible);
  }, [categories, q]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {categories.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-500">No categories found.</div>
      ) : (
        <>
          <div className="p-2 border-b border-gray-100 dark:border-gray-700/50">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter categories"
              aria-label="Filter categories"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          {groups.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-500">No categories match &quot;{query.trim()}&quot;.</div>
          )}
          <ul aria-label="Audible categories" className="max-h-60 overflow-y-auto">
            {groups.map(({ cat, subs, matchingSubs, selfMatch }) => {
              // While filtering, matching sub-categories show without expanding. A parent that
              // matches by its own name keeps its toggle, which shows all its sub-categories.
              const filtering = q.length > 0;
              const showAll = expanded.has(cat.id) && selfMatch;
              const open = showAll || (filtering && matchingSubs.length > 0);
              const shown = showAll ? subs : matchingSubs;
              const listId = `${idPrefix}-sub-${cat.id}`;
              const added = existingIds.has(cat.id);
              return (
                <li key={cat.id} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => onPick({ id: cat.id, name: cat.name })}
                      disabled={added}
                      className={`${ROW} ${PARENT_TEXT} flex-1 px-4`}
                    >
                      {cat.name}
                      <AddedTag added={added} />
                    </button>
                    {subs.length > 0 && selfMatch && (
                      <button
                        type="button"
                        onClick={() => toggle(cat.id)}
                        aria-expanded={showAll}
                        aria-controls={listId}
                        aria-label={`Sub-categories of ${cat.name}`}
                        className={`flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] px-3 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${FOCUS} transition-colors`}
                      >
                        <span aria-hidden="true">{subs.length}</span>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                  {open && (
                    <ul id={listId} aria-label={`${cat.name} sub-categories`} className="pb-1">
                      {shown.map((sub) => {
                        const subAdded = existingIds.has(sub.id);
                        return (
                          <li key={`${cat.id}-${sub.id}`}>
                            <button
                              type="button"
                              onClick={() => onPick({ id: sub.id, name: sub.name })}
                              disabled={subAdded}
                              className={`${ROW} ${SUB_TEXT} pl-8 pr-4`}
                            >
                              {sub.name}
                              <AddedTag added={subAdded} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="w-full px-4 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border-t border-gray-100 dark:border-gray-700/50 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
