# Settings Pages

**Status:** ✅ Implemented

Single tabbed interface for admins to view/modify system configuration post-setup.

## Sections

1. **Plex** - URL, token (masked), library ID
2. **Prowlarr** - URL, API key (masked), indexer selection with priority, seeding time, RSS monitoring toggle
3. **Download Client** - Type, URL, credentials (masked)
4. **Paths** - Download + media directories
5. **General** - App name, user registrations, max concurrent downloads, auto-approve

## API Endpoints

**GET /api/admin/settings**
- Returns all config (passwords masked as ••••)
- Admin auth required

**PUT /api/admin/settings/plex**
- Updates Plex config, re-tests connection before saving

**PUT /api/admin/settings/prowlarr**
- Updates Prowlarr config, re-tests connection

**PUT /api/admin/settings/download-client**
- Updates download client config, re-tests connection

**PUT /api/admin/settings/paths**
- Updates paths, validates writability, creates if missing

## Features

- Password visibility toggle
- Connection test buttons
- Toast notifications for save confirmations
- Form validation with Zod schemas
- Reuses setup wizard connection test endpoints

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
