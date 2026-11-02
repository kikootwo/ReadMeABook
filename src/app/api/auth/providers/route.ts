/**
 * List Available Auth Providers
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { ConfigurationService } from '@/lib/services/config.service';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Auth.Providers');

export async function GET() {
  try {
    const configService = new ConfigurationService();
    const backendMode = await configService.get('system.backend_mode');

    // Check if local login is disabled via environment variable
    const localLoginDisabled = process.env.DISABLE_LOCAL_LOGIN === 'true';

    // Check if weak passwords are allowed via environment variable
    const allowWeakPassword = process.env.ALLOW_WEAK_PASSWORD === 'true';

    // Check if automation (Phase 3) is configured by checking for Prowlarr/indexer config
    const indexerType = await configService.get('indexer.type');
    const prowlarrUrl = await configService.get('indexer.prowlarr_url');
    const automationEnabled = !!(indexerType || prowlarrUrl);

    if (backendMode === 'audiobookshelf') {
      // Audiobookshelf mode - check which auth methods are enabled
      const oidcEnabled = (await configService.get('oidc.enabled')) === 'true';
      const registrationEnabled = (await configService.get('auth.registration_enabled')) === 'true';
      const oidcProviderName = await configService.get('oidc.provider_name') || 'SSO';

      // Check if any local users exist in database (for login form visibility); soft-deleted users can't sign in
      const hasLocalUsers = (await prisma.user.count({
        where: { authProvider: 'local', deletedAt: null }
      })) > 0;

      const providers: string[] = [];
      if (oidcEnabled) providers.push('oidc');
      // Add 'local' provider if not disabled and (users exist OR registration is enabled)
      // Registration needs local auth form to be shown even when no users exist yet
      if ((hasLocalUsers || registrationEnabled) && !localLoginDisabled) providers.push('local');

      return NextResponse.json({
        backendMode: 'audiobookshelf',
        providers,
        registrationEnabled: !localLoginDisabled && registrationEnabled,
        hasLocalUsers,
        oidcProviderName: oidcEnabled ? oidcProviderName : null,
        localLoginDisabled,
        allowWeakPassword,
        automationEnabled,
      });
    } else {
      // Plex mode - check if local admin exists (setup admin); soft-deleted users can't sign in
      const hasLocalUsers = (await prisma.user.count({
        where: {
          plexId: { startsWith: 'local-' },
          isSetupAdmin: true,
          deletedAt: null
        }
      })) > 0;

      return NextResponse.json({
        backendMode: 'plex',
        providers: ['plex'],
        registrationEnabled: false,
        hasLocalUsers,
        oidcProviderName: null,
        localLoginDisabled,
        allowWeakPassword,
        automationEnabled,
      });
    }
  } catch (error) {
    logger.error('Failed to fetch auth providers', { error: error instanceof Error ? error.message : String(error) });
    // Default to Plex mode if config can't be read
    const localLoginDisabled = process.env.DISABLE_LOCAL_LOGIN === 'true';
    const allowWeakPassword = process.env.ALLOW_WEAK_PASSWORD === 'true';
    return NextResponse.json({
      backendMode: 'plex',
      providers: ['plex'],
      registrationEnabled: false,
      hasLocalUsers: false,
      oidcProviderName: null,
      localLoginDisabled,
      allowWeakPassword,
      automationEnabled: false,
    });
  }
}
