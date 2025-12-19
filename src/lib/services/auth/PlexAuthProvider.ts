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
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { getBaseUrl } from '@/lib/utils/url';
import { prisma } from '@/lib/db';

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
      console.error('[PlexAuthProvider] Failed to initiate login:', error);
      throw new Error('Failed to initiate Plex authentication');
    }
  }

  /**
   * Handle OAuth callback - check PIN status and complete authentication
   */
  async handleCallback(params: CallbackParams): Promise<AuthResult> {
    try {
      const { pinId } = params;

      if (!pinId) {
        return {
          success: false,
          error: 'Missing PIN ID',
        };
      }

      // Check PIN status
      const authToken = await this.plexService.checkPin(parseInt(pinId, 10));

      if (!authToken) {
        // Still waiting for user authorization
        return {
          success: false,
          error: 'Waiting for user authorization',
        };
      }

      // Get user info from Plex
      const plexUser = await this.plexService.getUserInfo(authToken);

      if (!plexUser || !plexUser.id || !plexUser.username) {
        return {
          success: false,
          error: 'Failed to get user information from Plex',
        };
      }

      // Verify user has access to configured server
      const plexConfig = await this.configService.getPlexConfig();

      if (!plexConfig.serverUrl || !plexConfig.machineIdentifier) {
        return {
          success: false,
          error: 'Plex server is not configured',
        };
      }

      const hasAccess = await this.plexService.verifyServerAccess(
        plexConfig.serverUrl,
        plexConfig.machineIdentifier,
        authToken
      );

      if (!hasAccess) {
        return {
          success: false,
          error: 'You do not have access to this Plex server',
        };
      }

      // Check for Plex Home profiles
      const homeUsers = await this.plexService.getHomeUsers(authToken);

      if (homeUsers.length > 1) {
        // Multiple profiles - need profile selection
        return {
          success: true,
          requiresProfileSelection: true,
          profiles: homeUsers,
        };
      }

      // No additional profiles - create/update user with main account
      const userInfo = await this.createOrUpdateUser(
        plexUser.id.toString(),
        plexUser.username,
        plexUser.email,
        plexUser.thumb,
        authToken,
        null // No home profile
      );

      // Generate JWT tokens
      const tokens = await this.generateTokens(userInfo);

      return {
        success: true,
        user: userInfo,
        tokens,
      };
    } catch (error) {
      console.error('[PlexAuthProvider] Callback failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
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
      console.error('[PlexAuthProvider] Access validation failed:', error);
      return false;
    }
  }

  /**
   * Create or update user in database
   */
  private async createOrUpdateUser(
    plexId: string,
    username: string,
    email: string | undefined,
    avatarUrl: string | undefined,
    authToken: string,
    homeUserId: string | null
  ): Promise<UserInfo> {
    // Check if this is the first user (should be promoted to admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';

    // Create or update user in database
    const user = await prisma.user.upsert({
      where: { plexId },
      create: {
        plexId,
        plexUsername: username,
        plexEmail: email || null,
        role,
        isSetupAdmin: isFirstUser,
        avatarUrl: avatarUrl || null,
        authToken: this.encryptionService.encrypt(authToken),
        authProvider: 'plex',
        plexHomeUserId: homeUserId,
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: username,
        plexEmail: email || null,
        avatarUrl: avatarUrl || null,
        authToken: this.encryptionService.encrypt(authToken),
        authProvider: 'plex',
        plexHomeUserId: homeUserId,
        lastLoginAt: new Date(),
      },
    });

    return {
      id: user.id,
      username: user.plexUsername,
      email: user.plexEmail || undefined,
      avatarUrl: user.avatarUrl || undefined,
      isAdmin: user.role === 'admin',
    };
  }

  /**
   * Generate JWT access and refresh tokens
   */
  private async generateTokens(userInfo: UserInfo): Promise<AuthTokens> {
    const accessToken = generateAccessToken({
      sub: userInfo.id,
      plexId: userInfo.id, // For backwards compatibility
      username: userInfo.username,
      role: userInfo.isAdmin ? 'admin' : 'user',
    });

    const refreshToken = generateRefreshToken(userInfo.id);

    return {
      accessToken,
      refreshToken,
    };
  }
}
