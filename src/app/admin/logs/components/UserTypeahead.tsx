/**
 * Component: Admin Logs — User Typeahead
 * Documentation: documentation/admin-dashboard.md
 *
 * Combobox input + suggestion popover sourced from useUserSearch (fetch-once,
 * SWR-cached, in-memory filter). Keyboard-navigable: ArrowUp/ArrowDown +
 * Enter + Escape. Selection emits the user's id; the clear × button emits
 * null so the filter resets.
 *
 * Pause-on-interact: registers `'logs-user-typeahead'` while the popover is open.
 */

'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRegisterPauseReason } from '../hooks/useAutoRefreshControl';
import { useUserSearch, type UserSearchUser } from '../hooks/useUserSearch';
import { INPUT_CLASS, LABEL_CLASS } from './filter-styles';

interface UserTypeaheadProps {
  userId: string | null;
  onChange: (id: string | null) => void;
}

export default function UserTypeahead({ userId, onChange }: UserTypeaheadProps) {
  const { filterByQuery, findUserById, isLoading } = useUserSearch();
  const selected = findUserById(userId);
  const [query, setQuery] = useState<string>(selected?.plexUsername ?? '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useRegisterPauseReason('logs-user-typeahead', open);

  // Sync visible text if userId changes externally (e.g. chip dismissal).
  useEffect(() => {
    setQuery(selected?.plexUsername ?? '');
  }, [selected?.plexUsername]);

  const suggestions = useMemo(
    () => (open ? filterByQuery(query) : []),
    [open, query, filterByQuery]
  );

  const handleSelect = (user: UserSearchUser) => {
    onChange(user.id);
    setQuery(user.plexUsername);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((idx) => Math.min(idx + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((idx) => Math.max(idx - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        handleSelect(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <label className={LABEL_CLASS} htmlFor="logs-user-typeahead">User</label>
      <div className="relative">
        <input
          id="logs-user-typeahead"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          placeholder={isLoading ? 'Loading users…' : 'Search by plex username'}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={`${INPUT_CLASS} pr-9`}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear user filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700/60"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg"
        >
          {suggestions.map((user, idx) => {
            const isActive = idx === activeIdx;
            return (
              <li
                key={user.id}
                role="option"
                aria-selected={isActive}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200'
                    : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700/60'
                }`}
                onMouseDown={(e) => {
                  // onMouseDown so the input's blur doesn't fire first and close us.
                  e.preventDefault();
                  handleSelect(user);
                }}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className="font-medium">{user.plexUsername}</span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{user.role}</span>
              </li>
            );
          })}
        </ul>
      )}
      {open && !isLoading && suggestions.length === 0 && query.trim() !== '' && (
        <div className="absolute z-20 mt-1 w-full px-3 py-2 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          No users match &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
