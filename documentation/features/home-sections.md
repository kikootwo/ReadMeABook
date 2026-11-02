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
| GET | `/api/audible/categories` | user | Live catalog categories: `{categories: [{id, name, subcategories: [{id, name, parentId}]}]}` |
| GET | `/api/audiobooks/category/[categoryId]` | public | Paginated category books from cache |

## Refresh Processor (Unified Storage)
- All section data stored in `AudibleCacheCategory` with reserved IDs: `__popular__` and `__new_releases__` for built-in sections
- Popular/new-releases use same wipe-and-populate pattern as user categories
- After built-in sections, collects distinct categoryIds from `UserHomeSection`, capped at `MAX_REFRESHED_CATEGORIES` = 30 per run, stalest first (`selectCategoriesToRefresh()`): never stored, then oldest `AudibleCacheCategory.lastSyncedAt` (one `groupBy` `_max`, only when over the cap), then most users, then id (a refresh that stores no books counts as never stored). A refreshed id moves to the back, so every category refreshes within ceil(N / 30) runs and a newly added one on the next run. Over-cap ids are logged (warn), not wiped, and keep their previous data; result carries `categoriesSkipped`
- Per section: wipe `AudibleCacheCategory` rows, scrape, upsert `AudibleCache` metadata, insert ranked category entries
- Batch cooldown between sections (10-20s random)
- Constants exported from `audible-refresh.processor.ts`: `POPULAR_CATEGORY_ID`, `NEW_RELEASES_CATEGORY_ID`

## AudibleService Methods
- `getCategories()`: one catalog request, `/1.0/catalog/categories?categories_num_levels=2`, parsed by `parseCatalogCategories()` (`src/lib/integrations/audible-categories.ts`) into `{id, name, subcategories: {id, name, parentId}[]}[]`. Ids come from the region's catalog (never hardcoded). One sub-category id can sit under two parents (e.g. True Crime); it is kept under both, each with that parent's name for it
- `getCategoryBooks(categoryId, limit)`: Scrapes `/search?node={id}&pageSize=50&sort=popularity-rank`, up to 200 results

## Frontend
- **Hooks:** `useHomeSections()`, `useCategoryAudiobooks()`, `useAudibleCategories()` in `src/lib/hooks/useHomeSections.ts`
- **Config Modal:** `src/components/home/HomeSectionConfigModal.tsx` — drag-and-drop (desktop), up/down arrows (mobile), auto-save with debounce
- **Category Picker:** `src/components/home/CategoryPicker.tsx`: top-level rows (`font-medium`), each with a 44 px disclosure button (`aria-expanded`, label "Sub-categories of X") listing its sub-categories indented; violet inset focus ring; name filter (matching sub-categories show under their parent; a parent matching by its own name keeps its toggle, which shows all its sub-categories); added categories stay listed, disabled, "Added". A sub-category saves as a normal `category` section (`categoryId` = its id, `categoryName` = its name)
- **Section Component:** `src/components/home/HomeSection.tsx` — renders individual section with color-coded header
- **Home Page:** `src/app/page.tsx` — dynamic sections from user config, gear icon for customize
- **Pagination:** `src/components/ui/UnifiedPagination.tsx` — controlled by `HomePage` for `activeIndex`; observer reports dominant section but parent gates updates via `lockedTo` state. Lock set on Prev/Next/jump; released on user scroll input (`wheel` / `touchstart` / Arrow / Page / Home / End keys) or any dot click. Fit-aware scroll via `src/lib/utils/paginationScroll.ts` — no scroll when section fits viewport, otherwise snaps top under sticky header with clamps that structurally prevent scrolling the section out of view. Pill is shown anywhere on main content; only the footer hides it.

## Key Decisions
- 10 section limit per user (total)
- Category picker scraped live (no categories table)
- Top-level categories and their direct sub-categories (two levels)
- At most 30 distinct categories refreshed per run
- Wipe-and-re-scrape per category during refresh
- Deduplication of categories across users before scraping
- If category disappears, user sees empty section
- 10-color palette assigned by sort order

## Files
- Schema: `prisma/schema.prisma` (UserHomeSection, AudibleCacheCategory)
- Migration: `prisma/migrations/20260306000000_add_home_sections/migration.sql`
- Service: `src/lib/integrations/audible.service.ts` (getCategories, getCategoryBooks), `src/lib/integrations/audible-categories.ts` (parser)
- Processor: `src/lib/processors/audible-refresh.processor.ts`
- API Routes: `src/app/api/user/home-sections/route.ts`, `src/app/api/audible/categories/route.ts`, `src/app/api/audiobooks/category/[categoryId]/route.ts`
- Hooks: `src/lib/hooks/useHomeSections.ts`
- Components: `src/components/home/HomeSectionConfigModal.tsx`, `src/components/home/CategoryPicker.tsx`, `src/components/home/HomeSection.tsx`
- Tests: `tests/api/home-sections.routes.test.ts`, `tests/api/audible-categories.route.test.ts`, `tests/processors/audible-refresh.processor.test.ts`, `tests/processors/audible-refresh.category-cap.test.ts`, `tests/integrations/audible-categories*.test.ts`, `tests/components/home/HomeSectionConfigModal.test.tsx`; fixtures `tests/fixtures/audible-catalog/us-categories-*.json`

## Fixed Issues
- **#309:** picker listed only top-level categories, so sub-categories such as Horror (under Literature & Fiction) could not be added. Now fetched with `categories_num_levels=2` (still one request) and pickable under their parent; refresh capped at 30 categories per run, stalest first so over-cap ones rotate in
