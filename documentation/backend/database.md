# Database Schema

**Status:** ✅ Implemented

PostgreSQL database storing users, audiobooks, requests, downloads, configuration, and jobs.

**Setup:** Automatically created on container startup via `prisma db push` (syncs schema directly to DB without migration files).

## Tables

### Users
- `id` (UUID PK), `plex_id` (unique), `plex_username`, `plex_email`, `role` ('user'|'admin')
- `is_setup_admin` (bool, default false) - First admin created during setup, role protected from changes
- `avatar_url`, `auth_token` (encrypted), `created_at`, `updated_at`, `last_login_at`
- **Plex Home profile tracking:**
  - `plex_home_user_id` (string, nullable) - Profile ID from Plex Home (null = main account, set = home profile)
- **Request approval control:**
  - `auto_approve_requests` (bool, nullable, default null) - Per-user override for request approval
    - `null` = Use global setting (Configuration.auto_approve_requests)
    - `true` = Always auto-approve this user's requests
    - `false` = Always require admin approval for this user's requests
- **BookDate per-user preferences:**
  - `bookdate_library_scope` ('full'|'rated', default 'full') - Library scope for recommendations
  - `bookdate_custom_prompt` (text, optional, max 1000 chars) - Custom preferences for AI
  - `bookdate_onboarding_complete` (bool, default false) - Whether user has completed BookDate onboarding
- Indexes: `plex_id`, `role`

### Audible_Cache
- `id` (UUID PK), `asin` (unique, Audible ID), `title`, `author`, `narrator`, `description`
- `cover_art_url`, `cached_cover_path` (local thumbnail path), `duration_minutes`, `release_date`, `rating`, `genres` (JSONB)
- **Discovery:** `is_popular` (bool), `is_new_release` (bool), `popular_rank`, `new_release_rank`
- `last_synced_at`, `created_at`, `updated_at`
- Indexes: `asin`, `title`, `author`, `is_popular`, `is_new_release`, `popular_rank`, `new_release_rank`
- **Purpose:** Cached Audible metadata (popular/new releases), thumbnails stored locally in `/app/cache/thumbnails`

### Plex_Library (Library Cache)
- `id` (UUID PK), `plex_guid` (unique, external ID from Plex or Audiobookshelf), `plex_rating_key`
- `title`, `author`, `narrator`, `summary`, `duration` (BigInt, milliseconds), `year`, `user_rating` (0-10 scale)
- **Universal identifiers:** `asin` (Audible ASIN), `isbn` (ISBN-10 or ISBN-13)
- `file_path` (ABS: the item's folder as ABS sees it, `item.path`, written by both scan jobs, read by the delivered-request link #284; Plex: null), `thumb_url`, `cached_library_cover_path` (local cached cover path), `plex_library_id`, `added_at`
- `last_scanned_at`, `created_at`, `updated_at`
- Indexes: `plex_guid`, `title`, `author`, `plex_library_id`, `asin`, `isbn`
- **Purpose:** Universal library cache for both Plex and Audiobookshelf backends
- **ASIN/ISBN fields:** Enable accurate matching across backends
  - **Plex:** ASIN extracted from Plex GUID (e.g., `com.plexapp.agents.audible://B00ABC123`) + stored in dedicated field
  - **Audiobookshelf:** ASIN/ISBN retrieved directly from ABS metadata + stored in dedicated fields
  - **Matching:** Prioritizes exact ASIN/ISBN matches (100% confidence) before fuzzy title/author matching
- **Cached cover path:** Local path to cached library cover (e.g., `/app/cache/library/{hash}.jpg`), populated during scans

### Audiobooks
- `id` (UUID PK), `audible_asin` (nullable), `title`, `author`, `narrator`, `description`
- `cover_art_url`, `file_path`, `file_format`, `file_size_bytes`
- `plex_guid` (nullable), `plex_library_id` (nullable), `abs_item_id` (nullable)
- `library_asin` (nullable, #325a) - ASIN of the linked ABS item when it differs from `audible_asin`; written only by the library scans' follow ([fixes/file-hash-matching.md](../fixes/file-hash-matching.md#delivered-requests-follow-the-library-asin-325a)); display only; the Prisma client omits it from every audiobook result unless a query selects it (`src/lib/db.ts`)
- `files_hash` (nullable) - SHA256 hash of sorted audio filenames for library matching
- `status` ('requested'|'downloading'|'processing'|'completed'|'failed')
- `created_at`, `updated_at`, `completed_at`
- Indexes: `audible_asin`, `plex_guid`, `abs_item_id`, `files_hash`, `title`, `author`, `status`
- **Purpose:** User-requested audiobooks only (created on request)
- **File Hash Matching:** `files_hash` enables 100% accurate ASIN matching for RMAB-organized content in ABS library scans (see: [fixes/file-hash-matching.md](../fixes/file-hash-matching.md))

### Requests
- `id` (UUID PK), `user_id` (FK), `audiobook_id` (FK)
- `status` ('pending'|'searching'|'downloading'|'processing'|'downloaded'|'available'|'failed'|'cancelled'|'awaiting_search'|'awaiting_import'|'awaiting_release'|'warn'|'awaiting_approval'|'denied')
  - **Approval flow:** awaiting_approval → (approve) → pending → searching → downloading → processing → downloaded → available
  - **Denial flow:** awaiting_approval → (deny) → denied
  - **awaiting_approval** - Request pending admin approval (only if auto-approve disabled)
  - **denied** - Request rejected by admin (terminal state)
  - **pending** - Request approved and queued for processing
  - **awaiting_release** - Book has a future release date; auto-search skipped until release (admin toggle controls behavior)
- `release_date` (Date, nullable) - Book release date snapshot from Audnexus at request creation; used by skip-unreleased-auto-search gate
- `progress` (0-100), `priority`, `error_message`
- `search_attempts`, `download_attempts`, `import_attempts`, `max_import_retries` (default 5)
- `auto_rerequest_count` (Int, default 0) - Automatic re-requests after a failure with no new block (shelf sync / watched lists backoff step); user requests and retries reset it to 0. See [release-blocklist.md](../admin-features/release-blocklist.md#automatic-re-requests-409)
- `last_search_at`, `last_import_at`, `created_at`, `updated_at`, `completed_at`
- `cancelled_at` (DateTime, nullable, **no default**, #228) - Set by every cancel; meaningful only while `status = 'cancelled'`. NULL on a cancelled request = cancelled before the column existed: the cancelled-download cleanup never touches it ([request-cancel.md](../admin-features/request-cancel.md))
- `placed_ebook_files` (Json, nullable) - Ebook requests: files this request's imports copied into the library, `[{ path, size, sha256, placedAt }]`; `[]` = imported but the file was already there; NULL = no record (pre-#497, a failed record write, or never imported); a first item `{ earlierImport: 'unrecorded' }` = the request delivered before its first recorded import. The request delete removes only these. Never in an API response. See [request-deletion.md](../admin-features/request-deletion.md)
- `approval_bypassed_by` (String, nullable, no index) - Set when a request left `awaiting_approval`/`denied`/`cancelled` without an approval, in the same guarded write as the status change: `<path>:<fromStatus>` = `asin_match:awaiting_approval` (library scan ASIN match, `match-requests.ts`), `manual_import:<awaiting_approval|denied|cancelled>` (another user's request, none named, `manual-import.service.ts`), `bulk_import:<...>` (another user's request, `bulk-import/execute`). Cleared (NULL) by the approve route and by a manual import that names the request (API only). The importing admin's own request is never set. NULL = no record (approved, or delivered before this field existed). Status flow, notifications and delivery are unchanged. Read only by the requester tagger: a set value is never tagged ([requester-tags.md](../features/requester-tags.md)). Never in an API response (`hidePlacementRecord`, `GET /api/requests`). A downgrade drops the column (`db push --accept-data-loss`); upgrading again re-adds it NULL on every row, so earlier records are lost. Values: `src/lib/constants/request-statuses.ts` (`approvalBypassMark`)
- Unique: `(user_id, audiobook_id)`
- Indexes: `user_id`, `audiobook_id`, `status`, `created_at DESC`

### Download_History
- `id` (UUID PK), `request_id` (FK), `indexer_name`, `torrent_name`, `torrent_hash`
- `torrent_size_bytes`, `magnet_link`, `torrent_url`, `seeders`, `leechers`
- `quality_score`, `selected` (bool), `download_client`, `download_client_id`
- `download_status` ('queued'|'downloading'|'completed'|'failed'|'stalled'|'removed'); `removed` = gone from the client (RMAB removed it, or the seeding cleanup's strict probe got a well-formed "not there"): no longer a cleanup candidate, never written back to `completed`
- `added_by_rmab` (bool, nullable, no default, #423): `true` RMAB added the torrent; `false` it was already in the client (taken over: never removed or re-categorized); `NULL` row from before the column (judged by the client's added time, `resolveOwnership()` in `src/lib/utils/torrent-ownership.ts`). Usenet rows: `true`. Never filtered with a nullable-boolean WHERE (`<> false` drops NULLs in SQL)
- `download_error`, `started_at`, `completed_at`, `created_at`
- Indexes: `request_id`, `selected`, `created_at DESC`

### Configuration
- `id` (UUID PK), `key` (unique), `value`, `encrypted` (bool), `category`, `description`
- `created_at`, `updated_at`
- Indexes: `key`, `category`
- Example keys: `plex.server_url`, `plex.auth_token`, `indexer.prowlarr_url`, `download_client.qbittorrent_password`, `paths.downloads`, `setup.completed`, `auto_approve_requests`
- **Request approval:**
  - `auto_approve_requests` (value: 'true'|'false') - Global setting for auto-approving requests
  - If 'true' and User.autoApproveRequests is null, requests auto-approved
  - If not 'true' and User.autoApproveRequests is null, requests require admin approval

### Jobs
- `id` (UUID PK), `bull_job_id`, `request_id` (FK nullable)
- `type` ('search_indexers'|'monitor_download'|'organize_files'|'scan_plex'|'match_plex'|'plex_library_scan'|'plex_recently_added_check'|'audible_refresh'|'retry_missing_torrents'|'retry_failed_imports'|'cleanup_seeded_torrents'|'monitor_rss_feeds')
- `status` ('pending'|'active'|'completed'|'failed'|'delayed'|'stuck')
- `priority`, `attempts`, `max_attempts` (default 3)
- `payload` (JSONB), `result` (JSONB), `error_message`, `stack_trace`
- `started_at`, `completed_at`, `created_at`, `updated_at`
- Indexes: `request_id`, `type`, `status`, `created_at DESC`

### Job_Events
- `id` (UUID PK), `job_id` (FK → Jobs, CASCADE delete)
- `level` ('info'|'warn'|'error')
- `context` (processor name: OrganizeFiles, FileOrganizer, MonitorDownload, etc.)
- `message` (event description)
- `metadata` (JSONB, optional structured data)
- `created_at` (timestamp)
- Indexes: `job_id`, `created_at`
- **Purpose:** Store detailed event logs for job operations (shown in admin logs UI)

### Blocked_Releases
- `id` (UUID PK), `request_id` (FK → Requests, CASCADE on hard delete)
- `release_name` (text) - original release title as the indexer returned it
- `release_key` (text) - normalized lookup key: `trim().toLowerCase()` of release_name
- `release_hash` (nullable) - `torrentHash` (qBit) OR `nzbId` (SAB/NZBGet); mutually exclusive in source
- `indexer_name` (nullable), `indexer_id` (int, nullable)
- `source` ('organize_fail'|'download_fail'|'manual'; 'manual' reserved for v2)
- `reason` (text) - short, e.g. "No audiobook files found", "Download failed (par2)"
- `reason_detail` (text, nullable) - raw client error string (SAB failMessage, NZBGet Par/Unpack code)
- `download_history_id` (nullable) - traceability to the DownloadHistory row that drove the block
- `job_id` (nullable) - origin job; also drives JobEvent emission via RMABLogger.forJob
- `created_at` (timestamp)
- Unique: `(request_id, release_key)` - idempotency for concurrent auto-block writes
- Indexes: `request_id`, `release_key`, `release_hash`, `created_at DESC`
- **Purpose:** Per-request blocklist. Search processors filter their candidate set against this table so future searches skip releases that have already failed for the same request.
- **Soft/hard delete:** Soft-delete (sets `requests.deleted_at`) does NOT cascade - blocklist entries survive. Hard-delete cascades and wipes entries. A re-request of a failed/warn/cancelled request moves its entries to the new request in the same transaction before deleting it (`request-rerequest.ts`; `download_history_id` is then historical).
- **Match rules:** Case-insensitive exact match on `release_key` OR exact match on `release_hash`.
- **Service:** Single writer is `src/lib/services/blocklist.service.ts` (`addAutoBlock` is idempotent via upsert; never throws).

### Watched_Series / Watched_Authors
- `id` (UUID PK), `user_id` (FK → Users, CASCADE), `series_asin`/`author_asin`, `series_title`/`author_name`, `cover_art_url` (nullable), `last_checked_at` (nullable), `created_at`, `updated_at`
- `new_releases_since` (DateTime, nullable) - null = request the entire catalog; set = request only books released from this day on (#302)
- Unique: `(user_id, series_asin)` / `(user_id, author_asin)`. See [features/watched-lists.md](../features/watched-lists.md)

## Relationships

- User → Requests (1:many)
- Audiobook → Requests (1:many)
- Request → Download History (1:many)
- Request → Jobs (1:many, nullable)
- Request → Blocked Releases (1:many, CASCADE on hard delete)
- Job → Job Events (1:many, CASCADE delete)

## Setup Strategy

**Approach:** Schema sync via `prisma db push`
- Prisma schema is source of truth
- On startup: sync schema → database
- Idempotent (safe to run multiple times)
- No migration files needed
- Generates Prisma client after sync

## ORM: Prisma 6.x

- Type-safe queries
- Auto-generated types
- Connection pooling
- Client output: `src/generated/prisma`

## Security

**Encryption at Rest (AES-256):**
- User auth tokens
- API keys/passwords in Configuration
- Download client credentials

**SQL Injection:** Parameterized queries only via ORM

**Access Control:** Row-level (users see only their requests), admins have full access

## Tech Stack

- PostgreSQL 16+
- Prisma 6.x
- `prisma db push` (schema sync)
- Node.js crypto (encryption)
