/**
 * Component: Setup Wizard Complete API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getPlexService } from '@/lib/integrations/plex.service';

export async function POST(request: NextRequest) {
  try {
    const { admin, plex, prowlarr, downloadClient, paths, bookdate } = await request.json();

    // Validate required fields
    if (
      !admin?.username ||
      !admin?.password ||
      !plex?.url ||
      !plex?.token ||
      !plex?.audiobook_library_id ||
      !prowlarr?.url ||
      !prowlarr?.api_key ||
      !prowlarr?.indexers ||
      !Array.isArray(prowlarr.indexers) ||
      prowlarr.indexers.length === 0 ||
      !downloadClient?.type ||
      !downloadClient?.url ||
      !downloadClient?.username ||
      !downloadClient?.password ||
      !paths?.download_dir ||
      !paths?.media_dir
    ) {
      return NextResponse.json(
        { success: false, error: 'Missing required configuration fields' },
        { status: 400 }
      );
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash(admin.password, 10);
    const adminUser = await prisma.user.create({
      data: {
        plexId: `local-${admin.username}`,
        plexUsername: admin.username,
        plexEmail: null,
        role: 'admin',
        isSetupAdmin: true, // Mark as setup admin - role cannot be changed
        avatarUrl: null,
        authToken: hashedPassword, // Store hashed password in authToken field for local users
        lastLoginAt: new Date(),
      },
    });

    // Save configuration to database
    // Use upsert to handle both initial setup and updates

    // Plex configuration
    await prisma.configuration.upsert({
      where: { key: 'plex_url' },
      update: { value: plex.url },
      create: { key: 'plex_url', value: plex.url },
    });

    await prisma.configuration.upsert({
      where: { key: 'plex_token' },
      update: { value: plex.token },
      create: { key: 'plex_token', value: plex.token },
    });

    await prisma.configuration.upsert({
      where: { key: 'plex_audiobook_library_id' },
      update: { value: plex.audiobook_library_id },
      create: { key: 'plex_audiobook_library_id', value: plex.audiobook_library_id },
    });

    // Get and save machine identifier (for server-specific access tokens)
    // Fetch from Plex if not provided by frontend
    let machineIdentifier = plex.machine_identifier;
    if (!machineIdentifier) {
      try {
        const plexService = getPlexService();
        const serverInfo = await plexService.testConnection(plex.url, plex.token);
        if (serverInfo.success && serverInfo.info?.machineIdentifier) {
          machineIdentifier = serverInfo.info.machineIdentifier;
          console.log('[Setup] Fetched machineIdentifier:', machineIdentifier);
        } else {
          console.warn('[Setup] Could not fetch machineIdentifier');
        }
      } catch (error) {
        console.error('[Setup] Error fetching machineIdentifier:', error);
      }
    }

    if (machineIdentifier) {
      await prisma.configuration.upsert({
        where: { key: 'plex_machine_identifier' },
        update: { value: machineIdentifier },
        create: { key: 'plex_machine_identifier', value: machineIdentifier },
      });
    }

    // Prowlarr configuration
    await prisma.configuration.upsert({
      where: { key: 'prowlarr_url' },
      update: { value: prowlarr.url },
      create: { key: 'prowlarr_url', value: prowlarr.url },
    });

    await prisma.configuration.upsert({
      where: { key: 'prowlarr_api_key' },
      update: { value: prowlarr.api_key },
      create: { key: 'prowlarr_api_key', value: prowlarr.api_key },
    });

    await prisma.configuration.upsert({
      where: { key: 'prowlarr_indexers' },
      update: { value: JSON.stringify(prowlarr.indexers) },
      create: { key: 'prowlarr_indexers', value: JSON.stringify(prowlarr.indexers) },
    });

    // Download client configuration
    await prisma.configuration.upsert({
      where: { key: 'download_client_type' },
      update: { value: downloadClient.type },
      create: { key: 'download_client_type', value: downloadClient.type },
    });

    await prisma.configuration.upsert({
      where: { key: 'download_client_url' },
      update: { value: downloadClient.url },
      create: { key: 'download_client_url', value: downloadClient.url },
    });

    await prisma.configuration.upsert({
      where: { key: 'download_client_username' },
      update: { value: downloadClient.username },
      create: { key: 'download_client_username', value: downloadClient.username },
    });

    await prisma.configuration.upsert({
      where: { key: 'download_client_password' },
      update: { value: downloadClient.password },
      create: { key: 'download_client_password', value: downloadClient.password },
    });

    // Path configuration
    await prisma.configuration.upsert({
      where: { key: 'download_dir' },
      update: { value: paths.download_dir },
      create: { key: 'download_dir', value: paths.download_dir },
    });

    await prisma.configuration.upsert({
      where: { key: 'media_dir' },
      update: { value: paths.media_dir },
      create: { key: 'media_dir', value: paths.media_dir },
    });

    // BookDate configuration (optional, global for all users)
    // Note: libraryScope and customPrompt are now per-user settings, not required here
    if (bookdate && bookdate.provider && bookdate.apiKey && bookdate.model) {
      console.log('[Setup] Saving global BookDate configuration');

      const encryptionService = getEncryptionService();
      const encryptedApiKey = encryptionService.encrypt(bookdate.apiKey);

      // Check if global config already exists
      const existingConfig = await prisma.bookDateConfig.findFirst();

      if (existingConfig) {
        // Update existing global config
        await prisma.bookDateConfig.update({
          where: { id: existingConfig.id },
          data: {
            provider: bookdate.provider,
            apiKey: encryptedApiKey,
            model: bookdate.model,
            libraryScope: 'full', // Default value for backwards compatibility
            customPrompt: null,
            isVerified: true,
            isEnabled: true,
          },
        });
      } else {
        // Create new global config
        await prisma.bookDateConfig.create({
          data: {
            provider: bookdate.provider,
            apiKey: encryptedApiKey,
            model: bookdate.model,
            libraryScope: 'full', // Default value for backwards compatibility
            customPrompt: null,
            isVerified: true,
            isEnabled: true,
          },
        });
      }

      console.log('[Setup] Global BookDate configuration saved');
    } else {
      console.log('[Setup] BookDate configuration skipped (missing provider, apiKey, or model)');
    }

    // Mark setup as complete
    await prisma.configuration.upsert({
      where: { key: 'setup_completed' },
      update: { value: 'true' },
      create: { key: 'setup_completed', value: 'true' },
    });

    // Enable auto jobs (Plex Library Scan and Audible Data Refresh)
    await prisma.scheduledJob.updateMany({
      where: {
        type: {
          in: ['plex_library_scan', 'audible_refresh'],
        },
      },
      data: {
        enabled: true,
      },
    });

    console.log('[Setup] Auto jobs enabled (Plex Library Scan, Audible Data Refresh)');

    // Generate JWT tokens for auto-login
    const accessToken = generateAccessToken({
      sub: adminUser.id,
      plexId: adminUser.plexId,
      username: adminUser.plexUsername,
      role: adminUser.role,
    });

    const refreshToken = generateRefreshToken(adminUser.id);

    console.log('[Setup] Configuration saved successfully');

    return NextResponse.json({
      success: true,
      message: 'Setup completed successfully',
      accessToken,
      refreshToken,
      user: {
        id: adminUser.id,
        plexId: adminUser.plexId,
        username: adminUser.plexUsername,
        email: adminUser.plexEmail,
        role: adminUser.role,
        avatarUrl: adminUser.avatarUrl,
      },
    });
  } catch (error) {
    console.error('[Setup] Failed to save configuration:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save configuration',
      },
      { status: 500 }
    );
  }
}
