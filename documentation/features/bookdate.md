# BookDate Feature

**Status:** ✅ Implemented | AI-powered audiobook recommendations with Tinder-style swipe interface

## Overview
Personalized audiobook discovery using OpenAI/Claude APIs. Admin configures AI provider globally. Users swipe through recommendations based on their individual Plex library + swipe history. Right swipe creates request, left rejects, up dismisses.

## Key Details
- **AI Providers:** OpenAI (GPT-4o+), Claude (Sonnet 4.5, Opus 4, Haiku)
- **Configuration:** Global admin-managed (provider, model, API key), per-user preferences (library scope, custom prompt)
- **Personalization:** Each user receives recommendations based on their own library, ratings, swipe history, and custom preferences
- **Library Scopes (per-user):**
  - Full library: All books in library (max 40 most recent)
  - Rated only: Only books the user has rated
    - Local admin: Uses cached ratings from system token
    - Plex users: Fetches 100 books, filters to user's rated books, returns top 40
- **Custom Prompt (per-user):** Optional preferences (max 1000 chars) to guide recommendations
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
- libraryScope (DEPRECATED: now per-user in User model)
- customPrompt (DEPRECATED: now per-user in User model)
- isVerified (admin tested connection), isEnabled (admin toggle)
```

### User (per-user preferences)
```prisma
- bookDateLibraryScope ('full' | 'rated', default: 'full')
- bookDateCustomPrompt (optional, max 1000 chars)
- bookDateOnboardingComplete (boolean, default: false)
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

**Global Configuration (Admin):**
- POST `/api/bookdate/test-connection` - Validate API key (saved or new), fetch models
  - **Auth:** Optional (unauthenticated during setup wizard, authenticated for saved keys in settings)
  - Supports `useSavedKey: true` to test with encrypted saved API key (requires authentication)
- GET `/api/bookdate/config` - Get global config (excluding API key) (All authenticated)
- POST `/api/bookdate/config` - Create/update global config (Admin only)
  - Accepts optional `apiKey` (only required for initial setup)
  - Includes `isEnabled` field for global admin toggle
- DELETE `/api/bookdate/config` - Delete global config (Admin only)
- DELETE `/api/bookdate/swipes` - Clear ALL users' swipe history (Admin only)

**User Preferences:**
- GET `/api/bookdate/preferences` - Get user's BookDate preferences (libraryScope, customPrompt, onboardingComplete) (All authenticated)
- PUT `/api/bookdate/preferences` - Update user's preferences (All authenticated)
  - Accepts `libraryScope` ('full' | 'rated'), `customPrompt` (max 1000 chars), and `onboardingComplete` (boolean)

**Recommendations:**
- GET `/api/bookdate/recommendations` - Return user's cached unswiped recommendations (All authenticated)
- POST `/api/bookdate/swipe` - Record user's swipe, create request + trigger search job if right+confirm (All authenticated)
- POST `/api/bookdate/undo` - Undo last swipe (left/up only) (All authenticated)
- POST `/api/bookdate/generate` - Force generate new batch (All authenticated)

## UI Components

**Pages:**
- `/bookdate` - Main swipe interface (mobile gestures + desktop buttons) + user preferences settings (All authenticated users)
  - **Onboarding Flow:** First-time users see settings modal before recommendations
- `/admin/settings` - BookDate global configuration tab (Admin only)
- Header navigation - BookDate tab visible to all authenticated users when admin has configured and enabled

**Components:**
- `RecommendationCard` - Swipeable card with 150px delta threshold, responsive height (max 80vh mobile, 85vh desktop)
  - Cover image scales dynamically (max 25vh mobile with 300px cap) to ensure all content fits
  - Mobile-optimized: Reduced padding, smaller text, line-clamped AI reason
- `SettingsWidget` - Per-user preferences modal (library scope, custom prompt) in `/bookdate` page
  - Supports onboarding mode with "Welcome" header and "Let's Go!" button
  - Cannot be closed during onboarding (no X button)
- `LoadingScreen` - Animated loading state
- Navigation tab - Shows to any user with verified configuration

## First-Time User Experience

**Onboarding Flow:**
1. User visits `/bookdate` for first time (bookDateOnboardingComplete=false)
2. Settings modal opens automatically with welcome message
3. User configures library scope and custom prompt preferences
4. User clicks "Let's Go!" button
5. Preferences saved with onboardingComplete=true
6. Modal closes, recommendations begin generating
7. Subsequent visits skip onboarding, load recommendations directly

## AI Prompt Flow

1. **Context Gathering:**
   - Get user's library books (max 40, filtered by scope)
     - **Local Admin Users:** Use cached ratings (from system Plex token configured during setup)
     - **Plex-Authenticated Users (including admins):** Fetch library with user's token to get personal ratings
   - Get recent swipes (max 10, prioritized: non-dismiss actions first, then dismissals)
     - Prioritizes most informative swipes: up to 10 likes/requests/dislikes (left/right swipes)
     - Fills remaining slots with most recent dismissals (up swipes)
     - Rationale: Non-dismiss actions provide stronger preference signals for AI recommendations
   - Add custom prompt if provided

2. **AI Call:**
   - OpenAI: `response_format: {type: "json_object"}`, system prompt enforces JSON
   - Claude: System prompt: "Return ONLY valid JSON"
   - Request: 20 recommendations (expect ~10 after filtering)

3. **Post-Processing:**
   - Match to Audnexus (database cache first, API fallback)
   - Filter: Already in library (uses centralized audiobook-matcher.ts - same as homepage), already requested, already swiped
   - Two-stage library filtering:
     - Stage 1: Fuzzy match with AI-provided title/author (before Audnexus)
     - Stage 2: ASIN + fuzzy match with Audnexus title/author (after Audnexus lookup)
   - Matching algorithm: Title normalization, ASIN matching, weighted scoring (title 70% + author 30%), 70% threshold
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
- Note: Library scope and custom prompt configured per-user after setup
- "Skip for now" + "Next" buttons
- Config saved in `/api/setup/complete` (optional, only if filled)

## Settings Pages

**Admin Settings (`/admin/settings` - BookDate Tab):**
- **Enable/Disable Toggle:** Global feature toggle (preserves all settings)
- **Provider Selection:** OpenAI or Claude
- **API Key:** Optional re-entry (leave blank to keep existing, required for initial setup)
  - Shows placeholder "••••••••" if already configured
- **Test Connection:** Uses saved API key if no new key entered
  - Button text changes to indicate using saved key
- **Model Selection:** Populated after successful test
- **Save:** Can save provider/model/enabled without re-testing
  - Testing only required when changing provider/API key/model
- **Clear Swipe History:** Button with confirmation dialog (clears ALL users' history)
- **Note:** Library scope and custom prompt are now per-user settings
- **Accessible to admins only**

**User Preferences (`/bookdate` page - Settings Icon):**
- **Library Scope:** Full library | Rated only (default: full)
- **Custom Prompt:** Optional preferences (max 1000 chars, default: blank)
- **Save:** Updates user's preferences immediately
- **Accessible to all authenticated users**

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
- **Plex-authenticated users (including admins):** Fetch library with server-specific access token
  - User's plex.tv OAuth token (from authToken) → `/api/v2/resources` with stored machineIdentifier → server access token
  - Per Plex API docs: plex.tv tokens are for plex.tv, server tokens are for PMS
  - Uses server access token to call `/library/sections/{id}/all` with user's personal ratings
  - Matches by plexGuid/ratingKey against cached library structure
  - ~1-2s fetch time for full library (only happens when generating recommendations)
  - scope='rated': Fetches 100 books, enriches with user ratings, filters to rated, returns top 40
    - Ensures user sees books THEY rated
  - **Security:** Users never access or decrypt the system Plex token (machineIdentifier stored in config)

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
- **Responsive Layout:** Optimized for mobile viewing
  - Card max 80vh (mobile) vs 85vh (desktop)
  - Cover image max 25vh (mobile, 300px cap) to fit all content on screen
  - Reduced padding (1rem mobile vs 1.5rem desktop)
  - Smaller text sizing on mobile
  - AI reason line-clamped to 3 lines to prevent overflow
  - Compact progress indicator and swipe hint spacing
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
- `prisma/schema.prisma` - Database models (User.bookDateOnboardingComplete, BookDateConfig, BookDateRecommendation, BookDateSwipe)
- `src/lib/bookdate/helpers.ts` - Helper functions (AI calling, matching, filtering)
- `src/app/api/bookdate/` - API routes (config, preferences, recommendations, swipe, undo, generate)
- `src/app/api/bookdate/preferences/route.ts` - User preferences API (GET, PUT with onboarding tracking)

**Frontend:**
- `src/app/bookdate/page.tsx` - Main swipe interface + onboarding flow + settings button
- `src/components/bookdate/RecommendationCard.tsx` - Swipeable card
- `src/components/bookdate/SettingsWidget.tsx` - Per-user preferences modal (supports onboarding mode)
- `src/components/bookdate/LoadingScreen.tsx` - Loading animation
- `src/app/admin/settings/page.tsx` - Admin settings (BookDate tab)
- `src/app/setup/steps/BookDateStep.tsx` - Setup wizard step
- `src/components/layout/Header.tsx` - Navigation (conditional BookDate tab)

## Fixed Issues ✅

**1. Setup Wizard Not Saving BookDate Configuration**
- Issue: After configuring BookDate in setup wizard, tab doesn't appear; must re-configure in settings
- User Experience: "I set it up in wizard, but have to go back to settings and re-enter everything"
- Cause: Setup completion route required `bookdate.libraryScope` field, but wizard step doesn't collect it (now per-user)
  - Condition: `if (bookdate && bookdate.provider && bookdate.apiKey && bookdate.model && bookdate.libraryScope)`
  - Wizard only collects: provider, apiKey, model (libraryScope/customPrompt are per-user preferences)
  - Config never saved, BookDate tab never appeared
- Fix: Removed `libraryScope` from required condition in setup completion route
  - Now checks: `if (bookdate && bookdate.provider && bookdate.apiKey && bookdate.model)`
  - Sets `libraryScope: 'full'` and `customPrompt: null` as defaults (backwards compatibility)
  - Config saves with `isVerified: true, isEnabled: true` → BookDate tab appears immediately
- Files updated: `src/app/api/setup/complete/route.ts:163-205`

**2. Onboarding Modal Showing After Empty State**
- Issue: First-time users saw empty state with "Generate More Recommendations" button instead of onboarding settings
- User Experience: "Didn't see onboarding, just empty state buttons. After generating, onboarding finally showed"
- Cause: Render logic checked empty recommendations before checking onboarding status
  - When `onboardingComplete=false`, page set `isOnboarding=true` but `recommendations.length === 0`
  - Empty state check ran before onboarding check, rendered "Get More Recommendations"
- Fix: Added dedicated onboarding state check before empty state check
  - New render order: Loading → Onboarding → Error → Empty → Normal
  - Onboarding state shows welcome message + settings modal immediately
  - After completion, modal closes and recommendations generate
- Files updated: `src/app/bookdate/page.tsx:233-258`

**3. Undo Restores Card at Front with Full Information**
- Issue: When undoing a dismiss/dislike, card appeared at back of stack with "Previously dismissed" and lost data
- User Experience: "When I undo, it gets added to the back of the stack and loses all info"
- Cause: Original implementation deleted recommendation on swipe, then recreated it with new timestamp
  - Swipe endpoint deleted BookDateRecommendation after creating swipe record
  - Undo endpoint tried to recreate from swipe data (only had title/author)
  - New createdAt timestamp put card at end when ordered by 'asc'
- Fix: Keep recommendations in database, filter by swipe status
  - Swipe endpoint no longer deletes recommendations (just creates swipe record)
  - Recommendations endpoint filters out any with associated swipes (`swipes: { none: {} }`)
  - Undo endpoint deletes swipe + updates createdAt to front of stack
  - All original data preserved (narrator, rating, description, coverUrl, aiReason, etc.)
- Files updated: `src/app/api/bookdate/swipe/route.ts`, `src/app/api/bookdate/undo/route.ts`, `src/app/api/bookdate/recommendations/route.ts`, `src/app/bookdate/page.tsx`

**4. Setup Wizard Auth Error on Test Connection**
- Issue: "Test Connection" in setup wizard fails with auth error, but works in settings with same API key
- User Experience: Unable to configure BookDate during initial setup wizard
- Cause: `/api/bookdate/test-connection` required authentication, but setup wizard runs before user login
  - Wizard tried to send Authorization header from localStorage (doesn't exist during setup)
  - Settings page works because user is already authenticated
- Fix: Modified endpoint to support optional authentication
  - Unauthenticated: Allowed during setup wizard (tests provided API key only)
  - Authenticated: Required when using `useSavedKey: true` in settings (accesses saved encrypted key)
  - Route checks for Authorization header presence to determine flow
  - Files updated: `src/app/api/bookdate/test-connection/route.ts`, `src/app/setup/steps/BookDateStep.tsx`

**5. Library Books Appearing in Recommendations**
- Issue: Books already in Plex library were being recommended despite filtering
- User Experience: "Getting books recommended by BookDate that are already in my library"
- Cause: `isInLibrary` used weak string `contains` matching instead of robust fuzzy matching
  - Didn't match title variations (e.g., "The Tenant" vs "The Tenant (Unabridged)")
  - Didn't support ASIN matching for exact identification
  - Didn't normalize titles (remove "(Unabridged)", "(Abridged)", etc.)
  - Used AND logic (both title and author must contain) instead of weighted scoring
- Fix: Updated BookDate filtering to use centralized `audiobook-matcher.ts` (same as homepage)
  - `isInLibrary()` now calls `findPlexMatch()` for consistent matching behavior
  - Two-stage filtering: fuzzy match before Audnexus, then ASIN + fuzzy match after
  - Title normalization: Removes "(Unabridged)", "(Abridged)", series numbers, etc.
  - ASIN exact matching: Checks plexGuid for exact ASIN (100% confidence)
  - Weighted scoring: title * 0.7 + author * 0.3 >= 0.7 threshold
  - Narrator support: Can match narrator to Plex author field
  - Files updated: `src/lib/bookdate/helpers.ts`, `src/app/api/bookdate/generate/route.ts`, `src/app/api/bookdate/recommendations/route.ts`

**6. Mobile Layout Cramped - AI Reason Overflow and Content Not Fitting**
- Issue: On mobile, AI reason text fell off card, full page content didn't fit (had to scroll between rating and swipe instructions)
- User Experience: "The AI 'reason' falls off the card and can't be read. The x/10 at top and swiping instructions at bottom don't fit, I have to scroll carefully to see them one at a time"
- Cause: Card and cover image were sized for desktop (85vh card, 40vh cover), leaving insufficient space for all mobile content
  - Cover image too large (40vh) consumed most of card height
  - Fixed text sizes and padding didn't scale down for mobile
  - AI reason box could overflow without line limiting
  - Page elements (progress, card, swipe hint) exceeded viewport height
- Fix: Implemented responsive mobile-first layout with dynamic scaling
  - Card height: 80vh (mobile) vs 85vh (desktop) for more breathing room
  - Cover image: 25vh max (mobile, 300px cap) vs 40vh (desktop) - 37.5% reduction
  - Responsive padding: 1rem (mobile) vs 1.5rem (desktop) throughout card
  - Responsive text sizing: smaller fonts on mobile (text-xs/sm/base vs text-sm/lg/xl)
  - AI reason: Added line-clamp-3 to prevent overflow, always visible
  - Page spacing: Reduced margins on progress indicator, swipe hint, undo button for mobile
  - Result: All content (rating, description, AI reason) fits within single viewport without scrolling
  - Files updated: `src/components/bookdate/RecommendationCard.tsx`, `src/app/bookdate/page.tsx`

**7. Generate Endpoint Returning Swiped Recommendations**
- Issue: Users saw same 10 recommendations repeatedly after clicking "Get More Recommendations"
- User Experience: "Seeing the same 10 recommendations over and over, but logs show different ones being generated"
- Cause: `/api/bookdate/generate` endpoint generated new recommendations correctly but final query didn't filter out swiped items
  - Line 147-151: `findMany({ where: { userId } })` returned ALL recommendations including swiped ones
  - Since ordered by `createdAt: 'asc'`, old swiped recommendations appeared first
  - New recommendations were generated but hidden behind old swiped ones
  - Contrast with `/api/bookdate/recommendations` which correctly filtered: `where: { userId, swipes: { none: {} } }`
- Fix: Added swipe filter to final query in generate endpoint
  - Updated query: `where: { userId, swipes: { none: {} } }`
  - Now returns only unswiped recommendations (including newly generated ones)
  - Consistent with recommendations endpoint filtering behavior
- Files updated: `src/app/api/bookdate/generate/route.ts:147-157`

## Related

- Full requirements: [features/bookdate-prd.md](bookdate-prd.md)
- Authentication: [backend/services/auth.md](../backend/services/auth.md)
- Database: [backend/database.md](../backend/database.md)
- Setup wizard: [setup-wizard.md](../setup-wizard.md)
- Matching algorithm: [../integrations/plex.md](../integrations/plex.md) (Fixed Issues #7)
