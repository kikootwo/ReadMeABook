# Proposal: Fix Stuck Request Timeouts and Stale State Recovery

## Executive Summary
Requests in ReadMeABook can become stuck in `SEARCHING` or `PROCESSING` state indefinitely if worker processes crash, HTTP sockets time out, or unhandled exceptions occur during download client dispatch. This proposal introduces an automated state recovery engine to detect requests stuck in transient processing states for >2 hours and gracefully reset them to `awaiting_search` or `downloading` for automatic re-processing.

## Problem Statement
- **Indefinite Stuck States:** Diagnostic health checks identified 49 requests stuck in `SEARCHING` or `PROCESSING` state for over 5 days (since July 25th).
- **Lack of Lock Expiry:** When a Bull worker process encounters a network timeout while searching Prowlarr or sending NZBs to SABnzbd, the request status is set to `SEARCHING` or `PROCESSING` before the operation begins, but no cleanup worker resets the state if the job terminates unexpectedly.
- **Manual Intervention Required:** Admins currently have to manually click "Retry" or execute database queries to recover stuck requests.

## Proposed Changes
1. **Stuck State Recovery Processor (`recover-stuck-requests.processor.ts`):**
   - Periodically queries requests in `SEARCHING` or `PROCESSING` state updated >2 hours ago.
   - Resets `SEARCHING` requests older than 2 hours back to `awaiting_search` and updates `lastSearchAt`.
   - Re-checks active download clients (SABnzbd / qBittorrent) for `PROCESSING` requests; if not found in active downloads or completed history, resets status to `awaiting_search`.
2. **Scheduled Recovery Job:**
   - Registers a recurring cron job `recover_stuck_requests` running every 1 hour (`0 * * * *`).
3. **Admin Trigger & Metric Tracking:**
   - Adds manual "Reset Stuck Requests" trigger button in Operations Center UI.
   - Emits `rmab_stuck_requests_recovered_total` Prometheus counter.

## User Impact & Value
- **Zero Manual Cleanup:** System automatically self-heals stuck requests without human intervention.
- **Increased Fulfillment Rate:** Stalled books are automatically picked up by subsequent search cycles.
