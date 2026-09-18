# Watched Series and Authors

**Status:** ✅ Implemented | Automatic requests for followed series/authors

## Overview
Watched lists periodically check Audible and request books the user does not already own.

## Key Details
- **Series:** Requests existing missing books and future additions.
- **Authors:** Per-user mode:
  - `includeBackCatalog=false` (default): release date must be on/after the follow date.
  - `includeBackCatalog=true`: all discovered books are eligible.
- Existing watched authors keep entire-catalog behavior when this setting is introduced.
- Author mode can be changed from the profile page.
- Switching an author to entire-catalog mode triggers an immediate check.
- Books without a valid release date are skipped in new-release mode.
- Duplicate/owned books are skipped by the existing request and works-table checks.

## API
- `GET /api/user/watched-authors` → includes `includeBackCatalog`.
- `POST /api/user/watched-authors` → accepts optional `includeBackCatalog` (default `false`).
- `PATCH /api/user/watched-authors/:id` → `{ includeBackCatalog: boolean }`.
- `DELETE /api/user/watched-authors/:id` → removes the subscription.

## Data Model
- `WatchedAuthor.includeBackCatalog Boolean @default(false)` → `include_back_catalog`.

## Related
- `src/lib/services/watched-lists.service.ts`
- `src/components/ui/WatchButton.tsx`
- `src/components/profile/WatchedListsSection.tsx`
