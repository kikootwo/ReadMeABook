/**
 * Component: Setup Wizard Finalize Step
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface FinalizeStepProps {
  onComplete: () => void;
  onBack: () => void;
}

interface JobStatus {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
}

export function FinalizeStep({ onComplete, onBack }: FinalizeStepProps) {
  const [jobs, setJobs] = useState<JobStatus[]>([
    {
      id: 'audible_refresh',
      name: 'Audible Data Refresh',
      description: 'Fetches popular and new release audiobooks from Audible to populate your browse catalog',
      status: 'pending',
    },
    {
      id: 'plex_library_scan',
      name: 'Plex Library Scan',
      description: 'Scans your Plex library to discover audiobooks you already have',
      status: 'pending',
    },
  ]);

  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  // Auto-start jobs when component mounts
  useEffect(() => {
    if (!hasStarted) {
      setHasStarted(true);
      runJobs();
    }
  }, [hasStarted]);

  const runJobs = async () => {
    const accessToken = localStorage.getItem('accessToken');

    if (!accessToken) {
      console.error('No access token found');
      setJobs(prev => prev.map(job => ({
        ...job,
        status: 'error',
        error: 'Authentication required',
      })));
      return;
    }

    // Get all scheduled jobs to find the IDs
    let scheduledJobs: any[] = [];
    try {
      const response = await fetch('/api/admin/jobs', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch scheduled jobs');
      }

      const data = await response.json();
      scheduledJobs = data.jobs;
    } catch (error) {
      console.error('Failed to fetch scheduled jobs:', error);
      setJobs(prev => prev.map(job => ({
        ...job,
        status: 'error',
        error: 'Failed to fetch job configuration',
      })));
      return;
    }

    // Run each job sequentially
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      // Update status to running
      setJobs(prev => prev.map((j, idx) =>
        idx === i ? { ...j, status: 'running' } : j
      ));

      // Find the scheduled job by type
      const scheduledJob = scheduledJobs.find((sj: any) => sj.type === job.id);

      if (!scheduledJob) {
        console.error(`Scheduled job not found for type: ${job.id}`);
        setJobs(prev => prev.map((j, idx) =>
          idx === i ? { ...j, status: 'error', error: 'Job configuration not found' } : j
        ));
        continue;
      }

      try {
        const response = await fetch(`/api/admin/jobs/${scheduledJob.id}/trigger`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Failed to trigger job');
        }

        // Update status to completed
        setJobs(prev => prev.map((j, idx) =>
          idx === i ? { ...j, status: 'completed' } : j
        ));

        // Add a small delay between jobs
        if (i < jobs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to run job ${job.name}:`, error);
        setJobs(prev => prev.map((j, idx) =>
          idx === i ? {
            ...j,
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to run job'
          } : j
        ));
      }
    }

    // All jobs complete (or failed)
    setIsComplete(true);
  };

  const allJobsCompleted = jobs.every(job => job.status === 'completed' || job.status === 'error');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Initializing Your Library
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Running initial setup jobs to populate your audiobook catalog.
        </p>
      </div>

      <div className="space-y-4">
        {jobs.map((job, index) => (
          <div
            key={job.id}
            className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border-2 border-gray-200 dark:border-gray-800"
          >
            <div className="flex items-start gap-4">
              {/* Status Icon */}
              <div className="flex-shrink-0 mt-1">
                {job.status === 'pending' && (
                  <div className="w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                )}
                {job.status === 'running' && (
                  <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                )}
                {job.status === 'completed' && (
                  <svg
                    className="w-6 h-6 text-green-600 dark:text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {job.status === 'error' && (
                  <svg
                    className="w-6 h-6 text-red-600 dark:text-red-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              {/* Job Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {job.name}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {job.description}
                </p>

                {job.status === 'running' && (
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-2 font-medium">
                    Running...
                  </p>
                )}

                {job.status === 'completed' && (
                  <p className="text-sm text-green-600 dark:text-green-400 mt-2 font-medium">
                    Completed successfully
                  </p>
                )}

                {job.status === 'error' && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-2 font-medium">
                    Error: {job.error}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isComplete && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="flex gap-3">
            <svg
              className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Initial setup complete!
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                These jobs will run automatically on a schedule to keep your catalog fresh.
                You can manage their schedules in the admin settings.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button onClick={onBack} variant="outline" disabled={!allJobsCompleted}>
          Back
        </Button>
        <Button
          onClick={onComplete}
          disabled={!allJobsCompleted}
          size="lg"
        >
          Finish Setup
        </Button>
      </div>
    </div>
  );
}
