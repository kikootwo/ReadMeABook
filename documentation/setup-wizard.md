# Setup Wizard

**Status:** ✅ Implemented

9-step wizard for first-time configuration with connection testing, validation, database persistence, BookDate AI setup, and automated initial job execution.

## Features

- 9 steps with progress indicator
- Connection testing for Plex, Prowlarr, qBittorrent
- Path validation with write permission checking
- Automated initial jobs (Audible refresh, Plex scan)
- Auto-enabling of scheduled jobs
- Dark mode support

## Steps

1. Welcome - Intro screen
2. Admin Account - Create admin user
3. Plex - Server URL, OAuth, library selection
4. Prowlarr - URL, API key, indexer selection with priorities (1-25), seeding time, RSS monitoring
5. Download Client - qBittorrent/Transmission config
6. Paths - Download + media directories with validation
7. BookDate - AI-powered recommendations config (OpenAI/Claude, optional)
8. Review - Summary of all configs
9. Finalize - Run initial Audible refresh + Plex scan, enable scheduled jobs

## API Endpoints

**POST /api/setup/test-plex**
- Tests Plex connection, returns libraries if successful

**POST /api/setup/test-prowlarr**
- Tests connection, returns indexer details (id, name, protocol)
- User selects indexers and assigns priorities

**POST /api/setup/test-download-client**
- Tests qBittorrent/Transmission, returns client version

**POST /api/setup/complete**
- Saves all config to database
- Creates admin user account
- Enables auto jobs (Plex scan, Audible refresh)
- Marks setup as complete
- Returns JWT tokens for auto-login

## State Interface

```typescript
interface SetupState {
  currentStep: number;
  plexUrl: string;
  plexToken: string;
  plexLibraryId: string;
  prowlarrUrl: string;
  prowlarrApiKey: string;
  prowlarrIndexers: Array<{id: number, name: string, priority: number, seedingTimeMinutes: number, rssEnabled: boolean}>;
  downloadClient: 'qbittorrent' | 'transmission';
  downloadClientUrl: string;
  downloadClientUsername: string;
  downloadClientPassword: string;
  downloadDir: string;
  mediaDir: string;
  validated: {plex: boolean, prowlarr: boolean, downloadClient: boolean, paths: boolean};
}
```

## Validation

**Plex:** Valid URL, non-empty token, connection succeeds, library available
**Prowlarr:** Valid URL, non-empty API key, connection succeeds, ≥1 indexer selected with priority 1-25, seedingTimeMinutes ≥0, rssEnabled boolean (RSS timing defaults to 15min, configurable in scheduled jobs)
**Download Client:** Valid URL, credentials required, connection succeeds
**Paths:** Absolute paths, writable

## OIDC-Only Setup Flow

**When using OIDC authentication without creating a local admin:**

1. Setup wizard completes without creating admin user
2. FinalizeStep detects no access token (OIDC-only mode)
3. Shows message: jobs will run on first login
4. User completes setup → redirected to /login
5. User logs in via OIDC → first user becomes admin
6. Initial jobs (Audible refresh + Library scan) trigger automatically in background
7. User redirected to /setup/initializing page → shows real-time job progress
8. Jobs complete → user clicks "Go to Homepage" → fully initialized app

**User Experience:**
- FinalizeStep: Clear instructions about first login
- First OIDC login: Automatic redirect to initializing page
- Initializing page: Real-time job status with progress indicators
- Subsequent logins: Normal login flow (no initializing page)

**Implementation:**
- `setup/page.tsx`: Passes `hasAdminTokens` prop to FinalizeStep, clears localStorage to remove stale tokens
- `FinalizeStep.tsx`: Uses prop (not localStorage) to detect mode, shows appropriate UI
- `OIDCAuthProvider.ts`:
  - Triggers initial jobs on first user creation
  - Returns `isFirstLogin: true` flag in AuthResult
- `api/auth/oidc/callback/route.ts`:
  - Checks `isFirstLogin` flag
  - Redirects to `/setup/initializing` for first login
  - Normal redirect for subsequent logins
- `setup/initializing/page.tsx`:
  - Reads auth data from URL hash
  - Polls job status every 2s
  - Shows real-time progress
  - Auto-enables "Go to Homepage" when complete
- `system.initial_jobs_run` config flag prevents duplicate runs

## Fixed Issues ✅

**1. Plex Server Info Parsing**
- Issue: "Connected to undefined undefined"
- Cause: XML parsing not extracting `MediaContainer.$` attributes
- Fix: Proper XML attribute parsing with fallbacks

**2. Auth Requirement**
- Issue: Setup completion endpoint required auth before user login
- Fix: Removed auth requirement from `/api/setup/complete`

**3. Plex Token Hint**
- Issue: Incorrect path shown for finding token
- Fix: Link to official Plex documentation

**4. Prowlarr Indexer Selection**
- Feature: Added UI for selecting indexers with priorities (1-25)
- Auto-selects all with default priority 10
- Saves to database as JSON

**5. Initial Job Execution**
- Feature: Added FinalizeStep (step 9)
- **Normal mode (with admin):** Runs jobs during setup
- **OIDC-only mode:** Jobs run on first OIDC login
- Polls job status every 2s until actual completion
- Shows real-time execution status (pending → running → completed/failed)
- Prevents navigation until all jobs complete
- Uses `/api/admin/job-status/:id` endpoint for status polling

**6. OIDC-Only Setup Support**
- Issue: Initial jobs failed with "Authentication required" or "Failed to fetch job configuration"
- Root causes:
  - No admin user created during setup (OIDC-only), no auth token available
  - Stale tokens in localStorage from previous tests caused false-positive detection
- Fix: Proper architectural solution
  - Setup wizard passes `hasAdminTokens` prop to FinalizeStep (explicit mode detection)
  - Setup wizard clears localStorage before storing new tokens (removes stale data)
  - FinalizeStep uses prop instead of checking localStorage (avoids stale token issues)
  - OIDC-only mode redirects to /login after setup completion
- Jobs automatically trigger on first OIDC login (first user becomes admin)
- Background execution doesn't block authentication flow

**7. Initializing Page Job Detection**
- Issue: "Job did not start" error on initializing page while jobs running
- Root cause: `lastRunJobId` field missing from ScheduledJob schema
  - `triggerJobNow()` returned Bull job ID but never stored it
  - Initializing page couldn't find running jobs
- Fix: Database schema update + scheduler service update
  - Added `lastRunJobId` field to ScheduledJob model
  - Updated `triggerJobNow()` to store Bull job ID in database
  - Migration: `20251221072639_add_last_run_job_id_to_scheduled_jobs`
- Initializing page now successfully finds and polls running jobs

## Related Files

- `/src/app/setup/` - Wizard components
- `/src/app/setup/initializing/` - First login initialization page (OIDC-only)
- `/src/app/api/setup/` - API routes
- `/src/lib/services/auth/OIDCAuthProvider.ts` - OIDC auth + first login detection
- `/src/lib/services/auth/IAuthProvider.ts` - Auth interfaces (includes isFirstLogin flag)
