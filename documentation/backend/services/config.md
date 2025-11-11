# Configuration Service

## Current State

**Status:** Design Phase - Not yet implemented

This service manages all application configuration including external service credentials, system settings, and automation preferences. It provides secure storage with encryption for sensitive values and a clean API for reading/writing configuration.

## Design Architecture

### Configuration Storage: Database-Backed

**Why Database Storage:**
- Centralized configuration management
- Can be updated via web interface without container restart
- Version history and audit trail
- Encryption at rest for sensitive values
- Survives container restarts (when using mounted volumes)

### Encryption: AES-256-GCM

**Why AES-256-GCM:**
- Industry standard symmetric encryption
- Authenticated encryption (prevents tampering)
- Fast encryption/decryption
- Built into Node.js crypto module

### Configuration Categories

1. **Plex** - Server URL, library ID, auth tokens
2. **Indexer** - Type (Prowlarr/Jackett), URL, API key
3. **Download Client** - Type (qBittorrent/Transmission), URL, credentials
4. **Paths** - Download directory, media library directory
5. **Automation** - Intervals, quality preferences, retry settings
6. **System** - Setup completion flag, app version, internal settings

## Implementation Details

### Configuration Model

Each configuration item has:
- **Key** - Unique identifier (namespaced, e.g., "plex.server_url")
- **Value** - The actual setting (string, can be JSON for complex types)
- **Encrypted** - Boolean flag indicating if value should be encrypted at rest
- **Category** - Logical grouping for organization
- **Description** - Human-readable explanation for UI display

### Key Naming Convention

```
{category}.{setting_name}

Examples:
- plex.server_url
- plex.library_id
- plex.auth_token (encrypted)
- indexer.type
- indexer.prowlarr.url
- indexer.prowlarr.api_key (encrypted)
- download_client.type
- download_client.qbittorrent.url
- download_client.qbittorrent.username (encrypted)
- download_client.qbittorrent.password (encrypted)
- paths.downloads
- paths.media_library
- automation.check_interval_seconds
- automation.quality_preference
- system.setup_completed
- system.app_version
```

### Encryption Strategy

**Encryption Key:**
- Stored as environment variable `CONFIG_ENCRYPTION_KEY`
- 32-byte random string (generated on first run if not provided)
- Persisted to /config volume
- Never stored in database

**Encryption Process:**
1. Generate random initialization vector (IV) for each value
2. Encrypt plaintext using AES-256-GCM with key + IV
3. Store encrypted value as: `iv:authTag:encryptedData` (base64 encoded)
4. Set encrypted flag to true in database

**Decryption Process:**
1. Read value from database
2. If encrypted flag is false, return raw value
3. Parse IV, auth tag, and encrypted data
4. Decrypt using AES-256-GCM with key
5. Verify auth tag (prevents tampering)
6. Return plaintext

### Configuration Service API

```typescript
interface ConfigService {
  // Get single value
  get(key: string): Promise<string | null>;
  getOrDefault(key: string, defaultValue: string): Promise<string>;

  // Get typed values
  getBoolean(key: string): Promise<boolean>;
  getNumber(key: string): Promise<number>;
  getJSON<T>(key: string): Promise<T | null>;

  // Set values
  set(key: string, value: string, encrypted?: boolean): Promise<void>;
  setMany(items: Array<{key: string, value: string, encrypted?: boolean}>): Promise<void>;

  // Get by category
  getCategory(category: string): Promise<Record<string, string>>;

  // Special helpers
  getPlexConfig(): Promise<PlexConfig>;
  getIndexerConfig(): Promise<IndexerConfig>;
  getDownloadClientConfig(): Promise<DownloadClientConfig>;
  getPathsConfig(): Promise<PathsConfig>;
  getAutomationConfig(): Promise<AutomationConfig>;

  // Setup check
  isSetupCompleted(): Promise<boolean>;
  markSetupCompleted(): Promise<void>;

  // Testing connections
  testConnection(category: string): Promise<{success: boolean, message: string}>;
}
```

## API Endpoints

### GET /api/config/:category

**Description:** Get all configuration for a category

**Auth Required:** Admin only

**Response:**
```json
{
  "category": "plex",
  "config": {
    "server_url": "http://192.168.1.100:32400",
    "library_id": "1",
    "auth_token": "***" // Masked for security
  }
}
```

### PUT /api/config

**Description:** Update multiple configuration values

**Auth Required:** Admin only

**Request:**
```json
{
  "updates": [
    {
      "key": "plex.server_url",
      "value": "http://192.168.1.100:32400",
      "encrypted": false
    },
    {
      "key": "plex.auth_token",
      "value": "plex-token-12345",
      "encrypted": true
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "updated": 2
}
```

### POST /api/config/test/:category

**Description:** Test connection to external service

**Auth Required:** Admin only

**Response:**
```json
{
  "success": true,
  "message": "Successfully connected to Plex server",
  "details": {
    "version": "1.32.5.7349",
    "platform": "Linux"
  }
}
```

### GET /api/config/setup-status

**Description:** Check if initial setup is completed

**Auth Required:** None (needed for setup wizard routing)

**Response:**
```json
{
  "setupCompleted": false,
  "hasUsers": false
}
```

## Configuration Defaults

### Default Values

When configuration doesn't exist, return sensible defaults:

```typescript
const CONFIG_DEFAULTS = {
  'automation.check_interval_seconds': '60',
  'automation.max_search_attempts': '3',
  'automation.max_download_attempts': '2',
  'automation.quality_preference': 'high', // 'high', 'medium', 'fast'
  'automation.preferred_format': 'm4b', // 'm4b', 'm4a', 'mp3'
  'system.setup_completed': 'false',
  'system.log_level': 'info', // 'debug', 'info', 'warn', 'error'
  'paths.downloads': '/downloads',
  'paths.media_library': '/media'
};
```

## Tech Stack

**Encryption:** Node.js `crypto` module
**Database:** PostgreSQL (configuration table)
**Validation:** `joi` or `zod` for schema validation

## Dependencies

- PostgreSQL database (configuration table)
- File system access to /config volume (for encryption key)
- Environment variable support

## Usage Examples

### Reading Configuration

```typescript
import { configService } from './services/config';

// Simple get
const plexUrl = await configService.get('plex.server_url');

// With default
const interval = await configService.getOrDefault('automation.check_interval_seconds', '60');

// Typed get
const setupDone = await configService.getBoolean('system.setup_completed');

// Get entire category
const plexConfig = await configService.getPlexConfig();
// Returns: { serverUrl: string, libraryId: string, authToken: string }
```

### Writing Configuration

```typescript
// Set single value
await configService.set('plex.server_url', 'http://localhost:32400');

// Set encrypted value
await configService.set('plex.auth_token', 'secret-token', true);

// Set many at once (transactional)
await configService.setMany([
  { key: 'indexer.type', value: 'prowlarr', encrypted: false },
  { key: 'indexer.prowlarr.url', value: 'http://localhost:9696', encrypted: false },
  { key: 'indexer.prowlarr.api_key', value: 'api-key-123', encrypted: true }
]);
```

### Testing Connections

```typescript
// Test Plex connection
const result = await configService.testConnection('plex');
if (!result.success) {
  throw new Error(`Plex connection failed: ${result.message}`);
}

// Test indexer
const indexerTest = await configService.testConnection('indexer');
```

### Setup Wizard Usage

```typescript
// Check if setup is needed
const setupCompleted = await configService.isSetupCompleted();
if (!setupCompleted) {
  // Show setup wizard
  return redirectToSetup();
}

// After wizard completes
await configService.markSetupCompleted();
```

## Validation Rules

### Required Configuration for App to Function

**Plex:**
- ✅ `plex.server_url` - Must be valid URL
- ✅ `plex.library_id` - Must be numeric
- ✅ `plex.auth_token` - Must not be empty

**Indexer (at least one):**
- ✅ `indexer.type` - Must be 'prowlarr' or 'jackett'
- ✅ `indexer.{type}.url` - Must be valid URL
- ✅ `indexer.{type}.api_key` - Must not be empty

**Download Client (at least one):**
- ✅ `download_client.type` - Must be 'qbittorrent' or 'transmission'
- ✅ `download_client.{type}.url` - Must be valid URL
- ✅ `download_client.{type}.username` - Must not be empty (if required by client)
- ✅ `download_client.{type}.password` - Must not be empty (if required by client)

**Paths:**
- ✅ `paths.downloads` - Must exist and be writable
- ✅ `paths.media_library` - Must exist and be writable

### Validation on Save

```typescript
interface ValidationResult {
  valid: boolean;
  errors: Array<{field: string, message: string}>;
}

async function validateConfig(category: string, config: Record<string, string>): Promise<ValidationResult> {
  // Run category-specific validation
  // Check URL formats
  // Verify paths exist
  // Test external service connections
}
```

## Security Considerations

### Encryption Key Management

- **Generation:** Random 32-byte key generated on first run
- **Storage:** File in /config volume (outside database)
- **Permissions:** Readable only by app user
- **Rotation:** Support key rotation via admin UI (future enhancement)
- **Backup:** Included in configuration backup process

### Access Control

- **Read Access:** Admin only (users never see config)
- **Write Access:** Admin only
- **Masking:** Sensitive values masked in API responses (show `***`)
- **Audit Log:** Track all configuration changes with user and timestamp

### Secure Transmission

- Always use HTTPS in production
- Never log decrypted sensitive values
- Sanitize error messages to avoid leaking config details

## Error Handling

### Common Errors

**Encryption Key Missing:**
```json
{
  "error": "ConfigurationError",
  "message": "Encryption key not found. Cannot decrypt configuration.",
  "statusCode": 500
}
```

**Invalid Decryption:**
```json
{
  "error": "ConfigurationError",
  "message": "Failed to decrypt configuration value. Data may be corrupted.",
  "statusCode": 500
}
```

**Validation Failed:**
```json
{
  "error": "ValidationError",
  "message": "Invalid configuration",
  "details": [
    { "field": "plex.server_url", "message": "Must be a valid URL" }
  ],
  "statusCode": 400
}
```

## Testing Strategy

### Unit Tests

- Encryption and decryption
- Default value handling
- Type conversion (string → boolean, number)
- Key validation

### Integration Tests

- End-to-end config save and retrieve
- Encryption key generation
- Category filtering
- Connection testing

### Security Tests

- Verify encryption at rest
- Test decryption failure handling
- Validate access control (non-admin rejection)
- Test key tampering detection (auth tag)

## Known Issues

*This section will be updated during implementation.*

## Future Enhancements

- **Configuration versioning** - Track changes over time
- **Backup/restore** - Export/import configuration
- **Environment variable overrides** - Allow env vars to override DB config
- **Configuration validation UI** - Real-time validation in settings page
- **Multiple indexers/download clients** - Support configuring multiple simultaneously
- **Configuration templates** - Pre-configured profiles for common setups
- **Key rotation** - Rotate encryption key with automatic re-encryption
