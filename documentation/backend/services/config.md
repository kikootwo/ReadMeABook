# Configuration Service

**Status:** ❌ Design Phase

Manages application configuration with secure storage, encryption for sensitive values, clean API for read/write.

## Storage: Database-Backed

- Centralized management
- Update via web UI without restart
- Version history and audit trail
- Encryption at rest for sensitive values
- Survives container restarts

## Encryption: AES-256-GCM

- Industry standard symmetric encryption
- Authenticated encryption (prevents tampering)
- Built into Node.js crypto module
- Encryption key: 32-byte random (env var `CONFIG_ENCRYPTION_KEY`)
- Format: `iv:authTag:encryptedData` (base64)

## Configuration Model

- **Key** - Unique identifier (e.g., `plex.server_url`)
- **Value** - Setting (string, JSON for complex types)
- **Encrypted** - Boolean flag
- **Category** - Logical grouping
- **Description** - Human-readable explanation

## Key Naming

```
{category}.{setting_name}

Examples:
plex.server_url
plex.auth_token (encrypted)
indexer.prowlarr.url
indexer.prowlarr.api_key (encrypted)
download_client.qbittorrent.url
download_client.qbittorrent.password (encrypted)
paths.downloads
paths.media_library
automation.check_interval_seconds
system.setup_completed
```

## Service API

```typescript
interface ConfigService {
  get(key: string): Promise<string | null>;
  getOrDefault(key: string, defaultValue: string): Promise<string>;
  getBoolean(key: string): Promise<boolean>;
  getNumber(key: string): Promise<number>;
  getJSON<T>(key: string): Promise<T | null>;

  set(key: string, value: string, encrypted?: boolean): Promise<void>;
  setMany(items: Array<{key, value, encrypted?}>): Promise<void>;

  getCategory(category: string): Promise<Record<string, string>>;

  // Helpers
  getPlexConfig(): Promise<PlexConfig>;
  getIndexerConfig(): Promise<IndexerConfig>;
  getDownloadClientConfig(): Promise<DownloadClientConfig>;

  isSetupCompleted(): Promise<boolean>;
  testConnection(category: string): Promise<{success: boolean, message: string}>;
}
```

## API Endpoints

**GET /api/config/:category** - Get all config for category (admin auth, passwords masked)

**PUT /api/config** - Update multiple values (admin auth)
```json
{
  "updates": [
    {"key": "plex.server_url", "value": "http://...", "encrypted": false},
    {"key": "plex.auth_token", "value": "token", "encrypted": true}
  ]
}
```

**POST /api/config/test/:category** - Test connection (admin auth)

**GET /api/config/setup-status** - Check setup completion (no auth)

## Defaults

```typescript
const CONFIG_DEFAULTS = {
  'automation.check_interval_seconds': '60',
  'automation.max_search_attempts': '3',
  'automation.preferred_format': 'm4b',
  'system.setup_completed': 'false',
  'system.log_level': 'info',
  'paths.downloads': '/downloads',
  'paths.media_library': '/media'
};
```

## Required for App Function

**Plex:** `server_url`, `library_id`, `auth_token`
**Indexer:** `type`, `{type}.url`, `{type}.api_key`
**Download Client:** `type`, `{type}.url`, credentials
**Paths:** `downloads`, `media_library` (writable)

## Tech Stack

- Node.js crypto (encryption)
- PostgreSQL (configuration table)
- Zod (validation)
