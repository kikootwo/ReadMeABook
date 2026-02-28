/**
 * BookDate: Helper Functions for Recommendations
 * Documentation: documentation/features/bookdate-prd.md
 */

import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getConfigService } from '@/lib/services/config.service';
import { AudibleService } from '@/lib/integrations/audible.service';
import { getPlexService } from '@/lib/integrations/plex.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('BookDate');

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
  plexGuid: string;
  plexRatingKey: string | null;
  userRating?: any; // Admin's cached rating
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
    // Get user's Plex token, plexId, and role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { authToken: true, plexId: true, role: true },
    });

    if (!user) {
      logger.warn('User not found');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

    // Local admin users: Use cached ratings (from system Plex token)
    // Local admins authenticate with username/password, not Plex OAuth
    if (user.plexId.startsWith('local-')) {
      logger.info('User is local admin, using cached ratings (from system Plex token)');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: book.userRating ? parseFloat(book.userRating.toString()) : undefined,
      }));
    }

    // Plex-authenticated users (including admins): Fetch library with their token to get personal ratings
    // Note: /library/sections/{id}/all returns items with the authenticated user's ratings
    logger.info('User is Plex-authenticated, fetching library with user token to get personal ratings');

    if (!user.authToken) {
      logger.warn('User has no Plex auth token');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

    // Get Plex configuration
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    if (!plexConfig.serverUrl || !plexConfig.libraryId) {
      logger.warn('No Plex server URL or library ID configured');
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

    // Decrypt user's plex.tv OAuth token
    let userPlexToken: string;
    const encryptionService = getEncryptionService();
    try {
      userPlexToken = encryptionService.decrypt(user.authToken);
    } catch (decryptError) {
      // Token might be stored as plain text (from before encryption or different implementation)
      // Try using it as-is
      logger.warn('Failed to decrypt user Plex token, trying as plain text');
      userPlexToken = user.authToken;
    }

    try {
      // Get server-specific access token
      // Per Plex API: plex.tv OAuth tokens are for plex.tv, but we need
      // server-specific access tokens from /api/v2/resources to talk to PMS
      const plexService = getPlexService();

      // Get server machine ID from stored config (no need to access system token)
      if (!plexConfig.machineIdentifier) {
        logger.error('Server machine identifier not configured');
        return cachedBooks.map(book => ({
          title: book.title,
          author: book.author,
          narrator: book.narrator || undefined,
          rating: undefined,
        }));
      }

      const serverMachineId = plexConfig.machineIdentifier;
      const serverAccessToken = await plexService.getServerAccessToken(
        serverMachineId,
        userPlexToken
      );

      if (!serverAccessToken) {
        logger.warn('Could not get server access token for user (may not have server access)');
        return cachedBooks.map(book => ({
          title: book.title,
          author: book.author,
          narrator: book.narrator || undefined,
          rating: undefined,
        }));
      }

      logger.info('Successfully obtained server access token for user');

      // Fetch library content with user's SERVER access token to get their personal ratings
      const userLibrary = await plexService.getLibraryContent(
        plexConfig.serverUrl,
        serverAccessToken,
        plexConfig.libraryId
      );

      logger.info(`Fetched ${userLibrary.length} items from Plex with user's token`);

      // Create a map of guid/ratingKey -> userRating for quick lookup
      const ratingsMap = new Map<string, number>();
      userLibrary.forEach(item => {
        if (item.userRating) {
          // Try to match by guid first (most reliable)
          if (item.guid) {
            ratingsMap.set(item.guid, item.userRating);
          }
          // Also store by ratingKey as fallback
          if (item.ratingKey) {
            ratingsMap.set(item.ratingKey, item.userRating);
          }
        }
      });

      logger.info(`Found ${ratingsMap.size} rated items for non-admin user`);

      // Enrich cached books with user's ratings from the fetched library
      return cachedBooks.map(book => {
        // Try to find rating by guid first (most reliable), then ratingKey
        let rating: number | undefined;
        if (book.plexGuid) {
          rating = ratingsMap.get(book.plexGuid);
        }
        if (!rating && book.plexRatingKey) {
          rating = ratingsMap.get(book.plexRatingKey);
        }

        return {
          title: book.title,
          author: book.author,
          narrator: book.narrator || undefined,
          rating: rating,
        };
      });

    } catch (fetchError: any) {
      if (fetchError?.response?.status === 401 || fetchError?.message?.includes('401')) {
        logger.warn('User token unauthorized for library access (shared users may not have direct API access)');
        logger.warn('Falling back to recommendations without user ratings');
      } else {
        logger.error('Failed to fetch library with user token', { error: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      }
      // Fallback: return books without ratings
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined,
      }));
    }

  } catch (error) {
    logger.error('Error enriching books with user ratings', { error: error instanceof Error ? error.message : String(error) });
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
 * @param scope - 'full' | 'listened' | 'rated' | 'favorites'
 * @returns Array of library books (max 40)
 */
export async function getUserLibraryBooks(
  userId: string,
  scope: 'full' | 'listened' | 'rated' | 'favorites'
): Promise<LibraryBook[]> {
  try {
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();

    // Early validation: audiobookshelf doesn't support ratings
    if (backendMode === 'audiobookshelf' && scope === 'rated') {
      logger.warn('Audiobookshelf does not support ratings, falling back to full library');
      scope = 'full';
    }

    // Handle favorites scope
    if (scope === 'favorites') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { bookDateFavoriteBookIds: true },
      });

      const favoriteIds = user?.bookDateFavoriteBookIds
        ? JSON.parse(user.bookDateFavoriteBookIds)
        : [];

      if (favoriteIds.length === 0) {
        logger.warn('Favorites scope selected but no favorites stored, falling back to full library');
        scope = 'full';
      } else {
        // Get library ID for filtering
        let libraryId: string;
        if (backendMode === 'audiobookshelf') {
          const absLibraryId = await configService.get('audiobookshelf.library_id');
          if (!absLibraryId) {
            logger.warn('No Audiobookshelf library ID configured');
            return [];
          }
          libraryId = absLibraryId;
        } else {
          const plexConfig = await configService.getPlexConfig();
          if (!plexConfig.libraryId) {
            logger.warn('No Plex library ID configured');
            return [];
          }
          libraryId = plexConfig.libraryId;
        }

        // Query favorite books
        const cachedBooks = await prisma.plexLibrary.findMany({
          where: {
            id: { in: favoriteIds },
            plexLibraryId: libraryId, // Ensure books are from current library
          },
          select: {
            title: true,
            author: true,
            narrator: true,
            plexGuid: true,
            plexRatingKey: true,
            userRating: true,
          },
          orderBy: { addedAt: 'desc' },
        });

        logger.info(`Fetched ${cachedBooks.length} favorite books for user ${userId}`);

        // For Plex: Enrich with user's personal ratings
        // For Audiobookshelf: Skip enrichment (no rating support)
        if (backendMode === 'plex') {
          return await enrichWithUserRatings(userId, cachedBooks);
        } else {
          // Audiobookshelf: Map to LibraryBook without ratings
          return cachedBooks.map(book => ({
            title: book.title,
            author: book.author,
            narrator: book.narrator || undefined,
            rating: undefined,
          }));
        }
      }
    }

    // Get library ID based on backend mode
    let libraryId: string;
    if (backendMode === 'audiobookshelf') {
      const absLibraryId = await configService.get('audiobookshelf.library_id');
      if (!absLibraryId) {
        logger.warn('No Audiobookshelf library ID configured');
        return [];
      }
      libraryId = absLibraryId;
    } else {
      // Plex mode
      const plexConfig = await configService.getPlexConfig();
      if (!plexConfig.libraryId) {
        logger.warn('No Plex library ID configured');
        return [];
      }
      libraryId = plexConfig.libraryId;
    }

    // Check user type for local admin detection (Plex-specific logic)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plexId: true },
    });
    const isLocalAdmin = user?.plexId.startsWith('local-') ?? false;

    // Build query filters
    let whereClause: any = { plexLibraryId: libraryId };
    let takeLimit = 40;

    // Apply rating filter only for Plex backend with rated scope
    if (backendMode === 'plex' && scope === 'rated') {
      if (isLocalAdmin) {
        // Local admin: Use cached ratings from system token
        whereClause.userRating = { not: null };
      } else {
        // OAuth user: Fetch more, filter after user rating enrichment
        takeLimit = 100;
      }
    }

    // Query library from database (same table for both backends)
    let cachedBooks = await prisma.plexLibrary.findMany({
      where: whereClause,
      orderBy: {
        addedAt: 'desc',
      },
      take: takeLimit,
      select: {
        title: true,
        author: true,
        narrator: true,
        plexGuid: true,
        plexRatingKey: true,
        userRating: true,
      },
    });

    // For Plex: Enrich with user's personal ratings
    // For Audiobookshelf: Skip enrichment (no rating support)
    if (backendMode === 'plex') {
      const enrichedBooks = await enrichWithUserRatings(userId, cachedBooks);

      // Filter to rated books if scope is 'rated'
      if (scope === 'rated') {
        const ratedBooks = enrichedBooks.filter(book => book.rating != null);
        return isLocalAdmin ? ratedBooks : ratedBooks.slice(0, 40);
      }

      return enrichedBooks;
    } else {
      // Audiobookshelf: Map to LibraryBook without ratings
      return cachedBooks.map(book => ({
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        rating: undefined, // ABS doesn't support ratings
      }));
    }

  } catch (error) {
    logger.error('Error fetching library books', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Get user's recent swipes
 * Prioritizes non-dismiss actions (likes/requests/dislikes) over dismissals
 * @param userId - User ID
 * @param limit - Max number of swipes to return
 * @returns Array of recent swipes (prioritized: non-dismiss first, then dismissals)
 */
export async function getUserRecentSwipes(
  userId: string,
  limit: number = 10
): Promise<SwipeHistory[]> {
  try {
    // First, get the most recent non-dismiss swipes (left=reject, right=like/request)
    // These are most informative for AI recommendations
    const nonDismissSwipes = await prisma.bookDateSwipe.findMany({
      where: {
        userId,
        action: { in: ['left', 'right'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        bookTitle: true,
        bookAuthor: true,
        action: true,
        markedAsKnown: true,
        createdAt: true,
      },
    });

    // Calculate remaining slots for dismissals
    const remainingSlots = limit - nonDismissSwipes.length;

    // If we have remaining slots, fill with dismiss swipes (up=dismiss)
    let dismissSwipes: typeof nonDismissSwipes = [];
    if (remainingSlots > 0) {
      dismissSwipes = await prisma.bookDateSwipe.findMany({
        where: {
          userId,
          action: 'up',
        },
        orderBy: { createdAt: 'desc' },
        take: remainingSlots,
        select: {
          bookTitle: true,
          bookAuthor: true,
          action: true,
          markedAsKnown: true,
          createdAt: true,
        },
      });
    }

    // Combine both lists, maintaining chronological order (most recent first)
    const allSwipes = [...nonDismissSwipes, ...dismissSwipes].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    logger.info(
      `Fetched ${allSwipes.length} swipes: ${nonDismissSwipes.length} non-dismiss, ${dismissSwipes.length} dismiss`
    );

    return allSwipes.map((s) => ({
      title: s.bookTitle,
      author: s.bookAuthor,
      action: s.action,
      markedAsKnown: s.markedAsKnown,
    }));

  } catch (error) {
    logger.error('Error fetching swipe history', { error: error instanceof Error ? error.message : String(error) });
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
    config.libraryScope as 'full' | 'listened' | 'rated' | 'favorites'
  );

  const swipeHistory = await getUserRecentSwipes(userId, 10);

  logger.info('Building AI prompt with context:', {
    libraryBooks: libraryBooks.length,
    swipeHistory: swipeHistory.length,
    customPrompt: config.customPrompt ? 'Yes' : 'No',
    libraryScope: config.libraryScope,
  });

  let instructions =
    'Recommend 15-20 audiobooks the user would enjoy based on their library and swipe history. ' +
    'CRITICAL RULES:\n' +
    '1. DO NOT recommend any books already in the user\'s library (check titles carefully)\n' +
    '2. DO NOT recommend any books from the swipe history (whether requested, rejected, dismissed, or marked_as_liked)\n' +
    '3. You must provide 15-20 diverse recommendations, not just 3-5\n' +
    '4. Focus on variety across genres, authors, and styles\n' +
    '5. Consider user ratings if available (0-10 scale, higher = liked more)\n' +
    '6. Learn from rejected books to avoid similar recommendations\n' +
    '7. Learn from requested books to find similar ones\n' +
    '8. Pay special attention to "marked_as_liked" books - these are books the user has already read/listened to elsewhere and enjoyed. Find similar books to these.\n' +
    '9. Each recommendation should be a NEW book not mentioned anywhere in the user context';

  // Add special instruction for favorites scope
  if (config.libraryScope === 'favorites') {
    instructions += '\n\n' +
      'IMPORTANT: The user has specifically handpicked these ' + libraryBooks.length + ' books as their personal favorites. ' +
      'These represent their preferred genres, authors, themes, and styles. Use these as PRIMARY INSPIRATION for your recommendations. ' +
      'Find books that capture the essence of what makes these favorites special to the user.';
  }

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
    instructions,
  };

  const promptString = JSON.stringify(prompt);
  logger.debug('Full AI prompt:', { prompt: promptString });

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
  prompt: string,
  baseUrl?: string | null
): Promise<{ recommendations: AIRecommendation[] }> {
  const encryptionService = getEncryptionService();
  let apiKey = '';
  try {
    apiKey = encryptionService.decrypt(encryptedApiKey);
  } catch (error) {
    // Allow empty API key for custom provider (local models)
    if (provider !== 'custom') {
      throw error;
    }
  }

  logger.info(`Calling AI provider: ${provider}, model: ${model}`);

  // Define JSON schema for structured output
  const responseSchema = {
    type: 'json_schema',
    json_schema: {
      name: 'audiobook_recommendations',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                author: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['title', 'author', 'reason'],
              additionalProperties: false,
            },
            minItems: 15,
            maxItems: 20,
          },
        },
        required: ['recommendations'],
        additionalProperties: false,
      },
    },
  };

  const systemMessage = 'You are an expert audiobook recommender. ' +
    'Your task is to recommend 15-20 NEW audiobooks that the user would enjoy. ' +
    'NEVER recommend books that are already in the user\'s library or swipe history. ' +
    'Focus on discovering books they haven\'t seen yet.';

  if (provider === 'openai') {
    const requestBody = {
      model,
      response_format: responseSchema,
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

    logger.debug('OpenAI request body:', { requestBody });

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
      logger.error('OpenAI API error', { status: response.status, error: errorText });
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    logger.debug('OpenAI response:', { content });
    return JSON.parse(content);

  } else if (provider === 'claude') {
    const userMessage = `${systemMessage}\n\n${prompt}\n\nIMPORTANT: Provide exactly 15-20 recommendations. Return ONLY valid JSON with no additional text or formatting.`;
    const requestBody = {
      model,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    };

    logger.debug('Claude request body:', { requestBody });

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
      logger.error('Claude API error', { status: response.status, error: errorText });
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;
    logger.debug('Claude raw response:', { content });

    // Claude sometimes wraps JSON in markdown code blocks, so clean it
    const cleanedContent = content
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    logger.debug('Claude cleaned response:', { cleanedContent });
    return JSON.parse(cleanedContent);

  } else if (provider === 'gemini') {
    const requestBody = {
      systemInstruction: {
        parts: [{ text: systemMessage }],
      },
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            recommendations: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  author: { type: "STRING" },
                  reason: { type: "STRING" },
                },
                required: ["title", "author", "reason"],
              },
            },
          },
          required: ["recommendations"],
        },
      },
    };

    logger.debug('Gemini request body:', { requestBody });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Gemini API error', { status: response.status, error: errorText });
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('Invalid response format from Gemini API');
    }

    logger.debug('Gemini raw response:', { content });

    // Clean potential markdown wrapping
    const cleanedContent = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    logger.debug('Gemini cleaned response:', { cleanedContent });
    return JSON.parse(cleanedContent);

  } else if (provider === 'custom') {
    if (!baseUrl) {
      throw new Error('Base URL is required for custom provider');
    }

    // Try with json_schema first
    let requestBody: any = {
      model,
      response_format: responseSchema,
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

    logger.debug('Custom provider request body:', { requestBody, baseUrl });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Only add Authorization header if API key provided
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Custom provider API error', { status: response.status, error: errorText });

        // If response_format not supported, retry without it and add instructions to prompt
        if (errorText.includes('response_format') || errorText.includes('json_schema')) {
          logger.info('Retrying without response_format (provider does not support structured outputs)');
          delete requestBody.response_format;
          requestBody.messages[0].content = systemMessage + ' Return ONLY valid JSON with no additional text or formatting.';

          const retryResponse = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
          });

          if (!retryResponse.ok) {
            const retryErrorText = await retryResponse.text();
            throw new Error(`Custom provider API error: ${retryResponse.status} ${retryErrorText}`);
          }

          const retryData = await retryResponse.json();
          const retryContent = retryData.choices[0].message.content;

          // Clean markdown code blocks
          const cleanedContent = retryContent
            .replace(/^```json\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

          logger.debug('Custom provider cleaned response (fallback):', { cleanedContent });
          return JSON.parse(cleanedContent);
        }

        throw new Error(`Custom provider API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      logger.debug('Custom provider response:', { content });

      // Clean potential markdown wrapping (some providers still wrap even with json_schema)
      const cleanedContent = content
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      return JSON.parse(cleanedContent);

    } catch (error: any) {
      logger.error('Custom provider error:', error);
      throw new Error(`Custom provider error: ${error.message}`);
    }

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
      logger.info(`Found in cache: "${cached.title}" by ${cached.author}`);
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
    logger.info(`Not in cache, searching Audible for "${title}" by ${author}...`);
    const audibleService = new AudibleService();
    const searchQuery = `${title} ${author}`;
    const searchResults = await audibleService.search(searchQuery, 1);

    if (!searchResults.results || searchResults.results.length === 0) {
      logger.warn(`No Audible search results for "${title}" by ${author}`);
      return null;
    }

    // Take the first result (best match)
    const firstResult = searchResults.results[0];
    logger.info(`Found on Audible: "${firstResult.title}" (ASIN: ${firstResult.asin})`);

    // Step 3: Use ASIN to fetch full details from Audnexus (or Audible as fallback)
    const details = await audibleService.getAudiobookDetails(firstResult.asin);

    if (!details) {
      logger.warn(`Could not fetch details for ASIN ${firstResult.asin}`);
      return null;
    }

    logger.info(`Successfully matched "${title}" to ASIN ${details.asin}`);

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
    logger.error(`Audnexus matching error for "${title}"`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Check if book is already in user's library
 * Uses the same matching algorithm as homepage (audiobook-matcher.ts)
 * @param userId - User ID
 * @param title - Book title
 * @param author - Book author
 * @param asin - Optional ASIN for exact matching
 * @returns true if book is in library
 */
export async function isInLibrary(
  userId: string,
  title: string,
  author: string,
  asin?: string
): Promise<boolean> {
  try {
    // Use the centralized matching algorithm from audiobook-matcher.ts
    // This ensures consistent matching behavior across the application
    const match = await findPlexMatch({
      asin: asin || '', // Empty ASIN will skip exact ASIN matching but still do fuzzy matching
      title,
      author,
    });

    if (match) {
      logger.info(`Book "${title}" by ${author} found in library (matched to: "${match.title}")`);
    }

    return !!match;
  } catch (error) {
    logger.error(`Error checking library for "${title}"`, { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Check if book has already been requested (audiobook request)
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
      type: 'audiobook', // Only check audiobook requests (ebook requests are separate)
      deletedAt: null, // Only check active requests
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
