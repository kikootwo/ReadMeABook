# Database Schema

**Status:** ✅ Implemented

PostgreSQL database storing users, audiobooks, requests, downloads, configuration, and jobs.

**Setup:** Automatically created on container startup via `prisma db push` (syncs schema directly to DB without migration files).

## Tables

### Users
- `id` (UUID PK), `plex_id` (unique), `plex_username`, `plex_email`, `role` ('user'|'admin')
- `is_setup_admin` (bool, default false) - First admin created during setup, role protected from changes
- `avatar_url`, `auth_token` (encrypted), `created_at`, `updated_at`, `last_login_at`
- Indexes: `plex_id`, `role`

### Audiobooks
- `id` (UUID PK), `audible_id` (unique), `title`, `author`, `narrator`, `description`
- `cover_art_url`, `duration_minutes`, `release_date`, `rating`, `genres` (JSONB)
- `plex_guid`, `plex_library_id`, `file_path`, `file_format`, `file_size_bytes`
- `availability_status` ('unknown'|'requested'|'downloading'|'processing'|'available'|'failed')
- **Discovery:** `is_popular` (bool), `is_new_release` (bool), `popular_rank`, `new_release_rank`, `last_audible_sync`
- `created_at`, `updated_at`, `available_at`
- Indexes: `audible_id`, `plex_guid`, `title`, `author`, `availability_status`, `is_popular`, `is_new_release`, `popular_rank`, `new_release_rank`

### Requests
- `id` (UUID PK), `user_id` (FK), `audiobook_id` (FK)
- `status` ('pending'|'searching'|'downloading'|'processing'|'completed'|'failed'|'cancelled'|'awaiting_search'|'awaiting_import'|'warn')
- `progress` (0-100), `priority`, `error_message`
- `search_attempts`, `download_attempts`, `import_attempts`, `max_import_retries` (default 5)
- `last_search_at`, `last_import_at`, `created_at`, `updated_at`, `completed_at`
- Unique: `(user_id, audiobook_id)`
- Indexes: `user_id`, `audiobook_id`, `status`, `created_at DESC`

### Download_History
- `id` (UUID PK), `request_id` (FK), `indexer_name`, `torrent_name`, `torrent_hash`
- `torrent_size_bytes`, `magnet_link`, `torrent_url`, `seeders`, `leechers`
- `quality_score`, `selected` (bool), `download_client`, `download_client_id`
- `download_status` ('queued'|'downloading'|'completed'|'failed'|'stalled')
- `download_error`, `started_at`, `completed_at`, `created_at`
- Indexes: `request_id`, `selected`, `created_at DESC`

### Configuration
- `id` (UUID PK), `key` (unique), `value`, `encrypted` (bool), `category`, `description`
- `created_at`, `updated_at`
- Indexes: `key`, `category`
- Example keys: `plex.server_url`, `plex.auth_token`, `indexer.prowlarr_url`, `download_client.qbittorrent_password`, `paths.downloads`, `setup.completed`

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

## Relationships

- User → Requests (1:many)
- Audiobook → Requests (1:many)
- Request → Download History (1:many)
- Request → Jobs (1:many, nullable)
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

- PostgreSQL 15+
- Prisma 6.x
- `prisma db push` (schema sync)
- Node.js crypto (encryption)
