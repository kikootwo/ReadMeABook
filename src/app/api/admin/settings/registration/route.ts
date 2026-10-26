/**
 * Registration Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.Registration');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
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
        logger.error('Failed to save registration settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
