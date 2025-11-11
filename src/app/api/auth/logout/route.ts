/**
 * Component: Logout Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 * Logout user (client-side token clearing, stateless JWT)
 */
export async function POST() {
  // Since we're using stateless JWT, logout is primarily client-side
  // The client should clear tokens from storage

  // TODO: In the future, implement token blacklist for enhanced security
  // This would require storing revoked tokens in Redis with expiration

  return NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  });
}
