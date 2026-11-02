/**
 * Component: BookDate User Preferences API
 * Documentation: documentation/features/bookdate.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.BookDate.Preferences');

/**
 * GET /api/bookdate/preferences
 * Get current user's BookDate preferences (library scope and custom prompt)
 */
async function getPreferences(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Get user preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        bookDateLibraryScope: true,
        bookDateFavoriteBookIds: true,
        bookDateCustomPrompt: true,
        bookDateOnboardingComplete: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Add backend capability detection
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();
    const supportsRatings = backendMode === 'plex';

    // Override 'rated' scope if backend doesn't support it
    let effectiveScope = user.bookDateLibraryScope || 'full';
    if (!supportsRatings && effectiveScope === 'rated') {
      effectiveScope = 'full';
    }

    return NextResponse.json({
      libraryScope: effectiveScope,
      favoriteBookIds: user.bookDateFavoriteBookIds ? JSON.parse(user.bookDateFavoriteBookIds) : [],
      customPrompt: user.bookDateCustomPrompt || '', // Always return empty string for UI
      onboardingComplete: user.bookDateOnboardingComplete || false,
      backendCapabilities: {
        supportsRatings,
      },
    });

  } catch (error: any) {
    logger.error('Get BookDate preferences error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error.message || 'Failed to get preferences' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/bookdate/preferences
 * Update current user's BookDate preferences
 */
async function updatePreferences(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Parse request body
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.data;
    const { libraryScope, favoriteBookIds, customPrompt, onboardingComplete } = body;

    // Validate library scope
    if (libraryScope && !['full', 'rated', 'favorites'].includes(libraryScope)) {
      return NextResponse.json(
        { error: 'Invalid library scope. Must be "full", "rated", or "favorites"' },
        { status: 400 }
      );
    }

    // Validate favorites scope requirements
    if (libraryScope === 'favorites' && (!favoriteBookIds || favoriteBookIds.length === 0)) {
      return NextResponse.json(
        { error: 'Favorites scope requires at least 1 favorite book selected' },
        { status: 400 }
      );
    }

    // Validate favorite books limit
    if (favoriteBookIds && favoriteBookIds.length > 25) {
      return NextResponse.json(
        { error: 'Maximum 25 favorite books allowed' },
        { status: 400 }
      );
    }

    // Add validation for rating support
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();
    const supportsRatings = backendMode === 'plex';

    if (libraryScope === 'rated' && !supportsRatings) {
      return NextResponse.json(
        { error: 'Your backend does not support ratings. Please select "Full Library".' },
        { status: 400 }
      );
    }

    // Validate custom prompt length (only if provided and not empty)
    if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim() && customPrompt.length > 1000) {
      return NextResponse.json(
        { error: 'Custom prompt must be 1000 characters or less' },
        { status: 400 }
      );
    }

    // Build update data object
    const updateData: any = {};
    if (libraryScope !== undefined) {
      updateData.bookDateLibraryScope = libraryScope || 'full';
    }
    if (favoriteBookIds !== undefined) {
      // Store as JSON string
      updateData.bookDateFavoriteBookIds = favoriteBookIds && favoriteBookIds.length > 0
        ? JSON.stringify(favoriteBookIds)
        : null;
    }
    if (customPrompt !== undefined) {
      // Normalize empty strings to null for consistency
      const normalizedPrompt = (typeof customPrompt === 'string' && customPrompt.trim()) ? customPrompt.trim() : null;
      updateData.bookDateCustomPrompt = normalizedPrompt;
    }
    if (onboardingComplete !== undefined) {
      updateData.bookDateOnboardingComplete = onboardingComplete;
    }

    // Update user preferences
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        bookDateLibraryScope: true,
        bookDateFavoriteBookIds: true,
        bookDateCustomPrompt: true,
        bookDateOnboardingComplete: true,
      },
    });

    return NextResponse.json({
      success: true,
      libraryScope: updatedUser.bookDateLibraryScope || 'full',
      favoriteBookIds: updatedUser.bookDateFavoriteBookIds ? JSON.parse(updatedUser.bookDateFavoriteBookIds) : [],
      customPrompt: updatedUser.bookDateCustomPrompt || '', // Always return empty string for UI
      onboardingComplete: updatedUser.bookDateOnboardingComplete || false,
    });

  } catch (error: any) {
    logger.error('Update BookDate preferences error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error.message || 'Failed to update preferences' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return requireAuth(req, getPreferences);
}

export async function PUT(req: NextRequest) {
  return requireAuth(req, updatePreferences);
}
