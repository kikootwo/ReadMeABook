/**
 * Component: Test Audiobookshelf Connection
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSetupIncompleteOrAdmin } from '@/lib/middleware/auth';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudiobookshelfCredential } from '@/lib/services/saved-credentials.service';

export async function POST(request: NextRequest) {
  return requireSetupIncompleteOrAdmin(request, async (req) => {
  try {
    const { serverUrl, apiToken } = await req.json();

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
    const libResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/api/libraries`, {
      headers: {
        'Authorization': `Bearer ${effectiveApiToken}`,
      },
    });

    if (!libResponse.ok) {
      return NextResponse.json(
        { error: `Connection failed: ${libResponse.status} ${libResponse.statusText}` },
        { status: 400 }
      );
    }

    const libData = await libResponse.json();

    // Check if response has libraries array
    if (!libData.libraries || !Array.isArray(libData.libraries)) {
      return NextResponse.json(
        { error: 'Invalid response from Audiobookshelf server' },
        { status: 400 }
      );
    }

    const libraries = libData.libraries
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
