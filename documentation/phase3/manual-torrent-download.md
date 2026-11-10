# Admin Add Torrent (magnet link or .torrent file)

**Status:** ✅ Implemented | An admin gives one audiobook request a torrent by hand; the normal download job takes it from there

## Overview
Admin request menu → **Add Torrent** → paste a magnet link or choose a .torrent file. The request moves to `downloading` and a normal `download_torrent` job adds it. Torrents only (no .nzb); nothing for non-admins; no API-token access. Based on community PR #290.

## Key Details
- **Entry point:** `src/app/admin/components/RequestActionsDropdown.tsx` item from `AddTorrentMenuItem.tsx` (`canAddTorrent`: audiobook rows in `ADVANCEABLE_FROM_INTERACTIVE_SEARCH`: pending, failed, awaiting_search, awaiting_release), right after Interactive Search; dialog `AddTorrentDialog.tsx` (shared `Modal`, mounted per opening)
- **Dialog:** title "Add Torrent"; first line the book title; "Magnet link" field (focused on open) / "or" / "Choose .torrent file" (filling one disables the other; chosen file shows name, size and **Remove**); one line "ReadMeABook never removes torrents added here; they seed until you remove them in your client."; Cancel / Add ("Adding…" with a spinner). No closing (Escape, backdrop, ×, Cancel) while sending
  - Errors inline: the server's message; "This file is larger than 2 MB." (checked before sending); "This file is larger than your server accepts." on HTTP 413 (proxy or route); "Adding the torrent failed (HTTP n)." for a non-JSON answer
  - On open it reads `GET /api/admin/settings/download-clients`; no enabled torrent client → the 409 text below is shown and nothing can be sent
  - Success: toast "Torrent added. Downloading now."; SWR keys containing `/api/admin/requests` and `/api/admin/metrics` refreshed
- **Route:** `POST /api/admin/requests/[id]/add-torrent` (`src/app/api/admin/requests/[id]/add-torrent/route.ts`), JSON `{ magnet }` or `{ torrentFile }` (base64)

| Step (in order) | Refusal |
|---|---|
| `requireAuth` | no session 401; any `rmab_` token 403 "This endpoint is not available via API token authentication" (no allowlist entry; same answer for every id) |
| `requireAdmin` | 403 "Admin access required" (nothing read, no request query) |
| `readJsonBody` 3 MiB (`TORRENT_UPLOAD_JSON_BODY_LIMIT_BYTES`), JSON content type | 415; 413 (Content-Length before reading, or while reading) |
| zod `{ magnet?, torrentFile? }`, exactly one | 400 |
| Magnet rule / upload rule (below) | 400 with the rule's message |
| `findFirst({ id, deletedAt: null })` | 404 (missing or soft-deleted) |
| `type === 'audiobook'` | 409 `NotAudiobook` |
| status in `ADVANCEABLE_FROM_INTERACTIVE_SEARCH` | 409: awaiting_approval "Approve this request before adding a torrent"; denied "This request was denied"; others "A torrent can only be added to a pending, failed or waiting request (this one is <status>)" |
| enabled torrent client (`getClientForProtocol('torrent')`) | 409 `NoDownloadClient` "No torrent client is set up. Add qBittorrent, Transmission or Deluge in Settings > Download Clients." (`src/lib/constants/manual-torrent.ts`) |
| claim: `updateMany({ id, deletedAt: null, status: <read> })` → downloading, progress 0, errorMessage null, autoRerequestCount 0 | count 0 → 409 "This request changed; refresh and try again" (double submit, cancel, delete) |
| `addDownloadJob(...)` | throws → claim undone (status, progress, errorMessage), 500 |

- **Magnet rule** `checkAddableMagnet()` (`download-selection-guard.ts`): `checkClientDownloadUrl` + ≤ 16 KiB, no `[\x00-\x1f\x7f]`, exactly one btih (`xt`/`xt.N`, 40 hex or 32 base32, counted over every `[?&]xt…=urn:btih:` the way `magnetHashes` reads them), at most one btmh. Pure v2 (btmh only) refused. Stored and sent: `decodedMagnet(url)` (`&amp;` → `&`), otherwise the string as given (never rebuilt; trackers kept)
- **Upload rule** `readUploadedTorrent()` (`src/lib/services/manual-torrent.ts`): base64 `^[A-Za-z0-9+/]+={0,2}$`, length % 4 = 0, ≤ 2 MiB decoded (`MAX_UPLOADED_TORRENT_BYTES`); `parseTorrent(Buffer)` in memory (never a path, URL or file name); accepted only with `info` + `infoBuffer` + `Number.isSafeInteger(length) && length >= 0` (and each file length) → else 400 "Not a valid .torrent file" (20 raw bytes, bad lengths, deep nesting RangeError, random bytes)
- **Release** (`manualMagnetResult` / `manualFileResult`): `indexer: 'Manual'`, no `indexerId`, `title` = `dn` / `info.name` (control characters removed, ≤ 255 chars, else `Manual torrent <hash8>`), `size` = `xl` / total length, `guid` = `downloadUrl` = the magnet (file add: bare `magnet:?xt=urn:btih:<v1>&dn=<encodeURIComponent(title)>`, passes `isMagnetUri`), `protocol: 'torrent'`, `format: 'OTHER'`
- **Bytes:** only in the queue's job data (`DownloadTorrentPayload.torrentFile`, base64). The `jobs.payload` row stores `torrentFile: { omitted: true, bytes, infoHash }` (`addDownloadJob(..., torrentFile)` → `addJob(type, payload, options, dbPayload)`). Admin sessions and admin API tokens do get admin request detail (jobs with payloads, `GET /api/requests/:id`), so the row never holds the file (a private .torrent carries a passkey). Never on the release object: the processor reads `payload.torrentFile` only, for the primary release
- **Processor:** `payload.torrentFile` → `client.addTorrentData(Buffer, options)`; a client without it → permanent failure "<client> cannot add a .torrent file" (never falls back to the magnet)
- **Clients:** qBittorrent `addTorrent`/`addTorrentData` → one `addSource` (login, `ensureCategory`: a category another app owns is used as is, Manual mode with `savepath`; one re-login on 403); Transmission / Deluge `addDownload`/`addTorrentData` → one `addSource`. Fetched and uploaded files share `uploadTorrentData` / `addTorrentBuffer` (hash, takeover of a copy already in the client, `audiobook` tag on qBittorrent, labels, save path, seed limits off); the file name sent is `<v1>.torrent`
- **Log:** one info line `{ requestId, adminId, source: magnet|file, infoHash, bytes }`; never the magnet (tracker passkeys) or the bytes

## After the add
- **Seeding:** no indexer config matches "Manual" → unlimited; RMAB never removes it (cleanup, remove-after-processing); it seeds until removed in the client. An indexer literally named "Manual" would apply its own limits (exact-name match)
- **Client failure:** hand-picked rule: request `failed`, block by exact name or hash, no next search ([release-blocklist.md](../admin-features/release-blocklist.md#next-release-after-a-client-failure-332))
- **Notification:** `request_grabbed` "<title> via Manual (<client>)"; no `request_approved`
- **Retry Download:** `magnetLink` holds the magnet (file add: the bare magnet, no trackers). Still in the client → resume monitoring. Gone → re-added by that magnet, which a private torrent never finishes (no trackers, no DHT): add the file again instead
- History "View Source" stays hidden (magnet guid)

## Critical Issues
- Queued-search race: a search job already queued or running for a pending/awaiting request can overwrite the status after the claim (shared with select-torrent; separate issue)
- Not covered by the e2e harness: Transmission and Deluge (no fakes), reverse-proxy body limits (nginx default 1 MB refuses a .torrent above about 750 KB with 413), real trackers and DHT, web seeds, the phone file picker

## Related: [download-clients.md](./download-clients.md), [qbittorrent.md](./qbittorrent.md), [../backend/validation.md](../backend/validation.md), [../admin-features/release-blocklist.md](../admin-features/release-blocklist.md)
