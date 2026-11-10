# Request Cancel

**Status:** ✅ Implemented | One cancel path; stops and removes RMAB's own partial download (#228, credit #506)

## Overview
Cancel (web UI, admin table, API token route) runs `cancelRequest()` / `cancelLoadedRequest()` in `src/lib/services/request-cancel.service.ts`. Callers authorize (owner, or effective role admin). Cancel never touches library files. Delete is a different action: [request-deletion.md](request-deletion.md).

## Cancel vs Delete
| | Cancel | Delete (admin) |
|---|---|---|
| Request row | `status='cancelled'`, `cancelledAt` set | soft delete (`deletedAt`) |
| Partial torrent RMAB added | removed with its files | removed with its files (unless unlimited seeding) |
| Finished torrent | kept until its indexer's seeding rule is met | same |
| Library files | never | removed (guards in request-deletion.md) |
| Routes | `PATCH /api/requests/:id {action:'cancel'}`, `POST /api/requests/:id/cancel` | `DELETE /api/admin/requests/:id` |

## Order (`cancelLoadedRequest`)
1. Status not in `CANCELLABLE_STATUSES`: `cancelled` = idempotent success (`alreadyCancelled`, `download:'none'`); else `not_cancellable` (400).
2. `updateMany where {id, deletedAt:null, status:<status read>}` sets `status`, `cancelledAt`, `updatedAt` (+ `selectedTorrent: DbNull` for `awaiting_approval`). Count 0: re-read; `cancelled` = idempotent success, else 400 / 404. Committed before any client call; no transaction.
3. Queue `request_cancelled` notification (failure logged only).
4. Download step inline (`handleCancelledDownload`, `src/lib/services/cancelled-download.ts`) on the newest `selected` row only, under `CANCEL_STEP_BUDGET_MS` (10 s, `cancel-deadline.ts`). Deadline checked right before every `deleteDownload` and every row write; once passed: no delete, no write (the seeding cleanup's cancelled pass takes over). Lookups race the deadline (no abort signal; a late answer is ignored). An in-flight delete is awaited.

## Download step rules (torrent)
| Case | Result |
|---|---|
| No row; row `removed`/`failed`; no client id | `none`, no client call |
| `addedByRmab=false` | `kept_not_owned`, no client call |
| Recorded client type ≠ configured | `none` (left as it is) |
| Row `completed` + indexer unlimited | `kept_unlimited`, no client call |
| `probeDownload` missing / throws / past deadline | `retry_later`, nothing changed |
| Probe `found:false` | row `removed`, `none`. Cancel time only: a row under 2 min old (`JUST_ADDED_MS`) = `retry_later`, no write (qBittorrent lists an add a moment after it answers; the cleanup pass looks again) |
| `resolveOwnership` not owned | `kept_not_owned`; `addedByRmab=false` written only on `recordNotOwned` |
| State `checking`/`failed`/`processing` | `retry_later` (a recheck reports progress < 1 on a finished torrent) |
| Finished: `completed`/`seeding`, progress ≥ 1, `completedAt`, or row `completed` | needs readable `prowlarr_indexers` (else `retry_later`, no write). Unlimited / not met: row `completed` + `completedAt`, `kept_unlimited` / `kept_seeding`. Met: holds, then delete |
| Partial: `downloading`/`queued`/`paused` otherwise | holds, then `deleteDownload(id, true)`, row `removed`. Any seeding rule (Q4: a partial earns no seed time) |

**Holds** (any hit = `kept_shared`):
- Other requests on the hash, active and (finished torrent only) soft-deleted: `torrentHolds()`, the table in [request-deletion.md](request-deletion.md#shared-torrent-holds) (#545). Partial: any active request with a live row holds; deleted and cancelled ones never. Finished: active per `siblingKeepsTorrent` (finished, imported since, own rule met by the same answer); a deleted or cancelled request holds only through a row that owns the torrent, until its own rule is met (cancelled + unlimited: forever).
- Same book + type, another request `searching`/`downloading` with no selected row (`sameBookGrabInProgress`).
- Re-read right before the delete: request still `cancelled`, not deleted, row still selected and not `removed`.
- After a delete: other requests' selected rows for the hash recorded for this client type are marked `removed` too (`markOtherRowsRemoved`).

## Usenet (cancel time only, `cancelled-download-usenet.ts`)
- Only `addedByRmab === true` (null/false: `kept_not_owned`).
- `getDownload` (raced to the deadline); error: `not_removed`. Not found: `none`. Status not `queued`/`downloading`/`paused`: `kept_finished`.
- `otherActiveRequestsUsingNzb` non-empty: `kept_shared`.
- Both clients: `deleteQueuedDownload(id, {name: torrentName, category})`; never a history delete. `not_queued` = `kept_finished`, `mismatch` = `kept_not_owned`, `unconfirmed` = `not_removed` (no row write).
  - SABnzbd: `mode=queue&name=delete&del_files=1`. `deleted` only when the answer's `nzo_ids` name the job, or (answer without ids) a re-read finds it nowhere; still queued = `unconfirmed`; ids name other jobs, or the job is now in history = `not_queued`. `status:false` without ids throws (`not_removed`).
  - NZBGet: `GroupFinalDelete` only while queued and name or category matches. The category is passed only when it is RMAB's own; in a category RMAB did not create the match is the name alone, so when NZBGet's NZB name differs from the release title RMAB's own queued job is kept (`kept_not_owned`).
- Never retried later (no strict probe; NZBGet reuses ids).

## Response
`{ success, request: {id, status:'cancelled', cancelledAt}, download, message }`. `download`: `removed | kept_seeding | kept_unlimited | kept_shared | kept_not_owned | kept_finished | retry_later | not_removed | none`.
- Admins: message names the client and a sharing request. Owners/user tokens: never (`cancelMessage(outcome, 'owner')`), and `download` is `kept` for `kept_shared` and `kept_not_owned` (`reportedOutcome`), with one message for both.
- `retry_later` says "on its next seeding cleanup". `not_removed` (usenet) promises no retry.
- Admin table toast shows the server message: `toast.warning` for `retry_later` / `not_removed`, else success. User `RequestCard` shows no toast.
- Confirm text (both modals, `cancelConfirmText(status, type)` in `src/lib/utils/cancel-confirm-text.ts`; `awaiting_approval` = withdraw text):
  - `downloading` audiobook: "RMAB stops this request's download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed."
  - `downloading` ebook: "RMAB stops this request's download. What it already downloaded may stay in the download client or the downloads folder." (a direct download's file is not removed)
  - no download yet (`pending`, `searching`, `awaiting_search`, `awaiting_release`): "RMAB stops looking for this book." Admin dialog prefixes `Cancel "<title>"? `.

## Other cancel paths
- **Grab job** (`download-torrent.processor.ts`): after creating the row, `getRequestStopReason` = `cancelled` runs `stopCancelledDownload()` (same step, own deadline); no monitor job, no grab notification.
- **Monitor**: per-poll and completion `downloadHistory` writes are `updateMany ... OR [{downloadStatus:null},{downloadStatus:{not:'removed'}}]`: never over `removed`.
- **Direct ebook download**: `downloading`, `processing` and `failed` writes go through `updateRequestUnlessStopped` / `markRequestFailedUnlessStopped`; a cancel stops it and nothing is imported. A transfer already running finishes, and its file stays in `download_dir` (not removed; the ebook confirm text promises no removal).
- **Cleanup pass**: `cleanup-cancelled-downloads.ts` in `cleanup_seeded_torrents` ([scheduler.md](../backend/services/scheduler.md)).

## Known limits
- Re-request hard-deletes the cancelled request and its rows (`request-rerequest.ts`): after that nothing tracks what the cancel left (kept, not lost).
- Manual/bulk import recycles a cancelled request (`processing`). A row the cancel recorded `completed` then makes it a seeding-pass candidate for its old torrent once `available` (policy: removed when its rule is met).
- Requests cancelled before `cancelledAt` existed (NULL) are never swept. Since #545 they no longer keep another request's torrent past their own rule, but a torrent whose only owner is such a cancel stays (a request that only took it over can't remove it).
- A newest selected row recorded `failed` counts as gone (`none` at cancel; `NOT_GONE` drops it from the pass): a failed partial torrent RMAB added stays in the client.
- The pass handles only the newest selected row, but its candidate query matches a request with any selected live torrent row: a request whose newest row is gone and an older one is live costs one read every run, with no client call.

## Related
[request-deletion.md](request-deletion.md), [backend/services/scheduler.md](../backend/services/scheduler.md), [backend/services/api-tokens.md](../backend/services/api-tokens.md), [phase3/download-clients.md](../phase3/download-clients.md#torrent-ownership-423), [backend/services/jobs.md](../backend/services/jobs.md)
