/**
 * Component: Library detail request history (admin or requester; only steps with data)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import { JOB_TYPE_LABELS } from '@/lib/constants/job-labels';
import type { RequestHistory } from '@/lib/hooks/useLibraryRequestDetail';

/** Job statuses as words (jobs.status: pending, active, completed, failed, delayed, stuck). */
const JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  active: 'Running',
  completed: 'Done',
  failed: 'Failed',
  delayed: 'Delayed',
  stuck: 'Stuck',
};

export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : '');
}

export function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Step({ title, lines }: { title: string; lines: (string | null)[] }) {
  const shown = lines.filter((l): l is string => !!l);
  return (
    <li className="relative pl-5">
      <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-blue-400" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</p>
      {shown.map((line, i) => (
        <p key={i} className="text-sm text-gray-600 dark:text-gray-400 break-words">
          {line}
        </p>
      ))}
    </li>
  );
}

export function LibraryHistory({ history, isLoading }: { history: RequestHistory | null; isLoading: boolean }) {
  if (isLoading && !history) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading history...</p>;
  }
  if (!history) return null;
  const d = history.download;
  const downloadLines = d
    ? [
        d.indexerName ? `Found on ${d.indexerName}` : null,
        d.releaseName,
        d.client ? `Client: ${d.client}` : null,
        formatDateTime(d.startedAt) ? `Started ${formatDateTime(d.startedAt)}` : null,
        formatDateTime(d.completedAt) ? `Finished ${formatDateTime(d.completedAt)}` : null,
      ]
    : [];
  const hasDownload = downloadLines.some(Boolean);

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {history.requestedAt && <Step title="Requested" lines={[formatDateTime(history.requestedAt)]} />}
        {hasDownload && <Step title="Download" lines={downloadLines} />}
        {history.completedAt && <Step title="Completed" lines={[formatDateTime(history.completedAt)]} />}
      </ol>
      {history.jobs.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Recent jobs</p>
          <ul className="space-y-1">
            {history.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-800 dark:text-gray-200 truncate">{JOB_TYPE_LABELS[job.type] ?? job.type}</span>
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {jobStatusLabel(job.status)}
                  {formatDateTime(job.createdAt) ? ` · ${formatDateTime(job.createdAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
