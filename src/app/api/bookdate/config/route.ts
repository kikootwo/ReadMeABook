/**
 * BookDate: User Configuration Management
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { isSameServiceUrl, savedCredentialUrlMismatch } from '@/lib/utils/saved-credential';

const logger = RMABLogger.create('API.BookDateConfig');

/** True when the saved (encrypted) key is non-empty, or cannot be read (treated as set). */
function savedKeyIsSet(encryptedApiKey: string | null | undefined): boolean {
  if (!encryptedApiKey) return false;
  try {
    return getEncryptionService().decrypt(encryptedApiKey) !== '';
  } catch {
    return true;
  }
}

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
    logger.error('Get config error', { error: error instanceof Error ? error.message : String(error) });
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
    const { provider, apiKey, model, baseUrl, isEnabled, clearApiKey } = body;

    // Check if config exists
    const existingConfig = await prisma.bookDateConfig.findFirst();

    // Validation - API key only required for new configs (except custom provider)
    if (!existingConfig && !apiKey && provider !== 'custom') {
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

    if (!['openai', 'claude', 'custom', 'gemini'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider. Must be "openai", "claude", "custom", or "gemini"' },
        { status: 400 }
      );
    }

    // Custom provider requires baseUrl
    if (provider === 'custom') {
      if (!baseUrl) {
        return NextResponse.json(
          { error: 'Base URL is required for custom provider' },
          { status: 400 }
        );
      }

      // Validate URL format
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return NextResponse.json(
            { error: 'Invalid base URL. Must use http:// or https://' },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Invalid base URL format' },
          { status: 400 }
        );
      }
    }

    // Determine which API key to store (encrypted). Without a new key, the saved key is kept
    // only for the same provider and, for custom, the same base URL; it never moves elsewhere.
    const encryptionService = getEncryptionService();
    const canKeepSavedKey = Boolean(existingConfig) &&
      existingConfig!.provider === provider &&
      (provider !== 'custom' || isSameServiceUrl(baseUrl, existingConfig!.baseUrl));
    let encryptedApiKeyToUse: string;
    let apiKeyChanged = true;

    if (apiKey) {
      // New API key provided - encrypt it
      encryptedApiKeyToUse = encryptionService.encrypt(apiKey);
    } else if (clearApiKey === true) {
      // Explicitly saved with no key (keyless custom endpoint); never for built-in providers
      if (provider !== 'custom') {
        return NextResponse.json(
          { error: 'Only a custom provider can be saved without an API key' },
          { status: 400 }
        );
      }
      encryptedApiKeyToUse = encryptionService.encrypt('');
    } else if (canKeepSavedKey) {
      // Same provider (and custom base URL): keep the saved key
      encryptedApiKeyToUse = existingConfig!.apiKey;
      apiKeyChanged = false;
    } else if (provider === 'custom') {
      if (existingConfig?.provider === 'custom' && savedKeyIsSet(existingConfig.apiKey)) {
        // The saved key belongs to the saved base URL
        return NextResponse.json(
          { error: `${savedCredentialUrlMismatch('bookdate')} If this endpoint needs no key, choose "This endpoint needs no API key".` },
          { status: 400 }
        );
      }
      // Custom provider with no API key (local model) - encrypt empty string
      encryptedApiKeyToUse = encryptionService.encrypt('');
    } else {
      // API key required for OpenAI/Claude/Gemini; a saved key for another provider is never reused
      const error = !existingConfig
        ? 'API key is required'
        : savedKeyIsSet(existingConfig.apiKey)
          ? 'The saved API key is for a different provider. Enter an API key for this provider.'
          : 'There is no saved API key for this provider. Enter one.';
      return NextResponse.json({ error }, { status: 400 });
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

      // Only update the API key when it changed (new key, or cleared for a keyless custom provider)
      if (apiKeyChanged) {
        updateData.apiKey = encryptedApiKeyToUse;
      }

      // Update or clear baseUrl based on provider
      if (provider === 'custom') {
        updateData.baseUrl = baseUrl;
      } else {
        updateData.baseUrl = null; // Clear baseUrl when switching away from custom
      }

      config = await prisma.bookDateConfig.update({
        where: { id: existingConfig.id },
        data: updateData,
      });
    } else {
      // Create new global config
      config = await prisma.bookDateConfig.create({
        data: {
          provider,
          model,
          baseUrl: provider === 'custom' ? baseUrl : null,
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
    logger.error('Save config error', { error: error instanceof Error ? error.message : String(error) });
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
    logger.error('Delete config error', { error: error instanceof Error ? error.message : String(error) });
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
