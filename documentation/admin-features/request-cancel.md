# Request Cancel

**Status:** ✅ Implemented | One cancel path; stops and removes RMAB's own partial download (#228, credit #506)

## Overview
Cancel (web UI, admin table, API token route, Discord) runs `cancelRequest()` / `cancelLoadedRequest()` in `src/lib/services/request-cancel.service.ts`. Callers authorize (owner, or effective role admin). Cancel never touches library files. Delete is a different action: [request-deletion.md](request-deletion.md).

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
| Probe `found:false` | row `removed`, `none` |
| `resolveOwnership` not owned | `kept_not_owned`; `addedByRmab=false` written only on `recordNotOwned` |
| State `checking`/`failed`/`processing` | `retry_later` (a recheck reports progress < 1 on a finished torrent) |
| Finished: `completed`/`seeding`, progress ≥ 1, `completedAt`, or row `completed` | needs readable `prowlarr_indexers` (else `retry_later`, no write). Unlimited / not met: row `completed` + `completedAt`, `kept_unlimited` / `kept_seeding`. Met: holds, then delete |
| Partial: `downloading`/`queued`/`paused` otherwise | holds, then `deleteDownload(id, true)`, row `removed`. Any seeding rule (Q4: a partial earns no seed time) |

**Holds** (any hit = `kept_shared`):
- Other non-deleted request with a selected row on the hash (`otherActiveRequestsSharingTorrent`); `cancelled` siblings never hold. Partial: any holds. Finished: `siblingKeepsTorrent` (finished, imported since, own rule met by the same answer).
- Finished only: soft-deleted request with a non-`removed` selected row on the hash (`softDeletedHoldersOfTorrent`) holds until its own indexer rule is met by the same answer (other client type: holds). Never holds a partial.
- Same book + type, another request `searching`/`downloading` with no selected row (`sameBookGrabInProgress`).
- Re-read right before the delete: request still `cancelled`, not deleted, row still selected and not `removed`.
- After a delete: other requests' selected rows for the hash are marked `removed` too.

## Usenet (cancel time only, `cancelled-download-usenet.ts`)
- Only `addedByRmab === true` (null/false: `kept_not_owned`).
- `getDownload` (raced to the deadline); error: `not_removed`. Not found: `none`. Status not `queued`/`downloading`/`paused`: `kept_finished`.
- `otherActiveRequestsUsingNzb` non-empty: `kept_shared`.
- SABnzbd: `deleteDownload(id, true)` (queue delete, `del_files=1`). NZBGet: `deleteQueuedDownload(id, {name: torrentName, category})`: `GroupFinalDelete` only while queued and name or category matches; never `HistoryFinalDelete`. `not_queued` = `kept_finished`, `mismatch` = `kept_not_owned`.
- Never retried later (no strict probe; NZBGet reuses ids).

## Response
`{ success, request: {id, status:'cancelled', cancelledAt}, download, message }`. `download`: `removed | kept_seeding | kept_unlimited | kept_shared | kept_not_owned | kept_finished | retry_later | not_removed | none`.
- Admins: message names the client and a sharing request. Owners/user tokens: never (`cancelMessage(outcome, 'owner')`).
- `retry_later` says "on its next seeding cleanup". `not_removed` (usenet) promises no retry.
- Admin table toast shows the server message. User `RequestCard` shows no toast.
- Confirm text (both modals): "RMAB stops this request's download and removes what it downloaded so far, unless another request still uses it. A download that already finished may stay in the download client to seed."

## Other cancel paths
- **Grab job** (`download-torrent.processor.ts`): after creating the row, `getRequestStopReason` = `cancelled` runs `stopCancelledDownload()` (same step, own deadline); no monitor job, no grab notification.
- **Monitor**: per-poll and completion `downloadHistory` writes are `updateMany ... OR [{downloadStatus:null},{downloadStatus:{not:'removed'}}]`: never over `removed`.
- **Direct ebook download**: `downloading`, `processing` and `failed` writes go through `updateRequestUnlessStopped` / `markRequestFailedUnlessStopped`; a cancel stops it and nothing is imported.
- **Cleanup pass**: `cleanup-cancelled-downloads.ts` in `cleanup_seeded_torrents` ([scheduler.md](../backend/services/scheduler.md)).

## Known limits
- Re-request hard-deletes the cancelled request and its rows (`request-rerequest.ts`): after that nothing tracks what the cancel left (kept, not lost).
- Manual/bulk import recycles a cancelled request (`processing`). A row the cancel recorded `completed` then makes it a seeding-pass candidate for its old torrent once `available` (policy: removed when its rule is met).
- Requests cancelled before `cancelledAt` existed (NULL) are never swept.
- Soft-deleted-holder gap in request delete and the existing seeding pass: #545.

## Related
[request-deletion.md](request-deletion.md), [backend/services/scheduler.md](../backend/services/scheduler.md), [backend/services/api-tokens.md](../backend/services/api-tokens.md), [phase3/download-clients.md](../phase3/download-clients.md#torrent-ownership-423), [backend/services/jobs.md](../backend/services/jobs.md)
