import React, { useState } from 'react';

export function OperationsCenter() {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const triggerJob = async (type: string, name: string) => {
    setLoading(type);
    setMessage(null);
    try {
      const res = await fetch('/api/scheduler/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`✅ Success: ${name} triggered (Job ID: ${data.bullJobId})`);
      } else {
        setMessage(`❌ Error: ${data.error || 'Failed to trigger job'}`);
      }
    } catch (err) {
      setMessage(`❌ Network Error triggering ${name}`);
    } finally {
      setLoading(null);
    }
  };

  const restartScheduler = async () => {
    setLoading('restart');
    setMessage(null);
    try {
      const res = await fetch('/api/scheduler/restart', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage('🎉 Background scheduler restarted and re-initialized successfully');
      } else {
        setMessage(`❌ Restart Error: ${data.error}`);
      }
    } catch {
      setMessage('❌ Network error restarting background scheduler');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-6 bg-card text-card-foreground rounded-lg border shadow-sm">
      <h2 className="text-xl font-bold mb-4">⚙️ Operations & Maintenance Control Center</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Trigger instant background maintenance jobs, re-initialize workers, or force backlog scans.
      </p>

      {message && (
        <div className="mb-4 p-3 rounded bg-accent text-accent-foreground text-sm font-medium">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => triggerJob('retry_missing_torrents', 'Backlog Search Retry')}
          disabled={loading !== null}
          className="px-4 py-3 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium disabled:opacity-50 text-left"
        >
          {loading === 'retry_missing_torrents' ? '⏳ Triggering...' : '🔄 Run Backlog Search Retry'}
        </button>

        <button
          onClick={() => triggerJob('retry_failed_imports', 'Retry Failed Imports')}
          disabled={loading !== null}
          className="px-4 py-3 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium disabled:opacity-50 text-left"
        >
          {loading === 'retry_failed_imports' ? '⏳ Triggering...' : '📁 Retry Failed Imports'}
        </button>

        <button
          onClick={() => triggerJob('plex_library_scan', 'Library Import Scan')}
          disabled={loading !== null}
          className="px-4 py-3 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium disabled:opacity-50 text-left"
        >
          {loading === 'plex_library_scan' ? '⏳ Triggering...' : '🎧 Trigger Media Library Scan'}
        </button>

        <button
          onClick={() => triggerJob('recover_stuck_requests', 'Reset Stuck Requests')}
          disabled={loading !== null}
          className="px-4 py-3 bg-primary text-primary-foreground rounded hover:opacity-90 font-medium disabled:opacity-50 text-left"
        >
          {loading === 'recover_stuck_requests' ? '⏳ Triggering...' : '🚨 Reset Stuck Requests (>2h)'}
        </button>

        <button
          onClick={restartScheduler}
          disabled={loading !== null}
          className="px-4 py-3 bg-destructive text-destructive-foreground rounded hover:opacity-90 font-medium disabled:opacity-50 text-left"
        >
          {loading === 'restart' ? '⏳ Restarting...' : '⚡ Restart Scheduler Daemon'}
        </button>
      </div>
    </div>
  );
}
