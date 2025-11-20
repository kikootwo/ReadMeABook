# Plex Media Server Integration

**Status:** ✅ Implemented

Connectivity to Plex for OAuth, library management, content detection, and automatic scanning. Database stores all audiobooks from Plex as source of truth for availability.

## Data Flow

1. **Plex Scan Job** → Fetches all audiobooks → Populates DB with `availabilityStatus: 'available'`
2. **Audible Refresh** → Fuzzy matches against Plex data in DB → Sets `availabilityStatus: 'available'` for matches
3. **UI** → Queries DB → Shows "In Your Library" badge → Prevents duplicate requests

**Key Principle:** Database reflects Plex content. Audible data matched against this.

## Core Endpoints

**GET {server_url}/identity** - Server info (machineIdentifier, version, platform) | Also used for access verification
**GET {server_url}/library/sections** - List libraries with IDs and types
**GET {server_url}/library/sections/{id}/all?type=9** - All albums (type 9 = audiobooks)
**GET {server_url}/library/sections/{id}/all?type=9&sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=10** - Recently added (lightweight polling)
**GET {server_url}/library/sections/{id}/refresh** - Trigger async scan
**GET {server_url}/library/metadata/{rating_key}** - Item metadata (includes user's personal rating)
**GET {server_url}/library/sections/{id}/search?title={query}** - Search

Auth: `X-Plex-Token` header
Response: XML (requires `xml2js` parsing to JSON)
API Docs: `/PlexMediaServerAPIDocs.json`

**Security:** During OAuth, user's accessible servers are fetched from `plex.tv/api/v2/resources`. Only users with the configured server in their resource list can authenticate.

## Plex OAuth

**Base:** `https://plex.tv/api/v2`

1. `POST /pins` → Get PIN id and code
2. Build auth URL: `https://app.plex.tv/auth#?clientID={id}&code={code}`
3. `GET /pins/{id}` → Poll until authToken populated
4. `GET /users/account` → Get user info with token
5. **Security check:** Get server machineIdentifier from configured server
6. **Security check:** Fetch user's accessible servers (`GET plex.tv/api/v2/resources` with user token)
7. **Security check:** Verify configured server's machineIdentifier is in user's resource list
8. Only grant access if server found in user's accessible resources (validates shared access)

## Audiobook Detection

- Plex has no dedicated audiobook type
- Stored as Music library (type="artist")
- Admin selects library during setup
- Query with `type=9` for Album-level items (books)
- `item.title` = book name, `item.parentTitle` = author

## Library Scanning

### Full Library Scan
**Scan Process:**
1. Fetch all audiobooks via API (`type=9`)
2. For each:
   - Exists by `plexGuid`? Update metadata
   - New? Create entry in `plex_library` table
3. Match downloaded requests (status: 'downloaded'):
   - Uses centralized `audiobook-matcher.ts` (ASIN matching, title normalization, narrator support)
   - Matched → Update request status to 'available' + link plexGuid
4. Return summary (total, new count, updated count, matched downloads)

**Trigger:** Scheduled (every 6 hours default) or manual admin action
**Note:** Heavy operation, scans entire library

### Recently Added Check (Lightweight Polling)
**Process:**
1. Query top 10 items sorted by `addedAt:desc` with pagination
2. For each item:
   - New? Create in `plex_library` table
   - Existing? Update metadata
3. Match downloaded requests:
   - Uses centralized `audiobook-matcher.ts` (same as full scan and homepage)
   - Searches entire `plex_library` table for matches
4. Return summary (new, updated, matched downloads)

**Trigger:** Scheduled (every 5 minutes default), enabled by default
**Benefits:** Lightweight polling for new items + comprehensive matching for downloaded requests
**Note:** Requests transition: pending → searching → downloading → processing → downloaded → available (after detection)

## Data Models

```typescript
interface PlexAudiobook {
  ratingKey: string;
  guid: string;
  title: string;
  author: string; // from parentTitle
  narrator?: string;
  duration: number; // ms
  year?: number;
  summary?: string;
  thumb?: string;
  addedAt: number;
  updatedAt: number;
  filePath: string;
}

interface PlexLibrary {
  id: string;
  title: string;
  type: string; // "artist", "audio"
  locations: string[];
  itemCount: number;
}
```

## BookDate Ratings

**Problem:** Library scan runs with system Plex token, storing those ratings in cache. Different users need different ratings for recommendations.

**Solution:**
1. **Local admin users:** Use cached ratings (from system Plex token)
2. **Plex-authenticated users (including admins):** Fetch library with user's token to get personal ratings

**How Per-User Ratings Work:**
- **Key insight:** `/library/sections/{id}/all` returns items with the **authenticated user's ratings**
- Plex ratings are tied to user accounts (stored on plex.tv), not the server
- When fetched with a user's token, each item includes that user's personal `userRating`
- No special permissions needed - works for all authenticated users (admin and non-admin)

**Implementation:**
- `getLibraryContent(serverUrl, userToken, libraryId)` - Fetches library with user-specific ratings
- Returns `PlexAudiobook[]` with `userRating` field specific to the authenticated user
- Plex-authenticated users: Fetch full library (~1-2s), match by plexGuid/ratingKey against cached structure
- Local admin: Use cached ratings (skip API call, user has no Plex account)

**BookDate Integration:**
- `enrichWithUserRatings(userId, cachedBooks)` - Determines user type and returns appropriate ratings
  - Local admin (plexId starts with 'local-') → cached ratings from system token (no API call)
  - Plex-authenticated (everyone else) → user's plex.tv token + stored machineIdentifier → server access token → fetch library with user's ratings

**Notes:**
- System Plex token (configured during setup) is used for library scanning, testing, admin operations only
- Cached ratings reflect whoever owns that system token
- Local admins use cached ratings because they don't have Plex accounts (user.authToken is bcrypt hash)
- **Token types:** Plex uses two token types per the API documentation
  - plex.tv OAuth tokens: For authenticating to plex.tv services
  - Server access tokens: For talking to individual PMS instances
  - Must call `/api/v2/resources` with plex.tv token + machineIdentifier to get server-specific access tokens
  - Each server in user's resources list has its own `accessToken`
- **Security:** machineIdentifier stored in Configuration during setup to avoid accessing system token for user operations
- BookDate correctly fetches server-specific access tokens without touching the system Plex token

## Fixed Issues ✅

**1. Response Format Handling**
- Issue: Server info "unknown", libraries failing to load
- Cause: Modern Plex returns JSON when `Accept: application/json` set, not XML
- Fix: Added JSON handling alongside XML parsing, optional chaining for `$` attributes

**2. OAuth Callback Missing pinId**
- Issue: "Missing pinId parameter" after auth
- Fix: Modified `getOAuthUrl()` to append pinId to callback URL

**3. Scan Architecture**
- Issue: Matched requests instead of populating library (0 matches when DB empty)
- User Feedback: "Seeing books on homepage I know are in library"
- Fix: Rewrote to populate ALL Plex audiobooks to DB as source of truth, Audible matches against this

**4. Mapping Artist Instead of Album**
- Issue: Author names as titles, undefined authors
- Cause: Querying without `type=9` returned Artist items, not Albums
- Fix: Added `type=9` parameter, changed `grandparentTitle` to `parentTitle` for author

**5. Immediate Plex Search After File Organization (400 Error)**
- Issue: organize_files job triggered match_plex immediately after copying files
- Cause: Plex hadn't scanned new files yet, search API returned 400 error
- User Experience: Error logs despite successful download
- Fix: Removed immediate match_plex trigger, changed workflow:
  - organize_files → status: 'downloaded' (green)
  - Scheduled scan_plex (every 6 hours) → matches downloaded requests → status: 'available'

**6. Recently Added Check Used Different Matching Criteria**
- Issue: Recently added check didn't match downloaded requests that full scan matched
- Cause: Recently added used AND logic (title >= 70% AND author >= 70%), full scan used weighted average (title × 0.7 + author × 0.3 >= 0.7)
- User Experience: "The Tenant" → "The Tenant (Unabridged)" matched in full scan but not in recently added check
- Fix: Changed recently added check to use same weighted scoring algorithm as full scan

**7. Scan Methods Not Using Centralized Matcher**
- Issue: Full scan and recently added check had custom matching logic, different from homepage matcher
- Cause: Each component implemented its own fuzzy matching without title normalization, ASIN matching, or narrator support
- User Experience: Inconsistent matching behavior across the application
- Fix: Both scan methods now use `audiobook-matcher.ts` utility (same as homepage)
  - ASIN matching: Checks plexGuid for exact ASIN (100% confidence)
  - Title normalization: Removes "(Unabridged)", "(Abridged)", etc.
  - Narrator matching: Can match narrator to Plex author field
  - ASIN filtering: Rejects candidates with wrong ASINs in plexGuid
  - Consistent 70% weighted threshold everywhere

**8. BookDate Token Decryption Failures**
- Issue: Decryption errors when fetching user ratings for BookDate recommendations
- User Experience: "Failed to decrypt user authToken" / "Failed to decrypt system Plex token"
- Cause: Tokens may be stored as plain text (from before encryption implementation or different encryption key)
- Fix: Added fallback to use tokens as plain text if decryption fails
  - User Plex token: Try decrypt, fallback to plain text
  - System Plex token: Try decrypt, fallback to plain text (before architectural fix)
  - Allows BookDate to function with both encrypted and plain text tokens

**9. BookDate Accessing System Token for User Operations** ⚡ **ARCHITECTURAL FIX**
- Issue: Every BookDate user request was decrypting system Plex token to get machineIdentifier
- User Experience: Unnecessary decryption operations, security concern (users shouldn't access admin token)
- Cause: machineIdentifier was fetched via testConnection() using system token for each user request
- Fix: Store machineIdentifier in Configuration during setup, use stored value for user operations
  - Added `plex_machine_identifier` to Configuration table
  - Setup/complete route saves machineIdentifier from test-plex response
  - config.service.ts returns machineIdentifier from config
  - enrichWithUserRatings() uses stored machineIdentifier (no system token access)
  - System token now only used for: library scanning, setup, testing, admin operations
  - User flow: user's plex.tv token + stored machineIdentifier → server access token
- Security: Users never access or decrypt the system Plex token

**10. OAuth Callback Re-fetching machineIdentifier** ⚡ **ARCHITECTURAL FIX**
- Issue: auth/plex/callback route was calling testConnection() to fetch machineIdentifier on every user login
- User Experience: Unnecessary Plex API call on every authentication (adds latency, wastes resources)
- Cause: Inconsistent architecture - setup/settings save machineIdentifier, but callback re-fetched it
- Fix: Use stored machineIdentifier from config (via getPlexConfig().machineIdentifier)
  - auth/plex/callback now reads from database instead of API call
  - Consistent with BookDate and other user operations
  - testConnection() only used for: testing connections, initial fetching during setup/settings
- Result: Faster authentication, no unnecessary API calls, consistent architecture

## Availability Checking

1. **DB Population:** Plex scan creates/updates records with `plexGuid` + `availabilityStatus: 'available'`
2. **Audible Matching:** Refresh job fuzzy matches (85% threshold), sets `availabilityStatus: 'available'` for matches
3. **API Enrichment:** Discovery APIs use real-time matching (70% threshold) at query time
4. **UI:** `AudiobookCard` shows "In Your Library" if `isAvailable: true`
5. **Server Validation:** `/api/requests` returns 409 if `availabilityStatus === 'available'`

## Tech Stack

- axios/node-fetch
- xml2js (XML → JSON)
- string-similarity (fuzzy matching)
