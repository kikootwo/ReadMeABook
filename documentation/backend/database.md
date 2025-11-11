# Database Schema

## Current State

**Status:** Design Phase - Not yet implemented

This document defines the PostgreSQL database schema for the ReadMeABook application. The database will be embedded within the Docker container and store all application data including users, audiobooks, requests, downloads, configuration, and background jobs.

## Design Architecture

### Database: PostgreSQL

**Why PostgreSQL:**
- Robust ACID compliance for data integrity
- Excellent support for JSON data types (useful for flexible configuration storage)
- Strong TypeScript ORM support (TypeORM, Prisma, Sequelize)
- Reliable for embedded use cases
- Built-in encryption capabilities

### ORM: To Be Determined

Options under consideration:
- **Prisma** - Modern, type-safe, excellent DX, automatic migrations
- **TypeORM** - Mature, decorator-based, good TypeScript support
- **Sequelize** - Well-established, extensive documentation

**Decision:** Will be made during implementation phase based on Docker embedding requirements.

## Schema Overview

### Entity Relationship Diagram

```
┌─────────────┐        ┌──────────────┐        ┌──────────────┐
│    Users    │◄───┐   │  Audiobooks  │        │Configuration │
│             │    │   │              │        │              │
│ - id (PK)   │    │   │ - id (PK)    │        │ - id (PK)    │
│ - plexId    │    │   │ - title      │        │ - key        │
│ - username  │    │   │ - author     │        │ - value      │
│ - role      │    │   │ - narrator   │        │ - encrypted  │
└─────────────┘    │   │ - plexGuid   │        └──────────────┘
                   │   └──────────────┘
                   │          ▲
                   │          │
                   │   ┌──────────────┐
                   └───┤   Requests   │
                       │              │
                       │ - id (PK)    │
                       │ - userId(FK) │
                       │ - audiobookId│
                       │ - status     │
                       │ - progress   │
                       └──────┬───────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
          ┌──────▼──────┐         ┌───────▼──────┐
          │   Download  │         │     Jobs     │
          │   History   │         │              │
          │             │         │ - id (PK)    │
          │ - id (PK)   │         │ - requestId  │
          │ - requestId │         │ - type       │
          │ - torrentId │         │ - status     │
          │ - indexer   │         │ - attempts   │
          └─────────────┘         └──────────────┘
```

## Table Definitions

### Users Table

Stores all authenticated users via Plex OAuth.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plex_id VARCHAR(255) NOT NULL UNIQUE,
  plex_username VARCHAR(255) NOT NULL,
  plex_email VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'user',  -- 'user' or 'admin'
  avatar_url TEXT,
  auth_token TEXT,  -- Encrypted Plex auth token
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE INDEX idx_users_plex_id ON users(plex_id);
CREATE INDEX idx_users_role ON users(role);
```

**Fields:**
- `id` - Internal UUID primary key
- `plex_id` - Unique identifier from Plex (used for OAuth)
- `plex_username` - Display name from Plex
- `plex_email` - Email from Plex (if available)
- `role` - Access level: 'user' or 'admin'
- `avatar_url` - Profile picture from Plex
- `auth_token` - Encrypted Plex authentication token
- `created_at` - Account creation timestamp
- `updated_at` - Last account update timestamp
- `last_login_at` - Most recent login timestamp

### Audiobooks Table

Stores metadata for all audiobooks (requested, downloading, or available).

```sql
CREATE TABLE audiobooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audible_id VARCHAR(255) UNIQUE,  -- Audible ASIN or identifier
  title VARCHAR(500) NOT NULL,
  author VARCHAR(255) NOT NULL,
  narrator VARCHAR(255),
  description TEXT,
  cover_art_url TEXT,
  duration_minutes INTEGER,
  release_date DATE,
  rating DECIMAL(3,2),
  genres JSONB DEFAULT '[]',
  plex_guid VARCHAR(255),  -- GUID from Plex when matched
  plex_library_id VARCHAR(255),
  file_path TEXT,  -- Path in media library when available
  file_format VARCHAR(10),  -- m4b, m4a, mp3
  file_size_bytes BIGINT,
  availability_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
    -- 'unknown', 'requested', 'downloading', 'processing', 'available', 'failed'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  available_at TIMESTAMP  -- When it became available in Plex
);

CREATE INDEX idx_audiobooks_audible_id ON audiobooks(audible_id);
CREATE INDEX idx_audiobooks_plex_guid ON audiobooks(plex_guid);
CREATE INDEX idx_audiobooks_title ON audiobooks(title);
CREATE INDEX idx_audiobooks_author ON audiobooks(author);
CREATE INDEX idx_audiobooks_availability ON audiobooks(availability_status);
```

**Fields:**
- `id` - Internal UUID primary key
- `audible_id` - Unique Audible identifier (ASIN)
- `title`, `author`, `narrator` - Core metadata
- `description` - Full book description
- `cover_art_url` - URL to cover image
- `duration_minutes` - Length in minutes
- `release_date` - Publication date
- `rating` - Average rating (0-5 scale)
- `genres` - Array of genre strings stored as JSON
- `plex_guid` - Plex GUID once matched
- `plex_library_id` - Which Plex library contains this item
- `file_path` - Absolute path to files in media library
- `file_format` - Audio format
- `file_size_bytes` - Total size
- `availability_status` - Current lifecycle status
- Timestamps for tracking

### Requests Table

Tracks all user requests for audiobooks.

```sql
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audiobook_id UUID NOT NULL REFERENCES audiobooks(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- 'pending', 'searching', 'downloading', 'processing', 'completed', 'failed', 'cancelled'
  progress INTEGER DEFAULT 0,  -- 0-100 for download progress
  priority INTEGER DEFAULT 0,  -- Higher = more important
  error_message TEXT,
  search_attempts INTEGER DEFAULT 0,
  download_attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,

  UNIQUE(user_id, audiobook_id)  -- One request per user per audiobook
);

CREATE INDEX idx_requests_user_id ON requests(user_id);
CREATE INDEX idx_requests_audiobook_id ON requests(audiobook_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);
```

**Fields:**
- `id` - Internal UUID primary key
- `user_id` - Foreign key to user who made the request
- `audiobook_id` - Foreign key to requested audiobook
- `status` - Current processing status
- `progress` - Download percentage (0-100)
- `priority` - Request priority (for queue management)
- `error_message` - Details when status is 'failed'
- `search_attempts` - Number of indexer searches performed
- `download_attempts` - Number of download retry attempts
- Timestamps for tracking
- `completed_at` - When request was fulfilled

### Download_History Table

Detailed logs of all download attempts and torrent selections.

```sql
CREATE TABLE download_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  indexer_name VARCHAR(100) NOT NULL,  -- 'prowlarr', 'jackett', specific indexer
  torrent_name VARCHAR(500),
  torrent_hash VARCHAR(100),
  torrent_size_bytes BIGINT,
  magnet_link TEXT,
  torrent_url TEXT,
  seeders INTEGER,
  leechers INTEGER,
  quality_score INTEGER,  -- Internal ranking score
  selected BOOLEAN DEFAULT FALSE,  -- Was this the chosen torrent?
  download_client VARCHAR(50),  -- 'qbittorrent', 'transmission'
  download_client_id VARCHAR(255),  -- ID in download client
  download_status VARCHAR(50),  -- 'queued', 'downloading', 'completed', 'failed', 'stalled'
  download_error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_download_history_request_id ON download_history(request_id);
CREATE INDEX idx_download_history_selected ON download_history(selected);
CREATE INDEX idx_download_history_created_at ON download_history(created_at DESC);
```

**Fields:**
- `id` - Internal UUID primary key
- `request_id` - Foreign key to request
- `indexer_name` - Which indexer provided this result
- `torrent_name` - Original torrent name
- `torrent_hash` - Info hash
- `torrent_size_bytes` - Size in bytes
- `magnet_link`, `torrent_url` - Download links
- `seeders`, `leechers` - Availability metrics
- `quality_score` - Ranking algorithm score
- `selected` - Whether this torrent was chosen
- `download_client` - Which client was used
- `download_client_id` - ID from client API
- `download_status` - Current download state
- `download_error` - Error details if failed
- Timestamps

### Configuration Table

Stores all system configuration with encryption support for sensitive values.

```sql
CREATE TABLE configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT,  -- Can store JSON strings for complex configs
  encrypted BOOLEAN DEFAULT FALSE,
  category VARCHAR(100),  -- 'plex', 'indexer', 'download_client', 'system', 'automation'
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_configuration_key ON configuration(key);
CREATE INDEX idx_configuration_category ON configuration(category);
```

**Fields:**
- `id` - Internal UUID primary key
- `key` - Unique configuration key (e.g., 'plex.server_url')
- `value` - Configuration value (encrypted if sensitive)
- `encrypted` - Whether value is encrypted at rest
- `category` - Logical grouping
- `description` - Human-readable explanation
- Timestamps

**Example Keys:**
- `plex.server_url`
- `plex.auth_token` (encrypted)
- `indexer.type` ('prowlarr' or 'jackett')
- `indexer.url`
- `indexer.api_key` (encrypted)
- `download_client.type` ('qbittorrent' or 'transmission')
- `download_client.url`
- `download_client.username` (encrypted)
- `download_client.password` (encrypted)
- `paths.downloads`
- `paths.media_library`
- `automation.check_interval_seconds`
- `setup.completed`

### Jobs Table

Tracks background job queue (managed by Bull/Redis, but persisted for history).

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bull_job_id VARCHAR(255),  -- ID from Bull queue
  request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL,
    -- 'search_indexers', 'monitor_download', 'organize_files', 'scan_plex', 'match_plex'
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- 'pending', 'active', 'completed', 'failed', 'delayed', 'stuck'
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  payload JSONB,  -- Job-specific data
  result JSONB,  -- Job output
  error_message TEXT,
  stack_trace TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jobs_request_id ON jobs(request_id);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

**Fields:**
- `id` - Internal UUID primary key
- `bull_job_id` - ID from Bull queue system
- `request_id` - Associated request (if applicable)
- `type` - Job type identifier
- `status` - Current job state
- `priority` - Queue priority
- `attempts` - Retry count
- `max_attempts` - Maximum retries before failure
- `payload` - Input data as JSON
- `result` - Output data as JSON
- `error_message`, `stack_trace` - Failure details
- Timestamps

## Data Relationships

### One-to-Many Relationships

- **User → Requests** - Each user can have many requests
- **Audiobook → Requests** - Each audiobook can be requested by many users
- **Request → Download History** - Each request can have multiple download attempts
- **Request → Jobs** - Each request spawns multiple background jobs

### Unique Constraints

- **User + Audiobook** - One request per user per audiobook (prevents duplicates)
- **Plex ID** - Each Plex user can only authenticate once
- **Audible ID** - Each audiobook is unique by Audible identifier

## Migrations Strategy

**Approach:** Use ORM's built-in migration system

**Workflow:**
1. Define schema changes in ORM models
2. Generate migration files automatically
3. Migrations run automatically on Docker container startup
4. Version control all migration files
5. Support rollback for failed migrations

**Migration Execution:**
- Container startup script checks for pending migrations
- Applies migrations before starting application
- Logs migration results
- Exits with error code if migrations fail

## Performance Considerations

### Indexing Strategy

Primary indexes on:
- All foreign keys
- Frequently queried fields (status, timestamps)
- User lookup fields (plex_id)
- Audiobook search fields (title, author)

### Query Optimization

- Use database-level pagination for large result sets
- Implement query result caching for expensive operations
- Use EXPLAIN ANALYZE for slow query debugging
- Add composite indexes for complex filter combinations

### Data Retention

- Keep completed requests for 90 days by default (configurable)
- Archive old jobs after 30 days
- Keep download history indefinitely for analytics
- Soft-delete users (mark as inactive rather than delete)

## Security Considerations

### Encryption at Rest

Sensitive fields encrypted using AES-256:
- User auth tokens
- API keys and passwords in Configuration table
- Download client credentials

**Implementation:**
- Use crypto library with unique encryption key
- Store encryption key in environment variable (outside database)
- Rotate keys via admin interface

### SQL Injection Prevention

- Use parameterized queries exclusively via ORM
- Never construct raw SQL with user input
- Validate all input before database operations

### Access Control

- Enforce row-level security where possible
- Users can only see their own requests
- Admins have full access
- Audit log for sensitive operations

## Known Issues

*This section will be updated during implementation.*

## Tech Stack

**Database:** PostgreSQL 15+
**ORM:** TBD (Prisma, TypeORM, or Sequelize)
**Migration Tool:** ORM's built-in migration system
**Encryption:** Node.js crypto module

## Dependencies

- PostgreSQL must be running before application starts
- Database must be accessible via connection string
- File system permissions for embedded database files

## Usage Examples

*These will be added once the ORM is implemented and models are created.*

## Testing Strategy

- Unit tests for model validation logic
- Integration tests for complex queries
- Migration tests to ensure schema changes work
- Seed data for development and testing
- Backup/restore testing for disaster recovery

## Future Enhancements

- Read replicas for horizontal scaling
- Partitioning for large tables (requests, jobs)
- Full-text search indexes for audiobook discovery
- Database performance monitoring and alerting
- Automated backup to external storage
