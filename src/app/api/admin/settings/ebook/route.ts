/**
 * Component: E-book Sidecar Settings API
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Ebook');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Parse request body - new structure with separate source toggles
        const { annasArchiveEnabled, indexerSearchEnabled, format, baseUrl, flaresolverrUrl, autoGrabEnabled, kindleFixEnabled } = await request.json();

        // Enforce: auto-grab must be false if no sources are enabled
        const effectiveAutoGrabEnabled = (annasArchiveEnabled || indexerSearchEnabled) ? (autoGrabEnabled ?? true) : false;

        // Validate format
        const validFormats = ['epub', 'pdf', 'mobi', 'azw3', 'any'];
        if (format && !validFormats.includes(format)) {
          return NextResponse.json(
            { error: `Invalid format. Must be one of: ${validFormats.join(', ')}` },
            { status: 400 }
          );
        }

        // Validate baseUrl (basic check) - only required if Anna's Archive is enabled
        if (annasArchiveEnabled && baseUrl && !baseUrl.startsWith('http')) {
          return NextResponse.json(
            { error: 'Base URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        // Validate flaresolverrUrl if provided
        if (flaresolverrUrl && !flaresolverrUrl.startsWith('http')) {
          return NextResponse.json(
            { error: 'FlareSolverr URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        // Save configuration
        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        const configs = [
          // New granular source toggles
          {
            key: 'ebook_annas_archive_enabled',
            value: annasArchiveEnabled ? 'true' : 'false',
            category: 'ebook',
            description: 'Enable e-book downloads from Anna\'s Archive',
          },
          {
            key: 'ebook_indexer_search_enabled',
            value: indexerSearchEnabled ? 'true' : 'false',
            category: 'ebook',
            description: 'Enable e-book downloads via indexer search (Prowlarr)',
          },
          // General settings
          {
            key: 'ebook_sidecar_preferred_format',
            value: format || 'epub',
            category: 'ebook',
            description: 'Preferred e-book format',
          },
          {
            key: 'ebook_auto_grab_enabled',
            value: effectiveAutoGrabEnabled ? 'true' : 'false',
            category: 'ebook',
            description: 'Automatically create ebook requests after audiobook downloads complete',
          },
          // Anna's Archive specific settings
          {
            key: 'ebook_sidecar_base_url',
            value: baseUrl || 'https://annas-archive.li',
            category: 'ebook',
            description: 'Base URL for Anna\'s Archive',
          },
          {
            key: 'ebook_sidecar_flaresolverr_url',
            value: flaresolverrUrl || '',
            category: 'ebook',
            description: 'FlareSolverr URL for bypassing Cloudflare protection',
          },
          // Kindle compatibility
          {
            key: 'ebook_kindle_fix_enabled',
            value: kindleFixEnabled ? 'true' : 'false',
            category: 'ebook',
            description: 'Apply compatibility fixes to EPUB files for Kindle import',
          },
        ];

        await configService.setMany(configs);

        return NextResponse.json({ success: true });
      } catch (error) {
        logger.error('Failed to save e-book settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
