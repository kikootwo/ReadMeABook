# Requester Tags (Audiobookshelf)

**Status:** ✅ Implemented | ABS-only | Tags matched items with `req:<username>`

## Overview
When enabled, RMAB writes a `req:<sanitized_username>` tag onto each Audiobookshelf item it matches to a completed request. Because every request method (Web UI, Discord, API) produces a `Request` with a `user`, tagging at match time covers all of them through one code path. ABS supports per-user library filtering by tag, so admins can scope what each user sees.

## Key Details
- **Setting:** `audiobookshelf.tag_requester` (boolean, default `false`) — checkbox in Library tab → Audiobookshelf section.
- **Tag format:** `req:` + username lowercased, trimmed, spaces→`_`, chars outside `[a-z0-9_-]` stripped. `John Smith` → `req:john_smith`.
- **Merge, never overwrite:** GET `media.tags`, union with new tags (dedupe), PATCH back. Preserves manual tags (`nsfw`) and other requesters' `req:` tags. Skips the write if unchanged.
- **Apply points:** both match loops that flip a request to `available` — `scan-plex.processor.ts` (full scan) and `plex-recently-added.processor.ts` (scheduled recently-added check). Guarded by `tagRequester && backendMode === 'audiobookshelf' && match.plexGuid && username`. Both paths must tag; a request matched by either is otherwise excluded from the other.
- **Backfill:** false→true toggle of the setting enqueues a one-time `backfill_requester_tags` job that tags existing `available` audiobook requests with `absItemId` set.
- **Best-effort:** tagging never throws; failures are logged and the scan/backfill continues.

## ABS API (`src/lib/services/audiobookshelf/api.ts`)
- `formatRequesterTag(username): string` — sanitized `req:<username>`.
- `addABSItemTags(itemId, tagsToAdd: string[]): Promise<void>` — GET `media.tags`, merge, PATCH `/items/:id/media` `{ tags }`. Best-effort.

## Job
- Type: `backfill_requester_tags` (registered in `job-queue.service.ts`, concurrency 1).
- Enqueue: `addBackfillRequesterTagsJob()`, triggered from the ABS settings PUT route on false→true.
- Processor: `src/lib/processors/backfill-requester-tags.processor.ts` — queries `status='available'`, `type='audiobook'`, `deletedAt=null`, `audiobook.absItemId != null`; calls `addABSItemTags` per request.

## Scope / Notes
- **Plex backend:** out of scope; ABS-only.
- **Delete:** no tag removal needed — cascading `/delete` removes the whole ABS item.
- **Idempotency:** merge dedupes; `available` requests are excluded from the match loop, so no repeat API calls outside the one-time backfill.
- **Empty/unknown usernames:** skipped.
- **Sanitization collisions:** two usernames could map to one tag (acceptable, low risk).

## Related
- [settings-pages.md](../settings-pages.md#requester-tagging-audiobookshelf-only)
- `src/lib/processors/scan-plex.processor.ts`, `src/lib/processors/plex-recently-added.processor.ts`, `src/lib/services/audiobookshelf/api.ts`
