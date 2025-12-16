/**
 * OIDC Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { enabled, providerName, issuerUrl, clientId, clientSecret } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Build config updates
        const updates: Array<{key: string; value: string; encrypted?: boolean}> = [
          { key: 'oidc.enabled', value: enabled ? 'true' : 'false' },
          { key: 'oidc.provider_name', value: providerName || '' },
          { key: 'oidc.issuer_url', value: issuerUrl || '' },
          { key: 'oidc.client_id', value: clientId || '' },
        ];

        // Only update client secret if provided (not masked)
        if (clientSecret && !clientSecret.includes('••')) {
          updates.push({
            key: 'oidc.client_secret',
            value: clientSecret,
            encrypted: true
          });
        }

        await configService.setMany(updates);

        return NextResponse.json({
          success: true,
          message: 'OIDC settings saved successfully'
        });
      } catch (error) {
        console.error('[Admin] Failed to save OIDC settings:', error);
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
