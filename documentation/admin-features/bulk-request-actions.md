# Bulk Request Actions (Admin Table)

**Status:** ✅ Implemented | Select requests on the admin table's page, then approve, deny, cancel or delete them, one at a time (#212)

## Overview
Checkboxes on the admin Request Management table. Each action is the existing single action, called from the page once per request, in order: the next call starts only after the previous one answered. No bulk route, no job, no schema change.

## Actions
| Action | Applies to (as the single action) | Calls, per request | Skipped by the server as |
|---|---|---|---|
| Approve | `awaiting_approval` | `POST /api/admin/requests/:id/approve {action:'approve'}` | 400 `InvalidStatus`: not waiting for approval |
| Deny | `awaiting_approval` | same route `{action:'deny'}` | same |
| Cancel | `CANCELLABLE_STATUSES` (`awaiting_approval` = withdraw) | `PATCH /api/requests/:id {action:'cancel'}` | 400 `ValidationError`: not cancellable now |
| Delete | any row with `inLibrary` false | `DELETE /api/admin/requests/:id?keepLibrary=1` | 409 `InLibrary`: in your library or being imported |

- Any action: 404 = skipped "no longer exists". Any other refusal or a network error = failed, with the server's message.
- Approve never sends an admin pick: a user's stored pick still downloads, as on the approval card.
- Search again and Retry are not bulk actions (each queues an indexer search or download).

## Selection (`useRequestSelection.ts`)
- Page only: the header checkbox (tri-state, `indeterminate` by ref) selects or clears the visible rows (at most 100). No "select all matching".
- Cleared by any change of the list URL (`apiUrl`: filters, search, type, user, sort, page, page size; back/forward included), checked during render.
- Rows that leave the page are pruned (`prune`, from the bar on every row change).
- `version` moves only on the admin's changes (toggle, page select, Clear, a reset), so the result stays until then.
- Table SWR `refreshInterval` is 0 while anything is selected or a run is going (SWR still revalidates on focus; prune covers it).

## Run (`useBulkRun.ts`)
- Owns a fixed list of the eligible selected requests (`{id, title}`), so a selection change mid-run does not change it.
- `for` loop, `await` per item; per-item progress ("Deleting 3 of 40..."); a throw = failed item; the run goes on.
- Stop: takes effect after the current request. Unmount (leaving the page): nothing new starts. Closing the tab: the request in flight finishes on the server, nothing more.
- A second `start` while running returns null.
- After a run: the selection keeps the requests not done (skipped, failed, not started); SWR refresh of the list, `/api/admin/metrics`, `/api/admin/requests/pending-approval`, and `/api/audiobooks*` after a delete.
- Row menus, checkboxes and bar buttons are disabled during a run; filters and paging are not (the run owns its list).

## Bar (`BulkActionBar.tsx`)
- `position: fixed` at the bottom of the viewport at every width, outside the table's scroll container (`z-40`; ConfirmDialog `z-50`; toasts top-right). A spacer under the table keeps the last rows reachable.
- Left: "N selected" and Clear; during a run the progress; after it the result line (focused, `tabIndex=-1`) with Details (failed and skipped: title and reason, first 50) and Dismiss.
- Right: Approve, Deny, Cancel, Delete, each with the count it applies to, disabled at 0. During a run: Stop.
- `role="region" aria-label="Bulk actions"`, `aria-live="polite"` on the status line. Checkboxes: `Select all requests on this page`, `Select <title>`; 44px hit area via the label; cell `w-10 px-3`.
- Confirm (ConfirmDialog, focus on the safe button) closes on confirm; progress shows in the bar. Summary toast: success, or a 10 s warning when anything was skipped, failed or stopped.

## Texts (`bulk-action-text.ts`; cancel sentences in `src/lib/utils/cancel-confirm-text.ts`)
| Confirm | Title / button | Body |
|---|---|---|
| Approve (primary) | Approve N requests? / Approve N requests | "RMAB starts searching for each one now, or on its release date if it isn't out yet." "A release the user already picked starts downloading at once." |
| Deny (danger) | Deny N requests? / Deny N requests | "They're marked Denied and not searched for." |
| Cancel (danger) | Cancel N requests? / Cancel N requests, Keep requests | `bulkCancelConfirmLines()`: "They stay in the list as Cancelled." "M waiting for approval are withdrawn; the user can request them again later." "Nothing in your library is touched." |
| Delete (danger) | Delete N requests? / Delete N requests | "They're removed and can be requested again." "Downloads RMAB added are removed from the download client, unless they're still seeding or another request uses them." "Nothing in your library is touched." "M selected are books in your library or being imported and are left as they are." `DELETE_COMES_BACK_LINE` |

- Each confirm adds the not-eligible count ("M selected aren't waiting for approval and are skipped.", "M selected can't be cancelled now and are skipped.").
- Singular forms throughout ("Delete 1 request?").
- `BULK_CANCEL_TEXT` (`'list'` | `'single'`): one line switches the bulk cancel body to the single cancel's download sentences in the plural.
- Result: "Deleted 278 requests." then, as they apply, "M downloads are still in the download client." (cancel: `kept*`, `retry_later`, `not_removed`), "M skipped (reasons with counts).", "M failed.", "M not started; still selected."; a stopped run starts "Stopped after K of N.".

## Delete
- Never removes a book in the library or being imported: rule and refusal in [request-deletion.md](request-deletion.md#bulk-delete-212) (`deleteTouchesLibrary`, inside `deleteRequest`, decided on its own load).
- What it removes per request is the single delete's: the download per its seeding rule (partial RMAB downloads; finished ones once their rule is met; shared or not-RMAB ones stay), RMAB's `plex_library` rows for the book, the request (soft delete, `deletedBy`).
- **Comes back:** shelf sync (auto-request shelves) and watched authors/series create a deleted request again on their next run; a cancelled request is never re-created automatically. For those floods use Cancel, or remove the shelf or watch first. The delete confirm says so (`DELETE_COMES_BACK_LINE`).

## Notifications
- A bulk action sends what the single action sends, once per request: approve queues `request_approved`, cancel queues `request_cancelled`, deny and delete send none.
- `send_notification` runs at concurrency 2 and the providers have no 429 / Retry-After handling: at hundreds of requests a provider such as Discord may drop some.

## Cost
- Never-delivered requests: roughly 40-80 ms per HTTP call; 100 (one page) in a few seconds. A cancel with a download can take up to its 10 s step.

## Related
[request-deletion.md](request-deletion.md), [request-cancel.md](request-cancel.md), [request-approval.md](request-approval.md), [../admin-dashboard.md](../admin-dashboard.md), [../frontend/components.md](../frontend/components.md)
