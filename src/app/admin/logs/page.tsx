/**
 * Component: Admin System Logs Page
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { authenticatedFetcher } from '@/lib/utils/api';

interface JobEvent {
  id: string;
  level: string;
  context: string;
  message: string;
  metadata: any;
  createdAt: string;
}

interface Log {
  id: string;
  bullJobId: string | null;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: any;
  events: JobEvent[];
  request: {
    id: string;
    audiobook: {
      title: string;
      author: string;
    } | null;
    user: {
      plexUsername: string;
    };
  } | null;
}

interface LogsData {
  logs: Log[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function AdminLogsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const { data, error } = useSWR<LogsData>(
    `/api/admin/logs?page=${page}&limit=50&status=${statusFilter}&type=${typeFilter}`,
    authenticatedFetcher,
    {
      refreshInterval: 10000, // Refresh every 10 seconds
    }
  );

  const isLoading = !data && !error;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Logs
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load system logs'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const logs = data?.logs || [];
  const pagination = data?.pagination;

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'active':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'delayed':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'stuck':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400';
    }
  };

  const formatDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt) return 'N/A';
    if (!completedAt) return 'Running...';

    const start = new Date(startedAt).getTime();
    const end = new Date(completedAt).getTime();
    const durationMs = end - start;

    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              System Logs
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              View background jobs and system activity
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="delayed">Delayed</option>
              <option value="stuck">Stuck</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Job Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="search_indexers">Search Indexers</option>
              <option value="download_torrent">Download Torrent</option>
              <option value="monitor_download">Monitor Download</option>
              <option value="organize_files">Organize Files</option>
              <option value="scan_plex">Library Scan</option>
              <option value="match_plex">Library Match</option>
              <option value="plex_library_scan">Library Scan (Scheduled)</option>
              <option value="plex_recently_added_check">Recently Added Check</option>
              <option value="audible_refresh">Audible Refresh</option>
              <option value="retry_missing_torrents">Retry Missing Torrents</option>
              <option value="retry_failed_imports">Retry Failed Imports</option>
              <option value="cleanup_seeded_torrents">Cleanup Seeded Torrents</option>
              <option value="monitor_rss_feeds">Monitor RSS Feeds</option>
            </select>
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Related Item
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Attempts
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {logs.map((log) => (
                  <>
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {log.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeColor(log.status)}`}>
                          {log.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {log.request?.audiobook ? (
                          <div className="text-sm">
                            <div className="font-medium text-gray-900 dark:text-gray-100">
                              {log.request.audiobook.title}
                            </div>
                            <div className="text-gray-500 dark:text-gray-400">
                              by {log.request.audiobook.author}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500">
                              User: {log.request.user.plexUsername}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-gray-400">System job</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatDuration(log.startedAt, log.completedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {log.attempts}/{log.maxAttempts}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        {(log.events.length > 0 || log.errorMessage || log.bullJobId || log.result) && (
                          <button
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {expandedLog === log.id ? 'Hide Details' : 'Show Details'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr>
                        <td colSpan={7} className="px-6 py-4 bg-gray-50 dark:bg-gray-900">
                          <div className="space-y-4">
                            {log.bullJobId && (
                              <div>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Bull Job ID: </span>
                                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{log.bullJobId}</span>
                              </div>
                            )}

                            {/* Event Logs */}
                            {log.events.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Event Log</h4>
                                <div className="space-y-1 max-h-96 overflow-y-auto bg-black/5 dark:bg-black/30 rounded p-3 font-mono text-xs">
                                  {log.events.map((event) => {
                                    const timestamp = new Date(event.createdAt).toISOString().split('T')[1].split('.')[0];
                                    const levelColor = event.level === 'error'
                                      ? 'text-red-500'
                                      : event.level === 'warn'
                                      ? 'text-yellow-500'
                                      : 'text-green-500';

                                    return (
                                      <div key={event.id} className="text-gray-800 dark:text-gray-200">
                                        <span className={levelColor}>[{event.context}]</span> {event.message}
                                        <span className="text-gray-500 dark:text-gray-400 ml-2">{timestamp}</span>
                                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                                          <pre className="ml-4 mt-1 text-gray-600 dark:text-gray-400 text-xs">
                                            {JSON.stringify(event.metadata, null, 2)}
                                          </pre>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Result Data */}
                            {log.result && Object.keys(log.result).length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Job Result</h4>
                                <pre className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-900 dark:text-blue-300 font-mono overflow-x-auto">
                                  {JSON.stringify(log.result, null, 2)}
                                </pre>
                              </div>
                            )}

                            {/* Error Message */}
                            {log.errorMessage && (
                              <div>
                                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Error</h4>
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">
                                  {log.errorMessage}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {logs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No logs found</p>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total logs)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === pagination.totalPages}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            About System Logs
          </h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• Logs are automatically refreshed every 10 seconds</li>
            <li>• Click "Show Details" to view detailed event logs, job results, and error messages</li>
            <li>• Event logs show all internal operations with timestamps (similar to Docker logs)</li>
            <li>• Jobs are retried automatically based on their max attempts setting</li>
            <li>• Use filters to find specific job types or statuses</li>
            <li>• All job types are tracked: searches, downloads, file organization, library scans, RSS monitoring, and more</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
