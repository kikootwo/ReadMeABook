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

    // Check if it's a preset
    const preset = SCHEDULE_PRESETS.find(p => p.cron === job.schedule);
    if (preset) {
      setScheduleMode('preset');
      setSelectedPreset(preset.cron);
    } else {
      // Try to parse as custom schedule
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
      fetchJobs(); // Refresh list
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

    // Calculate final cron expression based on mode
    let finalCron: string;
    if (scheduleMode === 'preset') {
      finalCron = selectedPreset;
    } else if (scheduleMode === 'custom') {
      finalCron = customScheduleToCron(customSchedule);
    } else {
      finalCron = editForm.schedule;
    }

    // Validate cron expression
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
      fetchJobs(); // Refresh list
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Scheduled Jobs
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Manage recurring tasks and automated jobs
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

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Jobs Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
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
                      {job.type}
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

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            About Scheduled Jobs
          </h3>
          <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <li>• <strong>Library Scan:</strong> Automatically scans your media library for new audiobooks</li>
            <li>• <strong>Audible Data Refresh:</strong> Caches popular and new release audiobooks from Audible</li>
            <li>• Trigger jobs manually using the "Trigger Now" button</li>
            <li>• Schedule format follows cron syntax (minute hour day month weekday)</li>
          </ul>
        </div>

        {/* Confirmation Dialog */}
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Confirm Job Trigger
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Are you sure you want to trigger &quot;{confirmDialog.jobName}&quot; now?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={hideConfirmDialog}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={triggerJob}
                  className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Trigger Job
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Job Dialog */}
        {editDialog.isOpen && editDialog.job && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Edit Job Schedule
              </h3>
              <div className="space-y-4 mb-6">
                {/* Job Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Job Name
                  </label>
                  <input
                    type="text"
                    value={editDialog.job.name}
                    disabled
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-lg cursor-not-allowed"
                  />
                </div>

                {/* Schedule Mode Tabs */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Schedule Type
                  </label>
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setScheduleMode('preset')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        scheduleMode === 'preset'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      Common Schedules
                    </button>
                    <button
                      onClick={() => setScheduleMode('custom')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        scheduleMode === 'custom'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      Custom Schedule
                    </button>
                    <button
                      onClick={() => setScheduleMode('advanced')}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        scheduleMode === 'advanced'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      Advanced (Cron)
                    </button>
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
                            className="mt-1 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {preset.label}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {preset.description}
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1">
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
                          onChange={(e) => setCustomSchedule({ ...customSchedule, type: e.target.value as any })}
                          className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="minutes">Every X minutes</option>
                          <option value="hours">Every X hours</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>

                      {/* Minutes/Hours Interval */}
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
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Run every {customSchedule.interval || 1} {customSchedule.type}
                          </p>
                        </div>
                      )}

                      {/* Daily/Weekly/Monthly Time */}
                      {(customSchedule.type === 'daily' || customSchedule.type === 'weekly' || customSchedule.type === 'monthly') && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Hour (0-23)
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
                              className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Minute (0-59)
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
                              className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      )}

                      {/* Weekly Day Selection */}
                      {customSchedule.type === 'weekly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Day of Week
                          </label>
                          <select
                            value={customSchedule.dayOfWeek || 0}
                            onChange={(e) => setCustomSchedule({ ...customSchedule, dayOfWeek: parseInt(e.target.value, 10) })}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
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

                      {/* Monthly Day Selection */}
                      {customSchedule.type === 'monthly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Day of Month (1-31)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={customSchedule.dayOfMonth || 1}
                            onChange={(e) => setCustomSchedule({ ...customSchedule, dayOfMonth: parseInt(e.target.value, 10) })}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      {/* Preview */}
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Cron Expression
                      </label>
                      <input
                        type="text"
                        value={editForm.schedule}
                        onChange={(e) => setEditForm({ ...editForm, schedule: e.target.value })}
                        placeholder="0 */6 * * *"
                        className="w-full px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Format: minute hour day month weekday
                      </p>
                      <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                          <div>• */15 * * * * = Every 15 minutes</div>
                          <div>• 0 */6 * * * = Every 6 hours</div>
                          <div>• 0 0 * * * = Daily at midnight</div>
                          <div>• 0 0 * * 0 = Weekly on Sunday</div>
                        </div>
                      </div>
                      {editForm.schedule && (
                        <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <div className="text-sm font-medium text-blue-900 dark:text-blue-200">
                            Preview: {cronToHuman(editForm.schedule)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Enabled Checkbox */}
                <div className="flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={editForm.enabled}
                    onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label htmlFor="enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Enable this job
                  </label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={hideEditDialog}
                  disabled={saving}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={saveJobSchedule}
                  disabled={saving}
                  className="px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
