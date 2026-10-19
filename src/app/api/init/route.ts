/**
 * Component: Internal Startup Initialization Route
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Called only by this process's instrumentation hook over loopback, with the
 * per-process startup secret. Any other caller gets 404. Initialization runs
 * once per process (scheduler + credential migration).
 */

import { NextRequest, NextResponse } from 'next/server';
import { STARTUP_TOKEN_HEADER } from '@/lib/constants/startup';
import { isStartupSecret } from '@/lib/startup/startup-secret';
import { runAppInitOnce } from '@/lib/startup/app-init';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isStartupSecret(request.headers.get(STARTUP_TOKEN_HEADER))) {
    return NextResponse.json({ error: 'NotFound' }, { status: 404 });
  }

  const outcome = await runAppInitOnce();

  if (outcome === 'initialized' || outcome === 'already-initialized') {
    return NextResponse.json({ success: true, alreadyInitialized: outcome === 'already-initialized' });
  }
  if (outcome === 'not-ready') {
    return NextResponse.json({ success: false, error: 'Services not ready' }, { status: 503 });
  }
  return NextResponse.json({ success: false, error: 'Initialization failed' }, { status: 500 });
}
