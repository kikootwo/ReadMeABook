# Lists (system-wide public book lists)

Lists are a fourth request source next to shelves, watched authors and watched series. An admin adds
public Goodreads "Listopia" lists once (Admin → Settings → **Lists**); ReadMeABook re-reads them on a
schedule and requests the audiobooks that are not in the library yet.

Unlike shelves (per user, on the profile page), lists are **system-wide**. Requests they create are owned
by the first admin account.

## Flow

```
Goodreads list page ──> filter profile (pre) ──> Audible match ──> filter profile (deep)
        │                                                              │
        └── "new on list" tracking                                     v
                                          ownership check ──> guards ──> createRequestForUser
```

1. **Read** the top `topN` books (Goodreads pages hold 100). Only `www.goodreads.com` is contacted.
2. **Pre-filter** on title/author: box sets and omnibus editions (when enabled) and regex exclusions.
3. **Match** the Goodreads book to Audible by comparing title and author across the search results
   (Sørensen–Dice ≥ 0.8, author surname must appear), instead of trusting the first hit. Results and the Audible
   data the filters need are cached in `import_list_book_matches` (no-match retried after 14 days, matches
   refreshed after 30).
4. **Deep filter** on Audible data: abridged, length, publication year, language, publisher, narrator, genres,
   minimum Audible rating.
5. **Ownership check** (`owned.ts`): ReadMeABook's own library check is an exact ASIN match; lists additionally
   treat the same author surname + cleaned title as owned, so another edition (or a library item with no ASIN)
   is not requested again.
6. **Guards**, checked before every request: the list's own cap per sync, the **hourly request allowance** shared
   by all lists, and the **free-space guard** (stop when the media library has less than N GB free).
7. **Request** through `createRequestForUser(..., { automatic: true })`, which also handles in-progress requests,
   the ignore list, books removed from the library, approvals and notifications.

## Scheduling

The `sync_import_lists` job runs every 10 minutes and starts every enabled list that is due
(`lastSuccessfulSyncAt + syncIntervalHours`). A failed list is not retried for an hour. A run cut short by an
allowance or the disk guard comes due again in about an hour so the rest of the list is picked up gradually.
"Sync now" queues the same job for one list, ignoring its schedule and the hourly allowance (the per-list cap and
the disk guard still apply).

## Settings

Per list: name, enabled, auto-request, sync interval (hours), books read from the top, max requests per sync,
filter profile.

Global (config keys): `import_lists.min_free_gb` (default 300) and `import_lists.max_requests_per_hour` (default 25).

## Filter profiles

Reusable rule sets (`import_list_filter_profiles`). Two built-ins are created on first use: **Standard** and
**Strict** (English, unabridged, 1 hour or longer, rated 3.5+). Deleting a profile leaves its lists with no filter.

## Data

| Table | Purpose |
|---|---|
| `import_lists` | One row per list and its settings and status |
| `import_list_filter_profiles` | Filter rules |
| `import_list_sync_logs` | One row per run: read, new on list, filtered, no match, already have, skipped, requested, error, stop reason, example titles |
| `import_list_book_matches` | Goodreads book → Audible match cache |

## API (admin only)

| Method | Path |
|---|---|
| GET / POST | `/api/admin/import-lists` (POST accepts `source` or `sources[]`) |
| GET / PUT / DELETE | `/api/admin/import-lists/:id` |
| POST | `/api/admin/import-lists/:id/sync` |
| POST / GET | `/api/admin/import-lists/:id/preview` |
| GET | `/api/admin/import-lists/:id/logs` |
| POST | `/api/admin/import-lists/bulk`, `/api/admin/import-lists/test` |
| GET / PUT | `/api/admin/import-lists/status` |
| GET / POST | `/api/admin/import-lists/profiles` |
| PUT / DELETE | `/api/admin/import-lists/profiles/:profileId` |

## Not included yet

Goodreads has no write API, so list status is never pushed back to Goodreads. Writing request status to
Hardcover lists is a possible follow-up.
