# Settings Pages

## Current State

**Status:** Completed ✅

The settings pages allow administrators to view and modify system configuration for all external services and paths after initial setup. Implemented as a single tabbed interface with sections for Plex, Prowlarr, Download Client, Paths, and General settings.

## Design Architecture

### Why Settings Pages?

**Requirements:**
- Administrators need to update configuration without re-running setup wizard
- Individual service credentials may need to be rotated
- Test connections after configuration changes
- Separate concerns (Plex, Prowlarr, Download Client, Paths) into tabs/pages
- Maintain security (never show passwords in plain text)

### Page Structure

```
┌─────────────────────────────────────────────────────────┐
│                  Settings                                 │
├───────────┬──────────────────────────────────────────────┤
│           │                                               │
│  Sidebar  │              Content Area                     │
│           │                                               │
│ • Plex    │  ┌─────────────────────────────────────────┐│
│ • Prowlarr│  │         Plex Configuration              ││
│ • Download│  │                                         ││
│ • Paths   │  │  URL:  [http://localhost:32400    ]    ││
│ • General │  │  Token: [••••••••••••••••••]  [Show]   ││
│           │  │  Library: [Audiobooks ▼]               ││
│           │  │                                         ││
│           │  │  [Test Connection]  [Save]             ││
│           │  └─────────────────────────────────────────┘│
│           │                                               │
└───────────┴──────────────────────────────────────────────┘
```

## Implementation Details

### Component Structure

```
src/app/admin/settings/
├── page.tsx                    # Settings page with tab navigation
├── components/
│   ├── SettingsLayout.tsx     # Sidebar navigation layout
│   ├── PlexSettings.tsx       # Plex configuration form
│   ├── ProwlarrSettings.tsx   # Prowlarr configuration form
│   ├── DownloadClientSettings.tsx # Download client form
│   ├── PathsSettings.tsx      # Directory paths form
│   └── GeneralSettings.tsx    # General system settings
```

### API Endpoints

**GET /api/admin/settings**
- Returns current configuration for all services
- Passwords are masked (show ••••••)
- Requires admin authentication

**PUT /api/admin/settings/plex**
- Updates Plex configuration
- Re-tests connection before saving
- Returns validation errors if connection fails

**PUT /api/admin/settings/prowlarr**
- Updates Prowlarr configuration
- Re-tests connection before saving

**PUT /api/admin/settings/download-client**
- Updates download client configuration
- Re-tests connection before saving

**PUT /api/admin/settings/paths**
- Updates directory paths
- Validates paths are writable
- Creates directories if they don't exist

### Settings Sections

#### 1. Plex Settings
- Server URL (text input)
- Authentication Token (password input with show/hide)
- Audiobook Library ID (dropdown, populated after connection test)
- Test Connection button
- Save button

#### 2. Prowlarr Settings
- Server URL (text input)
- API Key (password input with show/hide)
- Test Connection button (shows indexer count)
- Save button

#### 3. Download Client Settings
- Client Type (radio: qBittorrent / Transmission)
- Server URL (text input)
- Username (text input)
- Password (password input with show/hide)
- Test Connection button (shows version)
- Save button

#### 4. Paths Settings
- Download Directory (text input with validation)
- Media Directory (text input with validation)
- Validate Paths button (checks writability)
- Save button

#### 5. General Settings
- Application Name (text input)
- Allow User Registrations (toggle)
- Max Concurrent Downloads (number input)
- Auto-approve Requests (toggle)
- Save button

## Tech Stack

**Frontend:**
- React Hook Form for form management
- Form validation with Zod schemas
- Tab/sidebar navigation
- Password visibility toggle
- Toast notifications for save confirmations

**Backend:**
- Configuration service for get/set operations
- Connection testing utilities (reuse from setup wizard)
- Input validation
- Atomic updates (all or nothing)

## Dependencies

**Existing:**
- Configuration service
- Setup wizard connection test endpoints
- Authentication middleware

**New:**
- React Hook Form
- Zod for schema validation
- Toast notification library

## Usage Examples

### Fetch Current Settings

```tsx
const { data: settings } = useSWR('/api/admin/settings', fetcher);

// settings = {
//   plex: { url: 'http://...', token: '••••', libraryId: '1' },
//   prowlarr: { url: 'http://...', apiKey: '••••' },
//   downloadClient: { type: 'qbittorrent', url: '...', username: '...', password: '••••' },
//   paths: { downloadDir: '/downloads', mediaDir: '/media/audiobooks' }
// }
```

### Update Plex Settings

```tsx
const updatePlexSettings = async (data) => {
  const response = await fetch('/api/admin/settings/plex', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (response.ok) {
    toast.success('Plex settings updated successfully');
  } else {
    toast.error('Failed to update Plex settings');
  }
};
```

### Test Connection

```tsx
const testPlexConnection = async () => {
  setTesting(true);
  const response = await fetch('/api/setup/test-plex', {
    method: 'POST',
    body: JSON.stringify({ url: plexUrl, token: plexToken }),
  });

  const result = await response.json();
  if (result.success) {
    toast.success('Connection successful!');
    setLibraries(result.libraries);
  } else {
    toast.error(`Connection failed: ${result.error}`);
  }
  setTesting(false);
};
```

## Security Considerations

- All settings endpoints require admin role
- Passwords are never returned in GET requests (masked as ••••)
- Connection tests validate credentials before saving
- Audit log for configuration changes (future enhancement)
- HTTPS required in production

## Validation Rules

**Plex:**
- URL must be valid HTTP/HTTPS URL
- Token must be non-empty string
- Library ID must be selected from available libraries

**Prowlarr:**
- URL must be valid HTTP/HTTPS URL
- API key must be non-empty string
- At least 1 indexer must be configured

**Download Client:**
- URL must be valid HTTP/HTTPS URL
- Username and password required
- Client type must be 'qbittorrent' or 'transmission'

**Paths:**
- Must be absolute paths
- Directories must exist or be creatable
- Must have write permissions
- Cannot be the same directory

## Future Enhancements

- Configuration history/rollback
- Bulk import/export settings (JSON)
- Encrypted backup download
- Configuration validation on startup
- Notification preferences
- Quality profiles
