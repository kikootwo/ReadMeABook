/**
 * BookDate: Get Recommendations
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import {
  buildAIPrompt,
  callAI,
  matchToAudnexus,
  isInLibrary,
  isAlreadyRequested,
  isAlreadySwiped,
} from '@/lib/bookdate/helpers';

async function handler(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Check for cached recommendations (exclude any that have been swiped)
    const cached = await prisma.bookDateRecommendation.findMany({
      where: {
        userId,
        // Exclude recommendations that have associated swipes
        swipes: {
          none: {},
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // If there are any cached unswiped recommendations, return them
    if (cached.length > 0) {
      return NextResponse.json({
        recommendations: cached,
        source: 'cache',
        remaining: cached.length,
      });
    }

    // Need to generate new recommendations - fetch global config
    const config = await prisma.bookDateConfig.findFirst();

    if (!config || !config.isVerified || !config.isEnabled) {
      return NextResponse.json(
        {
          error: 'BookDate is not configured or has been disabled. Please contact your administrator.',
        },
        { status: 400 }
      );
    }

    // Get user's preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        bookDateLibraryScope: true,
        bookDateCustomPrompt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Build user preferences object
    const userPreferences = {
      libraryScope: user.bookDateLibraryScope || 'full',
      customPrompt: user.bookDateCustomPrompt || null,
    };

    // Build prompt and call AI
    console.log('[BookDate] Generating new recommendations for user:', userId);
    const prompt = await buildAIPrompt(userId, userPreferences);
    const aiResponse = await callAI(config.provider, config.model, config.apiKey, prompt);

    if (!aiResponse.recommendations || !Array.isArray(aiResponse.recommendations)) {
      throw new Error('Invalid AI response format: missing recommendations array');
    }

    console.log(`[BookDate] AI returned ${aiResponse.recommendations.length} recommendations`);

    // Match to Audnexus and filter
    const batchId = `batch_${Date.now()}`;
    const matched: any[] = [];

    for (const rec of aiResponse.recommendations) {
      if (!rec.title || !rec.author) {
        console.warn('[BookDate] Skipping recommendation with missing title or author');
        continue;
      }

      // Check if already swiped
      if (await isAlreadySwiped(userId, rec.title, rec.author)) {
        console.log(`[BookDate] Skipping already swiped: "${rec.title}"`);
        continue;
      }

      // Check if in library
      if (await isInLibrary(userId, rec.title, rec.author)) {
        console.log(`[BookDate] Skipping already in library: "${rec.title}"`);
        continue;
      }

      // Match to Audnexus
      try {
        const audnexusMatch = await matchToAudnexus(rec.title, rec.author);

        if (!audnexusMatch) {
          console.warn(`[BookDate] No Audnexus match: "${rec.title}" by ${rec.author}`);
          continue;
        }

        // Check again if in library with ASIN for exact matching
        // This catches books that might have different titles (e.g., "The Tenant" vs "The Tenant (Unabridged)")
        if (await isInLibrary(userId, audnexusMatch.title, audnexusMatch.author, audnexusMatch.asin)) {
          console.log(`[BookDate] Book "${audnexusMatch.title}" (ASIN: ${audnexusMatch.asin}) is in library, skipping`);
          continue;
        }

        // Check if already requested
        if (await isAlreadyRequested(userId, audnexusMatch.asin)) {
          console.log(`[BookDate] Skipping already requested: "${rec.title}"`);
          continue;
        }

        matched.push({
          userId,
          batchId,
          title: audnexusMatch.title,
          author: audnexusMatch.author,
          narrator: audnexusMatch.narrator,
          rating: audnexusMatch.rating,
          description: audnexusMatch.description,
          coverUrl: audnexusMatch.coverUrl,
          audnexusAsin: audnexusMatch.asin,
          aiReason: rec.reason || 'Recommended based on your preferences',
        });

        if (matched.length >= 10) {
          break;
        }

      } catch (error) {
        console.warn(`[BookDate] Match error for "${rec.title}":`, error);
        continue;
      }
    }

    console.log(`[BookDate] Matched ${matched.length} recommendations`);

    // Save to database
    if (matched.length > 0) {
      await prisma.bookDateRecommendation.createMany({
        data: matched,
      });
    }

    // Combine with existing cache (exclude swiped recommendations)
    const allRecommendations = await prisma.bookDateRecommendation.findMany({
      where: {
        userId,
        swipes: {
          none: {},
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    return NextResponse.json({
      recommendations: allRecommendations,
      source: 'generated',
      generatedCount: matched.length,
    });

  } catch (error: any) {
    console.error('[BookDate] Recommendations error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to generate recommendations',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return requireAuth(req, handler);
}
