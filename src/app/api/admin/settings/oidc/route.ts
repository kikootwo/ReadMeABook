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
        const {
          enabled,
          providerName,
          issuerUrl,
          clientId,
          clientSecret,
          accessControlMethod,
          accessGroupClaim,
          accessGroupValue,
          allowedEmails,
          allowedUsernames,
          adminClaimEnabled,
          adminClaimName,
          adminClaimValue,
        } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Build config updates
        const updates: Array<{key: string; value: string; encrypted?: boolean}> = [
          { key: 'oidc.enabled', value: enabled ? 'true' : 'false' },
          { key: 'oidc.provider_name', value: providerName || '' },
          { key: 'oidc.issuer_url', value: issuerUrl || '' },
          { key: 'oidc.client_id', value: clientId || '' },
          { key: 'oidc.access_control_method', value: accessControlMethod || 'open' },
          { key: 'oidc.access_group_claim', value: accessGroupClaim || 'groups' },
          { key: 'oidc.access_group_value', value: accessGroupValue || '' },
          { key: 'oidc.allowed_emails', value: allowedEmails || '[]' },
          { key: 'oidc.allowed_usernames', value: allowedUsernames || '[]' },
          { key: 'oidc.admin_claim_enabled', value: adminClaimEnabled ? 'true' : 'false' },
          { key: 'oidc.admin_claim_name', value: adminClaimName || 'groups' },
          { key: 'oidc.admin_claim_value', value: adminClaimValue || '' },
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
