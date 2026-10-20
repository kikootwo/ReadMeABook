# Manual Torrent Download

**Status:** ✅ Implemented | Magnet link / .torrent upload → existing download pipeline (no Prowlarr search)

## Overview
Lets a user attach a torrent they found themselves to an existing request. The supplied magnet (or a magnet derived from an uploaded `.torrent`) is queued as a normal `download_torrent` job, so monitoring, organization and Plex/Audiobookshelf import are unchanged.

## Key Details
- **Entry point:** "Manual Torrent" icon button in the `AudiobookDetailsModal` sticky action bar (after Interactive Search)
- **Callers passing `requestId`/`requestedByUserId`:** admin `RecentRequestsTable`, `RequestCard` (requests page, owner from `request.user.id`), `AudiobookCard` (search results)
- **In-session requests:** the modal remembers the request it just created (`localRequestId`/`localRequestedByUserId`) so the button appears immediately after "Request Audiobook" without a reopen; cleared when `isOpen` goes false
- **Visibility:** book not available + viewer has interactive-search permission (`role === 'admin' || permissions.interactiveSearch !== false`) + an actionable request exists (own request or admin, status in the eligible list)
- **Components:** `src/components/audiobooks/ManualTorrentModal.tsx` (magnet input + `.torrent` drop zone), rendered via portal at `z-[60]`
- **Protocol:** torrent only. `.torrent` uploads are converted to magnets server-side so every torrent client uses the existing magnet path — no download-client changes.
- **Usenet/NZB:** out of scope.

## API

`POST /api/requests/[id]/manual-download` — `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `magnet` | string | Must match `/^magnet:\?.*xt=urn:btih:[a-zA-Z0-9]+/i` |
| `file` | file | `.torrent`, ≤ 5 MB. Parsed with `parse-torrent`; magnet built from `infoHash` + `name` + `announce` |

Exactly one of `magnet` / `file` is required.

**Eligible statuses:** `pending`, `failed`, `awaiting_search`, `awaiting_release` (same set as manual-search / `ADVANCEABLE_FROM_INTERACTIVE_SEARCH`).

**Responses**

| Status | Error | When |
|---|---|---|
| 200 | – | `{ success, request, message }` — request set to `downloading`, progress 0 |
| 400 | `ValidationError` | Both/neither field, bad magnet, non-`.torrent`, > 5 MB, unparseable torrent, non-multipart body |
| 401 | `Unauthorized` | Not authenticated |
| 403 | `Forbidden` | Not the requester and not admin |
| 404 | `NotFound` | Request does not exist |
| 409 | `InvalidStatus` | Request status not eligible |
| 409 | `NoDownloadClient` | No torrent client configured |
| 500 | `DownloadError` | Queueing failed |

## Queued Job
`jobQueue.addDownloadJob(requestId, { id, title, author }, torrent)` with:
```json
{
  "title": "Manual torrent",
  "downloadUrl": "<magnet>",
  "guid": "<magnet>",
  "size": 0,
  "indexer": "manual",
  "protocol": "torrent",
  "format": "OTHER"
}
```
`protocol: 'torrent'` makes `ProwlarrService.isNZBResult()` deterministic; `guid`/`publishDate` are required by `TorrentResult`.

## Notes
- `parse-torrent` v11 is ESM and async and exposes no `.magnet` property, so the route awaits `parseTorrent(buffer)` and assembles the magnet URI itself.
- API tokens are blocked on `/api/requests/:id/*` sub-routes (default deny in `api-tokens.ts`); this route is session-auth only.

## Related
- [README.md](README.md) — pipeline overview
- [prowlarr.md](prowlarr.md) — automatic search + interactive search
- [qbittorrent.md](qbittorrent.md) — magnet handling in the download client
