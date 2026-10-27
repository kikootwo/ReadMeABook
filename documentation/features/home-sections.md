# Home Page Sections (Per-User Configurable)

**Status:** Implemented | Per-user home page with configurable sections (popular, new releases, Audible categories)

## Overview
Users customize their home page by adding/removing/reordering sections. Each section displays audiobooks from a specific source: built-in Popular, New Releases, or scraped Audible categories.

## Data Models

**UserHomeSection** (`user_home_sections`):
- `id`, `userId` (FK User), `sectionType` ('popular'|'new_releases'|'category'), `categoryId` (nullable), `categoryName` (nullable), `sortOrder` (int)
- Unique: `(userId, sectionType, categoryId)`
- Default: Popular (0) + New Releases (1) created on first access

**AudibleCacheCategory** (`audible_cache_categories`):
- `id`, `asin`, `categoryId`, `rank`, `lastSyncedAt`
- Unique: `(asin, categoryId)`, Indexes: `categoryId`, `(categoryId, rank)`

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/user/home-sections` | user | Returns sections + nextRefresh |
| PUT | `/api/user/home-sections` | user | Save full config (delete-recreate), max 10 |
| GET | `/api/audible/categories` | user | Live scrape top-level categories |
| GET | `/api/audiobooks/category/[categoryId]` | public | Paginated category books from cache |

## Refresh Processor (Unified Storage)
- All section data stored in `AudibleCacheCategory` with reserved IDs: `__popular__` and `__new_releases__` for built-in sections
- Popular/new-releases use same wipe-and-populate pattern as user categories
- After built-in sections, queries DISTINCT categoryIds from `UserHomeSection`
- Per section: scrape, wipe `AudibleCacheCategory` rows, upsert `AudibleCache` metadata, insert ranked category entries
- Empty scrape (e.g. 503 storm) → previous rows kept, warning logged; category not counted in `categoriesSynced`
- Batch cooldown between sections (10-20s random)
- Constants exported from `audible-refresh.processor.ts`: `POPULAR_CATEGORY_ID`, `NEW_RELEASES_CATEGORY_ID`

## AudibleService Methods
- `getCategories()`: Scrapes `{baseUrl}/categories`, returns `{id, name}[]`
- `getCategoryBooks(categoryId, limit)`: Scrapes `/search?node={id}&pageSize=50&sort=popularity-rank`, up to 200 results; storefront yields 0 books → catalog API fallback (`category_id={id}&products_sort_by=BestSellers`, region-language filtered)

## Frontend
- **Hooks:** `useHomeSections()`, `useCategoryAudiobooks()`, `useAudibleCategories()` in `src/lib/hooks/useHomeSections.ts`
- **Config Modal:** `src/components/home/HomeSectionConfigModal.tsx` — drag-and-drop (desktop), up/down arrows (mobile), auto-save with debounce
- **Section Component:** `src/components/home/HomeSection.tsx` — renders individual section with color-coded header
- **Home Page:** `src/app/page.tsx` — dynamic sections from user config, gear icon for customize
- **Pagination:** `src/components/ui/UnifiedPagination.tsx` — controlled by `HomePage` for `activeIndex`; observer reports dominant section but parent gates updates via `lockedTo` state. Lock set on Prev/Next/jump; released on user scroll input (`wheel` / `touchstart` / Arrow / Page / Home / End keys) or any dot click. Fit-aware scroll via `src/lib/utils/paginationScroll.ts` — no scroll when section fits viewport, otherwise snaps top under sticky header with clamps that structurally prevent scrolling the section out of view. Pill is shown anywhere on main content; only the footer hides it.

## Key Decisions
- 10 section limit per user (total)
- Category picker scraped live (no categories table)
- Top-level categories only (v1)
- Wipe-and-re-scrape per category during refresh, skipped when the scrape returns nothing (last good list kept)
- Deduplication of categories across users before scraping
- If category disappears, user sees empty section
- 10-color palette assigned by sort order

## Files
- Schema: `prisma/schema.prisma` (UserHomeSection, AudibleCacheCategory)
- Migration: `prisma/migrations/20260306000000_add_home_sections/migration.sql`
- Service: `src/lib/integrations/audible.service.ts` (getCategories, getCategoryBooks)
- Processor: `src/lib/processors/audible-refresh.processor.ts`
- API Routes: `src/app/api/user/home-sections/route.ts`, `src/app/api/audible/categories/route.ts`, `src/app/api/audiobooks/category/[categoryId]/route.ts`
- Hooks: `src/lib/hooks/useHomeSections.ts`
- Components: `src/components/home/HomeSectionConfigModal.tsx`, `src/components/home/HomeSection.tsx`
- Tests: `tests/api/home-sections.routes.test.ts`, `tests/processors/audible-refresh.processor.test.ts`
