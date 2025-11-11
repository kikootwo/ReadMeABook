/**
 * Component: Setup Wizard Complete API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';

export async function POST(request: NextRequest) {
  try {
    const { admin, plex, prowlarr, downloadClient, paths } = await request.json();

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

    // Mark setup as complete
    await prisma.configuration.upsert({
      where: { key: 'setup_completed' },
      update: { value: 'true' },
      create: { key: 'setup_completed', value: 'true' },
    });

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
