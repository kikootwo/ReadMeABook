/**
 * Auth Provider Factory
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { IAuthProvider } from './IAuthProvider';
import { PlexAuthProvider } from './PlexAuthProvider';
import { OIDCAuthProvider } from './OIDCAuthProvider'; // Phase 3
import { LocalAuthProvider } from './LocalAuthProvider'; // Phase 4

import { getConfigService } from '@/lib/services/config.service';

export type AuthMethod = 'plex' | 'oidc' | 'local';

/**
 * Get the appropriate auth provider based on backend mode and auth method
 * @param method - Optional override for auth method (useful for multi-auth scenarios)
 */
export async function getAuthProvider(method?: AuthMethod): Promise<IAuthProvider> {
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();

  // Plex mode always uses Plex OAuth
  if (backendMode === 'plex') {
    return new PlexAuthProvider();
  }

  // Audiobookshelf mode - determine auth method
  if (method) {
    // Explicit method provided
    if (method === 'oidc') {
      return new OIDCAuthProvider();
    } else if (method === 'local') {
      return new LocalAuthProvider();
    }
  }

  // Auto-detect from configuration
  const oidcEnabled = (await configService.get('oidc.enabled')) === 'true';
  const registrationEnabled = (await configService.get('auth.registration_enabled')) === 'true';

  if (oidcEnabled) {
    return new OIDCAuthProvider();
  } else if (registrationEnabled) {
    return new LocalAuthProvider();
  }

  // Fallback to Plex (shouldn't happen in normal flow)
  return new PlexAuthProvider();
}

// Re-export types
export * from './IAuthProvider';
export { PlexAuthProvider } from './PlexAuthProvider';
export { OIDCAuthProvider } from './OIDCAuthProvider';
export { LocalAuthProvider } from './LocalAuthProvider';
