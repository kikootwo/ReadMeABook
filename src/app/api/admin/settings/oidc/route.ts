/**
 * OIDC Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { isMaskedSecret, resolveSecretForUrl } from '@/lib/utils/saved-credential';

const logger = RMABLogger.create('API.Admin.Settings.OIDC');

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

        if (issuerUrl !== undefined && issuerUrl !== null && typeof issuerUrl !== 'string') {
          return NextResponse.json({ error: 'Issuer URL must be text' }, { status: 400 });
        }
        const issuer = (issuerUrl || '').trim();

        // A masked or empty client secret keeps the saved one, but only for the saved issuer.
        // Clearing the issuer (which disables OIDC) needs no secret.
        let newClientSecret: string | null = null;
        if (issuer) {
          const resolved = await resolveSecretForUrl({
            kind: 'oidc',
            url: issuer,
            supplied: clientSecret,
            emptyMeansSaved: true,
            optional: true,
            loadSaved: async () => ({
              secret: await configService.get('oidc.client_secret'),
              url: await configService.get('oidc.issuer_url'),
            }),
          });
          if (!resolved.ok) {
            return NextResponse.json({ error: resolved.error }, { status: 400 });
          }
          if (!resolved.reusedSaved && resolved.secret) newClientSecret = resolved.secret;
        } else if (typeof clientSecret === 'string' && clientSecret && !isMaskedSecret(clientSecret)) {
          newClientSecret = clientSecret;
        }

        // Build config updates. setMany writes in order: the secret goes first, so a new
        // issuer is never saved alongside the previous issuer's secret.
        const updates: Array<{key: string; value: string; encrypted?: boolean}> = [];
        if (newClientSecret) {
          updates.push({ key: 'oidc.client_secret', value: newClientSecret, encrypted: true });
        }
        updates.push(
          { key: 'oidc.enabled', value: enabled && issuer ? 'true' : 'false' },
          { key: 'oidc.provider_name', value: providerName || '' },
          { key: 'oidc.issuer_url', value: issuer },
          { key: 'oidc.client_id', value: clientId || '' },
          { key: 'oidc.access_control_method', value: accessControlMethod || 'open' },
          { key: 'oidc.access_group_claim', value: accessGroupClaim || 'groups' },
          { key: 'oidc.access_group_value', value: accessGroupValue || '' },
          { key: 'oidc.allowed_emails', value: allowedEmails || '[]' },
          { key: 'oidc.allowed_usernames', value: allowedUsernames || '[]' },
          { key: 'oidc.admin_claim_enabled', value: adminClaimEnabled ? 'true' : 'false' },
          { key: 'oidc.admin_claim_name', value: adminClaimName || 'groups' },
          { key: 'oidc.admin_claim_value', value: adminClaimValue || '' },
        );

        await configService.setMany(updates);

        return NextResponse.json({
          success: true,
          message: 'OIDC settings saved successfully'
        });
      } catch (error) {
        logger.error('Failed to save OIDC settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
