/**
 * Component: Blocked Releases Chip (request-detail surface)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Visible chip on a request row showing "N releases blocked" — click to expand
 * a popover listing names + reasons. Real <button> with explicit chevron, no
 * surprise expansion (per zach.md UX rule on intentional affordances).
 *
 * Fetches the per-request blocklist on first expand only (lazy) — closing
 * collapses the panel without re-fetch. Each "Unblock" inside the panel hits
 * the same DELETE endpoint as the admin blocklist page.
 *
 * Displayed release names are rendered verbatim — chips/badges add context,
 * they don't replace (per zach.md "displayed source data stays true to source").
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '@/components/ui/Toast';
import { fetchWithAuth, authenticatedFetcher } from '@/lib/utils/api';
import useSWR from 'swr';
import { SOURCE_BADGE_LABEL } from '@/app/admin/blocklist/types';
import type { BlockedReleaseRow } from '@/app/admin/blocklist/types';

interface BlockedReleasesChipProps {
  requestId: string;
  blockedCount: number;
  /** Called after a successful unblock so the parent table can refresh. */
  onChange: () => void;
}

interface ByRequestResponse {
  entries: BlockedReleaseRow[];
  count: number;
}

export function BlockedReleasesChip({ requestId, blockedCount, onChange }: BlockedReleasesChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const swrKey = isOpen ? `/api/admin/blocklist/by-request/${requestId}` : null;
  const { data, error, mutate, isLoading } = useSWR<ByRequestResponse>(swrKey, authenticatedFetcher);

  // Recompute popover anchor when opening or on window resize/scroll.
  useEffect(() => {
    if (!isOpen) return;
    const recompute = () => {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 6,
        left: rect.left,
      });
    };
    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [isOpen]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  if (blockedCount <= 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={`${blockedCount} ${blockedCount === 1 ? 'release' : 'releases'} blocked — show details`}
        title={`${blockedCount} ${blockedCount === 1 ? 'release' : 'releases'} blocked for this request`}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors min-h-[24px]"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        <span>{blockedCount} {blockedCount === 1 ? 'release' : 'releases'} blocked</span>
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && position && typeof window !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Blocked releases"
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl"
        >
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Blocked for this request
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              className="p-1 -mr-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-3">
            {isLoading && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            )}
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">Failed to load blocked releases.</p>
            )}
            {data && data.entries.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No blocked releases.</p>
            )}
            {data && data.entries.length > 0 && (
              <ul className="space-y-3">
                {data.entries.map((entry) => (
                  <BlockedEntryItem
                    key={entry.id}
                    entry={entry}
                    onRemoved={() => {
                      mutate();
                      onChange();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function BlockedEntryItem({
  entry,
  onRemoved,
}: {
  entry: BlockedReleaseRow;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [isUnblocking, setIsUnblocking] = useState(false);

  const handleUnblock = async () => {
    setIsUnblocking(true);
    try {
      const response = await fetchWithAuth(`/api/admin/blocklist/${entry.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || 'Failed to unblock');
      }
      toast.success(`Unblocked: ${entry.releaseName}`);
      onRemoved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to unblock');
    } finally {
      setIsUnblocking(false);
    }
  };

  const sourceLabel = SOURCE_BADGE_LABEL[entry.source] ?? entry.source;

  return (
    <li className="border border-gray-100 dark:border-gray-700/60 rounded-md p-2.5">
      <p
        className="text-sm text-gray-900 dark:text-gray-100 break-words"
        title={entry.releaseName}
      >
        {entry.releaseName}
      </p>
      <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
          {sourceLabel}
        </span>
        <span className="truncate" title={entry.reason}>{entry.reason}</span>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleUnblock}
          disabled={isUnblocking}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUnblocking ? 'Unblocking…' : 'Unblock'}
        </button>
      </div>
    </li>
  );
}
