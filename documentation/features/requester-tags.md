# Requester Tags (Audiobookshelf)

**Status:** ✅ Implemented | ABS-only | Tags matched items with `req:<username>`

## Overview
When enabled, RMAB writes a `req:<sanitized_username>` tag onto each Audiobookshelf item it matches to a completed request. Because every request method (Web UI, Discord, API) produces a `Request` with a `user`, tagging at match time covers all of them through one code path. ABS supports per-user library filtering by tag, so admins can scope what each user sees.

## Key Details
- **Setting:** `audiobookshelf.tag_requester` (boolean, default `false`) — checkbox in Library tab → Audiobookshelf section.
- **Tag format:** `req:` + username lowercased, trimmed, spaces→`_`, chars outside `[a-z0-9_-]` stripped. `John Smith` → `req:john_smith`.
- **Merge, never overwrite:** GET `media.tags`, union with new tags (dedupe), PATCH back. Preserves manual tags (`nsfw`) and any `req:` tags already on the item. Skips the write if unchanged.
- **First requester only:** a book has one active request. A second user asking for it is refused (`being_processed` "already being requested by another user", or `already_available`; `request-creator.service.ts`), so only the first requester's tag is added. Give other users access in Audiobookshelf another way.
- **Visible:** tags are visible to anyone who can see the item in Audiobookshelf (the setting says so).
- **Shared tags are never written:** if two or more non-deleted users map to one tag (`john.smith` and `johnsmith` → `req:johnsmith`), none of them is tagged: a shared tag would show one user the other's books. Each run logs one warning per shared tag; the settings section shows the groups while tagging is on. Renaming one user clears it.
- **Apply points:** both match loops that flip a request to `available` — `scan-plex.processor.ts` (full scan) and `plex-recently-added.processor.ts` (scheduled recently-added check). Guarded by `tagRequester && backendMode === 'audiobookshelf' && match.plexGuid && username`. Both paths must tag; a request matched by either is otherwise excluded from the other.
- **Backfill:** false→true toggle of the setting enqueues a one-time `backfill_requester_tags` job that tags existing `available` audiobook requests with `absItemId` set.
- **Best-effort:** tagging never throws; failures are logged and the scan/backfill continues.

## Tag helpers (`src/lib/services/audiobookshelf/requester-tags.ts`)
- `formatRequesterTag(username): string` — sanitized `req:<username>`, or `''` when nothing usable remains.
- `findRequesterTagCollisions(): Promise<{ tag, usernames[] }[]>` — tags shared by 2+ users (`deletedAt: null`).
- `createRequesterTagger(logger)` → `(username) => Promise<string>` — tag to write, or `''` (no usable tag, or shared). Loads users on first call; one per scan/backfill run.
- Settings GET `/api/admin/settings` returns `audiobookshelf.tagCollisions` (same shape) for the warning.

## ABS API (`src/lib/services/audiobookshelf/api.ts`)
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
- **Sanitization collisions:** never tagged; see "Shared tags are never written" above.

## Related
- [settings-pages.md](../settings-pages.md#requester-tagging-audiobookshelf-only)
- `src/lib/processors/scan-plex.processor.ts`, `src/lib/processors/plex-recently-added.processor.ts`, `src/lib/services/audiobookshelf/requester-tags.ts`, `src/lib/services/audiobookshelf/api.ts`
