# Settings Pages

**Status:** ✅ Implemented

Single tabbed interface for admins to view/modify system configuration post-setup with mandatory validation before saving.

## Sections

1. **Plex** - URL, token (masked), library ID
2. **Prowlarr** - URL, API key (masked), indexer selection with priority, seeding time, RSS monitoring toggle
3. **Download Client** - Type, URL, credentials (masked)
4. **Paths** - Download + media directories
5. **BookDate** - AI provider, API key (encrypted), model selection, library scope, custom prompt, swipe history
6. **Account** - Local admin password change (only visible to setup admin)

## Validation Flow

**Plex, Download Client, Paths:**
1. User modifies settings (URL, credentials, paths)
2. User clicks "Test Connection" or "Test Paths"
3. System validates settings
4. On success: "Save Changes" button enabled
5. On failure: Error shown, "Save Changes" remains disabled

**Prowlarr (special handling):**
1. **On tab load:** Current indexer configuration loaded from database automatically
2. **Changing indexer settings** (enable/disable, priority, seeding time, RSS):
   - No test required
   - Can save immediately if URL/API key unchanged
3. **Changing URL or API key:**
   - Validation required before saving
   - User clicks "Test Connection"
   - On success: Indexers refresh automatically, "Save Changes" enabled
4. **Button text adapts:**
   - "Test Connection" when URL/API key changed
   - "Refresh Indexers" when connection info unchanged

**BookDate (Admin Settings):**
1. **On tab load:** Current BookDate global configuration loaded from database automatically
2. **Changing AI provider:** Resets model selection
3. **Test connection:** Required to fetch available models before saving
4. **Changing API key:** Must test connection to verify and fetch models
5. **Saving configuration:** Validates all fields (provider, API key, model)
6. **Note:** Library scope and custom prompt are now per-user settings (configured in BookDate page)
7. **Clear swipe history:** Confirmation dialog, removes ALL users' swipes and cached recommendations
8. No "Save Changes" button - uses dedicated "Save BookDate Configuration" button
9. Accessible to admins only

**BookDate (User Preferences - in `/bookdate` page):**
1. **Settings icon:** Opens modal with per-user preferences
2. **Library scope:** Full library or rated books only (default: full)
3. **Custom prompt:** Optional text (max 1000 chars, default: blank)
4. **Save:** Updates user preferences immediately
5. Accessible to all authenticated users

**Account (local admin only):**
1. Local admin can change password
2. Requires: current password, new password (min 8 chars), confirmation
3. No "Save Changes" button - uses dedicated "Change Password" button
4. Form clears after successful change
5. Only visible to users with `isSetupAdmin=true` AND `plexId` starts with `local-`

**Validation state resets when:**
- Plex: URL or token modified
- Prowlarr: URL or API key modified (NOT indexer config)
- Download Client: URL, username, or password modified
- Paths: Directory paths modified
- Account: No validation required (password change is immediate)

## API Endpoints

**GET /api/admin/settings**
- Returns all config (passwords masked as ••••)
- Admin auth required

**GET /api/admin/settings/prowlarr/indexers**
- Returns current indexer configuration merged with available Prowlarr indexers
- Loads saved settings (enabled, priority, seeding time, RSS) from database
- Merges with live indexer list from Prowlarr
- Admin auth required

**PUT /api/admin/settings/plex**
- Updates Plex config
- Requires prior successful test if URL/token changed

**PUT /api/admin/settings/prowlarr**
- Updates Prowlarr URL and API key
- Requires prior successful test if values changed

**PUT /api/admin/settings/prowlarr/indexers**
- Updates indexer configuration (enabled, priority, seeding time, RSS)
- No test required if URL/API key unchanged
- Saves only enabled indexers to database

**PUT /api/admin/settings/download-client**
- Updates download client config
- Requires prior successful test if credentials changed

**PUT /api/admin/settings/paths**
- Updates paths
- Requires prior successful test if paths changed

**Test Endpoints (authenticated, handle masked values):**
- POST /api/admin/settings/test-plex - Tests Plex connection, uses stored token if masked, returns libraries
- POST /api/admin/settings/test-prowlarr - Tests connection, uses stored API key if masked, returns indexers
- POST /api/admin/settings/test-download-client - Tests qBittorrent/Transmission, uses stored password if masked
- POST /api/setup/test-paths - Validates paths writable (no sensitive data, reuses wizard endpoint)

**BookDate Endpoints:**
- GET /api/bookdate/config - Get global BookDate configuration (API key excluded, admin only)
- POST /api/bookdate/config - Save/update global BookDate configuration (admin only)
- POST /api/bookdate/test-connection - Test AI provider connection and fetch available models
- DELETE /api/bookdate/swipes - Clear ALL users' swipe history and cached recommendations (admin only)
- GET /api/bookdate/preferences - Get user's preferences (libraryScope, customPrompt)
- PUT /api/bookdate/preferences - Update user's preferences (all authenticated users)

**Account Endpoints:**
- POST /api/admin/settings/change-password - Change local admin password (local admin only)
- GET /api/auth/is-local-admin - Check if current user is local admin (returns `{isLocalAdmin: boolean}`)

## Features

- Password visibility toggle
- Mandatory "Test Connection" buttons per tab
- "Save Changes" disabled until current tab validated
- Test result display (success/error messages)
- Toast notifications for save confirmations
- Form validation with Zod schemas
- Reuses setup wizard connection test endpoints
- Visual warning when validation required

## Security

- Admin role required
- Passwords never returned in GET (masked)
- Connection tests validate before saving
- HTTPS required in production

## Validation

**Plex:** Valid HTTP/HTTPS URL, non-empty token, library ID selected
**Prowlarr:** Valid URL, non-empty API key, ≥1 indexer configured, priority 1-25, seedingTimeMinutes ≥0, rssEnabled boolean
**Download Client:** Valid URL, credentials required, type must be 'qbittorrent' or 'transmission'
**Paths:** Absolute paths, exist or creatable, writable, cannot be same directory

## Tech Stack

- React Hook Form
- Zod validation
- Tab/sidebar navigation
- Toast notifications

## Fixed Issues ✅

**1. Settings Save Without Validation**
- Issue: Users could save invalid/broken settings (wrong URLs, bad credentials, invalid paths)
- Cause: No validation enforcement before save
- Fix: Added mandatory "Test Connection"/"Test Paths" buttons per tab, disabled "Save Changes" until validated
- Behavior: Now matches wizard flow - test first, then save

**2. Testing with Masked Credentials**
- Issue: Test connection failed because it was testing with masked `••••` values instead of actual credentials
- Cause: Test endpoints didn't handle masked values, tried to authenticate with literal `••••••••`
- Fix: Created authenticated test endpoints that read actual values from database when masked values detected
- Endpoints: `/api/admin/settings/test-plex`, `/test-prowlarr`, `/test-download-client`
- Behavior: Users can test without re-entering unchanged passwords

**3. Indexer Configuration Workflow**
- Issue: Indexer settings required re-testing before saving, current settings weren't loading, workflow confusing
- Cause: Indexers only loaded after test, changing any indexer setting invalidated connection
- Fix:
  - Load current indexer config from database on tab load (GET `/api/admin/settings/prowlarr/indexers`)
  - Track which values changed (URL/API key vs indexer config)
  - Only require test if URL/API key changed
  - Allow saving indexer config changes without re-testing connection
  - Button text adapts: "Test Connection" vs "Refresh Indexers"
- Behavior: Natural workflow - see current settings, modify indexers, save immediately
