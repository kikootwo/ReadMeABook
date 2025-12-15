/**
 * Local Login Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account pending admin approval.',
        });
      }
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    // Return tokens for login
    return NextResponse.json({
      success: true,
      user: result.user,
      accessToken: result.tokens!.accessToken,
      refreshToken: result.tokens!.refreshToken,
    });
  } catch (error) {
    console.error('[LocalLogin] Error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
