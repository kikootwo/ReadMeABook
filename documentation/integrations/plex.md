# Plex Media Server Integration

## Current State

**Status:** Implemented ✅

This integration provides connectivity to Plex Media Server for authentication (OAuth), library management, content detection, and automatic scanning. The system maintains a database of all audiobooks in your Plex library and uses this as the source of truth for availability status.

## Design Architecture

### Data Flow

**Plex as Source of Truth:**
The system treats Plex library content as the authoritative source for what audiobooks are available. The data flow is:

1. **Plex Scan Job** → Fetches all audiobooks from Plex → Populates/updates database with `availabilityStatus: 'available'`
2. **Audible Refresh Job** → Fetches popular/new audiobooks from Audible → Fuzzy matches against Plex data in database → Sets `availabilityStatus: 'available'` for matches
3. **User Interface** → Queries database → Shows "In Your Library" for available books → Prevents duplicate requests

**Key Principle:** Database always reflects what's in Plex. Audible data is matched against this to determine availability before showing users.

### Integration Points

1. **OAuth Authentication** - User login via Plex accounts
2. **Library Detection** - Discover available audiobook libraries
3. **Content Scanning** - Populate database with all Plex library content
4. **Metadata Matching** - Fuzzy match Audible audiobooks to Plex library items
5. **Server Information** - Retrieve server details for validation
6. **Availability Status** - Track which books are available, requested, or unknown

### Plex API: XML-Based REST API

**API Base URL:** `{server_url}` (user-configured, e.g., `http://192.168.1.100:32400`)

**Authentication:** X-Plex-Token header

**Response Format:** XML (requires parsing to JSON)

## Implementation Details

### API Reference

All Plex API endpoints are documented in `/PlexMediaServerAPIDocs.json` (1.1MB official API docs).

### Core Endpoints Used

**1. Get Server Identity**
```
GET {server_url}/identity
Headers: X-Plex-Token: {auth_token}

Response: Server info (machineIdentifier, version, platform)
```

**2. Get Libraries**
```
GET {server_url}/library/sections
Headers: X-Plex-Token: {auth_token}

Response: List of all libraries with IDs and types
```

**3. Get Library Content**
```
GET {server_url}/library/sections/{library_id}/all?type=9
Headers: X-Plex-Token: {auth_token}
Query Params: type=9 (Albums - for audiobooks)

Response: All albums in library (audiobooks)
Note: Type 9 = Albums. Important for music libraries used for audiobooks,
      as it returns book-level items instead of artist-level items.
```

**4. Scan Library**
```
GET {server_url}/library/sections/{library_id}/refresh
Headers: X-Plex-Token: {auth_token}

Response: Success (triggers async scan)
```

**5. Get Item Metadata**
```
GET {server_url}/library/metadata/{rating_key}
Headers: X-Plex-Token: {auth_token}

Response: Detailed metadata for specific item
```

**6. Search Library**
```
GET {server_url}/library/sections/{library_id}/search?title={query}
Headers: X-Plex-Token: {auth_token}

Response: Matching items
```

### Plex OAuth Flow

**OAuth Base URL:** `https://plex.tv/api/v2`

**Flow:**
1. Request auth PIN
2. Generate auth URL for user
3. Poll PIN status until authorized
4. Retrieve auth token
5. Fetch user info with token

**Detailed OAuth Steps:**

```typescript
// Step 1: Request PIN
POST https://plex.tv/api/v2/pins
Headers:
  X-Plex-Client-Identifier: {unique_app_id}
  X-Plex-Product: ReadMeABook

Response:
{
  "id": 12345,
  "code": "ABCD",
  "authToken": null // Initially null until authorized
}

// Step 2: Build auth URL
const authUrl = `https://app.plex.tv/auth#?clientID={client_id}&code={pin_code}&context[device][product]=ReadMeABook`;

// Step 3: Poll PIN status
GET https://plex.tv/api/v2/pins/{pin_id}
Headers:
  X-Plex-Client-Identifier: {unique_app_id}

Response (when authorized):
{
  "id": 12345,
  "code": "ABCD",
  "authToken": "plex-auth-token-xyz" // Now populated
}

// Step 4: Get user info
GET https://plex.tv/users/account
Headers:
  X-Plex-Token: {auth_token}

Response:
{
  "id": 123456,
  "username": "john_doe",
  "email": "john@example.com",
  "thumb": "https://plex.tv/users/.../avatar"
}
```

### Library Type Detection

**Audiobook Libraries:**
Plex doesn't have a dedicated "audiobook" library type. Audiobooks are typically stored as:
- Music library (type="artist")
- Audio library

**Detection Strategy:**
1. Get all libraries from server
2. Filter for type="artist" (music libraries)
3. Let admin select which library contains audiobooks during setup
4. Store library ID in configuration

### Fuzzy Matching Algorithm

**Challenge:** Matching requested audiobooks to Plex library items when naming doesn't match exactly.

**Matching Strategy:**

```typescript
interface MatchScore {
  plexItem: PlexAudiobook;
  score: number;
}

function fuzzyMatchAudiobook(
  requestedTitle: string,
  requestedAuthor: string,
  plexItems: PlexAudiobook[]
): MatchScore[] {
  return plexItems.map(item => {
    let score = 0;

    // Title matching (most important)
    const titleSimilarity = stringSimilarity(
      normalizeString(requestedTitle),
      normalizeString(item.title)
    );
    score += titleSimilarity * 60; // 60 points max

    // Author matching
    const authorSimilarity = stringSimilarity(
      normalizeString(requestedAuthor),
      normalizeString(item.author)
    );
    score += authorSimilarity * 30; // 30 points max

    // Exact match bonus
    if (titleSimilarity === 1.0) score += 10;

    return { plexItem: item, score };
  }).sort((a, b) => b.score - a.score);
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

// Use Levenshtein distance or similar for string similarity
```

**Matching Threshold:**
- Score >= 80: High confidence match (auto-accept)
- Score 60-79: Medium confidence (manual review recommended)
- Score < 60: Low confidence (likely not a match)

### Library Scanning Strategy

**When to Trigger Scans:**
- On a schedule (default: every 6 hours)
- After manual admin action (bulk operations)
- After download completion (future enhancement)

**Scan Process (Implemented):**
1. Fetch all audiobooks from Plex library via API
2. For each Plex audiobook:
   - Check if exists in database by `plexGuid`
   - If exists: Update metadata and set `availabilityStatus: 'available'`
   - If new: Create database entry with `availabilityStatus: 'available'`
3. Return summary: total scanned, new count, updated count

**Key Difference from Original Design:**
- **Original:** Scan was meant to match against pending requests
- **Current:** Scan populates entire library into database as source of truth
- **Result:** Database always reflects current Plex library state

**Optimization:**
- Batch database operations for better performance
- Rate limit scans to avoid overwhelming Plex server
- Default to disabled until first setup is complete

## Plex Service API

```typescript
interface PlexService {
  // Connection testing
  testConnection(serverUrl: string, authToken: string): Promise<{success: boolean, message: string}>;

  // Library management
  getLibraries(): Promise<PlexLibrary[]>;
  getLibraryContent(libraryId: string): Promise<PlexAudiobook[]>;
  scanLibrary(libraryId: string): Promise<void>;

  // Search and matching
  searchLibrary(libraryId: string, query: string): Promise<PlexAudiobook[]>;
  findAudiobook(title: string, author: string): Promise<PlexAudiobook | null>;
  fuzzyMatch(title: string, author: string): Promise<MatchScore[]>;

  // Item details
  getItemMetadata(ratingKey: string): Promise<PlexItemDetails>;

  // OAuth helpers
  requestAuthPin(): Promise<{pinId: number, code: string}>;
  pollAuthPin(pinId: number): Promise<string | null>; // Returns token when authorized
  getUserInfo(authToken: string): Promise<PlexUser>;
}
```

## Data Models

### PlexLibrary

```typescript
interface PlexLibrary {
  id: string;
  title: string;
  type: string; // "artist", "audio"
  language: string;
  scanner: string;
  agent: string;
  locations: string[]; // File system paths
  itemCount: number;
}
```

### PlexAudiobook

```typescript
interface PlexAudiobook {
  ratingKey: string; // Plex's unique ID
  guid: string;      // Plex GUID
  title: string;     // Album title (book name)
  author: string;    // Artist name from "parentTitle" (when querying albums)
  narrator?: string;
  duration: number;  // Milliseconds
  year?: number;
  summary?: string;
  thumb?: string;    // Cover art URL
  addedAt: number;   // Unix timestamp
  updatedAt: number;
  filePath: string;  // Location on disk
}
```

### PlexUser

```typescript
interface PlexUser {
  id: number;
  username: string;
  email?: string;
  thumb?: string; // Avatar URL
  authToken: string;
}
```

## Tech Stack

**HTTP Client:** `axios` or `node-fetch`
**XML Parsing:** `xml2js` (convert Plex XML responses to JSON)
**String Matching:** `string-similarity` or `fuzzball` (Levenshtein distance)

## Dependencies

- Configuration service (for server URL, auth token, library ID)
- Network access to Plex server
- Plex server must be running and accessible

## Usage Examples

### Testing Connection

```typescript
import { plexService } from './integrations/plex';

const result = await plexService.testConnection(
  'http://192.168.1.100:32400',
  'plex-token-123'
);

if (result.success) {
  console.log('Connected to Plex:', result.message);
} else {
  console.error('Plex connection failed:', result.message);
}
```

### Getting Libraries

```typescript
const libraries = await plexService.getLibraries();
const audioLibraries = libraries.filter(lib =>
  lib.type === 'artist' || lib.title.toLowerCase().includes('audio')
);

console.log('Available audiobook libraries:', audioLibraries);
```

### Searching for Audiobook

```typescript
// After files are moved to library
await plexService.scanLibrary('2'); // Library ID

// Wait for scan to process
await new Promise(resolve => setTimeout(resolve, 10000));

// Search for the audiobook
const matches = await plexService.fuzzyMatch(
  'Project Hail Mary',
  'Andy Weir'
);

if (matches.length > 0 && matches[0].score >= 80) {
  const matched = matches[0].plexItem;
  console.log('Found in Plex:', matched.title, matched.ratingKey);

  // Update request in database
  await updateRequest(requestId, {
    status: 'available',
    plexGuid: matched.guid,
    plexRatingKey: matched.ratingKey
  });
}
```

### OAuth Flow

```typescript
// Step 1: Request PIN
const { pinId, code } = await plexService.requestAuthPin();

// Step 2: Show user the auth URL
const authUrl = `https://app.plex.tv/auth#?clientID=${CLIENT_ID}&code=${code}`;
console.log('Visit:', authUrl);

// Step 3: Poll until authorized
let authToken: string | null = null;
while (!authToken) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  authToken = await plexService.pollAuthPin(pinId);
}

// Step 4: Get user info
const user = await plexService.getUserInfo(authToken);
console.log('Authenticated as:', user.username);
```

## Error Handling

### Common Errors

**Connection Refused:**
```typescript
{
  success: false,
  message: "Could not connect to Plex server. Check server URL and network connectivity."
}
```

**Invalid Token:**
```typescript
{
  success: false,
  message: "Authentication failed. Invalid Plex token."
}
```

**Library Not Found:**
```typescript
{
  success: false,
  message: "Audiobook library not found. Please configure library ID in settings."
}
```

**Scan Timeout:**
```typescript
{
  success: false,
  message: "Plex scan timed out after 5 minutes. Audiobook may still appear later."
}
```

## Security Considerations

### Token Storage

- Encrypt auth tokens in database
- Never log tokens in plaintext
- Use HTTPS when communicating with Plex.tv
- Local Plex server may use HTTP (same network)

### Access Control

- Only admins can modify Plex configuration
- All users can trigger OAuth flow
- Validate server URL to prevent SSRF attacks
- Sanitize all user input in search queries

## Performance Considerations

### API Rate Limiting

- Plex.tv OAuth endpoints: Unlimited (but be reasonable)
- Local Plex server: No official limits (avoid hammering)
- Implement exponential backoff for retries
- Cache library content for 5 minutes to reduce API calls

### Concurrent Requests

- Limit concurrent library scans (max 1 at a time)
- Queue scan requests if one is already running
- Use request pooling for bulk operations

### XML Parsing Performance

- Parse XML responses lazily
- Stream large responses when possible
- Cache parsed library content

## Testing Strategy

### Unit Tests

- OAuth PIN request and polling
- Fuzzy matching algorithm accuracy
- XML parsing correctness
- String normalization

### Integration Tests

- Full OAuth flow (with mocked Plex.tv API)
- Library retrieval
- Library scanning
- Search and matching
- Connection testing

### Manual Tests

- Test with real Plex server
- Verify scan triggers work
- Validate matching with real audiobooks
- Test different library configurations

## Known Issues

### Fixed Issues ✅

**1. Plex API Response Format Handling (Fixed)**
- **Issue:** Server info showing as "unknown" and libraries failing to load
- **Root Cause:** Modern Plex servers return JSON (not XML) when `Accept: application/json` header is used. Code was only handling XML parsing with `MediaContainer.$` attributes.
- **Actual Response Format:** Plex returns JSON with direct properties:
  ```json
  {
    "machineIdentifier": "abc123",
    "version": "1.32.5.7349",
    "platform": "Linux",
    "Directory": [
      { "key": "3", "title": "Audiobooks", "type": "artist", ... }
    ]
  }
  ```
- **Fix Applied:**
  - Added JSON response handling alongside XML parsing
  - Used optional chaining (`dir.$?.key` instead of `dir.$.key`) to prevent errors when `$` is undefined
  - Reordered property checks to prioritize direct properties (JSON format)
  - Added comprehensive logging to identify response format
- **Result:** Libraries now display correctly, server info shows proper version

**2. OAuth Callback Missing pinId Parameter (Fixed)**
- **Issue:** After Plex OAuth authorization, callback received error "Missing pinId parameter"
- **Root Cause:** The OAuth forward URL did not include the pinId parameter, so when Plex redirected back to our callback, the pinId was unavailable
- **Fix Applied:**
  - Modified `getOAuthUrl()` method to accept `pinId` parameter
  - Appended pinId as query parameter to callback URL before encoding: `callbackUrl?pinId={pinId}`
  - Updated `/api/auth/plex/login` route to pass `pin.id` to `getOAuthUrl()`
- **Result:** Plex OAuth login now works correctly, pinId is available in callback for PIN status checking

**3. Plex Scan Architecture - Matching vs Populating (Fixed)**
- **Issue:** Scan matched Plex items against existing database requests, resulting in 0 matches when database was empty
- **Root Cause:** Architectural misunderstanding - scan was treating requests as source of truth instead of Plex
- **User Feedback:** "I am seeing audiobooks on the home page that I know are in my library, and it is still suggesting I request them. So matching against requests is a poor setup."
- **Fix Applied:**
  - Rewrote `processScanPlex()` to create/update database entries for ALL Plex audiobooks
  - Each Plex audiobook now stored with `plexGuid`, `availabilityStatus: 'available'`, and metadata
  - Audible refresh now matches against Plex data in database (85% similarity threshold)
  - UI shows "In Your Library" badge for available books
  - Server-side validation prevents requests for books already in Plex
- **Result:** Database reflects complete Plex library, prevents duplicate requests, user knows what they already own

**Recent OAuth Fixes (Fixed):**
- ✅ OAuth callback error "Cannot read properties of undefined (reading 'toString')" (Fixed: added proper validation)
- ✅ Missing validation of Plex API responses (Fixed: comprehensive response validation)
- ✅ No error handling for malformed user data (Fixed: validates all required fields before use)

**4. Plex Scan Mapping Artist Instead of Album (Fixed)**
- **Issue:** Plex scan was incorrectly mapping author names as titles and leaving author field undefined
- **Root Cause:** The `getLibraryContent()` method was querying all items without specifying type, which returned Artist-level items (authors) instead of Album-level items (books). Since Artist items have their name in `item.title` and no `grandparentTitle`, the mapping was backwards.
- **User Feedback:** Logs showed `[ScanPlex] Added new: "Ruth Ware" by undefined` - author names appearing as titles
- **Fix Applied:**
  - Added `type: 9` query parameter to `/library/sections/{libraryId}/all` endpoint to specifically request Albums
  - Changed field mapping from `author: item.grandparentTitle` to `author: item.parentTitle`
  - In Plex music library structure: Artist (author) → Album (book) → Track (audio file)
  - For Album-level items: `item.title` = book name, `item.parentTitle` = author name
- **Result:** Scans now correctly identify book titles as titles and authors as authors

### Current Issues

**Potential Issues:**
- Plex's audiobook support is limited (uses music library)
- Metadata quality depends on Plex's agents
- Fuzzy matching may have false positives (mitigated by 85% threshold)
- Scans can be slow on large libraries

### Availability Checking & Request Prevention

**Implementation (Completed):**

**1. Database Population:**
- Plex scan job populates database with all library audiobooks
- Each entry has `plexGuid`, `availabilityStatus: 'available'`, and `availableAt` timestamp
- Updates existing entries on subsequent scans to keep metadata fresh

**2. Audible Matching:**
- Audible refresh job fetches popular/new releases from Audible
- Fuzzy matches each Audible book against Plex books in database (85% threshold)
- Sets `availabilityStatus: 'available'` for matches
- This enables "In Your Library" badges on Audible content that user already owns

**3. API Enrichment:**
- `/api/audiobooks/popular` and `/api/audiobooks/new-releases` query database for matches
- Return `isAvailable: true` for books with `availabilityStatus === 'available'`
- Uses fuzzy matching with 70% threshold for API responses (more lenient than job processing)

**4. UI Prevention:**
- `AudiobookCard` component checks `audiobook.isAvailable`
- If available: Shows "In Your Library" badge instead of "Request" button
- If not available: Shows "Request" button (or status badge if already requested)

**5. Server-Side Validation:**
- POST `/api/requests` checks `availabilityStatus` before creating request
- Returns 409 Conflict with "AlreadyAvailable" error if book is in Plex
- Prevents accidental duplicate requests even if UI bypassed

## Future Enhancements

- **Webhook support** - Receive notifications when Plex adds new content (avoids polling)
- **Multiple server support** - Connect to multiple Plex servers
- **Better metadata matching** - Use additional fields (ISBN, ASIN)
- **Partial library scans** - Scan only specific directories
- **Playlist creation** - Auto-create audiobook playlists
- **Watch status sync** - Track listening progress
- **Direct play links** - Deep links to audiobooks in Plex app
