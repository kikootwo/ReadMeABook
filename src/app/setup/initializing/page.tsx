/**
 * Component: Setup Initializing Page (First Login)
 * Documentation: documentation/setup-wizard.md
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

interface JobStatus {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
}

export default function InitializingPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobStatus[]>([
    {
      id: 'audible_refresh',
      name: 'Audible Data Refresh',
      description: 'Fetching popular and new release audiobooks to populate your browse catalog',
      status: 'pending',
    },
    {
      id: 'plex_library_scan',
      name: 'Library Scan',
      description: 'Scanning your media library to discover audiobooks you already have',
      status: 'pending',
    },
  ]);

  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [authProcessed, setAuthProcessed] = useState(false);

  // Process auth data from URL hash and start monitoring jobs
  useEffect(() => {
    if (authProcessed) return;

    // Read auth data from URL hash
    const hash = window.location.hash;
    if (!hash || !hash.includes('authData=')) {
      console.error('[Initializing] No auth data in URL hash');
      router.push('/login?error=' + encodeURIComponent('Authentication data missing'));
      return;
    }

    try {
      const authDataMatch = hash.match(/authData=([^&]+)/);
      if (!authDataMatch) {
        throw new Error('Failed to parse auth data');
      }

      const authDataStr = decodeURIComponent(authDataMatch[1]);
      const authData = JSON.parse(authDataStr);

      // Store in localStorage
      localStorage.setItem('accessToken', authData.accessToken);
      localStorage.setItem('refreshToken', authData.refreshToken);
      localStorage.setItem('user', JSON.stringify(authData.user));

      console.log('[Initializing] Auth data stored, starting job monitoring');

      // Clear hash for security
      window.history.replaceState(null, '', window.location.pathname);

      setAuthProcessed(true);

      // Start monitoring jobs after a brief delay to ensure jobs have been triggered
      setTimeout(() => {
        runJobs(authData.accessToken);
      }, 2000);
    } catch (error) {
      console.error('[Initializing] Failed to process auth data:', error);
      router.push('/login?error=' + encodeURIComponent('Failed to process authentication'));
    }
  }, [authProcessed, router]);

  const pollJobStatus = async (jobId: string, accessToken: string): Promise<'completed' | 'failed'> => {
    console.log(`[Initializing] Polling job status for: ${jobId}`);

    return new Promise((resolve) => {
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`/api/admin/job-status/${jobId}`, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          });

          if (!response.ok) {
            console.error(`[Initializing] Failed to fetch job status: ${response.status}`);
            throw new Error('Failed to fetch job status');
          }

          const data = await response.json();
          const jobStatus = data.job.status;

          console.log(`[Initializing] Job ${jobId} status: ${jobStatus}`);

          if (jobStatus === 'completed') {
            clearInterval(pollInterval);
            resolve('completed');
          } else if (jobStatus === 'failed') {
            clearInterval(pollInterval);
            resolve('failed');
          }
          // Otherwise keep polling
        } catch (error) {
          console.error('[Initializing] Error polling job status:', error);
          clearInterval(pollInterval);
          resolve('failed');
        }
      }, 2000); // Poll every 2 seconds

      // Timeout after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        resolve('failed');
      }, 10 * 60 * 1000);
    });
  };

  const runJobs = async (accessToken: string) => {
    if (hasStarted) return;
    setHasStarted(true);

    console.log('[Initializing] Starting job monitoring');

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
      console.error('[Initializing] Failed to fetch scheduled jobs:', error);
      setJobs(prev => prev.map(job => ({
        ...job,
        status: 'error',
        error: 'Failed to fetch job configuration',
      })));
      setIsComplete(true);
      return;
    }

    // Monitor each job
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      // Update status to running
      setJobs(prev => prev.map((j, idx) =>
        idx === i ? { ...j, status: 'running' } : j
      ));

      // Find the scheduled job by type
      const scheduledJob = scheduledJobs.find((sj: any) => sj.type === job.id);

      if (!scheduledJob) {
        console.error(`[Initializing] Scheduled job not found for type: ${job.id}`);
        setJobs(prev => prev.map((j, idx) =>
          idx === i ? { ...j, status: 'error', error: 'Job configuration not found' } : j
        ));
        continue;
      }

      try {
        // Look for the most recent job execution
        // Jobs should already be triggered by OIDCAuthProvider
        const response = await fetch('/api/admin/jobs', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }

        const data = await response.json();
        const jobsData = data.jobs || [];

        // Find the most recent job of this type
        const recentJob = jobsData.find((j: any) => j.type === job.id);

        if (!recentJob || !recentJob.lastRunJobId) {
          console.warn(`[Initializing] No recent job found for ${job.name}, may still be starting`);

          // Wait a bit and check again
          await new Promise(resolve => setTimeout(resolve, 3000));

          const retryResponse = await fetch('/api/admin/jobs', {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          });

          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            const retryJobData = retryData.jobs?.find((j: any) => j.type === job.id);

            if (retryJobData?.lastRunJobId) {
              const finalStatus = await pollJobStatus(retryJobData.lastRunJobId, accessToken);

              setJobs(prev => prev.map((j, idx) =>
                idx === i ? {
                  ...j,
                  status: finalStatus === 'completed' ? 'completed' : 'error',
                  error: finalStatus === 'failed' ? 'Job failed to complete' : undefined,
                } : j
              ));
            } else {
              // Give up, mark as error
              setJobs(prev => prev.map((j, idx) =>
                idx === i ? { ...j, status: 'error', error: 'Job did not start' } : j
              ));
            }
          }
        } else {
          // Poll the existing job
          const finalStatus = await pollJobStatus(recentJob.lastRunJobId, accessToken);

          setJobs(prev => prev.map((j, idx) =>
            idx === i ? {
              ...j,
              status: finalStatus === 'completed' ? 'completed' : 'error',
              error: finalStatus === 'failed' ? 'Job failed to complete' : undefined,
            } : j
          ));
        }

        // Small delay between jobs
        if (i < jobs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`[Initializing] Failed to monitor job ${job.name}:`, error);
        setJobs(prev => prev.map((j, idx) =>
          idx === i ? {
            ...j,
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to monitor job'
          } : j
        ));
      }
    }

    // All jobs complete
    setIsComplete(true);
  };

  const allJobsCompleted = jobs.every(job => job.status === 'completed' || job.status === 'error');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Welcome to ReadMeABook!
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Setting up your audiobook library...
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
              Initial Setup Progress
            </h2>

            <div className="space-y-4">
              {jobs.map((job, index) => (
                <div
                  key={job.id}
                  className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border-2 border-gray-200 dark:border-gray-700"
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
              <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
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
                      Your library is ready. These jobs will run automatically on a schedule to keep your catalog fresh.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button
                onClick={() => router.push('/')}
                disabled={!allJobsCompleted}
                size="lg"
                className="w-full"
              >
                {allJobsCompleted ? 'Go to Homepage' : 'Please wait...'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
