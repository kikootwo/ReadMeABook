# BookDate Feature

**Status:** ✅ Implemented | AI-powered audiobook recommendations with Tinder-style swipe interface

## Overview
Personalized audiobook discovery using OpenAI/Claude APIs. Users swipe through recommendations based on Plex library + preferences. Right swipe creates request, left rejects, up dismisses.

## Key Details
- **AI Providers:** OpenAI (GPT-4o+), Claude (Sonnet 4.5, Opus 4, Haiku)
- **Configuration:** Per-user, encrypted API keys (AES-256), stored in database
- **Library Scopes:** Full library | Listened (>25%) | Rated only
- **Context Window:** Max 50 books (40 library + 10 swipe history)
- **Cache:** 10 recommendations per user, persisted until swiped
- **Actions:**
  - Left swipe: Reject (can undo)
  - Right swipe: Request (shows confirmation toast: "Request" or "Mark as Known")
  - Up swipe: Dismiss (can undo)
- **Admin:** Global enable/disable toggle (preserves user configs)

## Database Models

### BookDateConfig (per user)
```prisma
- userId (unique)
- provider ('openai' | 'claude')
- apiKey (encrypted)
- model (e.g., 'gpt-4o', 'claude-sonnet-4-5-20250929')
- libraryScope ('full' | 'listened' | 'rated')
- customPrompt (optional)
- isVerified, isEnabled
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
- POST `/api/bookdate/test-connection` - Validate API key, fetch models
- GET/POST/DELETE `/api/bookdate/config` - User config management
- DELETE `/api/bookdate/swipes` - Clear swipe history
- PATCH `/api/admin/bookdate/toggle` - Admin enable/disable

**Recommendations:**
- GET `/api/bookdate/recommendations` - Get cached or generate new
- POST `/api/bookdate/swipe` - Record swipe, create request if right+confirm
- POST `/api/bookdate/undo` - Undo last swipe (left/up only)
- POST `/api/bookdate/generate` - Force generate new batch

## UI Components

**Pages:**
- `/bookdate` - Main swipe interface (mobile gestures + desktop buttons)
- `/admin/settings` - BookDate configuration tab (provider, API key, model, scope, prompt)
- `/setup` - Step 7 in setup wizard (optional, skip-able)

**Components:**
- `RecommendationCard` - Swipeable card with drag overlays (react-swipeable)
- `LoadingScreen` - Animated loading state
- Navigation tab - Shows only if configured + verified + enabled

## AI Prompt Flow

1. **Context Gathering:**
   - Get user's library books (max 40, filtered by scope)
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
1. User swipes right → Shows confirmation toast
2. User selects "Request" → Creates `Audiobook` + `Request` records
3. User selects "Mark as Known" → Records swipe only (no request)
4. Request appears in `/requests` page with status tracking

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

**Admin Settings (`/admin/settings` - BookDate Tab):**
- Same fields as wizard step
- Load existing config on mount (API key hidden for security)
- Save updates via POST `/api/bookdate/config`
- "Clear Swipe History" button (confirmation dialog)
- Accessible to all authenticated users (not just admins)

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

**Graceful Degradation:**
- Audnexus API down → Skip failed matches, show what matched
- Empty Plex library → Show warning, allow setup anyway
- No recommendations → Show empty state with "Get More" button

## Cache Strategy

- **Per-User:** Each user has separate cache
- **Invalidation:** Cleared when config changes or user clears manually
- **Persistence:** Remains until swiped (no expiration)
- **Refill:** Auto-generates more when <10 remaining

## Mobile UX

- **Touch Gestures:** Swipe left/right/up with visual feedback
- **Drag Overlay:** Green (right), Red (left), Blue (up) with emoji indicators
- **Rotation:** Card rotates slightly during drag
- **Snap Back:** Card returns if swipe canceled
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
