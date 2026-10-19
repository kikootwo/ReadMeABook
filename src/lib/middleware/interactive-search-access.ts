/**
 * Component: Interactive Search Access Guard
 * Documentation: documentation/phase3/download-clients.md
 *
 * Server-side enforcement of the per-user `interactiveSearchAccess` permission
 * for every route that searches indexers or accepts a user-picked release.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveInteractiveSearchAccess } from '@/lib/utils/permissions';

export const INTERACTIVE_SEARCH_FORBIDDEN_MESSAGE =
  'You do not have interactive search access. Contact your admin to enable this permission.';

/** Returns a 403 response when the user lacks interactive search access, otherwise null. */
export async function denyWithoutInteractiveSearchAccess(userId: string | undefined): Promise<NextResponse | null> {
  const callingUser = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, interactiveSearchAccess: true },
      })
    : null;

  if (callingUser && (await resolveInteractiveSearchAccess(callingUser.role, callingUser.interactiveSearchAccess))) {
    return null;
  }

  return NextResponse.json(
    { error: 'Forbidden', message: INTERACTIVE_SEARCH_FORBIDDEN_MESSAGE },
    { status: 403 }
  );
}
