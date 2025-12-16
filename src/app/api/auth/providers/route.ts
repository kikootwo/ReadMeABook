/**
 * List Available Auth Providers
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextResponse } from 'next/server';
import { ConfigurationService } from '@/lib/services/config.service';

export async function GET() {
  try {
    const configService = new ConfigurationService();
    const backendMode = await configService.get('system.backend_mode');

    if (backendMode === 'audiobookshelf') {
      // Audiobookshelf mode - check which auth methods are enabled
      const oidcEnabled = (await configService.get('oidc.enabled')) === 'true';
      const registrationEnabled = (await configService.get('auth.registration_enabled')) === 'true';
      const oidcProviderName = await configService.get('oidc.provider_name') || 'SSO';

      const providers: string[] = [];
      if (oidcEnabled) providers.push('oidc');
      if (registrationEnabled) providers.push('local');

      return NextResponse.json({
        backendMode: 'audiobookshelf',
        providers,
        registrationEnabled,
        oidcProviderName: oidcEnabled ? oidcProviderName : null,
      });
    } else {
      // Plex mode
      return NextResponse.json({
        backendMode: 'plex',
        providers: ['plex'],
        registrationEnabled: false,
        oidcProviderName: null,
      });
    }
  } catch (error) {
    console.error('[Auth] Failed to fetch auth providers:', error);
    // Default to Plex mode if config can't be read
    return NextResponse.json({
      backendMode: 'plex',
      providers: ['plex'],
      registrationEnabled: false,
      oidcProviderName: null,
    });
  }
}
