# Followed Authors

**Status:** ✅ Complete

## Overview
Users can follow authors to track their audiobooks and request new releases. The Authors page has two tabs: Following (list of followed authors) and Search (discover new authors).

## Key Details
- Per-user author following (each user has their own list)
- Heart icon toggle on AuthorCard and AuthorDetailCard
- Clicking a followed author shows all their books with library availability
- Books show "In Library" / "Requested" / "Request" status via `enrichAudiobooksWithMatches`
- Authors page defaults to "Following" tab, switches to "Search" if `?q=` param present

## Data Model

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| userId | string | FK → User |
| asin | string | Audible author ASIN |
| name | string | Cached display name |
| image | text? | Cached author image URL |
| createdAt | datetime | When followed |

**Unique constraint:** `(userId, asin)` — one follow per user per author.

## API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/authors/followed` | requireAuth | List followed authors |
| POST | `/api/authors/followed` | requireAuth | Follow author `{asin, name, image?}` |
| DELETE | `/api/authors/followed/[asin]` | requireAuth | Unfollow author |
| GET | `/api/authors/followed/[asin]/status` | getCurrentUser | Check if following |

### POST /api/authors/followed
```json
// Request
{ "asin": "B001H6UJO8", "name": "Brandon Sanderson", "image": "https://..." }
// Response 201
{ "success": true, "author": { "id": "...", "asin": "...", "name": "...", "image": "...", "createdAt": "..." } }
```

## Files
- Service: `src/lib/services/followed-author.service.ts`
- API routes: `src/app/api/authors/followed/`
- Hooks: `src/lib/hooks/useAuthors.ts` (`useFollowedAuthors`, `useIsFollowing`, `useFollowActions`)
- Components: `src/components/authors/FollowAuthorButton.tsx`, `FollowedAuthorsGrid.tsx`
- Page: `src/app/authors/page.tsx` (tabbed: Following / Search)

## User Flow
1. Search for author → click heart to follow
2. Go to Authors page → "Following" tab shows all followed authors
3. Click followed author → see all their books
4. Books marked "In Library" (green) or "Requested" (orange) or available to request

## Related
- [integrations/audible.md](../integrations/audible.md) — author search, book scraping
- [frontend/components.md](../frontend/components.md) — AuthorCard, AuthorDetailCard
- [backend/database.md](../backend/database.md) — FollowedAuthor model
