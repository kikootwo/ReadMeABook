/**
 * Component: Plex Profile Switch API
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';

/**
 * POST /api/auth/plex/switch-profile
 * Switch to a Plex Home profile and complete authentication
 */
export async function POST(request: NextRequest) {
  try {
    const mainAccountToken = request.headers.get('X-Plex-Token');

    if (!mainAccountToken) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Missing authentication token',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { userId, pin, pinId, profileInfo } = body;

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

    // Switch to selected profile
    let profileToken: string;
    try {
      const token = await plexService.switchHomeUser(userId, mainAccountToken, pin);
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

    // Use profile info from request (already has all the info from home users list)
    // or fall back to getUserInfo for main accounts
    let profilePlexId: string;
    let profileUsername: string;
    let profileEmail: string | null;
    let profileThumb: string | null;

    if (profileInfo && profileInfo.uuid) {
      // Use provided profile info (from home users list - more reliable for managed users)
      profilePlexId = profileInfo.uuid;
      profileUsername = profileInfo.friendlyName || `User ${userId}`;
      profileEmail = profileInfo.email || null;
      profileThumb = profileInfo.thumb || null;
      console.log('[Profile Switch] Using provided profile info:', {
        plexId: profilePlexId,
        username: profileUsername,
      });
    } else {
      // Fall back to getUserInfo (for main accounts without profile info)
      const profileUser = await plexService.getUserInfo(profileToken);

      if (!profileUser || !profileUser.id) {
        console.error('[Profile Switch] Failed to get profile user info');
        return NextResponse.json(
          {
            error: 'ServerError',
            message: 'Failed to get profile information',
          },
          { status: 500 }
        );
      }

      profilePlexId = typeof profileUser.id === 'string' ? profileUser.id : profileUser.id.toString();
      profileUsername = profileUser.username || `User ${userId}`;
      profileEmail = profileUser.email || null;
      profileThumb = profileUser.thumb || null;
      console.log('[Profile Switch] Using getUserInfo data:', {
        plexId: profilePlexId,
        username: profileUsername,
      });
    }

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
        plexHomeUserId: userId, // Store the home user ID
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: profileUsername,
        plexEmail: profileEmail,
        avatarUrl: profileThumb,
        authToken: encryptionService.encrypt(profileToken),
        plexHomeUserId: userId, // Update the home user ID
        lastLoginAt: new Date(),
      },
    });

    console.log('[Profile Switch] User authenticated:', {
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
    console.error('Failed to switch profile:', error);
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
