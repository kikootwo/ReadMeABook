# BookDate Feature

**Status:** ✅ Implemented | AI-powered audiobook recommendations with Tinder-style swipe interface

## Overview
Personalized audiobook discovery using OpenAI/Claude APIs. Admin configures AI provider globally. Users swipe through recommendations based on their individual Plex library + swipe history. Right swipe creates request, left rejects, up dismisses.

## Key Details
- **AI Providers:** OpenAI (GPT-4o+), Claude (Sonnet 4.5, Opus 4, Haiku)
- **Configuration:** Global admin-managed, single encrypted API key (AES-256) shared by all users
- **Personalization:** Each user receives recommendations based on their own library, ratings, and swipe history
- **Library Scopes:**
  - Full library: All books in library (max 40 most recent)
  - Rated only: Only books the user has rated
    - Local admin: Uses cached ratings from system token
    - Plex users: Fetches 100 books, filters to user's rated books, returns top 40
- **Context Window:** Max 50 books (40 library + 10 swipe history) per user
- **Cache:** All unswiped recommendations persisted per user, shown on return
- **Actions:**
  - Left swipe: Reject (can undo) - requires 150px swipe distance
  - Right swipe: Request (shows confirmation toast: "Request" or "Mark as Known", triggers search job)
  - Up swipe: Dismiss (can undo) - requires 150px swipe distance
- **Enable/Disable:** Admin global toggle to enable/disable feature for all users
- **Visibility:** Tab shown to any authenticated user when admin has configured and enabled BookDate

## Database Models

### BookDateConfig (global singleton - one record)
```prisma
- id (single record)
- provider ('openai' | 'claude')
- apiKey (encrypted, shared by all users)
- model (e.g., 'gpt-4o', 'claude-sonnet-4-5-20250929')
- libraryScope ('full' | 'rated')
- customPrompt (optional)
- isVerified (admin tested connection), isEnabled (admin toggle)
```

### BookDateRecommendation (cached)
```prisma
- userId, batchId (groups same AI call)
- title, author, narrator, rating, description, coverUrl
- audnexusAsin (for matching/requesting)
- aiReason (why AI recommended)
```

### BookDateSwipe (history)
```prisma
- userId, recommendationId
- bookTitle, bookAuthor
- action ('left' | 'right' | 'up')
- markedAsKnown (true if "Mark as Known" in toast)
```

## API Endpoints

**Configuration:**
- POST `/api/bookdate/test-connection` - Validate API key (saved or new), fetch models (All authenticated)
  - Supports `useSavedKey: true` to test with encrypted saved API key
- GET `/api/bookdate/config` - Get global config (excluding API key) (All authenticated)
- POST `/api/bookdate/config` - Create/update global config (Admin only)
  - Accepts optional `apiKey` (only required for initial setup)
  - Includes `isEnabled` field for global admin toggle
- DELETE `/api/bookdate/config` - Delete global config (Admin only)
- DELETE `/api/bookdate/swipes` - Clear ALL users' swipe history (Admin only)

**Recommendations:**
- GET `/api/bookdate/recommendations` - Return user's cached unswiped recommendations (All authenticated)
- POST `/api/bookdate/swipe` - Record user's swipe, create request + trigger search job if right+confirm (All authenticated)
- POST `/api/bookdate/undo` - Undo last swipe (left/up only) (All authenticated)
- POST `/api/bookdate/generate` - Force generate new batch (All authenticated)

## UI Components

**Pages:**
- `/bookdate` - Main swipe interface (mobile gestures + desktop buttons) (All authenticated users)
- `/admin/settings` - BookDate configuration tab (Admin only)
- Header navigation - BookDate tab visible to all authenticated users when admin has configured and enabled

**Components:**
- `RecommendationCard` - Swipeable card with 150px delta threshold, responsive height (max 85vh)
  - Cover image scales dynamically (max 40vh) to fit on screen
- `LoadingScreen` - Animated loading state
- Navigation tab - Shows to any user with verified configuration

## AI Prompt Flow

1. **Context Gathering:**
   - Get user's library books (max 40, filtered by scope)
     - **Local Admin Users:** Use cached ratings (from system Plex token configured during setup)
     - **Plex-Authenticated Users (including admins):** Fetch library with user's token to get personal ratings
   - Get recent swipes (max 10)
   - Add custom prompt if provided

2. **AI Call:**
   - OpenAI: `response_format: {type: "json_object"}`, system prompt enforces JSON
   - Claude: System prompt: "Return ONLY valid JSON"
   - Request: 20 recommendations (expect ~10 after filtering)

3. **Post-Processing:**
   - Match to Audnexus (database cache first, API fallback)
   - Filter: Already in library, already requested, already swiped
   - Store top 10 in cache

4. **Response:**
   - Return recommendations with metadata (title, author, cover, rating, AI reason)

## Request Integration

**Right Swipe Flow:**
1. User swipes right (150px minimum) → Shows confirmation toast
2. User selects "Request" → Creates `Audiobook` + `Request` records + triggers search job
3. User selects "Mark as Known" → Records swipe only (no request)
4. Request appears in `/requests` page, search job begins automatically (same as regular requests)

## Setup Wizard Integration

**Step 7 (between Paths and Review):**
- Provider selection dropdown
- API key input (password-masked)
- "Test Connection & Fetch Models" button
- Model dropdown (populated after successful test)
- Library scope radio buttons
- Custom prompt textarea
- "Skip for now" + "Next" buttons
- Config saved in `/api/setup/complete` (optional, only if filled)

## Settings Page

**Settings (`/admin/settings` - BookDate Tab):**
- **Enable/Disable Toggle:** Per-user feature toggle (preserves all settings)
- **Provider Selection:** OpenAI or Claude
- **API Key:** Optional re-entry (leave blank to keep existing, required for initial setup)
  - Shows placeholder "••••••••" if already configured
- **Test Connection:** Uses saved API key if no new key entered
  - Button text changes to indicate using saved key
- **Model Selection:** Populated after successful test
- **Library Scope:** Full library | Rated only
- **Custom Prompt:** Optional preferences
- **Save:** Can save scope/prompt/enabled without re-testing
  - Testing only required when changing provider/API key/model
- **Clear Swipe History:** Button with confirmation dialog
- **Accessible to all authenticated users** (not just admins)

## Security

- **API Keys:** Encrypted at rest (AES-256-GCM), never logged
- **User Isolation:** All queries filtered by userId
- **Admin Controls:** Can disable globally, cannot see user API keys
- **No Shared Keys:** Each user provides their own (no centralized costs)

## Error Handling

**Configuration Errors:**
- Invalid API key → "Invalid API key. Please check and try again."
- Connection failed → "Could not connect to {provider}. Check your API key and internet connection."
- Model fetch failed → Show error, allow manual model entry

**Recommendation Errors:**
- AI API call failed → Check cache first, show cached if available, else error
- Invalid JSON response → Log full response, retry once, then show error
- All recommendations filtered out → Show message: "Couldn't find new recommendations. Try adjusting settings."
- No Audnexus match → Skip silently, log warning, continue with next

**Per-User Rating Handling:**
- **Local admin users:** Use cached ratings from library scan
  - Cached ratings are from the system Plex token (configured during setup)
  - No additional API calls needed
  - scope='rated': Filters cached library by cached ratings (40 most recent rated books)
- **Plex-authenticated users (including admins):** Fetch full library with user's token to get personal ratings
  - Uses `/library/sections/{id}/all` endpoint which returns items with authenticated user's ratings
  - Matches by plexGuid/ratingKey against cached library structure
  - ~1-2s fetch time for full library (only happens when generating recommendations)
  - scope='rated': Fetches 100 books, enriches with user ratings, filters to rated, returns top 40
    - Ensures user sees books THEY rated, not just books the system token rated

**Graceful Degradation:**
- Audnexus API down → Skip failed matches, show what matched
- Empty Plex library → Show warning, allow setup anyway
- No recommendations → Show empty state with "Get More" button
- Rating fetch fails → Continue with recommendations, no ratings included in AI prompt

## Cache Strategy

- **Per-User:** Each user has separate cache
- **Return Behavior:** Shows all remaining unswiped cached recommendations when user returns
- **Invalidation:** Cleared when config changes or user clears manually
- **Persistence:** Remains until swiped (no expiration)
- **Refill:** User manually requests more when cache is empty

## Mobile UX

- **Touch Gestures:** Swipe left/right/up with visual feedback (150px minimum distance)
- **Drag Overlay:** Green (right), Red (left), Blue (up) with emoji indicators
  - Overlay visible at 50px offset, full opacity at 150px
- **Rotation:** Card rotates slightly during drag
- **Snap Back:** Card returns if released before 150px threshold
- **Card Height:** Dynamic scaling (max 85vh) to fit on screen, cover max 40vh
- **Undo:** Appears for 3 seconds after left/up swipe

## Desktop UX

- **Button Controls:** 3 buttons below card (Not Interested, Dismiss, Request)
- **Mouse Drag:** Also supports mouse dragging for swipe
- **Keyboard:** No shortcuts (future enhancement)

## Performance

- **Token Usage:** ~4,500 input + ~1,000 output tokens per batch
- **Cost Estimate:** ~$0.04 per batch (GPT-4o), varies by model
- **Cache Hit Rate:** High (only generates when needed)
- **API Rate Limits:** OpenAI ~3500 RPM, Claude ~4000 RPM
- **Per-User Rating Fetch:**
  - Local admin users: No additional API calls (use cached ratings)
  - Plex-authenticated users: 1 library fetch (~1-2s for full library)
  - Only happens when generating recommendations (not frequently)

## Dependencies

- `react-swipeable` (^7.0.1) - Swipe gesture handling
- `@prisma/client` - Database ORM
- `encryption.service.ts` - API key encryption

## File Locations

**Backend:**
- `prisma/schema.prisma` - Database models (BookDateConfig, BookDateRecommendation, BookDateSwipe)
- `src/lib/bookdate/helpers.ts` - Helper functions (AI calling, matching, filtering)
- `src/app/api/bookdate/` - API routes (9 endpoints)

**Frontend:**
- `src/app/bookdate/page.tsx` - Main swipe interface
- `src/components/bookdate/RecommendationCard.tsx` - Swipeable card
- `src/components/bookdate/LoadingScreen.tsx` - Loading animation
- `src/app/admin/settings/page.tsx` - Admin settings (BookDate tab)
- `src/app/setup/steps/BookDateStep.tsx` - Setup wizard step
- `src/components/layout/Header.tsx` - Navigation (conditional BookDate tab)

## Related

- Full requirements: [features/bookdate-prd.md](bookdate-prd.md)
- Authentication: [backend/services/auth.md](../backend/services/auth.md)
- Database: [backend/database.md](../backend/database.md)
- Setup wizard: [setup-wizard.md](../setup-wizard.md)
