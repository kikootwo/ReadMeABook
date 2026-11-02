/**
 * Component: Test Audiobookshelf Connection
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSetupIncompleteOrAdmin } from '@/lib/middleware/auth';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudiobookshelfCredential } from '@/lib/services/saved-credentials.service';
import { readJsonBody } from '@/lib/utils/request-body';
import { apiSuffixHint, describeFetchError, fetchErrorDetails } from '@/lib/utils/fetch-error';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Setup.TestABS');

export async function POST(request: NextRequest) {
  return requireSetupIncompleteOrAdmin(request, async (req) => {
  try {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const { serverUrl, apiToken } = bodyResult.data;

    if (!serverUrl) {
      return NextResponse.json(
        { error: 'Server URL is required' },
        { status: 400 }
      );
    }

    // A masked or empty token reuses the saved one — but only for the saved server URL
    const token = await resolveSecretForUrl({
      kind: 'audiobookshelf',
      url: serverUrl,
      supplied: apiToken,
      emptyMeansSaved: true,
      missingMessage: 'API token is required',
      loadSaved: savedAudiobookshelfCredential,
    });
    if (!token.ok) {
      return NextResponse.json({ error: token.error }, { status: 400 });
    }
    const effectiveApiToken = token.secret;

    // Test connection by fetching libraries (which also validates auth)
    const librariesUrl = `${serverUrl.replace(/\/$/, '')}/api/libraries`;
    let libResponse: Response;
    try {
      libResponse = await fetch(librariesUrl, {
        headers: {
          'Authorization': `Bearer ${effectiveApiToken}`,
        },
      });
    } catch (error) {
      // Node's fetch says only "fetch failed"; the reason is on error.cause
      const secrets = [effectiveApiToken, apiToken];
      const reason = describeFetchError(error, librariesUrl, { service: 'Audiobookshelf', secrets });
      logger.error('Audiobookshelf connection test failed', { reason, ...fetchErrorDetails(error, librariesUrl, secrets) });
      return NextResponse.json({ error: reason }, { status: 500 });
    }

    if (!libResponse.ok) {
      const hint = apiSuffixHint(serverUrl);
      return NextResponse.json(
        { error: `Connection failed: ${libResponse.status} ${libResponse.statusText}${hint ? `. ${hint}` : ''}` },
        { status: 400 }
      );
    }

    let libData: { libraries?: unknown } | null;
    try {
      libData = await libResponse.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid response from Audiobookshelf server: the answer was not JSON. Check that the URL points at Audiobookshelf.' },
        { status: 400 }
      );
    }

    // Check if response has libraries array
    const rawLibraries = libData?.libraries;
    if (!Array.isArray(rawLibraries)) {
      return NextResponse.json(
        { error: 'Invalid response from Audiobookshelf server' },
        { status: 400 }
      );
    }

    const libraries = rawLibraries
      .filter((lib: any) => lib.mediaType === 'book')
      .map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        itemCount: lib.stats?.totalItems || 0,
      }));

    return NextResponse.json({
      success: true,
      serverInfo: {
        name: 'Audiobookshelf',
        version: 'Connected',
      },
      libraries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Connection failed' },
      { status: 500 }
    );
  }
  });
}
