# Plex Media Server Integration

**Status:** ✅ Implemented

Connectivity to Plex for OAuth, library management, content detection, and automatic scanning. Database stores all audiobooks from Plex as source of truth for availability.

## Data Flow

1. **Plex Scan Job** → Fetches all audiobooks → Populates DB with `availabilityStatus: 'available'`
2. **Audible Refresh** → Fuzzy matches against Plex data in DB → Sets `availabilityStatus: 'available'` for matches
3. **UI** → Queries DB → Shows "In Your Library" badge → Prevents duplicate requests

**Key Principle:** Database reflects Plex content. Audible data matched against this.

## Core Endpoints

**GET {server_url}/identity** - Server info (machineIdentifier, version, platform)
**GET {server_url}/library/sections** - List libraries with IDs and types
**GET {server_url}/library/sections/{id}/all?type=9** - All albums (type 9 = audiobooks)
**GET {server_url}/library/sections/{id}/refresh** - Trigger async scan
**GET {server_url}/library/metadata/{rating_key}** - Item metadata
**GET {server_url}/library/sections/{id}/search?title={query}** - Search

Auth: `X-Plex-Token` header
Response: XML (requires `xml2js` parsing to JSON)
API Docs: `/PlexMediaServerAPIDocs.json`

## Plex OAuth

**Base:** `https://plex.tv/api/v2`

1. `POST /pins` → Get PIN id and code
2. Build auth URL: `https://app.plex.tv/auth#?clientID={id}&code={code}`
3. `GET /pins/{id}` → Poll until authToken populated
4. `GET /users/account` → Get user info with token

## Audiobook Detection

- Plex has no dedicated audiobook type
- Stored as Music library (type="artist")
- Admin selects library during setup
- Query with `type=9` for Album-level items (books)
- `item.title` = book name, `item.parentTitle` = author

## Library Scanning

**Scan Process:**
1. Fetch all audiobooks via API (`type=9`)
2. For each:
   - Exists by `plexGuid`? Update metadata + set `availabilityStatus: 'available'`
   - New? Create entry with `availabilityStatus: 'available'`
3. Return summary (total, new count, updated count)

**Trigger:** Scheduled (every 6 hours default) or manual admin action

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
