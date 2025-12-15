/**
 * Component: Test Audiobookshelf Connection
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { serverUrl, apiToken } = await request.json();

    if (!serverUrl || !apiToken) {
      return NextResponse.json(
        { error: 'Server URL and API token are required' },
        { status: 400 }
      );
    }

    // Test connection
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/status`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Connection failed: ${response.status} ${response.statusText}` },
        { status: 400 }
      );
    }

    const serverInfo = await response.json();

    // Get libraries
    const libResponse = await fetch(`${serverUrl.replace(/\/$/, '')}/api/libraries`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    const libData = await libResponse.json();
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
        name: serverInfo.name || 'Audiobookshelf',
        version: serverInfo.version,
      },
      libraries,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Connection failed' },
      { status: 500 }
    );
  }
}
