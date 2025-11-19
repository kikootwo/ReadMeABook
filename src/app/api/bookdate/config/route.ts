/**
 * BookDate: User Configuration Management
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';

// GET: Fetch user's BookDate configuration (excluding API key)
async function getConfig(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    const config = await prisma.bookDateConfig.findUnique({
      where: { userId },
    });

    if (!config) {
      return NextResponse.json({ config: null });
    }

    // Don't return API key for security
    const { apiKey, ...safeConfig } = config;

    return NextResponse.json({ config: safeConfig });
  } catch (error: any) {
    console.error('[BookDate] Get config error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}

// POST: Create or update user's BookDate configuration
async function saveConfig(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;
    const body = await req.json();
    const { provider, apiKey, model, libraryScope, customPrompt, isEnabled } = body;

    // Check if config exists
    const existingConfig = await prisma.bookDateConfig.findUnique({
      where: { userId },
    });

    // Validation - API key only required for new configs
    if (!existingConfig && !apiKey) {
      return NextResponse.json(
        { error: 'API key is required for initial setup' },
        { status: 400 }
      );
    }

    if (!provider || !model || !libraryScope) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, model, libraryScope' },
        { status: 400 }
      );
    }

    if (!['openai', 'claude'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai" or "claude"' },
        { status: 400 }
      );
    }

    if (!['full', 'listened', 'rated'].includes(libraryScope)) {
      return NextResponse.json(
        { error: 'Invalid library scope. Must be "full", "listened", or "rated"' },
        { status: 400 }
      );
    }

    // Determine which API key to use
    let encryptedApiKeyToUse: string;

    if (apiKey) {
      // New API key provided - encrypt it
      const encryptionService = getEncryptionService();
      encryptedApiKeyToUse = encryptionService.encrypt(apiKey);
    } else if (existingConfig) {
      // No new API key, use existing one
      encryptedApiKeyToUse = existingConfig.apiKey;
    } else {
      // This shouldn't happen due to validation above, but just in case
      return NextResponse.json(
        { error: 'API key is required for new configuration' },
        { status: 400 }
      );
    }

    // Build update data (only include apiKey if a new one was provided)
    const updateData: any = {
      provider,
      model,
      libraryScope,
      customPrompt: customPrompt || null,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      isVerified: true,
      updatedAt: new Date(),
    };

    // Only update API key if a new one was provided
    if (apiKey) {
      updateData.apiKey = encryptedApiKeyToUse;
    }

    // Create data must always include apiKey (for upsert validation)
    const createData: any = {
      userId,
      provider,
      model,
      libraryScope,
      customPrompt: customPrompt || null,
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      isVerified: true,
      apiKey: encryptedApiKeyToUse,
    };

    // Upsert configuration
    const config = await prisma.bookDateConfig.upsert({
      where: { userId },
      update: updateData,
      create: createData,
    });

    // Clear cached recommendations when config changes
    await prisma.bookDateRecommendation.deleteMany({
      where: { userId },
    });

    // Return config without API key
    const { apiKey: _, ...safeConfig } = config;

    return NextResponse.json({
      success: true,
      config: safeConfig,
    });

  } catch (error: any) {
    console.error('[BookDate] Save config error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    );
  }
}

// DELETE: Remove user's BookDate configuration
async function deleteConfig(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Check if config exists
    const config = await prisma.bookDateConfig.findUnique({
      where: { userId },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'Configuration not found' },
        { status: 404 }
      );
    }

    // Delete configuration
    await prisma.bookDateConfig.delete({
      where: { userId },
    });

    // Also delete cached recommendations and swipe history
    await prisma.bookDateRecommendation.deleteMany({
      where: { userId },
    });

    await prisma.bookDateSwipe.deleteMany({
      where: { userId },
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[BookDate] Delete config error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete configuration' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return requireAuth(req, getConfig);
}

export async function POST(req: NextRequest) {
  return requireAuth(req, saveConfig);
}

export async function DELETE(req: NextRequest) {
  return requireAuth(req, deleteConfig);
}
