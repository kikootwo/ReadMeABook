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

    console.log('[LocalLogin] Attempting login for username:', username);

    const provider = new LocalAuthProvider();
    const result = await provider.handleCallback({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        console.log('[LocalLogin] Account pending approval:', username);
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account pending admin approval.',
        });
      }
      console.error('[LocalLogin] Login failed:', result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    console.log('[LocalLogin] Login successful for:', username);
    console.log('[LocalLogin] User data:', result.user);
    console.log('[LocalLogin] Token generated successfully');

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
