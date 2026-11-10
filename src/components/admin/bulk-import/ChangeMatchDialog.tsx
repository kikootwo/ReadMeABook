/**
 * Component: Bulk Import - Change match / Find match dialog
 * Documentation: documentation/features/bulk-import.md
 *
 * Rendered inside the wizard panel (absolute overlay), so it stacks above the review list and
 * the wizard's backdrop never sees its clicks. One field takes a title, author or ASIN; results
 * the import would refuse (In Library, Requested) show but can't be picked. The Audible service
 * answers an outage with no results, so an empty answer is worded to be true either way.
 */

'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlassIcon, MusicalNoteIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { fetchWithAuth } from '@/lib/utils/api';
import { focusables } from '@/components/library/LibraryDialog';
import { formatDuration } from '@/components/library/card-display';
import { MATCH_QUERY_MAX_LENGTH } from '@/lib/constants/bulk-import';
import type { MatchCandidate, ScannedBook } from './types';
import { effectiveMatch, matchLabel } from './row-match';

/** Below Tailwind's `sm`: a phone, where the on-screen keyboard would cover the results. */
const PHONE_QUERY = '(max-width: 639px)';
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;

/** The search text as the match route takes it: trimmed, at most MATCH_QUERY_MAX_LENGTH. */
const fitQuery = (text: string) => text.trim().slice(0, MATCH_QUERY_MAX_LENGTH).trim();

interface ChangeMatchDialogProps {
  book: ScannedBook;
  onChoose: (candidate: MatchCandidate) => void;
  onClose: () => void;
  /** Puts focus back on the row's Change match / Find match button (a mouse click may not focus it). */
  restoreFocus: () => void;
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; results: MatchCandidate[]; asin: string | null; store: string }
  | { phase: 'error'; message: string };

/** The polite live-region text for a search state. */
export function statusText(state: SearchState): string {
  switch (state.phase) {
    case 'loading':
      return 'Searching…';
    case 'error':
      return state.message;
    case 'done':
      if (state.results.length > 0) return `${state.results.length} result${state.results.length === 1 ? '' : 's'}`;
      return state.asin ? `Nothing came back for ${state.asin} from ${state.store}` : 'No results';
    default:
      return '';
  }
}

/** GET the match search; null when aborted (a newer search or the dialog closed). */
async function searchMatches(q: string, signal: AbortSignal): Promise<SearchState | null> {
  try {
    const res = await fetchWithAuth(`/api/admin/bulk-import/match?q=${encodeURIComponent(q)}`, { signal });
    const data = await res.json().catch(() => ({}));
    if (signal.aborted) return null;
    if (!res.ok) {
      return { phase: 'error', message: res.status === 400 ? data.error || 'Search failed' : "Couldn't reach Audible. Try again." };
    }
    return { phase: 'done', results: data.results ?? [], asin: data.asin ?? null, store: data.store ?? 'audible.com' };
  } catch {
    return signal.aborted ? null : { phase: 'error', message: 'Search failed. Try again.' };
  }
}

export function ChangeMatchDialog({ book, onChoose, onClose, restoreFocus }: ChangeMatchDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(restoreFocus);
  /** A press that started on the dimmed overlay (a drag out of the field must not close). */
  const pressedOverlayRef = useRef(false);
  const [query, setQuery] = useState(() => fitQuery(book.searchTerm));
  // A row with a book searches its scan term on open; a No Match row waits for the admin
  const [openQuery] = useState(() => (effectiveMatch(book) ? fitQuery(book.searchTerm) : ''));
  const [state, setState] = useState<SearchState>(() => (openQuery ? { phase: 'loading' } : { phase: 'idle' }));
  const label = matchLabel(book);

  useEffect(() => {
    onCloseRef.current = onClose;
    restoreFocusRef.current = restoreFocus;
  }, [onClose, restoreFocus]);

  /**
   * One search in flight: a new one aborts the last; the state is set when the answer arrives. On
   * a phone the field lets go of focus once results show, so the keyboard drops and they are seen.
   */
  const startSearch = useCallback((q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void searchMatches(q, controller.signal).then((next) => {
      if (!next) return;
      setState(next);
      if (next.phase === 'done' && next.results.length > 0 && document.activeElement === inputRef.current && isPhone()) {
        panelRef.current?.focus();
      }
    });
  }, []);

  const runSearch = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setState({ phase: 'loading' });
    startSearch(q);
  };

  // Focus the field (text selected) and run the open search; focus goes back to the row's button on close.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    if (openQuery) startSearch(openQuery);
    return () => {
      abortRef.current?.abort();
      restoreFocusRef.current();
    };
  }, [openQuery, startSearch]);

  // Esc closes; Tab stays inside.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && panel.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6"
      onMouseDown={(e) => {
        pressedOverlayRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (pressedOverlayRef.current && e.target === e.currentTarget) onClose();
        pressedOverlayRef.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full sm:max-w-lg max-h-full flex flex-col focus:outline-none bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700/50">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {label}
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all mt-0.5">{book.relativePath}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 p-2 -m-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <form
          className="flex items-center gap-2 px-4 py-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={MATCH_QUERY_MAX_LENGTH}
            placeholder="Title, author or ASIN"
            aria-label="Title, author or ASIN"
            className="flex-1 min-w-0 px-3 py-2 text-base sm:text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="flex items-center gap-1.5 px-3 min-h-[44px] sm:min-h-0 sm:py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white"
          >
            <MagnifyingGlassIcon className="w-4 h-4" />
            Search
          </button>
        </form>

        <p role="status" aria-live="polite" className="px-4 pb-2 text-xs text-gray-500 dark:text-gray-400 min-h-[1.25rem]">
          {statusText(state)}
        </p>

        {state.phase === 'done' && state.results.length > 0 && (
          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
            {state.results.map((candidate) => (
              <li key={candidate.asin}>
                <CandidateButton candidate={candidate} onChoose={() => onChoose(candidate)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CandidateButton({ candidate, onChoose }: { candidate: MatchCandidate; onChoose: () => void }) {
  const blocked = candidate.inLibrary || candidate.hasActiveRequest;
  const duration = formatDuration(candidate.durationMinutes);
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={blocked}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <div className={`flex-shrink-0 w-10 h-10 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800 ${blocked ? 'opacity-50' : ''}`}>
        {candidate.coverArtUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={candidate.coverArtUrl}
            alt=""
            className="w-10 h-10 object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder_cover.svg';
            }}
          />
        ) : (
          <div className="w-10 h-10 flex items-center justify-center">
            <MusicalNoteIcon className="w-5 h-5 text-gray-400 dark:text-gray-600" />
          </div>
        )}
      </div>
      <div className={`flex-1 min-w-0 ${blocked ? 'opacity-60' : ''}`}>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{candidate.title}</p>
        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
          {candidate.author}
          {candidate.narrator && <span className="text-gray-400 dark:text-gray-500"> &middot; {candidate.narrator}</span>}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono">
          {candidate.asin}
          {duration && <span className="font-sans"> &middot; {duration}</span>}
        </p>
      </div>
      {candidate.inLibrary ? (
        <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs font-medium">
          In Library
        </span>
      ) : candidate.hasActiveRequest ? (
        <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-medium">
          Requested
        </span>
      ) : null}
    </button>
  );
}
