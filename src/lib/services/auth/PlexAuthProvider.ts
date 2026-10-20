/**
 * Plex Auth Provider Implementation
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import {
  IAuthProvider,
  UserInfo,
  AuthTokens,
  LoginInitiation,
  CallbackParams,
  AuthResult,
} from './IAuthProvider';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getConfigService } from '@/lib/services/config.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getBaseUrl } from '@/lib/utils/url';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('PlexAuth');

export class PlexAuthProvider implements IAuthProvider {
  type: 'plex' = 'plex';
  private plexService = getPlexService();
  private configService = getConfigService();
  private encryptionService = getEncryptionService();

  /**
   * Initiate Plex OAuth login flow
   */
  async initiateLogin(): Promise<LoginInitiation> {
    try {
      // Request a PIN from Plex
      const pin = await this.plexService.requestPin();

      // Generate OAuth URL
      const baseCallbackUrl = process.env.PLEX_OAUTH_CALLBACK_URL ||
                             `${getBaseUrl()}/api/auth/plex/callback`;

      const oauthUrl = this.plexService.getOAuthUrl(pin.code, pin.id, baseCallbackUrl);

      return {
        redirectUrl: oauthUrl,
        pinId: pin.id.toString(),
      };
    } catch (error) {
      logger.error('Failed to initiate login', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to initiate Plex authentication');
    }
  }

  /**
   * Not used: Plex sign-in completes in /api/auth/plex/callback and
   * /api/auth/plex/switch-profile. Refuses so this provider can never write a user row.
   */
  async handleCallback(_params: CallbackParams): Promise<AuthResult> {
    logger.warn('PlexAuthProvider.handleCallback called; Plex sign-in completes in /api/auth/plex/callback');
    return {
      success: false,
      error: 'Plex sign-in is completed through the Plex login flow',
    };
  }

  /**
   * Refresh JWT tokens
   */
  async refreshToken(refreshToken: string): Promise<AuthTokens | null> {
    // JWT refresh is handled by existing JWT utilities
    // This method is a placeholder for future implementation
    return null;
  }

  /**
   * Validate user has access to the server
   */
  async validateAccess(userInfo: UserInfo): Promise<boolean> {
    try {
      const plexConfig = await this.configService.getPlexConfig();

      if (!plexConfig.serverUrl || !plexConfig.machineIdentifier) {
        return false;
      }

      // Get user's Plex token from database
      const user = await prisma.user.findUnique({
        where: { id: userInfo.id },
      });

      if (!user || !user.authToken) {
        return false;
      }

      // Decrypt token
      const decryptedToken = this.encryptionService.decrypt(user.authToken);

      // Verify server access
      return await this.plexService.verifyServerAccess(
        plexConfig.serverUrl,
        plexConfig.machineIdentifier,
        decryptedToken
      );
    } catch (error) {
      logger.error('Access validation failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}
