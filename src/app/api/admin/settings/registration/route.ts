/**
 * Registration Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { enabled, requireAdminApproval } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        await configService.setMany([
          { key: 'auth.registration_enabled', value: enabled ? 'true' : 'false' },
          { key: 'auth.require_admin_approval', value: requireAdminApproval ? 'true' : 'false' },
        ]);

        return NextResponse.json({
          success: true,
          message: 'Registration settings saved successfully'
        });
      } catch (error) {
        console.error('[Admin] Failed to save registration settings:', error);
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
