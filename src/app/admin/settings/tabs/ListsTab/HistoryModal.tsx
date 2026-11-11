/**
 * Component: Sync History modal
 * Documentation: documentation/backend/services/list-sync.md
 */

'use client';

import { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import { Modal } from './Modal';
import { btnPrimaryClass, timeAgo } from './types';
import type { ImportListItem, SyncLogItem } from './types';

const SAMPLE_LABELS: Record<string, string> = {
  requested: 'Requested',
  filtered: 'Filtered out',
  missed: 'No Audible match',
  skipped: 'Skipped',
};

export function HistoryModal({ list, onClose }: { list: ImportListItem; onClose: () => void }) {
  const [logs, setLogs] = useState<SyncLogItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchWithAuth(`/api/admin/import-lists/${list.id}/logs`)
      .then((r) => r.json())
      .then((d) => setLogs(d.logs))
      .catch(() => setLogs([]));
  }, [list.id]);

  return (
    <Modal wide title={`Sync history: ${list.name}`} onClose={onClose} footer={<button className={btnPrimaryClass} onClick={onClose}>Close</button>}>
      {logs === null && <p className="text-sm text-gray-500">Loading…</p>}
      {logs?.length === 0 && <p className="text-sm text-gray-500">This list has not been synced yet.</p>}
      <div className="space-y-2">
        {logs?.map((log) => (
          <div key={log.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
            <button className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1" onClick={() => setOpen(open === log.id ? null : log.id)}>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{timeAgo(log.startedAt)}</span>
              {!log.completedAt && <span className="text-xs text-blue-600">running…</span>}
              {log.errorMessage && <span className="text-xs text-red-600">error</span>}
              <span className="text-xs text-gray-600 dark:text-gray-300">
                read {log.fetched} · new {log.newOnList} · requested <b>{log.requested}</b> · already have {log.alreadyHave} · filtered {log.filtered} · no match {log.missed} · skipped {log.skipped}
              </span>
            </button>
            {open === log.id && (
              <div className="px-4 pb-3 text-sm space-y-2 border-t border-gray-100 dark:border-gray-700/50 pt-3">
                {log.errorMessage && <p className="text-red-700 dark:text-red-400">Error: {log.errorMessage}</p>}
                {log.stoppedReason && <p className="text-yellow-700 dark:text-yellow-400">Stopped early: {log.stoppedReason}.</p>}
                {Object.entries(log.samples).map(([key, items]) => items.length > 0 && (
                  <div key={key}>
                    <p className="text-xs font-semibold uppercase text-gray-500">{SAMPLE_LABELS[key] ?? key} (examples)</p>
                    <ul className="list-disc ml-5 text-gray-700 dark:text-gray-300">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
