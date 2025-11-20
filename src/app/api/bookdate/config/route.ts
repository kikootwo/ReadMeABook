/**
 * BookDate: User Configuration Management
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';

// GET: Fetch global BookDate configuration (excluding API key)
// Any authenticated user can check if BookDate is configured
async function getConfig(req: AuthenticatedRequest) {
  try {
    // Get the single global config (there should only be one record)
    const config = await prisma.bookDateConfig.findFirst();

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

// POST: Create or update global BookDate configuration (Admin only)
async function saveConfig(req: AuthenticatedRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model, libraryScope, customPrompt, isEnabled } = body;

    // Check if config exists
    const existingConfig = await prisma.bookDateConfig.findFirst();

    // Validation - API key only required for new configs
    if (!existingConfig && !apiKey) {
      return NextResponse.json(
        { error: 'API key is required for initial setup' },
        { status: 400 }
      );
    }

    if (!provider || !model) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, model' },
        { status: 400 }
      );
    }

    if (!['openai', 'claude'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai" or "claude"' },
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

    let config;
    if (existingConfig) {
      // Update existing config
      const updateData: any = {
        provider,
        model,
        isEnabled: isEnabled !== undefined ? isEnabled : true,
        isVerified: true,
        updatedAt: new Date(),
      };

      // Only update API key if a new one was provided
      if (apiKey) {
        updateData.apiKey = encryptedApiKeyToUse;
      }

      config = await prisma.bookDateConfig.update({
        where: { id: existingConfig.id },
        data: updateData,
      });
    } else {
      // Create new global config
      // Note: libraryScope and customPrompt are now per-user settings (deprecated in global config)
      config = await prisma.bookDateConfig.create({
        data: {
          provider,
          model,
          libraryScope: 'full', // Default value for backwards compatibility
          customPrompt: null,
          isEnabled: isEnabled !== undefined ? isEnabled : true,
          isVerified: true,
          apiKey: encryptedApiKeyToUse,
        },
      });
    }

    // Clear ALL users' cached recommendations when global config changes
    await prisma.bookDateRecommendation.deleteMany({});

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

// DELETE: Remove global BookDate configuration (Admin only)
async function deleteConfig(req: AuthenticatedRequest) {
  try {
    // Get the global config
    const config = await prisma.bookDateConfig.findFirst();

    if (!config) {
      return NextResponse.json(
        { error: 'Configuration not found' },
        { status: 404 }
      );
    }

    // Delete global configuration
    await prisma.bookDateConfig.delete({
      where: { id: config.id },
    });

    // Also delete ALL cached recommendations and swipe history
    await prisma.bookDateRecommendation.deleteMany({});
    await prisma.bookDateSwipe.deleteMany({});

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
  return requireAuth(req, async (authReq) => requireAdmin(authReq, saveConfig));
}

export async function DELETE(req: NextRequest) {
  return requireAuth(req, async (authReq) => requireAdmin(authReq, deleteConfig));
}
