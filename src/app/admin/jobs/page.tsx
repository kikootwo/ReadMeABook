/**
 * Component: Admin Jobs Management Page
 * Documentation: documentation/backend/services/scheduler.md
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { authenticatedFetcher, fetchJSON } from '@/lib/utils/api';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import {
  cronToHuman,
  SCHEDULE_PRESETS,
  customScheduleToCron,
  cronToCustomSchedule,
  isValidCron,
  type CustomSchedule,
} from '@/lib/utils/cron';

interface ScheduledJob {
  id: string;
  name: string;
  type: string;
  schedule: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

// Plain-English subtitle shown under each job's name on /admin/jobs.
// Keyed by ScheduledJobType. Unknown types render no subtitle (silent absence —
// we never leak raw type keys like `plex_library_scan` into the UI).
const JOB_DESCRIPTIONS: Record<string, string> = {
  plex_library_scan: 'Scans your full media library to detect newly added audiobooks.',
  plex_recently_added_check: 'Checks for the newest items added to your library since the last scan.',
  audible_refresh: 'Refreshes popular & new-release audiobooks from Audible.',
  retry_missing_torrents: 'Retries searches for requests that previously found no results.',
  retry_failed_imports: 'Re-attempts import for downloads that failed to organize.',
  find_missing_ebooks: 'Looks for ebook companions to audiobooks you already have.',
  cleanup_seeded_torrents: "Removes torrents once they've met your seeding requirements.",
  monitor_rss_feeds: 'Watches indexer RSS feeds for matches against pending requests.',
  sync_reading_shelves: 'Pulls new books from your Goodreads/Hardcover shelves.',
  check_watched_lists: 'Checks watched series & authors for new releases.',
};

function AdminJobsPageContent() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    jobId: string;
    jobName: string;
  }>({ isOpen: false, jobId: '', jobName: '' });
  const [editDialog, setEditDialog] = useState<{
    isOpen: boolean;
    job: ScheduledJob | null;
  }>({ isOpen: false, job: null });
  const [editForm, setEditForm] = useState({ schedule: '', enabled: true });
  const [scheduleMode, setScheduleMode] = useState<'preset' | 'custom' | 'advanced'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customSchedule, setCustomSchedule] = useState<CustomSchedule>({ type: 'hours', interval: 1 });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetcher('/api/admin/jobs');
      setJobs(response.jobs);
      setError(null);
    } catch (err) {
      setError('Failed to load scheduled jobs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showConfirmDialog = (jobId: string, jobName: string) => {
    setConfirmDialog({ isOpen: true, jobId, jobName });
  };

  const hideConfirmDialog = () => {
    setConfirmDialog({ isOpen: false, jobId: '', jobName: '' });
  };

  const showEditDialog = (job: ScheduledJob) => {
    setEditForm({ schedule: job.schedule, enabled: job.enabled });

    const preset = SCHEDULE_PRESETS.find(p => p.cron === job.schedule);
    if (preset) {
      setScheduleMode('preset');
      setSelectedPreset(preset.cron);
    } else {
      const parsed = cronToCustomSchedule(job.schedule);
      if (parsed.type === 'custom') {
        setScheduleMode('advanced');
      } else {
        setScheduleMode('custom');
        setCustomSchedule(parsed);
      }
    }

    setEditDialog({ isOpen: true, job });
  };

  const hideEditDialog = () => {
    setEditDialog({ isOpen: false, job: null });
  };

  const triggerJob = async () => {
    const { jobId, jobName } = confirmDialog;
    hideConfirmDialog();

    try {
      setTriggering(jobId);
      await fetchJSON(`/api/admin/jobs/${jobId}/trigger`, {
        method: 'POST',
      });
      toast.success(`Job "${jobName}" triggered successfully`);
      fetchJobs();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to trigger job';
      toast.error(errorMsg);
      console.error(err);
    } finally {
      setTriggering(null);
    }
  };

  const saveJobSchedule = async () => {
    if (!editDialog.job) return;

    let finalCron: string;
    if (scheduleMode === 'preset') {
      finalCron = selectedPreset;
    } else if (scheduleMode === 'custom') {
      finalCron = customScheduleToCron(customSchedule);
    } else {
      finalCron = editForm.schedule;
    }

    if (!isValidCron(finalCron)) {
      toast.error('Invalid cron expression. Please check your schedule.');
      return;
    }

    try {
      setSaving(true);
      await fetchJSON(`/api/admin/jobs/${editDialog.job.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          schedule: finalCron,
          enabled: editForm.enabled,
        }),
      });
      toast.success(`Job "${editDialog.job.name}" updated successfully`);
      hideEditDialog();
      fetchJobs();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update job';
      toast.error(errorMsg);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* Header — stacks on mobile, row on sm+ */}
        <div className="sticky top-0 z-10 mb-6 sm:mb-8 bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
                Scheduled Jobs
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Manage recurring tasks and automated jobs
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium self-start sm:self-auto flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Jobs — Card layout on mobile, Table on sm+ */}
        <div className="space-y-3 sm:hidden">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Card header */}
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-snug">
                    {job.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {JOB_DESCRIPTIONS[job.type] ?? ''}
                  </div>
                </div>
                <span
                  className={`flex-shrink-0 mt-0.5 px-2.5 py-0.5 inline-flex text-xs font-medium rounded-full ${
                    job.enabled
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {job.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {/* Card body */}
              <div className="px-4 pb-3 space-y-2 border-t border-gray-100 dark:border-gray-700/60 pt-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                    Schedule
                  </div>
                  <div className="text-sm text-gray-900 dark:text-gray-100">
                    {cronToHuman(job.schedule)}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">
                    {job.schedule}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">
                    Last Run
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>

              {/* Card actions */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700/60 flex gap-2">
                <button
                  onClick={() => showEditDialog(job)}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
                <button
                  onClick={() => showConfirmDialog(job.id, job.name)}
                  disabled={triggering === job.id}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {triggering === job.id ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      Running...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Trigger
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
          {jobs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No scheduled jobs found</p>
            </div>
          )}
        </div>

        {/* Jobs Table — hidden on mobile, visible on sm+ */}
        <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Schedule
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Last Run
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {job.name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {JOB_DESCRIPTIONS[job.type] ?? ''}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {cronToHuman(job.schedule)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">
                      {job.schedule}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        job.enabled
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {job.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => showEditDialog(job)}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                        title="Edit schedule"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => showConfirmDialog(job.id, job.name)}
                        disabled={triggering === job.id}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {triggering === job.id ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                            <span>Running...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>Trigger Now</span>
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {jobs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">No scheduled jobs found</p>
            </div>
          )}
        </div>

        {/* Confirmation Dialog */}
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl sm:rounded-lg shadow-xl w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Confirm Job Trigger
              </h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                Are you sure you want to trigger &quot;{confirmDialog.jobName}&quot; now?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={hideConfirmDialog}
                  className="flex-1 px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={triggerJob}
                  className="flex-1 px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium"
                >
                  Trigger Job
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Job Dialog */}
        {editDialog.isOpen && editDialog.job && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
            <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
              {/* Dialog header */}
              <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Edit Job Schedule
                  </h3>
                  <button
                    onClick={hideEditDialog}
                    className="p-2 -mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    aria-label="Close dialog"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* Job Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Job Name
                  </label>
                  <input
                    type="text"
                    value={editDialog.job.name}
                    disabled
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg cursor-not-allowed text-sm"
                  />
                </div>

                {/* Schedule Mode Tabs — grid on mobile to avoid overflow */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Schedule Type
                  </label>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-gray-700/60 rounded-xl mb-4">
                    {(['preset', 'custom', 'advanced'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setScheduleMode(mode)}
                        className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                          scheduleMode === mode
                            ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                        }`}
                      >
                        {mode === 'preset' ? 'Common' : mode === 'custom' ? 'Custom' : 'Advanced'}
                      </button>
                    ))}
                  </div>

                  {/* Preset Mode */}
                  {scheduleMode === 'preset' && (
                    <div className="space-y-2">
                      {SCHEDULE_PRESETS.map((preset) => (
                        <label
                          key={preset.cron}
                          className="flex items-start gap-3 p-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="preset"
                            value={preset.cron}
                            checked={selectedPreset === preset.cron}
                            onChange={(e) => setSelectedPreset(e.target.value)}
                            className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {preset.label}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {preset.description}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">
                              {preset.cron}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Custom Mode */}
                  {scheduleMode === 'custom' && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Frequency
                        </label>
                        <select
                          value={customSchedule.type}
                          onChange={(e) => setCustomSchedule({ ...customSchedule, type: e.target.value as CustomSchedule['type'] })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                        >
                          <option value="minutes">Every X minutes</option>
                          <option value="hours">Every X hours</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>

                      {(customSchedule.type === 'minutes' || customSchedule.type === 'hours') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Interval
                          </label>
                          <input
                            type="number"
                            min="1"
                            max={customSchedule.type === 'minutes' ? 59 : 23}
                            value={customSchedule.interval || 1}
                            onChange={(e) => setCustomSchedule({ ...customSchedule, interval: parseInt(e.target.value, 10) })}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Run every {customSchedule.interval || 1} {customSchedule.type}
                          </p>
                        </div>
                      )}

                      {(customSchedule.type === 'daily' || customSchedule.type === 'weekly' || customSchedule.type === 'monthly') && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Hour (0–23)
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="23"
                              value={customSchedule.time?.hour || 0}
                              onChange={(e) =>
                                setCustomSchedule({
                                  ...customSchedule,
                                  time: { hour: parseInt(e.target.value, 10), minute: customSchedule.time?.minute || 0 },
                                })
                              }
                              className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Minute (0–59)
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={customSchedule.time?.minute || 0}
                              onChange={(e) =>
                                setCustomSchedule({
                                  ...customSchedule,
                                  time: { hour: customSchedule.time?.hour || 0, minute: parseInt(e.target.value, 10) },
                                })
                              }
                              className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                          </div>
                        </div>
                      )}

                      {customSchedule.type === 'weekly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Day of Week
                          </label>
                          <select
                            value={customSchedule.dayOfWeek || 0}
                            onChange={(e) => setCustomSchedule({ ...customSchedule, dayOfWeek: parseInt(e.target.value, 10) })}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          >
                            <option value="0">Sunday</option>
                            <option value="1">Monday</option>
                            <option value="2">Tuesday</option>
                            <option value="3">Wednesday</option>
                            <option value="4">Thursday</option>
                            <option value="5">Friday</option>
                            <option value="6">Saturday</option>
                          </select>
                        </div>
                      )}

                      {customSchedule.type === 'monthly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Day of Month (1–31)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={customSchedule.dayOfMonth || 1}
                            onChange={(e) => setCustomSchedule({ ...customSchedule, dayOfMonth: parseInt(e.target.value, 10) })}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                        </div>
                      )}

                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                          Preview: {cronToHuman(customScheduleToCron(customSchedule))}
                        </div>
                        <div className="text-xs text-blue-700 dark:text-blue-300 font-mono mt-1">
                          {customScheduleToCron(customSchedule)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Advanced Mode */}
                  {scheduleMode === 'advanced' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Cron Expression
                        </label>
                        <input
                          type="text"
                          value={editForm.schedule}
                          onChange={(e) => setEditForm({ ...editForm, schedule: e.target.value })}
                          placeholder="0 */6 * * *"
                          className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Format: minute hour day month weekday
                        </p>
                      </div>
                      <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 font-mono">
                          <div>*/15 * * * * = Every 15 minutes</div>
                          <div>0 */6 * * * = Every 6 hours</div>
                          <div>0 0 * * * = Daily at midnight</div>
                          <div>0 0 * * 0 = Weekly on Sunday</div>
                        </div>
                      </div>
                      {editForm.schedule && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                            Preview: {cronToHuman(editForm.schedule)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Enabled toggle */}
                <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={editForm.enabled}
                    onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 flex-shrink-0"
                  />
                  <label htmlFor="enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                    Enable this job
                  </label>
                </div>
              </div>

              {/* Dialog footer */}
              <div className="sticky bottom-0 bg-white dark:bg-gray-800 px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button
                  onClick={hideEditDialog}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={saveJobSchedule}
                  disabled={saving}
                  className="flex-1 sm:flex-none px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminJobsPage() {
  return (
    <ToastProvider>
      <AdminJobsPageContent />
    </ToastProvider>
  );
}
