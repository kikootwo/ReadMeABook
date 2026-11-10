/**
 * Component: Library detail (hero, error, In your library, Files, Request history, Actions)
 * Documentation: documentation/features/library-view.md
 *
 * Shows only what the list returned for this viewer. Error, size and history appear when the
 * fields are present (admin or requester); other viewers get public fields, no sections and no
 * request detail call. The Path row is admin-only (the key is present only for admins).
 */

'use client';

import React, { useCallback, useState } from 'react';
import { BookCover } from '@/components/audiobooks/BookCover';
import { StatusBadge } from '@/components/requests/StatusBadge';
import { useLibraryRequestDetail } from '@/lib/hooks/useLibraryRequestDetail';
import type { LibraryItem, LibraryResponse } from '@/lib/library-view/types';
import { LibraryDialog } from './LibraryDialog';
import { LibraryActions } from './LibraryActions';
import { LibraryHistory, formatDateTime } from './LibraryHistory';
import { SOURCE_LABELS, coverTone, formatDuration, sizeLabel } from './card-display';
import { hasAnyAction, libraryActions, type ActionUser } from './library-actions';

interface LibraryDetailProps {
  item: LibraryItem | null;
  viewer: LibraryResponse['viewer'] | null;
  user: ActionUser | null;
  /** The book is in the latest live response (the history polls while it is). */
  live: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100 break-words min-w-0">{value}</dd>
    </div>
  );
}

export function LibraryDetail({ item, viewer, user, live, onClose, onChanged }: LibraryDetailProps) {
  const [childOpen, setChildOpen] = useState(false);
  const gatedRequestId = item?.canSeeRequestDetails && item.request ? item.request.id : null;
  const detail = useLibraryRequestDetail(gatedRequestId, live);
  const { mutate: mutateDetail } = detail;
  const changed = useCallback(() => {
    onChanged();
    void mutateDetail();
  }, [onChanged, mutateDetail]);

  if (!item || !viewer) return null;
  const request = item.request;
  const inLibrary = item.inLibrary || item.status === 'available';
  const actions = libraryActions(item, viewer, user);
  const meta = [
    item.year ? String(item.year) : null,
    formatDuration(item.durationMinutes),
    item.series ? `${item.series}${item.seriesPart ? ` · Book ${item.seriesPart}` : ''}` : null,
  ].filter(Boolean);
  const size = sizeLabel(request?.downloadSizeBytes);

  return (
    <LibraryDialog open onClose={onClose} labelledBy="library-detail-title" childOpen={childOpen}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200/60 dark:border-gray-700/60">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Book details</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="p-2 -mr-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
        <div className="flex gap-4 sm:gap-6">
          <div className="w-28 sm:w-36 flex-shrink-0">
            <BookCover coverUrl={item.coverUrl} squareCovers tone={coverTone(item)} dotHidesOnHover={false} />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h2 id="library-detail-title" className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {item.title}
            </h2>
            <p className="text-gray-700 dark:text-gray-300">{item.author}</p>
            {item.narrator && <p className="text-sm text-gray-500 dark:text-gray-400">Narrated by {item.narrator}</p>}
            {meta.length > 0 && <p className="text-sm text-gray-500 dark:text-gray-400">{meta.join(' · ')}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <StatusBadge status={item.status} progress={item.progress ?? undefined} />
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {SOURCE_LABELS[item.source]}
              </span>
            </div>
          </div>
        </div>

        {request?.errorMessage && (
          <div role="note" className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200 break-words">
            {request.errorMessage}
          </div>
        )}

        <Section title="In your library">
          <dl className="space-y-2">
            <Row label="Library" value={inLibrary ? 'In your library' : 'Not yet'} />
            <Row label="Source" value={SOURCE_LABELS[item.source]} />
            <Row label={request && !inLibrary ? 'Requested' : 'Added'} value={formatDateTime(item.addedAt) ?? '—'} />
            {request && <Row label="Requested by" value={request.isMine ? 'You' : request.requestedBy.username} />}
            {'path' in item && <Row label="Path" value={item.path || '—'} />}
          </dl>
        </Section>

        {size && (
          <Section title="Files">
            <dl>
              <Row label="Download size" value={size} />
            </dl>
          </Section>
        )}

        {gatedRequestId && (
          <Section title="Request history">
            <LibraryHistory history={detail.history} isLoading={detail.isLoading} />
          </Section>
        )}

        {hasAnyAction(actions) && (
          <Section title="Actions">
            <LibraryActions
              item={item}
              actions={actions}
              customSearchTerms={detail.loaded || detail.error ? detail.history?.customSearchTerms ?? null : undefined}
              onChanged={changed}
              onChildOpenChange={setChildOpen}
            />
          </Section>
        )}
      </div>
    </LibraryDialog>
  );
}
