# Setup Wizard

**Status:** ✅ Implemented

8-step wizard for first-time configuration with connection testing, validation, database persistence, and automated initial job execution.

## Features

- 8 steps with progress indicator
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
7. Review - Summary of all configs
8. Finalize - Run initial Audible refresh + Plex scan, enable scheduled jobs

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
- Feature: Added FinalizeStep (step 8)
- Automatically runs Audible refresh + Plex scan
- Shows real-time execution status
- Prevents navigation until complete

## Related Files

- `/src/app/setup/` - Wizard components
- `/src/app/api/setup/` - API routes
