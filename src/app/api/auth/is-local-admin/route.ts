/**
 * Component: Check Local Admin Status Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest, isLocalAdmin } from '@/lib/middleware/auth';

/**
 * GET /api/auth/is-local-admin
 * Check if current authenticated user is a local admin (setup admin)
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    if (!req.user) {
      return NextResponse.json(
        {
          isLocalAdmin: false,
        },
        { status: 200 }
      );
    }

    const localAdmin = await isLocalAdmin(req.user.id);

    return NextResponse.json({
      isLocalAdmin: localAdmin,
    });
  });
}
