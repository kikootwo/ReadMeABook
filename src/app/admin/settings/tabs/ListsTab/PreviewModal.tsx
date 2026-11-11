/**
 * Component: List Preview modal (what a sync would do, requests nothing)
 * Documentation: documentation/backend/services/list-sync.md
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { Modal } from './Modal';
import { btnClass, btnPrimaryClass } from './types';
import type { ImportListItem, PreviewState, PreviewStatus } from './types';

const LABELS: Record<PreviewStatus, { text: string; className: string }> = {
  would_request: { text: 'Would request', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  in_library: { text: 'In library', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  requested: { text: 'Already requested', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  ignored: { text: 'Ignored', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' },
  filtered: { text: 'Filtered out', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
  no_match: { text: 'No Audible match', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

const ORDER: PreviewStatus[] = ['would_request', 'in_library', 'requested', 'filtered', 'no_match', 'ignored'];

export function PreviewModal({ list, onClose }: { list: ImportListItem; onClose: () => void }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const [filter, setFilter] = useState<PreviewStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollRef = useRef<() => void>(() => undefined);
  const poll = useCallback(async () => {
    const response = await fetchWithAuth(`/api/admin/import-lists/${list.id}/preview`);
    const data = await response.json();
    setState(data.preview);
    if (data.preview?.state === 'running') timer.current = setTimeout(() => pollRef.current(), 2000);
  }, [list.id]);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const response = await fetchWithAuth(`/api/admin/import-lists/${list.id}/preview`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not start the preview');
      setState((await response.json()).preview);
      timer.current = setTimeout(poll, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the preview');
    }
  }, [list.id, poll]);

  useEffect(() => {
    // Show the last result if there is one, otherwise start a fresh preview
    fetchWithAuth(`/api/admin/import-lists/${list.id}/preview`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.preview) return start();
        setState(d.preview);
        if (d.preview.state === 'running') return poll();
      })
      .catch(() => start());
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [list.id, poll, start]);

  const rows = (state?.rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const running = state?.state === 'running';

  return (
    <Modal
      wide
      title={`Preview: ${list.name}`}
      onClose={onClose}
      footer={
        <>
          <button className={btnClass} onClick={start} disabled={running}>Run again</button>
          <button className={btnPrimaryClass} onClick={onClose}>Close</button>
        </>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Shows what a sync would do with the top {list.topN} books. Nothing is requested.
      </p>
      {error && <p className="text-sm text-red-700 dark:text-red-400 mb-3">{error}</p>}
      {state?.state === 'error' && <p className="text-sm text-red-700 dark:text-red-400 mb-3">{state.error}</p>}
      {running && state && (
        <div className="mb-3">
          <div className="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${state.total ? (100 * state.done) / state.total : 5}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-1">Checking {state.done} of {state.total || '…'} books. New books take a moment each to look up on Audible.</p>
        </div>
      )}
      {state && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button className={`${btnClass} ${filter === 'all' ? 'ring-2 ring-blue-500' : ''}`} onClick={() => setFilter('all')}>All {state.rows.length}</button>
          {ORDER.map((s) => state.counts[s] > 0 && (
            <button key={s} className={`${btnClass} ${filter === s ? 'ring-2 ring-blue-500' : ''}`} onClick={() => setFilter(s)}>
              {LABELS[s].text} {state.counts[s]}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Book</th><th className="py-2 pr-3">Rating</th><th className="py-2 pr-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.rank}-${row.title}`} className="border-b border-gray-100 dark:border-gray-700/50">
                <td className="py-2 pr-3 text-gray-500">{row.rank}</td>
                <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">{row.title} <span className="text-gray-500">— {row.author}</span></td>
                <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{row.rating ? row.rating.toFixed(1) : '–'}</td>
                <td className="py-2 pr-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LABELS[row.status].className}`}>{LABELS[row.status].text}</span>
                  {row.detail && <span className="ml-2 text-xs text-gray-500">{row.detail}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-gray-500">{running ? 'Working…' : 'Nothing to show.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
