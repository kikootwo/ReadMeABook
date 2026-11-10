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

- Any action: 404 = skipped "no longer exists". Any other refusal = failed, with the server's message; a call with no answer (thrown fetch) = failed "no answer from RMAB" (`NO_ANSWER_REASON`), never the browser's error text.
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
- `for` loop, `await` per item; per-item progress ("Deleting 3 of 40..."); a throw = failed item ("no answer from RMAB"); the run goes on.
- Stop: takes effect after the current request. Unmount (leaving the page): nothing new starts. Closing the tab: the request in flight finishes on the server, nothing more.
- A second `start` while running returns null.
- After a run: the selection keeps the requests not done (skipped, failed, not started); SWR refresh of the list, `/api/admin/metrics`, `/api/admin/requests/pending-approval`, and `/api/audiobooks*` after a delete.
- Row menus, checkboxes and bar buttons are disabled during a run; filters and paging are not (the run owns its list). A list change mid-run clears the selection; the result still shows, without "(still selected)".
- The run survives a failed poll: the table renders the bar in its loading and error states (`listReady={false}`: no prune), and the dashboard (`admin/page.tsx`) keeps rendering on a poll error once its data loaded (a `role="alert"` line instead of the full-page error).

## Bar (`BulkActionBar.tsx`)
- `position: fixed` at the bottom of the viewport at every width, outside the table's scroll container (`z-40`; ConfirmDialog `z-50`). A spacer under the table, sized from the bar's measured height (`ResizeObserver`; Details open included; `h-40 sm:h-24` before the first measure), keeps the last rows reachable.
- Left: one status line (`tabIndex=-1`): "N selected" and Clear; during a run the progress; after it the result with Details (failed and skipped: title and reason, first 50, closed) and Dismiss. Focus moves to it when a run starts and stays there for the result.
- Right: Approve, Deny, Cancel, Delete, each with the count it applies to, disabled at 0. During a run: Stop.
- `role="region" aria-label="Bulk actions"`. A separate `sr-only` `aria-live="polite"` line announces twice per run: the start ("Deleting 98 requests.") and the result; per-item progress is not announced. Checkboxes: `Select all requests on this page`, `Select <title>`; 44px hit area via the label; cell `w-10 px-3`.
- Confirm (ConfirmDialog, focus on the safe button) closes on confirm; progress shows in the bar. A confirm left open closes for good when the selection it was built from changes or empties. No toast: the bar carries the result.
- Selected rows: `bg-blue-50/70 dark:bg-blue-900/20`, hover `bg-blue-100/70 dark:bg-blue-900/30` (the grey row hover only on unselected rows).

## Texts (`bulk-action-text.ts`; cancel lines in `src/lib/utils/cancel-confirm-text.ts`)
| Confirm | Title / buttons | Body |
|---|---|---|
| Approve (primary) | Approve N requests? / Approve N, Back | "RMAB starts on each one now: a search, or the release its user picked. Unreleased ones wait for release day." |
| Deny (danger) | Deny N requests? / Deny N, Back | "They're marked Denied." |
| Cancel (danger) | Cancel N requests? / Cancel N, Keep them | `bulkCancelConfirmLines()`: "Downloads stop and what they fetched is removed, unless another request uses it. Nothing in your library is touched." (one: "Its download stops and what it fetched is removed, ...") "M waiting for approval are withdrawn." |
| Delete (danger) | Delete N requests? / Delete N, Back | "Their downloads go too, unless still seeding or shared. Nothing in your library is touched: M books already in it are skipped." (no skips: ends at "touched.") `deleteComesBackLine()`: "A watched author or series, or a synced shelf, requests them again unless you remove it first or cancel instead." |

- Not-eligible count: "M others aren't waiting for approval and are skipped." (approve, deny), "M others can't be cancelled and are skipped." (cancel).
- Singular forms throughout ("Delete 1 request?", "Keep it", "1 book already in it is skipped.").
- Result: "Deleted 97." then, as they apply, "M in your library skipped." (every skip in the library; else "M skipped."), "M failed." Cancel only, from each request's `download` answer: "M downloads stay in the download client." (`kept*`, `not_removed`), "M downloads are not removed yet; RMAB tries again on its next seeding cleanup." (`retry_later`); `removed` and `none` add no line. A stopped run: "Stopped: denied 6, 94 not started (still selected)." Reasons per request are in Details.

## Delete
- Never removes a book in the library or being imported: rule and refusal in [request-deletion.md](request-deletion.md#bulk-delete-212) (`deleteTouchesLibrary`, inside `deleteRequest`, decided on its own load).
- What it removes per request is the single delete's: the download per its seeding rule (partial RMAB downloads; finished ones once their rule is met; shared or not-RMAB ones stay), the request (soft delete, `deletedBy`). Unlike a single delete it leaves RMAB's `plex_library` rows for the book (the book can be in the library by another route).
- **Comes back:** shelf sync (auto-request shelves) and watched authors/series create a deleted request again on their next run; a cancelled request is never re-created automatically. For those floods remove the shelf or watch first, or use Cancel (a failed request cannot be cancelled). The delete confirm says so (`deleteComesBackLine`).

## Notifications
- A bulk action sends what the single action sends, once per request: approve queues `request_approved`, cancel queues `request_cancelled`, deny and delete send none.
- `send_notification` runs at concurrency 2 and the providers have no 429 / Retry-After handling: at hundreds of requests a provider such as Discord may drop some.

## Cost
- Never-delivered requests: roughly 40-80 ms per HTTP call; 100 (one page) in a few seconds. A cancel with a download can take up to its 10 s step.

## Related
[request-deletion.md](request-deletion.md), [request-cancel.md](request-cancel.md), [request-approval.md](request-approval.md), [../admin-dashboard.md](../admin-dashboard.md), [../frontend/components.md](../frontend/components.md)
