/**
 * Component: Plex Profile Switch API
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getAuthTokenCache } from '@/lib/services/auth-token-cache.service';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { canSignInAsPlexIdentity } from '@/lib/services/auth/plex-identity';

const logger = RMABLogger.create('API.PlexSwitchProfile');

/**
 * POST /api/auth/plex/switch-profile
 * Switch to a Plex Home profile and complete authentication
 *
 * Authentication: Provide pinId in request body. The Plex token is
 * retrieved from server-side cache for security.
 *
 * Identity: the profile must be one of the account's Plex Home users (looked up with the
 * cached token); its identity fields come from Plex.
 */

const PROFILE_REFUSED = {
  error: 'AccessDenied',
  message: 'This profile cannot be used to sign in. Please restart the login process.',
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, pin, pinId, profileInfo } = body;

    // Validate pinId is provided
    if (!pinId) {
      logger.warn('Missing pinId in request body');
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Missing PIN ID. Please restart the login process.',
        },
        { status: 401 }
      );
    }

    // Retrieve the Plex token from server-side cache
    const tokenCache = getAuthTokenCache();
    const mainAccountToken = tokenCache.get(pinId);

    if (!mainAccountToken) {
      logger.warn('Token not found or expired for pinId', { pinId });
      return NextResponse.json(
        {
          error: 'SessionExpired',
          message: 'Your session has expired. Please restart the login process.',
        },
        { status: 401 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Missing userId',
        },
        { status: 400 }
      );
    }

    const plexService = getPlexService();
    const encryptionService = getEncryptionService();

    // The selected profile must be one of this account's Plex Home users
    const homeUsers = await plexService.getHomeUsers(mainAccountToken);
    const homeUser = homeUsers.find((u) => String(u.id) === String(userId));
    if (!homeUser) {
      logger.warn('Profile switch refused: not a Plex Home user of this account');
      return NextResponse.json(PROFILE_REFUSED, { status: 403 });
    }

    // Switch to selected profile
    let profileToken: string;
    try {
      const token = await plexService.switchHomeUser(String(homeUser.id), mainAccountToken, pin);
      if (!token) {
        throw new Error('Failed to get profile token');
      }
      profileToken = token;
    } catch (error: any) {
      if (error.message === 'Invalid PIN') {
        return NextResponse.json(
          {
            error: 'InvalidPIN',
            message: 'Invalid PIN for this profile',
          },
          { status: 401 }
        );
      }
      throw error;
    }

    // Identity from Plex. The web client has always been keyed on the Home user's uuid; a
    // client without profile details, or a Home entry without a uuid, on the account id that
    // /users/account returns for the profile token.
    let profilePlexId: string;
    let profileUsername: string;
    let profileEmail: string | null;
    let profileThumb: string | null;

    if (profileInfo && homeUser.uuid) {
      profilePlexId = homeUser.uuid;
      profileUsername = homeUser.friendlyName || homeUser.title || homeUser.username || `User ${homeUser.id}`;
      profileEmail = homeUser.email || null;
      profileThumb = homeUser.thumb || null;
    } else {
      const profileUser = await plexService.getUserInfo(profileToken);

      if (!profileUser || !profileUser.id) {
        logger.error('Failed to get profile user info');
        return NextResponse.json(
          {
            error: 'ServerError',
            message: 'Failed to get profile information',
          },
          { status: 500 }
        );
      }

      profilePlexId = typeof profileUser.id === 'string' ? profileUser.id : profileUser.id.toString();
      profileUsername = profileUser.username || `User ${homeUser.id}`;
      profileEmail = profileUser.email || null;
      profileThumb = profileUser.thumb || null;
    }

    // The row written must belong to Plex sign-ins (and to this Home user)
    if (!(await canSignInAsPlexIdentity(profilePlexId, { homeUserId: String(homeUser.id) }))) {
      logger.warn('Profile switch refused', { homeUserId: homeUser.id });
      return NextResponse.json(PROFILE_REFUSED, { status: 403 });
    }
    logger.debug('Using Plex profile identity', { plexId: profilePlexId, username: profileUsername });

    // Check if this is the first user (should be promoted to admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';

    // Create or update user with profile details
    const user = await prisma.user.upsert({
      where: { plexId: profilePlexId },
      create: {
        plexId: profilePlexId,
        plexUsername: profileUsername,
        plexEmail: profileEmail,
        role,
        avatarUrl: profileThumb,
        authToken: encryptionService.encrypt(profileToken),
        authProvider: 'plex',
        plexHomeUserId: String(homeUser.id), // Store the home user ID
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: profileUsername,
        plexEmail: profileEmail,
        avatarUrl: profileThumb,
        authToken: encryptionService.encrypt(profileToken),
        authProvider: 'plex',
        plexHomeUserId: String(homeUser.id), // Update the home user ID
        lastLoginAt: new Date(),
      },
    });

    logger.info('User authenticated', {
      id: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      homeUserId: user.plexHomeUserId,
      role: user.role,
    });

    // Generate JWT tokens
    const accessToken = generateAccessToken({
      sub: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      role: user.role,
    });

    const refreshToken = generateRefreshToken(user.id);

    // Clean up the cached Plex token - authentication is complete
    tokenCache.delete(pinId);
    logger.debug('Cached Plex token cleaned up after successful auth', { pinId });

    // Return tokens and user info
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        email: user.plexEmail,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    logger.error('Failed to switch profile', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'ServerError',
        message: 'Failed to switch to selected profile',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
