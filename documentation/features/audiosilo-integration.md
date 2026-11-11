# AudioSilo Integration

**Status:** Implemented. AudioSilo is a third library backend next to Plex and Audiobookshelf.

[AudioSilo](https://audiosilo.app/server) is a free, self-hosted audiobook server with web, iOS and Android apps.
With this backend ReadMeABook reads the library, matches requests and marks them available through AudioSilo,
so no Plex or Audiobookshelf server is needed.

## Setup

1. In AudioSilo, sign in as an admin: account menu → **Account** → **Personal API keys** → **Create API key**.
   Copy the key; AudioSilo shows it once. Use an admin account if ReadMeABook should trigger library scans.
2. In the setup wizard choose **AudioSilo** as the backend (or, after setup, Admin → Settings → AudioSilo).
3. Enter the server URL (for example `http://audiosilo:8080`) and the API key, test the connection and pick the audiobook library.
4. Sign-in works as in Audiobookshelf mode: OIDC, local accounts, or both.

The backend cannot be switched after setup, as with Plex and Audiobookshelf.

## How it works

| ReadMeABook needs | AudioSilo API (`/api/v1`) |
|---|---|
| Server info and a stable identifier | `GET /server` (`name`, `version`, `server_id`) |
| Audiobook libraries | `GET /libraries` (only `kind: "books"`) |
| All books | `GET /libraries/{id}/books` (cursor paged, 200 per page) |
| Recently added | `GET /libraries/{id}/books?sort=recent` |
| One book | `GET /libraries/{id}/item?path=<rel_path>` |
| Search | `GET /search?q=` (results limited to the configured library) |
| Cover | `GET /libraries/{id}/cover?path=<rel_path>&size=320` (bearer key) |
| Scan | `POST /admin/libraries/{id}/scan` (admin key) |

Authentication is `Authorization: Bearer <personal API key>`; an admin's key passes admin checks.
Reference: https://docs.audiosilo.app/developers/server/api

### Identity of a book

AudioSilo's numeric book `id` is not documented as stable across re-indexes and the `/item` and `/cover` endpoints
only accept a library-relative path, so ReadMeABook identifies a book by its `rel_path`.
That value is stored in the existing `audiobooks.abs_item_id` column (every non-Plex backend uses it), so no migration is needed.
AudioSilo has no `updated_at`; `added_at` is used for both dates.

### Matching

AudioSilo lists `asin` and `isbn` on a book when it knows them. ReadMeABook matches requests by ASIN first and by title and author otherwise,
exactly as for the other backends. AudioSilo has no metadata-match endpoint, so the Audiobookshelf "match items without ASIN" step is skipped.

### Scanning

AudioSilo has no filesystem watcher: new folders are found on the library's schedule, or when scanned.
Enable **Trigger library scan after import** (on by default in the wizard) so an import is picked up right away.
- With the imported book's path, RMAB calls `POST /admin/libraries/{id}/book/rescan?path=`: it runs at once, for that one book.
- AudioSilo answers 404 `not_indexable` for a path with no indexed book (a folder of several books, or a book it has not seen yet): RMAB then falls back to one queued library scan (`POST /admin/libraries/{id}/scan`, no parameters).
- Looking a never-indexed book folder up (`/item?path=`) also makes AudioSilo index it on demand.
- Without the toggle a request becomes "available" only after AudioSilo's next scheduled scan and the next RMAB library scan.

### Deleting

AudioSilo has no delete endpoint. Deleting a request removes the files from disk and AudioSilo drops the book on its next scan.
"Replace content" for a book added outside ReadMeABook cannot remove it from AudioSilo, so it logs a warning.

### BookDate

AudioSilo has no per-user ratings, so BookDate works as it does with Audiobookshelf (library and favorites, no ratings).

## Configuration keys

| Key | Meaning |
|---|---|
| `system.backend_mode` | `audiosilo` |
| `audiosilo.server_url` | Server URL |
| `audiosilo.api_token` | Personal API key (stored encrypted) |
| `audiosilo.library_id` | Library id (a number, kept as a string) |
| `audiosilo.trigger_scan_after_import` | `true` / `false` |

## Code map

- `src/lib/services/audiosilo/` API client and types
- `src/lib/services/library/AudioSiloLibraryService.ts` implements `ILibraryService`
- `src/lib/constants/backend-mode.ts` backend names and per-backend config keys
- `src/app/api/setup/test-audiosilo`, `src/app/api/admin/settings/audiosilo` connection test, settings save, library list
- `src/app/setup/steps/AudioSiloStep.tsx`, `src/app/admin/settings/tabs/LibraryTab/AudioSiloSection.tsx` screens
