/**
 * Component: Setup Wizard Test Download Client API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';

export async function POST(request: NextRequest) {
  try {
    const { type, url, username, password } = await request.json();

    if (!type || !url || !username || !password) {
      return NextResponse.json(
        { success: false, error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (type !== 'qbittorrent') {
      return NextResponse.json(
        { success: false, error: 'Only qBittorrent is currently supported' },
        { status: 400 }
      );
    }

    // Test connection with custom credentials
    const version = await QBittorrentService.testConnectionWithCredentials(
      url,
      username,
      password
    );

    return NextResponse.json({
      success: true,
      version,
    });
  } catch (error) {
    console.error('[Setup] Download client test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to download client',
      },
      { status: 500 }
    );
  }
}
