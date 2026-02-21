# Settings Pages

**Status:** ✅ Implemented | ♻️ Refactored (Jan 2026)

Single tabbed interface for admins to view/modify system configuration post-setup with mandatory validation before saving.

## Architecture (Refactored Jan 2026)

**Original:** Monolithic 2,971-line component
**Current:** Modular architecture with 89% code reduction (2,971 → 325 lines)

**Structure:**
```
src/app/admin/settings/
├── page.tsx                      # Shell component (325 lines)
├── lib/
│   ├── types.ts                  # Shared TypeScript interfaces
│   └── helpers.ts                # Business logic (206 lines)
├── hooks/
│   └── useSettings.ts            # Global settings hook
└── tabs/                         # Feature modules
    ├── LibraryTab/               # Plex/Audiobookshelf config
    │   ├── LibraryTab.tsx
    │   ├── useLibrarySettings.ts
    │   ├── PlexSection.tsx
    │   ├── AudiobookshelfSection.tsx
    │   └── index.ts
    ├── AuthTab/                  # Authentication (OIDC + Manual)
    │   ├── AuthTab.tsx
    │   ├── useAuthSettings.ts
    │   ├── OIDCSection.tsx
    │   ├── RegistrationSection.tsx
    │   ├── PendingUsersTable.tsx
    │   └── index.ts
    ├── IndexersTab/              # Prowlarr/indexers
    │   ├── IndexersTab.tsx
    │   ├── useIndexersSettings.ts
    │   └── index.ts
    ├── DownloadTab/              # qBittorrent/Transmission/SABnzbd
    │   ├── DownloadTab.tsx
    │   ├── useDownloadSettings.ts
    │   └── index.ts
    ├── PathsTab/                 # Directory paths
    │   ├── PathsTab.tsx
    │   ├── usePathsSettings.ts
    │   └── index.ts
    ├── EbookTab/                 # E-book sidecar
    │   ├── EbookTab.tsx
    │   ├── useEbookSettings.ts
    │   └── index.ts
    └── BookDateTab/              # AI recommendations
        ├── BookDateTab.tsx
        ├── useBookDateSettings.ts
        └── index.ts
```

**Benefits:**
- Single Responsibility: Each tab manages its own state/logic
- Testability: Individual tabs can be unit tested
- Maintainability: Changes to one feature don't affect others
- Performance: Lazy loading possible (future optimization)
- Reusability: Custom hooks can be used elsewhere
- Code Quality: Follows React best practices

## Sections

1. **Plex** - URL, token (masked), library ID, Audible region, filesystem scan trigger toggle
2. **Audiobookshelf** - URL, API token (masked), library ID, Audible region, filesystem scan trigger toggle
3. **Prowlarr** - URL, API key (masked), indexer selection with priority, seeding time, RSS monitoring toggle, **audiobook/ebook categories per indexer**
4. **Download Client** - Type (qBittorrent, Transmission, SABnzbd), URL, credentials (masked), custom download path (per-client relative sub-path with live preview)
5. **Paths** - Download + media directories, audiobook organization template, metadata tagging toggle, chapter merging toggle
6. **E-book Sidecar** - Multi-source ebook downloads (Anna's Archive + Indexer Search), preferred format
7. **BookDate** - AI provider, API key (encrypted), model selection, library scope, custom prompt, swipe history
8. **Notifications** - Multiple backends (Discord, Pushover), event subscriptions, test functionality

## E-book Sidecar

**Purpose:** Configure ebook download sources and preferences to accompany audiobook downloads.

**Tab Structure (3 sections):**

1. **Anna's Archive Section**
   - Enable toggle for Anna's Archive downloads
   - Base URL (default: `https://annas-archive.li`)
   - FlareSolverr URL (optional, for Cloudflare bypass)

2. **Indexer Search Section**
   - Enable toggle for indexer-based ebook search via Prowlarr
   - Hint directing users to Indexers tab for category configuration

3. **General Settings Section** (visible when any source enabled)
   - Preferred format: EPUB (recommended), PDF, MOBI, AZW3, Any
   - Auto-grab toggle: Automatically create ebook requests after audiobook downloads
   - Kindle fix toggle: Apply compatibility fixes to EPUB files (only visible when EPUB format selected)

**Configuration Keys:**
| Key | Default | Description |
|-----|---------|-------------|
| `ebook_annas_archive_enabled` | `false` | Enable Anna's Archive |
| `ebook_indexer_search_enabled` | `false` | Enable Indexer Search via Prowlarr |
| `ebook_sidecar_preferred_format` | `epub` | Preferred format |
| `ebook_auto_grab_enabled` | `true` | Auto-create ebook requests after audiobook downloads |
| `ebook_kindle_fix_enabled` | `false` | Apply Kindle compatibility fixes to EPUB files |
| `ebook_sidecar_base_url` | `https://annas-archive.li` | Anna's Archive mirror |
| `ebook_sidecar_flaresolverr_url` | `` | FlareSolverr URL |

**Behavior:**
- If Anna's Archive enabled → Searches Anna's Archive first
- If Indexer Search enabled → Falls back to indexer search if Anna's Archive fails/disabled
- If both disabled → Ebook downloads completely off
- If auto-grab disabled → Manual "Fetch Ebook" button only (admin buttons still work)
- If Kindle fix enabled (and EPUB format) → Applies compatibility fixes during organization

## Indexer Categories (Tabbed)

**Purpose:** Configure separate category sets for audiobook and ebook searches per indexer.

**UI:** Edit Indexer modal has Categories section with two tabs:
- **AudioBook tab** - Categories for audiobook searches (default: `[3030]`)
- **EBook tab** - Categories for ebook searches (default: `[7020]`)

**Storage:** `prowlarr_indexers` JSON config stores:
```json
{
  "id": 1,
  "name": "MyIndexer",
  "audiobookCategories": [3030],
  "ebookCategories": [7020],
  ...
}
```

## Audible Region

**Purpose:** Configure which Audible region to use for metadata and search to ensure accurate ASIN matching with your metadata engine.

**Configuration:**
- Key: `audible.region` (string, default: 'us')
- Supported regions: US, Canada, UK, Australia, India
- UI: Dropdown selector in Library tab (both Plex and Audiobookshelf settings)
- No validation required (immediate save)

**Why It Matters:**
- Each Audible region uses different ASINs for the same audiobook
- Users must match their RMAB region to their Plex/Audiobookshelf metadata engine region
- Mismatched regions cause poor search results and failed metadata matching

**Help Text:**
"Select the Audible region that matches your metadata engine (Audnexus/Audible Agent) configuration in [Plex/Audiobookshelf]. This ensures accurate book matching and metadata."

**Implementation:**
- Affects all Audible API calls (base URL changes per region)
- Affects all Audnexus API calls (region parameter added)
- Changes apply immediately on next API call (no restart required)
- **Automatic refresh**: Changing region automatically triggers `audible_refresh` job to fetch popular/new releases for the new region
- **Cache management**: ConfigService cache and AudibleService initialization are cleared when region changes
- **Smart re-initialization**: Service automatically detects region changes and re-initializes before each request
- See: `documentation/integrations/audible.md` for technical details

## Audiobook Organization Template

**Purpose:** Customize how audiobooks are organized within the media directory using variable-based templates.

**Configuration:**
- Key: `audiobook_path_template` (string, default: `{author}/{title} {asin}`)
- Variables: `{author}`, `{title}`, `{narrator}`, `{asin}`, `{year}`
- Optional variables (narrator, asin, year) removed if not available
- Template validated on test, shows preview examples

**UI (PathsTab):**
- Text input with monospace font
- Placeholder: `{author}/{title} {asin}`
- Variable reference panel showing all available variables
- Template validation on "Test Paths" with success/error feedback
- Preview examples showing 2-3 sample paths with actual data

**Validation:**
- Must contain at least `{author}` or `{title}` (required variables)
- Cannot be empty or only contain optional variables
- Invalid templates show error message
- Valid templates show preview paths

**Examples:**
- `{author}/{title} {asin}` → `Douglas Adams/The Hitchhiker's Guide to the Galaxy B0009JKV9W/`
- `{author}/{title} ({year})` → `Douglas Adams/The Hitchhiker's Guide to the Galaxy (2005)/`
- `{author}/{narrator}/{title}` → `Douglas Adams/Stephen Fry/The Hitchhiker's Guide to the Galaxy/`

## Filesystem Scan Trigger

**Purpose:** Trigger Plex/Audiobookshelf to scan filesystem after organizing files for users with disabled filesystem watchers.

**Configuration:**
- Plex: `plex.trigger_scan_after_import` (boolean, default: false)
- Audiobookshelf: `audiobookshelf.trigger_scan_after_import` (boolean, default: false)

**UI:**
- Checkbox toggle in both Plex and Audiobookshelf settings tabs
- Default: Unchecked (disabled)
- Help text: "Only enable this if you have [Plex/Audiobookshelf]'s filesystem watcher (automatic scanning) disabled. Most users should leave this disabled and rely on [Plex/Audiobookshelf]'s built-in automatic detection."

**Behavior:**
- When enabled: After `organize_files` job completes, RMAB triggers filesystem scan in media server
- When disabled: User relies on media server's filesystem watcher or manual scans
- Error handling: Scan failures logged but don't fail organize job (graceful degradation)

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

**Validation state resets when:**
- Plex: URL or token modified
- Prowlarr: URL or API key modified (NOT indexer config)
- Download Client: URL, username, or password modified
- Paths: Directory paths or template modified

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

**PUT /api/admin/settings/audible**
- Updates Audible region
- Body: `{ region: string }` (one of: us, ca, uk, au, in, es, fr)
- No validation required

**PUT /api/admin/settings/prowlarr/indexers**
- Updates indexer configuration (enabled, priority, seeding time, RSS)
- No test required if URL/API key unchanged
- Saves only enabled indexers to database

**PUT /api/admin/settings/download-client**
- Updates download client config
- Requires prior successful test if credentials changed

**PUT /api/admin/settings/paths**
- Updates paths and audiobook organization template
- Requires prior successful test if paths or template changed
- Body: `{ downloadDir, mediaDir, audiobookPathTemplate, metadataTaggingEnabled, chapterMergingEnabled }`

**Test Endpoints (authenticated, handle masked values):**
- POST /api/admin/settings/test-plex - Tests Plex connection, uses stored token if masked, returns libraries
- POST /api/admin/settings/test-prowlarr - Tests connection, uses stored API key if masked, returns indexers
- POST /api/admin/settings/test-download-client - Tests qBittorrent/Transmission, uses stored password if masked
- POST /api/setup/test-paths - Validates paths writable and template format, returns `{success, message, templateValidation: {isValid, error?, previewPaths?}}`

**BookDate Endpoints:**
- GET /api/bookdate/config - Get global BookDate configuration (API key excluded, admin only)
- POST /api/bookdate/config - Save/update global BookDate configuration (admin only)
- POST /api/bookdate/test-connection - Test AI provider connection and fetch available models
- DELETE /api/bookdate/swipes - Clear ALL users' swipe history and cached recommendations (admin only)
- GET /api/bookdate/preferences - Get user's preferences (libraryScope, customPrompt)
- PUT /api/bookdate/preferences - Update user's preferences (all authenticated users)

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
**Download Client:** Valid URL, credentials required, type must be 'qbittorrent', 'transmission', or 'sabnzbd'
**Paths:** Absolute paths, exist or creatable, writable, cannot be same directory, template must contain `{author}` or `{title}`

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

## Notifications

**Purpose:** Configure notification backends to receive alerts for audiobook request events.

**Configuration:**
- Multiple backends per type (Discord, Pushover)
- Per-backend event subscriptions (4 events)
- Encrypted sensitive values (webhook URLs, API keys)
- Enable/disable toggle per backend

**UI (NotificationsTab):**
- Type selector cards: Discord (indigo "D"), Pushover (blue "P")
- Grid layout for configured backends (3 columns)
- Card shows: type icon, name, enabled status, event count
- Edit/delete actions per card

**Modal (NotificationConfigModal):**
- Type-specific forms (Discord: webhook/username/avatar, Pushover: keys/priority)
- Event subscription checkboxes (4 events)
- Enable/disable toggle
- Test button (sends sample notification)
- Password masking for sensitive values

**Event Types:**
- Request Pending Approval - Admin approval required
- Request Approved - Approved (manual or auto)
- Request Available - Available in library
- Request Error - Failed at any stage

**Validation:**
- Name required
- Discord: webhook URL required
- Pushover: user key + app token required
- At least one event selected
