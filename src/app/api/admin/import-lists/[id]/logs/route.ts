/**
 * Component: Import Lists API (sync history)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * GET /api/admin/import-lists/:id/logs   recent sync runs, newest first
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminOnly } from '../../_lib';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return adminOnly(request, async () => {
    const { id } = await params;
    const logs = await prisma.importListSyncLog.findMany({
      where: { importListId: id },
      orderBy: { startedAt: 'desc' },
      take: 25,
    });
    return NextResponse.json({
      logs: logs.map(({ details, ...log }) => {
        let samples: Record<string, string[]> = {};
        try {
          samples = details ? JSON.parse(details).samples ?? {} : {};
        } catch {
          // details are optional
        }
        return { ...log, samples };
      }),
    });
  });
}
