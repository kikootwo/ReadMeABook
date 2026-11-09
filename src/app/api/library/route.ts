/**
 * Component: Library API (GET /api/library, list + live mode)
 * Documentation: documentation/features/library-view.md
 *
 * Every signed-in role; not on the API-token allowlist. Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { parseLibraryParams } from '@/lib/library-view/params';
import { getLibraryLive, getLibraryPage } from '@/lib/library-view/service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Library');

async function handle(req: AuthenticatedRequest): Promise<NextResponse> {
  if (!req.user) {
    return NextResponse.json({ error: 'Unauthorized', message: 'User not authenticated' }, { status: 401 });
  }

  const parsed = parseLibraryParams(req.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, message: parsed.message }, { status: 400 });
  }

  try {
    if (parsed.params.live) {
      return NextResponse.json(await getLibraryLive());
    }
    const viewer = { id: req.user.id, isAdmin: req.user.role === 'admin' };
    return NextResponse.json(await getLibraryPage(parsed.params, viewer));
  } catch (error) {
    logger.error('Failed to load the library', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'InternalError', message: 'Failed to load the library' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return requireAuth(request, handle);
}
