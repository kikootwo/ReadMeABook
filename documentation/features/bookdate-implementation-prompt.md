# BookDate Feature - AI Agent Implementation Prompt

## Task Overview

Implement the **BookDate** feature for ReadMeABook - an AI-powered audiobook recommendation system with a Tinder-style swipe interface. This is a complete 0-to-MVP implementation covering backend, frontend, database, and integration work.

**PRD Location:** `/home/user/ReadMeABook/documentation/features/bookdate-prd.md`

**Goal:** Deliver a working MVP where users can:
1. Configure AI provider (OpenAI/Claude) in setup wizard or settings
2. View personalized audiobook recommendations in a swipeable interface
3. Swipe right to request, left to reject, up to dismiss
4. Have recommendations improve based on their Plex library and swipe history

---

## Project Context

### Tech Stack
- **Frontend:** Next.js 14+, TypeScript, Tailwind CSS
- **Backend:** Next.js API routes (Node.js/Express patterns)
- **Database:** PostgreSQL with Prisma ORM
- **Deployment:** Single Docker container
- **File Structure:** `src/app/` for pages, `src/components/` for UI, `src/lib/` for utilities

### Existing Patterns to Follow

**Database:**
- Schema defined in `prisma/schema.prisma`
- Use `prisma db push` for schema sync (no migrations)
- Prisma client output: `src/generated/prisma`
- Encrypted fields: Use AES-256 for API keys (see `backend/services/config.md`)

**API Routes:**
- Location: `src/app/api/[feature]/route.ts`
- Auth middleware: `requireAuth()`, `requireAdmin()` (see `backend/services/auth.md`)
- Response format: `NextResponse.json({...})`

**Frontend:**
- Route groups: `(user)` for user pages, `(admin)` for admin
- Protected routes: Wrap with auth check (see `frontend/routing-auth.md`)
- Components: Reusable in `src/components/`, page-specific in `src/app/[page]/`
- Styling: Tailwind CSS, dark mode support

**Setup Wizard:**
- Location: `src/app/setup/`
- 8-step pattern with progress indicator
- Current steps: Welcome, Admin, Plex, Prowlarr, Download Client, Paths, Review, Finalize
- BookDate should be inserted as **step 7** (after Paths validation, before Review)
- Steps are components: `WelcomeStep.tsx`, `AdminStep.tsx`, etc.
- State management: Local state passed between steps
- See `documentation/setup-wizard.md` for structure

### Key Documentation to Reference

**MANDATORY - Read First:**
- `documentation/TABLEOFCONTENTS.md` - Navigation guide (read THIS first)
- `documentation/features/bookdate-prd.md` - Complete feature requirements

**For Implementation:**
- `documentation/backend/database.md` - Schema patterns, encryption
- `documentation/backend/services/auth.md` - Auth middleware usage
- `documentation/setup-wizard.md` - Wizard integration patterns
- `documentation/settings-pages.md` - Settings UI patterns
- `documentation/frontend/components.md` - UI component catalog
- `documentation/integrations/plex.md` - Plex API integration patterns

---

## Implementation Phases

### Phase 1: Database Schema (Priority: Critical)

**Create new Prisma models in `prisma/schema.prisma`:**

```prisma
model BookDateConfig {
  id            String   @id @default(uuid())
  userId        String   @unique
  provider      String   // 'openai' | 'claude'
  apiKey        String   // Encrypted at rest
  model         String   // e.g., 'gpt-4o', 'claude-sonnet-4-5'
  libraryScope  String   // 'full' | 'listened' | 'rated'
  customPrompt  String?
  isVerified    Boolean  @default(false)
  isEnabled     Boolean  @default(true) // Admin toggle (global)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model BookDateRecommendation {
  id             String    @id @default(uuid())
  userId         String
  batchId        String    // Group recommendations from same AI call
  title          String
  author         String
  narrator       String?
  rating         Float?
  description    String?
  coverUrl       String?
  audnexusAsin   String?   // For matching
  aiReason       String    // Why AI recommended this
  createdAt      DateTime  @default(now())

  user   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  swipes BookDateSwipe[]

  @@index([userId, batchId])
  @@index([userId, createdAt])
}

model BookDateSwipe {
  id               String    @id @default(uuid())
  userId           String
  recommendationId String?   // NULL if book not from BookDate
  bookTitle        String
  bookAuthor       String
  action           String    // 'left' | 'right' | 'up'
  markedAsKnown    Boolean   @default(false) // True if "Mark as Known"
  createdAt        DateTime  @default(now())

  user           User                     @relation(fields: [userId], references: [id], onDelete: Cascade)
  recommendation BookDateRecommendation?  @relation(fields: [recommendationId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([recommendationId])
}
```

**User model update:**
Add relationships:
```prisma
model User {
  // ... existing fields ...
  bookDateConfig         BookDateConfig?
  bookDateRecommendations BookDateRecommendation[]
  bookDateSwipes         BookDateSwipe[]
}
```

**After schema changes:**
1. Run `npx prisma db push` to sync schema
2. Run `npx prisma generate` to regenerate client
3. Verify in database that tables created correctly

**Encryption:**
- API keys in `BookDateConfig.apiKey` MUST be encrypted
- Use existing encryption utility (see `backend/services/config.md`)
- Pattern: `encrypt(apiKey)` before save, `decrypt(apiKey)` on read

---

### Phase 2: Backend API - Configuration (Priority: Critical)

**Create API routes in `src/app/api/bookdate/`:**

#### 2.1 Test Connection & Fetch Models

**File:** `src/app/api/bookdate/test-connection/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth'; // Adjust path as needed

export async function POST(req: NextRequest) {
  // Auth check
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider, apiKey } = await req.json();

  // Validate inputs
  if (!provider || !apiKey) {
    return NextResponse.json({ error: 'Provider and API key required' }, { status: 400 });
  }

  try {
    let models = [];

    if (provider === 'openai') {
      // OpenAI: Fetch models from https://api.openai.com/v1/models
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!response.ok) {
        return NextResponse.json({ error: 'Invalid OpenAI API key' }, { status: 400 });
      }

      const data = await response.json();
      // Filter to relevant models (gpt-4o, gpt-4-turbo, etc.)
      models = data.data
        .filter((m: any) => m.id.startsWith('gpt-'))
        .map((m: any) => ({ id: m.id, name: m.id }));

    } else if (provider === 'claude') {
      // Claude: Hardcoded list (Anthropic doesn't have a models API endpoint)
      models = [
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      ];

      // Test connection with a simple API call
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        })
      });

      if (!response.ok) {
        return NextResponse.json({ error: 'Invalid Claude API key' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    return NextResponse.json({ success: true, models });

  } catch (error: any) {
    console.error('[BookDate] Test connection error:', error);
    return NextResponse.json({ error: error.message || 'Connection failed' }, { status: 500 });
  }
}
```

#### 2.2 Save/Update Configuration

**File:** `src/app/api/bookdate/config/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma'; // Adjust path
import { encrypt, decrypt } from '@/lib/encryption'; // Adjust path

// GET: Fetch user's config (excluding API key)
export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await prisma.bookDateConfig.findUnique({
    where: { userId: user.id }
  });

  if (!config) {
    return NextResponse.json({ config: null });
  }

  // Don't return API key
  const { apiKey, ...safeConfig } = config;

  return NextResponse.json({ config: safeConfig });
}

// POST: Create/update config
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider, apiKey, model, libraryScope, customPrompt } = await req.json();

  // Validation
  if (!provider || !apiKey || !model || !libraryScope) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!['openai', 'claude'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  if (!['full', 'listened', 'rated'].includes(libraryScope)) {
    return NextResponse.json({ error: 'Invalid library scope' }, { status: 400 });
  }

  try {
    // Encrypt API key
    const encryptedApiKey = encrypt(apiKey);

    // Upsert config
    const config = await prisma.bookDateConfig.upsert({
      where: { userId: user.id },
      update: {
        provider,
        apiKey: encryptedApiKey,
        model,
        libraryScope,
        customPrompt: customPrompt || null,
        isVerified: true,
        updatedAt: new Date()
      },
      create: {
        userId: user.id,
        provider,
        apiKey: encryptedApiKey,
        model,
        libraryScope,
        customPrompt: customPrompt || null,
        isVerified: true
      }
    });

    // Clear cached recommendations when config changes
    await prisma.bookDateRecommendation.deleteMany({
      where: { userId: user.id }
    });

    return NextResponse.json({ success: true, config: { ...config, apiKey: undefined } });

  } catch (error: any) {
    console.error('[BookDate] Save config error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Remove config
export async function DELETE(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.bookDateConfig.delete({
    where: { userId: user.id }
  });

  return NextResponse.json({ success: true });
}
```

#### 2.3 Admin Toggle (Global Enable/Disable)

**File:** `src/app/api/admin/bookdate/toggle/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { isEnabled } = await req.json();

  // Update all configs
  await prisma.bookDateConfig.updateMany({
    data: { isEnabled }
  });

  return NextResponse.json({ success: true, isEnabled });
}
```

---

### Phase 3: Backend API - Recommendations (Priority: Critical)

#### 3.1 Helper Functions

**File:** `src/lib/bookdate/helpers.ts`

Create utility functions:

```typescript
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';

// Get user's Plex library books based on scope
export async function getUserLibraryBooks(userId: string, scope: 'full' | 'listened' | 'rated') {
  // Query Plex API or database cache
  // For 'full': Return all audiobooks in user's Plex library
  // For 'listened': Filter by viewOffset/duration > 25%
  // For 'rated': Filter by user ratings > 0

  // Implementation note: Use existing Plex integration patterns
  // See documentation/integrations/plex.md

  // Return format:
  return [
    {
      title: 'Example Book',
      author: 'Author Name',
      narrator: 'Narrator Name',
      genres: ['Fiction', 'Sci-Fi'],
      rating: 4.5,
      listenStatus: 'completed' // or 'partial', 'unplayed'
    }
    // ... up to 40 latest books
  ];
}

// Get user's recent swipes
export async function getUserRecentSwipes(userId: string, limit: number = 10) {
  const swipes = await prisma.bookDateSwipe.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      bookTitle: true,
      bookAuthor: true,
      action: true,
      createdAt: true
    }
  });

  return swipes.map(s => ({
    title: s.bookTitle,
    author: s.bookAuthor,
    action: s.action
  }));
}

// Build AI prompt
export async function buildAIPrompt(userId: string, config: any) {
  const { libraryScope, customPrompt } = config;

  // Get context (max 50 books)
  const libraryBooks = await getUserLibraryBooks(userId, libraryScope);
  const swipeHistory = await getUserRecentSwipes(userId, 10);

  // Determine split (40 library + 10 swipes, adjust if needed)
  const maxLibraryBooks = Math.min(libraryBooks.length, 40);
  const contextBooks = libraryBooks.slice(0, maxLibraryBooks);

  const prompt = {
    task: 'recommend_audiobooks',
    user_context: {
      library_books: contextBooks,
      swipe_history: swipeHistory,
      custom_preferences: customPrompt || null
    },
    instructions: 'Based on the user\'s library and swipe history, recommend 20 audiobooks they would enjoy. Exclude books already in their library. Focus on variety and quality. Return ONLY valid JSON.',
    response_format: {
      recommendations: [
        {
          title: 'string',
          author: 'string',
          reason: '1-2 sentence explanation'
        }
      ]
    }
  };

  return JSON.stringify(prompt);
}

// Call AI API
export async function callAI(provider: string, model: string, apiKey: string, prompt: string) {
  const decryptedKey = decrypt(apiKey);

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an expert audiobook recommender. Return ONLY valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);

  } else if (provider === 'claude') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': decryptedKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nReturn ONLY valid JSON with no additional text or formatting.`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    return JSON.parse(content);
  }

  throw new Error('Invalid provider');
}

// Match AI recommendation to Audnexus
export async function matchToAudnexus(title: string, author: string) {
  // Search Audnexus API for title + author
  // Use existing Audnexus integration patterns
  // Return metadata or null if no match

  // Implementation note: Similar to existing Audible search
  // See integrations/audible.md or existing Audible API code

  return {
    asin: 'B0XXXXXX',
    title: 'Matched Title',
    author: 'Matched Author',
    narrator: 'Narrator Name',
    rating: 4.5,
    description: 'Book description...',
    coverUrl: 'https://...'
  };
}
```

#### 3.2 Get Recommendations

**File:** `src/app/api/bookdate/recommendations/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildAIPrompt, callAI, matchToAudnexus } from '@/lib/bookdate/helpers';

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check for cached recommendations
    const cached = await prisma.bookDateRecommendation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 10
    });

    if (cached.length >= 10) {
      return NextResponse.json({ recommendations: cached, source: 'cache' });
    }

    // Need to generate new recommendations
    const config = await prisma.bookDateConfig.findUnique({
      where: { userId: user.id }
    });

    if (!config || !config.isVerified || !config.isEnabled) {
      return NextResponse.json({ error: 'BookDate not configured' }, { status: 400 });
    }

    // Build prompt and call AI
    const prompt = await buildAIPrompt(user.id, config);
    const aiResponse = await callAI(config.provider, config.model, config.apiKey, prompt);

    if (!aiResponse.recommendations || !Array.isArray(aiResponse.recommendations)) {
      throw new Error('Invalid AI response format');
    }

    // Match to Audnexus and filter
    const batchId = `batch_${Date.now()}`;
    const matched = [];

    for (const rec of aiResponse.recommendations) {
      // Check if already in library (skip)
      // Check if already requested (skip)
      // Check if already swiped (skip)
      const alreadySwiped = await prisma.bookDateSwipe.findFirst({
        where: {
          userId: user.id,
          bookTitle: rec.title,
          bookAuthor: rec.author
        }
      });

      if (alreadySwiped) continue;

      // Match to Audnexus
      try {
        const audnexusMatch = await matchToAudnexus(rec.title, rec.author);
        if (!audnexusMatch) {
          console.warn(`[BookDate] No Audnexus match: "${rec.title}" by ${rec.author}`);
          continue;
        }

        matched.push({
          userId: user.id,
          batchId,
          title: audnexusMatch.title,
          author: audnexusMatch.author,
          narrator: audnexusMatch.narrator,
          rating: audnexusMatch.rating,
          description: audnexusMatch.description,
          coverUrl: audnexusMatch.coverUrl,
          audnexusAsin: audnexusMatch.asin,
          aiReason: rec.reason
        });

        if (matched.length >= 10) break;

      } catch (error) {
        console.warn(`[BookDate] Match error for "${rec.title}":`, error);
        continue;
      }
    }

    // Save to database
    if (matched.length > 0) {
      await prisma.bookDateRecommendation.createMany({
        data: matched
      });
    }

    // Combine with existing cache
    const allRecommendations = await prisma.bookDateRecommendation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 10
    });

    return NextResponse.json({
      recommendations: allRecommendations,
      source: 'generated',
      generatedCount: matched.length
    });

  } catch (error: any) {
    console.error('[BookDate] Recommendations error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

#### 3.3 Record Swipe

**File:** `src/app/api/bookdate/swipe/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { recommendationId, action, markedAsKnown } = await req.json();

  if (!recommendationId || !action) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  if (!['left', 'right', 'up'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    // Get recommendation
    const recommendation = await prisma.bookDateRecommendation.findUnique({
      where: { id: recommendationId }
    });

    if (!recommendation || recommendation.userId !== user.id) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
    }

    // Record swipe
    await prisma.bookDateSwipe.create({
      data: {
        userId: user.id,
        recommendationId,
        bookTitle: recommendation.title,
        bookAuthor: recommendation.author,
        action,
        markedAsKnown: markedAsKnown || false
      }
    });

    // Remove from cache
    await prisma.bookDateRecommendation.delete({
      where: { id: recommendationId }
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[BookDate] Swipe error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

#### 3.4 Undo Swipe

**File:** `src/app/api/bookdate/undo/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get last swipe (left or up only)
    const lastSwipe = await prisma.bookDateSwipe.findFirst({
      where: {
        userId: user.id,
        action: { in: ['left', 'up'] }
      },
      orderBy: { createdAt: 'desc' },
      include: { recommendation: true }
    });

    if (!lastSwipe) {
      return NextResponse.json({ error: 'No swipe to undo' }, { status: 404 });
    }

    // Restore recommendation to cache (if available)
    if (lastSwipe.recommendation) {
      await prisma.bookDateRecommendation.create({
        data: {
          userId: user.id,
          batchId: lastSwipe.recommendation.batchId,
          title: lastSwipe.recommendation.title,
          author: lastSwipe.recommendation.author,
          narrator: lastSwipe.recommendation.narrator,
          rating: lastSwipe.recommendation.rating,
          description: lastSwipe.recommendation.description,
          coverUrl: lastSwipe.recommendation.coverUrl,
          audnexusAsin: lastSwipe.recommendation.audnexusAsin,
          aiReason: lastSwipe.recommendation.aiReason
        }
      });
    }

    // Delete swipe
    await prisma.bookDateSwipe.delete({
      where: { id: lastSwipe.id }
    });

    return NextResponse.json({ success: true, recommendation: lastSwipe.recommendation });

  } catch (error: any) {
    console.error('[BookDate] Undo error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

#### 3.5 Generate More

**File:** `src/app/api/bookdate/generate/route.ts`

Similar to recommendations endpoint, but forces new generation (doesn't check cache first).

---

### Phase 4: Setup Wizard Integration (Priority: High)

**Goal:** Add BookDate configuration as step 7 in the setup wizard (after Paths, before Review).

**Files to modify:**
- `src/app/setup/page.tsx` - Main wizard component
- Create `src/app/setup/BookDateStep.tsx` - New step component

**BookDateStep.tsx structure:**

```typescript
'use client';

import { useState } from 'react';

interface BookDateStepProps {
  onNext: (data: any) => void;
  onSkip: () => void;
}

export default function BookDateStep({ onNext, onSkip }: BookDateStepProps) {
  const [provider, setProvider] = useState<'openai' | 'claude'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [libraryScope, setLibraryScope] = useState<'full' | 'listened' | 'rated'>('full');
  const [customPrompt, setCustomPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/bookdate/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey })
      });

      const data = await response.json();
      if (data.success) {
        setModels(data.models);
        setTested(true);
      } else {
        alert(data.error);
      }
    } catch (error) {
      alert('Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    onNext({ provider, apiKey, model: selectedModel, libraryScope, customPrompt });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">BookDate Setup (Optional)</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Configure AI-powered audiobook recommendations. You can skip this and set it up later.
        </p>
      </div>

      {/* Provider selection */}
      <div>
        <label className="block text-sm font-medium mb-2">AI Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as any)}
          className="w-full px-4 py-2 border rounded-lg"
        >
          <option value="openai">OpenAI</option>
          <option value="claude">Claude (Anthropic)</option>
        </select>
      </div>

      {/* API key input */}
      <div>
        <label className="block text-sm font-medium mb-2">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-4 py-2 border rounded-lg"
        />
        <p className="text-xs text-gray-500 mt-1">
          Your API key is stored securely and only used for recommendations
        </p>
      </div>

      {/* Test connection button */}
      <button
        onClick={handleTestConnection}
        disabled={!apiKey || testing}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
      >
        {testing ? 'Testing...' : 'Test Connection & Fetch Models'}
      </button>

      {/* Model selection (only shown after successful test) */}
      {tested && models.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-2">Select Model</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg"
          >
            <option value="">-- Choose a model --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Library scope */}
      {tested && selectedModel && (
        <div>
          <label className="block text-sm font-medium mb-2">Base Recommendations On</label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                value="full"
                checked={libraryScope === 'full'}
                onChange={(e) => setLibraryScope(e.target.value as any)}
                className="mr-2"
              />
              Full Plex Library
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="listened"
                checked={libraryScope === 'listened'}
                onChange={(e) => setLibraryScope(e.target.value as any)}
                className="mr-2"
              />
              Listened Books Only (>25% completed)
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="rated"
                checked={libraryScope === 'rated'}
                onChange={(e) => setLibraryScope(e.target.value as any)}
                className="mr-2"
              />
              Rated Books Only
            </label>
          </div>
        </div>
      )}

      {/* Custom prompt */}
      {tested && selectedModel && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Additional Preferences (Optional)
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g., 'I prefer sci-fi with strong female leads'"
            rows={3}
            className="w-full px-4 py-2 border rounded-lg"
          />
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-4">
        <button
          onClick={onSkip}
          className="px-4 py-2 border rounded-lg"
        >
          Skip for now
        </button>
        <button
          onClick={handleNext}
          disabled={!tested || !selectedModel || !libraryScope}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

**Integration points:**
1. Import `BookDateStep` in main wizard
2. Add to step array between Paths (step 6) and Review (step 7)
3. Handle skip logic (don't save config if skipped)
4. In Review step, show BookDate config if configured
5. In Finalize step, save BookDate config if provided

---

### Phase 5: Settings Page Integration (Priority: High)

**File:** `src/app/(user)/settings/bookdate/page.tsx`

Create new settings page for BookDate:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BookDateSettings() {
  // Similar structure to BookDateStep, but with:
  // - Load existing config on mount
  // - Save button instead of Next
  // - Clear swipe history button
  // - Admin toggle (if user is admin)

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">BookDate Settings</h1>

      {/* Same fields as wizard step */}
      {/* Add: Clear Swipe History button */}
      {/* Add: Admin toggle (if admin role) */}

      <button
        onClick={handleSave}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg"
      >
        Save Settings
      </button>
    </div>
  );
}
```

**Add to main settings nav:**
- Modify `src/app/(user)/settings/page.tsx` or settings layout
- Add "BookDate" link to settings navigation

---

### Phase 6: BookDate Tab & UI (Priority: Critical)

#### 6.1 BookDate Page

**File:** `src/app/(user)/bookdate/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RecommendationCard from '@/components/bookdate/RecommendationCard';
import LoadingScreen from '@/components/bookdate/LoadingScreen';

export default function BookDatePage() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastSwipe, setLastSwipe] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/bookdate/recommendations');
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
      await fetch('/api/bookdate/swipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendationId: recommendation.id,
          action,
          markedAsKnown
        })
      });

      setLastSwipe({ recommendation, action });
      setCurrentIndex(currentIndex + 1);

      // Check if we've reached the end
      if (currentIndex + 1 >= recommendations.length) {
        // Show empty state
      }

    } catch (error) {
      console.error('Swipe error:', error);
    }
  };

  const handleUndo = async () => {
    // Only for left/up swipes
    if (!lastSwipe || lastSwipe.action === 'right') return;

    try {
      const response = await fetch('/api/bookdate/undo', {
        method: 'POST'
      });

      if (response.ok) {
        setCurrentIndex(currentIndex - 1);
        setLastSwipe(null);
      }
    } catch (error) {
      console.error('Undo error:', error);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-bold mb-4">⚠️ Could not load recommendations</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <div className="flex gap-4">
          <button onClick={loadRecommendations} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
            Try Again
          </button>
          <button onClick={() => router.push('/settings/bookdate')} className="px-4 py-2 border rounded-lg">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  if (currentIndex >= recommendations.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-bold mb-4">🎉 You've seen all our current recommendations!</h2>
        <p className="text-gray-600 mb-4">Want more suggestions?</p>
        <div className="flex gap-4">
          <button onClick={loadRecommendations} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
            Get More
          </button>
          <button onClick={() => router.push('/')} className="px-4 py-2 border rounded-lg">
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const currentRec = recommendations[currentIndex];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <RecommendationCard
        recommendation={currentRec}
        onSwipe={handleSwipe}
      />

      {/* Undo button (show briefly after left/up swipe) */}
      {lastSwipe && lastSwipe.action !== 'right' && (
        <button
          onClick={handleUndo}
          className="fixed bottom-8 left-8 px-4 py-2 bg-gray-800 text-white rounded-lg"
        >
          Undo
        </button>
      )}
    </div>
  );
}
```

#### 6.2 Recommendation Card Component

**File:** `src/components/bookdate/RecommendationCard.tsx`

```typescript
'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSwipeable } from 'react-swipeable'; // Install: npm install react-swipeable

interface RecommendationCardProps {
  recommendation: any;
  onSwipe: (action: 'left' | 'right' | 'up', markedAsKnown?: boolean) => void;
}

export default function RecommendationCard({ recommendation, onSwipe }: RecommendationCardProps) {
  const [showToast, setShowToast] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleSwipeRight = () => {
    // Show confirmation toast
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
        className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden"
        style={{
          transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          transition: dragOffset.x === 0 ? 'transform 0.3s' : 'none'
        }}
      >
        {/* Overlay based on drag direction */}
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
        <div className="w-full h-96 relative">
          {recommendation.coverUrl ? (
            <Image
              src={recommendation.coverUrl}
              alt={recommendation.title}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center">
              <span className="text-4xl">📚</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          <h3 className="text-2xl font-bold mb-2">{recommendation.title}</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-1">{recommendation.author}</p>
          {recommendation.narrator && (
            <p className="text-sm text-gray-500 mb-3">Narrated by {recommendation.narrator}</p>
          )}
          {recommendation.rating && (
            <div className="flex items-center mb-3">
              <span className="text-yellow-500">⭐</span>
              <span className="ml-1">{recommendation.rating}</span>
            </div>
          )}
          {recommendation.description && (
            <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-4">
              {recommendation.description}
            </p>
          )}
        </div>

        {/* Desktop buttons */}
        <div className="hidden md:flex justify-center gap-4 p-6">
          <button
            onClick={() => onSwipe('left')}
            className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600"
          >
            ❌ Not Interested
          </button>
          <button
            onClick={() => onSwipe('up')}
            className="px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600"
          >
            ⬆️ Dismiss
          </button>
          <button
            onClick={handleSwipeRight}
            className="px-6 py-3 bg-green-500 text-white rounded-full hover:bg-green-600"
          >
            ✅ Request
          </button>
        </div>
      </div>

      {/* Confirmation Toast */}
      {showToast && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md">
            <h3 className="text-xl font-bold mb-4">Request "{recommendation.title}"?</h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Do you want to request this audiobook, or have you already read/listened to it elsewhere?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleToastAction('known')}
                className="px-4 py-2 border rounded-lg"
              >
                Mark as Known
              </button>
              <button
                onClick={() => handleToastAction('request')}
                className="px-4 py-2 bg-green-600 text-white rounded-lg"
              >
                Request
              </button>
              <button
                onClick={() => handleToastAction('cancel')}
                className="px-4 py-2 border rounded-lg"
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

#### 6.3 Loading Screen Component

**File:** `src/components/bookdate/LoadingScreen.tsx`

```typescript
export default function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      {/* Animated book cards shuffling */}
      <div className="relative w-64 h-96 mb-8">
        <div className="absolute inset-0 bg-blue-500 rounded-lg animate-pulse" />
        <div className="absolute inset-0 bg-green-500 rounded-lg animate-bounce" style={{ animationDelay: '0.2s' }} />
        <div className="absolute inset-0 bg-purple-500 rounded-lg animate-ping" style={{ animationDelay: '0.4s' }} />
      </div>
      <p className="text-xl text-gray-600 dark:text-gray-400">Finding your next great listen...</p>
    </div>
  );
}
```

#### 6.4 Tab Visibility

**File:** `src/components/layout/Header.tsx` (or wherever navigation is)

Add conditional BookDate tab:

```typescript
// Check if user has BookDate configured
const [showBookDate, setShowBookDate] = useState(false);

useEffect(() => {
  async function checkBookDate() {
    const response = await fetch('/api/bookdate/config');
    const data = await response.json();
    setShowBookDate(data.config && data.config.isVerified && data.config.isEnabled);
  }
  checkBookDate();
}, []);

// In navigation:
{showBookDate && (
  <Link href="/bookdate">BookDate</Link>
)}
```

---

### Phase 7: Integration & Polish (Priority: Medium)

#### 7.1 Request Integration

When user swipes right and confirms "Request":
- Call existing request API: `POST /api/requests` with `{ asin: recommendation.audnexusAsin }`
- Show success toast
- Continue to next recommendation

#### 7.2 Plex Library Integration

Implement `getUserLibraryBooks()` helper:
- Query Plex API for user's audiobook library
- For 'listened' scope: Calculate `viewOffset / duration > 0.25`
- For 'rated' scope: Filter books with user ratings
- Return latest 40 books

**Reference:** See `documentation/integrations/plex.md` for existing Plex API patterns

#### 7.3 Audnexus Matching

Implement `matchToAudnexus()` helper:
- Search Audnexus API by title + author
- Fuzzy match if exact fails
- Return metadata or null

**Reference:** Existing Audible search code or `documentation/integrations/audible.md`

#### 7.4 Error Logging

Add comprehensive logging:
- API errors
- Audnexus match failures
- AI response parsing errors

#### 7.5 Dark Mode Support

Ensure all components support dark mode:
- Use Tailwind `dark:` variants
- Test in both modes

---

### Phase 8: Testing & Verification (Priority: High)

#### 8.1 Database Testing
- [ ] Run `npx prisma db push` successfully
- [ ] Verify tables created in PostgreSQL
- [ ] Test encrypted API key storage/retrieval
- [ ] Test cascade deletes (user deletion removes configs/recommendations/swipes)

#### 8.2 API Testing
- [ ] Test connection endpoint with valid/invalid API keys
- [ ] Test config save/update/delete
- [ ] Test recommendation generation
- [ ] Test swipe recording
- [ ] Test undo functionality
- [ ] Test admin toggle

#### 8.3 UI Testing
- [ ] Setup wizard step works (skip functionality)
- [ ] Settings page loads and saves config
- [ ] BookDate tab shows/hides based on config
- [ ] Swipe gestures work on mobile
- [ ] Desktop buttons work
- [ ] Loading screen displays correctly
- [ ] Empty state shows at end
- [ ] Undo button appears/works
- [ ] Toast confirmation works

#### 8.4 Integration Testing
- [ ] Request creation from right swipe
- [ ] Plex library data fetched correctly
- [ ] Audnexus matching works
- [ ] Recommendations exclude library books
- [ ] Recommendations exclude already-swiped books
- [ ] Cache persistence across sessions

---

## MVP Definition

**MVP is complete when:**

✅ User can configure BookDate in setup wizard (or skip)
✅ User can configure BookDate in settings page
✅ BookDate tab visible only when configured
✅ User can view AI-generated recommendations
✅ User can swipe (mobile) or click buttons (desktop)
✅ Right swipe shows confirmation toast
✅ Request is created when user confirms
✅ Swipes are recorded and influence future recommendations
✅ Cache works (no duplicate API calls for same recommendations)
✅ Error states handled gracefully
✅ Dark mode supported

**Out of scope for MVP:**
- Advanced animations
- Swipe statistics/analytics
- Multi-AI voting
- Social features
- Advanced filtering

---

## Implementation Order

**Follow this order for fastest path to MVP:**

1. **Database schema** (Phase 1) - Foundation
2. **Config API endpoints** (Phase 2) - Test connection, save config
3. **Recommendation API endpoints** (Phase 3) - Core functionality
4. **Basic UI components** (Phase 6) - Card, loading screen
5. **BookDate page** (Phase 6) - Main interface
6. **Settings page** (Phase 5) - Configuration UI
7. **Setup wizard integration** (Phase 4) - Optional setup
8. **Plex/Audnexus integration** (Phase 7) - Real data
9. **Request integration** (Phase 7) - Complete flow
10. **Polish & testing** (Phase 8) - Bug fixes, UX improvements

---

## Key Technical Notes

### Encryption
- Use existing encryption utilities for API keys
- Never log decrypted keys
- Pattern: `encrypt()` on save, `decrypt()` on use

### Prisma
- Update `prisma/schema.prisma`
- Run `npx prisma db push` to sync
- Run `npx prisma generate` to regenerate client
- Import from `@/lib/prisma` or similar

### Auth Middleware
- Use `requireAuth(req)` for user endpoints
- Use `requireAdmin(req)` for admin endpoints
- Returns user object or null

### API Response Format
```typescript
// Success
return NextResponse.json({ success: true, data: {...} });

// Error
return NextResponse.json({ error: 'Error message' }, { status: 400 });
```

### Component Patterns
- Use `'use client'` directive for client components
- Tailwind for styling
- Dark mode: `className="bg-white dark:bg-gray-800"`
- Loading states: Show skeletons or spinners

### Mobile Swipe Library
Install `react-swipeable`:
```bash
npm install react-swipeable
```

### File Headers
Add to all new files:
```typescript
/**
 * BookDate: [Brief description]
 * Documentation: documentation/features/bookdate-prd.md
 */
```

---

## Documentation Updates

**After implementation, update:**

1. **TABLEOFCONTENTS.md** - Add BookDate section:
   ```markdown
   ## BookDate (AI Recommendations)
   - **AI-powered recommendations, swipe interface** → features/bookdate.md
   - **Configuration, setup wizard integration** → features/bookdate.md
   ```

2. **Create documentation/features/bookdate.md** - Token-efficient format:
   ```markdown
   # BookDate Feature

   **Status:** ✅ Implemented | AI-powered audiobook recommendations with swipe interface

   ## Overview
   Tinder-style recommendation system using OpenAI/Claude APIs, personalized per user.

   ## Key Details
   - **Providers:** OpenAI, Claude (Anthropic)
   - **Scopes:** Full library, listened only (>25%), rated only
   - **Actions:** Swipe left (reject), right (request), up (dismiss)
   - **Caching:** Per-user, 10 recommendations cached
   - **Context:** Max 50 books (40 library + 10 swipes)

   ## API Endpoints
   - POST /api/bookdate/test-connection - Validate API key, fetch models
   - GET/POST/DELETE /api/bookdate/config - Manage user config
   - GET /api/bookdate/recommendations - Get cached or generate new
   - POST /api/bookdate/swipe - Record swipe action
   - POST /api/bookdate/undo - Undo last swipe
   - PATCH /api/admin/bookdate/toggle - Admin enable/disable

   ## Database Models
   - BookDateConfig (per user)
   - BookDateRecommendation (cached)
   - BookDateSwipe (history)

   ## Related: features/bookdate-prd.md (full requirements)
   ```

3. **Update documentation/README.md** - Add to features list:
   ```markdown
   - BookDate: AI-powered recommendations with swipe interface
   ```

---

## Questions & Clarifications

If you encounter any blockers or need clarification:

1. **Check the PRD first:** `/home/user/ReadMeABook/documentation/features/bookdate-prd.md`
2. **Check relevant docs:** Use `TABLEOFCONTENTS.md` to find related documentation
3. **Follow existing patterns:** Look at similar features (setup wizard, settings pages, request flow)
4. **Ask the user:** If truly blocked, ask specific technical questions

---

## Success Criteria

**You've successfully implemented BookDate MVP when:**

- A user can complete setup wizard with BookDate configuration
- A user can view recommendations in BookDate tab
- A user can swipe through recommendations
- A user can request audiobooks from recommendations
- Recommendations improve based on swipe history
- All error states handled gracefully
- Dark mode works
- Mobile and desktop UX both functional

**Good luck! Reference the PRD frequently and follow existing code patterns.**
