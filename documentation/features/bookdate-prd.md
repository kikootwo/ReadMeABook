# BookDate Feature - Product Requirements Document

**Status:** ⏳ Planning Phase
**Version:** 1.0
**Last Updated:** 2025-11-19
**Owner:** Product Team

---

## 1. Executive Summary

**What:** An AI-powered audiobook recommendation system that presents personalized suggestions in a Tinder-style swipe interface, learning from user preferences to provide increasingly accurate recommendations.

**Why:** Current audiobook discovery relies on manual browsing. BookDate leverages AI and user listening history to surface relevant audiobooks users might not discover otherwise, increasing engagement and library utilization.

**Target Users:** All ReadMeABook users (global admin-managed AI, per-user personalization based on individual library and swipe history)

---

## 2. Feature Overview

### Core Experience
1. **Setup:** Admin configures AI provider, API key, model, library scope, and custom prompt (global for all users)
2. **Discovery:** AI generates personalized audiobook recommendations based on each user's individual Plex library, ratings, and swipe history
3. **Interaction:** Swipe right (request), left (not interested), or up (neutral) on recommendations
4. **Learning:** AI refines future recommendations based on individual swipe history

### Key Differentiation
- **Personalized:** Recommendations based on each individual user's library, listening history, ratings, and swipe patterns
- **AI-Powered:** Leverages LLMs (OpenAI, Claude) for sophisticated matching
- **Engaging:** Tinder-style interface makes discovery fun and frictionless
- **Centrally Managed:** Admin configures AI once, all users benefit with personalized recommendations

---

## 3. User Personas

### Primary Persona: Active Listener
- **Profile:** Regularly listens to audiobooks, has completed 20+ books
- **Goal:** Discover new audiobooks similar to favorites without manual searching
- **Pain Point:** Overwhelmed by options, misses hidden gems

### Secondary Persona: Curator
- **Profile:** Admin managing family/friend Plex library
- **Goal:** Curate recommendations for diverse user preferences
- **Pain Point:** Different users have different tastes

---

## 4. Configuration Flow

### 4.1 Admin Settings Page

**Location:** /admin/settings → BookDate tab (Admin only)

**Access Control:** Only users with admin role can access and configure BookDate

UI Elements:
1. **Enable/Disable Toggle:** (visible when configured)
   - Toggle switch: Enable/Disable BookDate Feature
   - Label: "BookDate Feature"
   - Help text: "When enabled, all users can access BookDate recommendations. When disabled, the BookDate tab is hidden for all users."
2. **AI Provider Selection:**
   - Dropdown: OpenAI, Claude (Anthropic)
   - Label: "Choose AI Provider"
3. **API Key Input:**
   - Text field (password-style masking)
   - Label: "API Key"
   - Help text: "The API key is stored securely and encrypted. All users share this API key but receive personalized recommendations."
   - Placeholder: "sk-..." (OpenAI) or "sk-ant-..." (Claude)
   - Can leave blank to keep existing key when updating other settings
4. **Test Connection Button:**
   - Label: "Test Connection & Fetch Models"
   - Can test with saved API key or newly entered key
   - Action: Validates API key, fetches available models
   - Success: Enables model selection dropdown
   - Failure: Shows error message
5. **Model Selection:**
   - Dropdown: Populated by API response (e.g., "gpt-4o", "claude-sonnet-4-5")
   - Label: "Select Model"
   - Disabled until connection tested
6. **Library Scope:**
   - Radio buttons:
     - "Full Plex Library" (all audiobooks)
     - "Rated Books Only" (user-rated books)
   - Label: "Base Recommendations On"
7. **Custom Prompt (Optional):**
   - Textarea (3-4 rows)
   - Label: "Additional Preferences (Optional)"
   - Placeholder: "e.g., 'I prefer sci-fi with strong female leads' or 'No romance novels'"
   - Help text: "Provide any additional context to personalize recommendations"
8. **Clear All Swipe History:** (visible when configured)
   - Button: "Clear Swipe History"
   - Confirmation dialog: "This will clear all swipe history and cached recommendations for ALL users. Continue?"
   - Action: Clears all users' swipes and recommendations

**Validation:**
- API key required for initial setup
- Model and library scope always required
- API key optional when updating existing configuration (uses saved key)

**Visibility:** BookDate tab visible to all admins in /admin/settings

---

## 5. BookDate Tab Visibility

### Display Rules
- **Show Tab:** Global BookDate configuration exists AND is verified AND is enabled
  - Required: Provider, API key, model, library scope configured by admin
  - Optional: Custom prompt (can be empty)
  - All authenticated users see the tab when these conditions are met
- **Hide Tab:** Configuration missing, unverified, or disabled by admin

### Verification Status
- Stored globally in database (single configuration for all users)
- Re-verification not required on subsequent visits (trust stored config)
- If API call fails during use, show error (don't hide tab)

---

## 6. Recommendation Engine

### 6.1 AI Prompt Generation

**Context Selection Logic:**
- **Max Context Books:** 50 books
- **Context Weighting:**
  - If user has ≤50 books in selected scope: Include all
  - If user has >50 books in selected scope:
    - 40 latest added books (80%)
    - 10 latest swipes (20% - includes both left/right swipes for preference learning)
  - If user has 0 books in selected scope: Fallback to full library (with warning)

**Prompt Structure (JSON format):**

```json
{
  "task": "recommend_audiobooks",
  "user_context": {
    "library_books": [
      {
        "title": "Project Hail Mary",
        "author": "Andy Weir",
        "narrator": "Ray Porter",
        "rating": 5
      }
      // ... up to 40 books
    ],
    "swipe_history": [
      {
        "title": "The Martian",
        "author": "Andy Weir",
        "user_action": "requested"
      },
      {
        "title": "Twilight",
        "author": "Stephenie Meyer",
        "user_action": "rejected"
      }
      // ... up to 10 swipes
    ],
    "custom_preferences": "User's custom prompt text here (if provided)"
  },
  "instructions": "Based on the user's library and swipe history, recommend 20 audiobooks they would enjoy. Important rules:\n1. DO NOT recommend any books already in the user's library\n2. DO NOT recommend any books from the swipe history (whether requested, rejected, or dismissed)\n3. Focus on variety and quality\n4. Consider user ratings if available (0-10 scale, higher = liked more)\n5. Learn from rejected books to avoid similar recommendations\n6. Learn from requested books to find similar ones\nReturn ONLY valid JSON with no additional text or formatting.",
  "response_format": {
    "recommendations": [
      {
        "title": "string",
        "author": "string",
        "reason": "1-2 sentence explanation"
      }
    ]
  }
}
```

**AI Provider-Specific Adjustments:**
- OpenAI: Use `response_format: { type: "json_object" }` parameter
- Claude: Include "Return ONLY valid JSON, no additional text" in instructions

**Request Count:** Ask for 20 recommendations (expect to filter down to 10 usable)

### 6.2 Recommendation Filtering

**Post-AI Filtering (in order):**
1. **Audnexus Matching:** Match AI recommendation to Audnexus metadata
   - If no match: Skip silently, log warning with title/author
2. **Already in Library:** Check against user's Plex library
   - If exists: Skip
3. **Already Requested:** Check against user's request history
   - If requested: Skip
4. **Already Swiped:** Check against user's swipe history (any direction)
   - If swiped: Skip

**Target:** 10 successfully matched and filtered recommendations per batch

### 6.3 Caching Strategy

**Cache Behavior:**
- Store un-swiped recommendations in database per user
- On BookDate tab visit: Check for cached recommendations first
- If cached available: Show cached (no API call)
- If cached <10: Generate new batch to replenish
- If cached =0: Generate new batch

**Cache Invalidation:**
- User swipes on recommendation: Remove from cache
- User changes BookDate settings: Clear all cached recommendations
- Cache never expires (only removed by swipe or settings change)

---

## 7. User Interface

### 7.1 Loading State

**Initial Load (no cached recommendations):**
- Animated loading screen
- Animation: Book cover cards flying/shuffling (whimsical, well-animated)
- Duration: Until recommendations ready (typically 2-5 seconds)
- Text: "Finding your next great listen..."

### 7.2 Recommendation Card

**Card Layout:**
```
┌─────────────────────────────┐
│                             │
│      [Cover Image]          │
│        (Large)              │
│                             │
├─────────────────────────────┤
│ Title (Bold, 18px)          │
│ Author (Gray, 14px)         │
│ Narrator (Gray, 12px)       │
├─────────────────────────────┤
│ ⭐ 4.5 (Rating)             │
├─────────────────────────────┤
│ Short Description           │
│ (3-4 lines, expandable)     │
│ [Read more...]              │
└─────────────────────────────┘
```

**Field Availability:**
- Title: Always shown
- Author: Always shown
- Cover: Show if available, placeholder if not
- Narrator: Show if available
- Rating: Show if available
- Description: Show if available

### 7.3 Swipe Mechanics

**Mobile (Touch):**
- **Swipe Right:** Request audiobook → Confirmation toast
- **Swipe Left:** Not interested → Next card
- **Swipe Up:** Neutral/dismiss → Next card
- **Visual Feedback:**
  - Card follows finger during drag
  - Green overlay on right drag
  - Red overlay on left drag
  - Blue overlay on up drag
  - Snap back if drag canceled

**Desktop (Buttons):**
```
┌─────────────────────────────────────┐
│                                     │
│         [Recommendation Card]       │
│                                     │
└─────────────────────────────────────┘
    [❌ Not Interested]  [⬆️ Dismiss]  [✅ Request]
```

- Buttons positioned below card
- Same actions as mobile swipes
- Keyboard shortcuts (optional enhancement):
  - Left arrow: Not interested
  - Up arrow: Dismiss
  - Right arrow: Request

### 7.4 Request Confirmation Toast

**Trigger:** User swipes right (mobile) or clicks "Request" (desktop)

**Toast Content:**
```
┌─────────────────────────────────────────┐
│  Do you want to request "[Book Title]"? │
│                                         │
│  Or have you already read/listened      │
│  to it elsewhere?                       │
│                                         │
│  [Mark as Known] [Request] [Cancel]     │
└─────────────────────────────────────────┘
```

**Actions:**
- **Request:** Adds to request queue, records "right" swipe, shows next card
- **Mark as Known:** Records "right" swipe only (no request), shows next card
- **Cancel:** No action, returns to card

**Toast Duration:** Persistent until user chooses (not auto-dismiss)

### 7.5 Undo Functionality

**Left/Up Swipes Only:**
- Small "Undo" button appears briefly (3 seconds) after swipe
- Position: Bottom-left corner
- Action: Restores previous card, removes swipe from history
- UX: Subtle slide-up animation

**Right Swipes:**
- No undo (already confirmed via toast)

### 7.6 Empty State

**Trigger:** User reaches end of cached + newly generated recommendations

**Message:**
```
┌─────────────────────────────────────┐
│                                     │
│   🎉 You've seen all our current    │
│      recommendations!               │
│                                     │
│   Want more suggestions?            │
│                                     │
│   [Get More] [Go Home]              │
└─────────────────────────────────────┘
```

**Actions:**
- **Get More:** Generates new batch of 10 recommendations
- **Go Home:** Redirects to home page

---

## 8. Technical Requirements

### 8.1 Data Models

**BookDateConfig (global singleton - one record for entire system):**
```typescript
{
  id: string; // Single record
  provider: 'openai' | 'claude';
  apiKey: string; // Encrypted at rest (AES-256), shared by all users
  model: string; // e.g., 'gpt-4o', 'claude-sonnet-4-5'
  libraryScope: 'full' | 'rated';
  customPrompt?: string;
  isVerified: boolean; // Admin has tested connection
  isEnabled: boolean; // Admin-controlled global toggle
  createdAt: Date;
  updatedAt: Date;
}
// Note: No userId - this is a global configuration managed by admins
```

**BookDateRecommendation (cached):**
```typescript
{
  id: string;
  userId: string;
  batchId: string; // Groups recommendations from same AI call
  title: string;
  author: string;
  narrator?: string;
  rating?: number;
  description?: string;
  coverUrl?: string;
  audnexusAsin?: string; // For matching
  aiReason: string; // Why AI recommended this
  createdAt: Date;
  expiresAt?: Date; // NULL = never expires (manual invalidation only)
}
```

**BookDateSwipe (history):**
```typescript
{
  id: string;
  userId: string;
  recommendationId?: string; // NULL if book not from BookDate
  bookTitle: string;
  bookAuthor: string;
  action: 'left' | 'right' | 'up';
  markedAsKnown: boolean; // True if user chose "Mark as Known" in toast
  createdAt: Date;
}
```

### 8.2 API Endpoints

**Configuration (Admin only - except GET):**
- `POST /api/bookdate/config` - Create/update global BookDate config (Admin only)
- `GET /api/bookdate/config` - Get global BookDate config (excluding API key) (All authenticated users)
- `POST /api/bookdate/test-connection` - Validate API key, return available models (All authenticated users - admins use for setup)
- `DELETE /api/bookdate/config` - Delete global BookDate config (Admin only)
- `DELETE /api/bookdate/swipes` - Clear ALL users' swipe history (Admin only)

**Recommendations (All authenticated users):**
- `GET /api/bookdate/recommendations` - Get current recommendations for user (cached or generate)
  - Uses global config but returns personalized recommendations based on user's library/swipes
  - Response: Array of 10 recommendations
- `POST /api/bookdate/swipe` - Record swipe action for current user
  - Body: `{ recommendationId, action, markedAsKnown? }`
- `POST /api/bookdate/undo` - Undo last swipe (left/up only)
- `POST /api/bookdate/generate` - Force generate new batch (for "Get More" button)

### 8.3 AI Provider Integration

**OpenAI API:**
- Endpoint: `https://api.openai.com/v1/chat/completions`
- Model List: `https://api.openai.com/v1/models`
- Headers: `Authorization: Bearer {apiKey}`
- Response Format: `response_format: { type: "json_object" }`

**Claude (Anthropic) API:**
- Endpoint: `https://api.anthropic.com/v1/messages`
- Model List: `https://api.anthropic.com/v1/models` (or hardcoded list)
- Headers: `x-api-key: {apiKey}`, `anthropic-version: 2023-06-01`
- JSON enforcement: Via system prompt

### 8.4 Audnexus Matching

**Matching Strategy:**
1. Search Audnexus by title + author
2. Fuzzy match if exact match fails (Levenshtein distance <3)
3. If multiple results: Pick best match by popularity/rating
4. If no match: Skip recommendation, log warning

**Data Extraction:**
- Title, Author: From AI response
- Narrator, Rating, Description, Cover: From Audnexus
- ASIN: Store for future reference

### 8.5 Plex Library Integration

**Rated Books Detection:**
- Query Plex API for audiobooks with user ratings (`userRating` field)
- Filter: Only books with `userRating NOT NULL`
- User ratings in Plex use a 0-10 scale

**Full Library:**
- Query all audiobooks (no filter)

---

## 9. Error Handling

### 9.1 Configuration Errors

**Invalid API Key:**
- Show error: "Invalid API key. Please check and try again."
- Don't save configuration

**API Connection Failed:**
- Show error: "Could not connect to {provider}. Check your API key and internet connection."
- Don't save configuration

**Model Fetch Failed:**
- Show error: "Could not fetch available models. Please try again."
- Allow manual model entry (text input) as fallback

### 9.2 Recommendation Generation Errors

**AI API Call Failed:**
- Check for cached recommendations
- If cached available: Show cached
- If no cache: Show error message
  ```
  ┌─────────────────────────────────────┐
  │  ⚠️ Could not load recommendations  │
  │                                     │
  │  Error: [Error message]             │
  │                                     │
  │  [Try Again] [Go to Settings]       │
  └─────────────────────────────────────┘
  ```
- Log error details for debugging

**Invalid JSON Response:**
- Log full response for debugging
- Show user-friendly error: "Unexpected response from AI. Please try again."
- Retry once automatically, then show error

**All Recommendations Filtered Out:**
- If <10 recommendations after filtering: Generate additional batch
- If still <10: Show what we have
- If 0 recommendations: Show message
  ```
  ┌─────────────────────────────────────┐
  │  🤔 Couldn't find new               │
  │     recommendations right now.      │
  │                                     │
  │  Try adjusting your settings or     │
  │  check back later!                  │
  │                                     │
  │  [Go to Settings] [Go Home]         │
  └─────────────────────────────────────┘
  ```

### 9.3 Audnexus Matching Errors

**No Match Found:**
- Skip recommendation silently
- Log: `[BookDate] No Audnexus match: "${title}" by ${author}`
- Continue with next recommendation

**Audnexus API Down:**
- Show error if all 20 recommendations fail to match
- Otherwise: Skip failed matches, show what matched

---

## 10. Security & Privacy

### 10.1 API Key Storage
- **Encryption at rest:** API key encrypted in database using AES-256
- **No logging:** Never log API keys (even in error logs)
- **Admin-managed:** Single global API key configured by admin, shared by all users
- **Secure transmission:** API key never sent to client (stored server-side only)

### 10.2 Per-User Isolation
- All recommendation queries filtered by `userId`
- Users never see other users' swipes, ratings, or recommendations
- Cache is per-user (each user has their own cached recommendations)
- Swipe history is per-user (AI uses individual swipe patterns for personalization)
- Plex library data is per-user (AI sees only the requesting user's library)

### 10.3 Admin Controls
- Global enable/disable toggle (hides BookDate tab for all users when disabled)
- Admin configures single global AI provider/key/model
- Admin can clear all users' swipe history (affects everyone's recommendations)
- Admin can't see decrypted API key after initial save (write-only)

---

## 11. Success Metrics

### Primary Metrics
1. **Adoption Rate:** % of users who complete BookDate setup
2. **Engagement Rate:** % of configured users who visit BookDate tab weekly
3. **Request Conversion:** % of right swipes that become actual requests
4. **Discovery Rate:** % of requests from BookDate vs. manual browsing

### Secondary Metrics
1. **Swipe Distribution:** Ratio of right:left:up swipes (indicates recommendation quality)
2. **Batch Completion Rate:** % of users who swipe through full 10-recommendation batch
3. **Return Rate:** % of users who click "Get More" at end of batch

### Quality Metrics
1. **Audnexus Match Rate:** % of AI recommendations successfully matched
2. **API Error Rate:** % of recommendation requests that fail
3. **Cache Hit Rate:** % of visits served from cache vs. new generation

---

## 12. Future Enhancements (Out of Scope for v1)

1. **Multi-AI Voting:** Query multiple AI models, aggregate recommendations
2. **Social Features:** See what friends are swiping on (opt-in)
3. **Advanced Filtering:** Exclude genres, narrator preferences, length preferences
4. **Recommendation Reasoning:** Show AI's reasoning in card detail view
5. **Listening Goals:** "Find me books under 10 hours" or "Epic fantasy series"
6. **Swipe Analytics:** Personal stats (e.g., "You swipe right on 30% of sci-fi")

---

## 13. Implementation Checklist

### Phase 1: Configuration (Week 1)
- [ ] Database schema (BookDateConfig, BookDateRecommendation, BookDateSwipe)
- [ ] Wizard step UI (skip-able)
- [ ] Settings page section
- [ ] API key encryption
- [ ] OpenAI integration (test connection, fetch models)
- [ ] Claude integration (test connection, fetch models)
- [ ] Admin enable/disable toggle

### Phase 2: Recommendation Engine (Week 2)
- [ ] Context selection logic (40 latest + 10 swipes)
- [ ] AI prompt generation (JSON format)
- [ ] OpenAI API call + JSON parsing
- [ ] Claude API call + JSON parsing
- [ ] Audnexus matching logic
- [ ] Filtering (library, requests, swipes)
- [ ] Caching system (per-user)

### Phase 3: UI/UX (Week 3)
- [ ] BookDate tab (conditional visibility)
- [ ] Loading screen animation
- [ ] Recommendation card component
- [ ] Mobile swipe gestures (left/right/up)
- [ ] Desktop button controls
- [ ] Request confirmation toast
- [ ] Undo button (left/up swipes)
- [ ] Empty state (end of recommendations)

### Phase 4: Integration & Polish (Week 4)
- [ ] Plex library integration (full/listened/rated)
- [ ] Listen percentage calculation (>25%)
- [ ] Request queue integration
- [ ] Error handling (all scenarios)
- [ ] Logging (errors, matches, swipes)
- [ ] Testing (unit, integration, e2e)
- [ ] Documentation update

### Phase 5: Testing & Launch
- [ ] Beta testing with trusted users
- [ ] Monitor error logs
- [ ] Gather feedback on recommendation quality
- [ ] Adjust context weights if needed
- [ ] Production launch

---

## 14. Open Questions

1. **Rate Limiting:** Should we track API usage per user and warn if excessive?
2. **Cost Estimation:** Should we estimate token costs and show users?
3. **Model Recommendations:** Should we suggest specific models based on use case?
4. **Prompt Engineering:** Should we A/B test different prompt formats?
5. **Recommendation Diversity:** Should we force diversity (different genres/authors)?

---

## 15. Appendix

### A. Example AI Prompts

**OpenAI (gpt-4o):**
```json
{
  "model": "gpt-4o",
  "response_format": { "type": "json_object" },
  "messages": [
    {
      "role": "system",
      "content": "You are an expert audiobook recommender. Analyze user's library and preferences to suggest audiobooks they'll love. Return ONLY valid JSON."
    },
    {
      "role": "user",
      "content": "{prompt from section 6.1}"
    }
  ]
}
```

**Claude (claude-sonnet-4-5):**
```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 2048,
  "messages": [
    {
      "role": "user",
      "content": "{prompt from section 6.1}\n\nReturn ONLY valid JSON with no additional text or formatting."
    }
  ]
}
```

### B. Database Indexes

**Performance Optimization:**
```sql
CREATE INDEX idx_bookdate_recommendations_user_batch ON BookDateRecommendation(userId, batchId);
CREATE INDEX idx_bookdate_swipes_user_created ON BookDateSwipe(userId, createdAt DESC);
CREATE INDEX idx_bookdate_config_user ON BookDateConfig(userId);
```

### C. Token Estimation

**Average Prompt Size:**
- 40 library books × 100 tokens/book = 4,000 tokens
- 10 swipe history × 20 tokens/swipe = 200 tokens
- Custom prompt: ~100 tokens
- Instructions: ~200 tokens
- **Total Input: ~4,500 tokens**

**Average Response Size:**
- 20 recommendations × 50 tokens/rec = 1,000 tokens
- **Total Output: ~1,000 tokens**

**Cost per Batch (GPT-4o example):**
- Input: 4,500 tokens × $0.005/1k = $0.0225
- Output: 1,000 tokens × $0.015/1k = $0.015
- **Total: ~$0.04 per batch**

---

**End of PRD**
