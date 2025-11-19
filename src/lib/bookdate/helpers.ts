/**
 * BookDate: Helper Functions for Recommendations
 * Documentation: documentation/features/bookdate-prd.md
 */

import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getConfigService } from '@/lib/services/config.service';
import { AudibleService } from '@/lib/integrations/audible.service';
import { getPlexService } from '@/lib/integrations/plex.service';

export interface LibraryBook {
  title: string;
  author: string;
  narrator?: string | null;
  rating?: number | null;
}

interface CachedLibraryBook {
  title: string;
  author: string;
  narrator: string | null;
  plexRatingKey: string | null;
}

export interface SwipeHistory {
  title: string;
  author: string;
  action: string;
  markedAsKnown: boolean;
}

export interface AIRecommendation {
  title: string;
  author: string;
  reason: string;
}

/**
 * Enrich cached library books with user's personal ratings from Plex
 * @param userId - User ID (to fetch their Plex token)
 * @param cachedBooks - Books from PlexLibrary table cache
 * @returns Books enriched with user's personal ratings
 */
async function enrichWithUserRatings(
  userId: string,
  cachedBooks: CachedLibraryBook[]
): Promise<LibraryBook[]> {
  try {
    // Get user's Plex token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { authToken: true },
    });

    if (!user?.authToken) {
      console.warn('[BookDate] User has no Plex auth token, using cached ratings');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined, // No ratings without token
      }));
    }

    // Get Plex configuration
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    if (!plexConfig.serverUrl) {
      console.warn('[BookDate] No Plex server URL configured, using cached ratings');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

    // Decrypt user's Plex token
    const encryptionService = getEncryptionService();
    const userPlexToken = encryptionService.decrypt(user.authToken);

    // Get rating keys from cached books
    const ratingKeys = cachedBooks
      .filter(book => book.plexRatingKey)
      .map(book => book.plexRatingKey as string);

    if (ratingKeys.length === 0) {
      console.warn('[BookDate] No rating keys found in cached books');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

    console.log(`[BookDate] Fetching live ratings for ${ratingKeys.length} books using user's token`);

    // Fetch user's personal ratings from Plex
    const plexService = getPlexService();
    const ratingsMap = await plexService.batchGetUserRatings(
      plexConfig.serverUrl,
      userPlexToken,
      ratingKeys
    );

    console.log(`[BookDate] Successfully fetched ${ratingsMap.size} user ratings from Plex`);

    // Enrich books with user's ratings
    return cachedBooks.map(book => ({
      title: book.title,
      author: book.author,
      narrator: book.narrator || undefined,
      rating: book.plexRatingKey ? ratingsMap.get(book.plexRatingKey) || undefined : undefined,
    }));

  } catch (error) {
    console.error('[BookDate] Error enriching books with user ratings:', error);
    // Fallback: return books without ratings on error
    return cachedBooks.map(book => ({
      title: book.title,
      author: book.author,
      narrator: book.narrator || undefined,
      rating: undefined,
    }));
  }
}

/**
 * Get user's Plex library books based on scope
 * @param userId - User ID
 * @param scope - 'full' | 'listened' | 'rated'
 * @returns Array of library books (max 40)
 */
export async function getUserLibraryBooks(
  userId: string,
  scope: 'full' | 'listened' | 'rated'
): Promise<LibraryBook[]> {
  try {
    // Get user's Plex library configuration
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    if (!plexConfig.libraryId) {
      console.warn('[BookDate] No Plex library ID configured');
      return [];
    }

    const plexLibraryId = plexConfig.libraryId;

    // Build query filters based on scope
    let whereClause: any = { plexLibraryId };

    if (scope === 'rated') {
      // Only include books that have a user rating
      // Note: This checks cached ratings, which may be admin's ratings
      // We'll filter again after fetching live user ratings
      whereClause.userRating = { not: null };
    }

    // Query Plex library from database (cached structure, no user-specific ratings yet)
    let cachedBooks = await prisma.plexLibrary.findMany({
      where: whereClause,
      orderBy: {
        addedAt: 'desc',
      },
      take: 40,
      select: {
        title: true,
        author: true,
        narrator: true,
        plexRatingKey: true,
      },
    });

    // Enrich with user's personal ratings from Plex
    const enrichedBooks = await enrichWithUserRatings(userId, cachedBooks);

    // If scope is 'rated', filter to only books the user has actually rated
    if (scope === 'rated') {
      return enrichedBooks.filter(book => book.rating != null);
    }

    return enrichedBooks;

  } catch (error) {
    console.error('[BookDate] Error fetching library books:', error);
    return [];
  }
}

/**
 * Get user's recent swipes
 * @param userId - User ID
 * @param limit - Max number of swipes to return
 * @returns Array of recent swipes
 */
export async function getUserRecentSwipes(
  userId: string,
  limit: number = 10
): Promise<SwipeHistory[]> {
  try {
    const swipes = await prisma.bookDateSwipe.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        bookTitle: true,
        bookAuthor: true,
        action: true,
        markedAsKnown: true,
      },
    });

    return swipes.map((s) => ({
      title: s.bookTitle,
      author: s.bookAuthor,
      action: s.action,
      markedAsKnown: s.markedAsKnown,
    }));

  } catch (error) {
    console.error('[BookDate] Error fetching swipe history:', error);
    return [];
  }
}

/**
 * Build AI prompt for recommendations
 * @param userId - User ID
 * @param config - User's BookDate configuration
 * @returns JSON string prompt for AI
 */
export async function buildAIPrompt(
  userId: string,
  config: { libraryScope: string; customPrompt?: string | null }
): Promise<string> {
  const libraryBooks = await getUserLibraryBooks(
    userId,
    config.libraryScope as 'full' | 'listened' | 'rated'
  );

  const swipeHistory = await getUserRecentSwipes(userId, 10);

  console.log('[BookDate] Building AI prompt with context:');
  console.log(`[BookDate] - Library books: ${libraryBooks.length}`);
  console.log(`[BookDate] - Swipe history: ${swipeHistory.length}`);
  console.log(`[BookDate] - Custom prompt: ${config.customPrompt ? 'Yes' : 'No'}`);
  console.log(`[BookDate] - Library scope: ${config.libraryScope}`);

  const prompt = {
    task: 'recommend_audiobooks',
    user_context: {
      library_books: libraryBooks.slice(0, 40),
      swipe_history: swipeHistory.map(s => ({
        title: s.title,
        author: s.author,
        user_action: s.action === 'right'
          ? (s.markedAsKnown ? 'marked_as_liked' : 'requested')
          : s.action === 'left' ? 'rejected' : 'dismissed',
      })),
      custom_preferences: config.customPrompt || null,
    },
    instructions:
      'Based on the user\'s library and swipe history, recommend 20 audiobooks they would enjoy. ' +
      'Important rules:\n' +
      '1. DO NOT recommend any books already in the user\'s library\n' +
      '2. DO NOT recommend any books from the swipe history (whether requested, rejected, dismissed, or marked_as_liked)\n' +
      '3. Focus on variety and quality\n' +
      '4. Consider user ratings if available (0-10 scale, higher = liked more)\n' +
      '5. Learn from rejected books to avoid similar recommendations\n' +
      '6. Learn from requested books to find similar ones\n' +
      '7. Pay special attention to "marked_as_liked" books - these are books the user has already read/listened to elsewhere and enjoyed. Find similar books to these.\n' +
      'Return ONLY valid JSON with no additional text or formatting.',
    response_format: {
      recommendations: [
        {
          title: 'string',
          author: 'string',
          reason: '1-2 sentence explanation',
        },
      ],
    },
  };

  const promptString = JSON.stringify(prompt);
  console.log('[BookDate] Full AI prompt:', promptString);

  return promptString;
}

/**
 * Call AI API to get recommendations
 * @param provider - 'openai' | 'claude'
 * @param model - Model ID
 * @param encryptedApiKey - Encrypted API key
 * @param prompt - JSON prompt string
 * @returns Parsed AI response with recommendations
 */
export async function callAI(
  provider: string,
  model: string,
  encryptedApiKey: string,
  prompt: string
): Promise<{ recommendations: AIRecommendation[] }> {
  const encryptionService = getEncryptionService();
  const apiKey = encryptionService.decrypt(encryptedApiKey);

  console.log(`[BookDate] Calling AI provider: ${provider}, model: ${model}`);

  if (provider === 'openai') {
    const systemMessage = 'You are an expert audiobook recommender. Analyze user preferences and suggest audiobooks they will love. Return ONLY valid JSON.';
    const requestBody = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: systemMessage,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    };

    console.log('[BookDate] OpenAI request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BookDate] OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    console.log('[BookDate] OpenAI response:', content);
    return JSON.parse(content);

  } else if (provider === 'claude') {
    const userMessage = `${prompt}\n\nReturn ONLY valid JSON with no additional text or formatting.`;
    const requestBody = {
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    };

    console.log('[BookDate] Claude request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BookDate] Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    console.log('[BookDate] Claude raw response:', content);

    // Claude sometimes wraps JSON in markdown code blocks, so clean it
    const cleanedContent = content
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    console.log('[BookDate] Claude cleaned response:', cleanedContent);
    return JSON.parse(cleanedContent);

  } else {
    throw new Error(`Invalid provider: ${provider}`);
  }
}

/**
 * Match AI recommendation to Audnexus
 * @param title - Book title
 * @param author - Book author
 * @returns Matched metadata or null
 */
export async function matchToAudnexus(
  title: string,
  author: string
): Promise<{
  asin: string;
  title: string;
  author: string;
  narrator: string | null;
  rating: number | null;
  description: string | null;
  coverUrl: string | null;
} | null> {
  try {
    // Step 1: Search in Audible cache first (fastest)
    const cached = await prisma.audibleCache.findFirst({
      where: {
        OR: [
          {
            title: {
              contains: title,
              mode: 'insensitive',
            },
            author: {
              contains: author,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        asin: true,
        title: true,
        author: true,
        narrator: true,
        rating: true,
        description: true,
        coverArtUrl: true,
      },
    });

    if (cached) {
      console.log(`[BookDate] Found in cache: "${cached.title}" by ${cached.author}`);
      return {
        asin: cached.asin,
        title: cached.title,
        author: cached.author,
        narrator: cached.narrator,
        rating: cached.rating ? parseFloat(cached.rating.toString()) : null,
        description: cached.description,
        coverUrl: cached.coverArtUrl,
      };
    }

    // Step 2: Search Audible.com for the book
    console.log(`[BookDate] Not in cache, searching Audible for "${title}" by ${author}...`);
    const audibleService = new AudibleService();
    const searchQuery = `${title} ${author}`;
    const searchResults = await audibleService.search(searchQuery, 1);

    if (!searchResults.results || searchResults.results.length === 0) {
      console.warn(`[BookDate] No Audible search results for "${title}" by ${author}`);
      return null;
    }

    // Take the first result (best match)
    const firstResult = searchResults.results[0];
    console.log(`[BookDate] Found on Audible: "${firstResult.title}" (ASIN: ${firstResult.asin})`);

    // Step 3: Use ASIN to fetch full details from Audnexus (or Audible as fallback)
    const details = await audibleService.getAudiobookDetails(firstResult.asin);

    if (!details) {
      console.warn(`[BookDate] Could not fetch details for ASIN ${firstResult.asin}`);
      return null;
    }

    console.log(`[BookDate] Successfully matched "${title}" to ASIN ${details.asin}`);

    return {
      asin: details.asin,
      title: details.title,
      author: details.author,
      narrator: details.narrator || null,
      rating: details.rating || null,
      description: details.description || null,
      coverUrl: details.coverArtUrl || null,
    };

  } catch (error) {
    console.error(`[BookDate] Audnexus matching error for "${title}":`, error);
    return null;
  }
}

/**
 * Check if book is already in user's library
 * @param userId - User ID
 * @param title - Book title
 * @param author - Book author
 * @returns true if book is in library
 */
export async function isInLibrary(
  userId: string,
  title: string,
  author: string
): Promise<boolean> {
  const configService = getConfigService();
  const plexConfig = await configService.getPlexConfig();

  if (!plexConfig.libraryId) {
    return false;
  }

  const match = await prisma.plexLibrary.findFirst({
    where: {
      plexLibraryId: plexConfig.libraryId,
      title: {
        contains: title,
        mode: 'insensitive',
      },
      author: {
        contains: author,
        mode: 'insensitive',
      },
    },
  });

  return !!match;
}

/**
 * Check if book has already been requested
 * @param userId - User ID
 * @param asin - Audible ASIN
 * @returns true if book is already requested
 */
export async function isAlreadyRequested(
  userId: string,
  asin: string
): Promise<boolean> {
  const request = await prisma.request.findFirst({
    where: {
      userId,
      audiobook: {
        audibleAsin: asin,
      },
    },
  });

  return !!request;
}

/**
 * Check if book has already been swiped
 * @param userId - User ID
 * @param title - Book title
 * @param author - Book author
 * @returns true if book has been swiped
 */
export async function isAlreadySwiped(
  userId: string,
  title: string,
  author: string
): Promise<boolean> {
  const swipe = await prisma.bookDateSwipe.findFirst({
    where: {
      userId,
      bookTitle: title,
      bookAuthor: author,
    },
  });

  return !!swipe;
}
