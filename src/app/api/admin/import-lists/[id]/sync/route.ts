/**
 * Component: Import Lists API (sync now)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * POST /api/admin/import-lists/:id/sync   queue an immediate sync of one list
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { adminOnly } from '../../_lib';

const logger = RMABLogger.create('API.Admin.ImportLists');

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return adminOnly(request, async () => {
    try {
      const { id } = await params;
      const list = await prisma.importList.findUnique({ where: { id } });
      if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });

      const open = await prisma.importListSyncLog.findFirst({
        where: { importListId: id, completedAt: null, startedAt: { gt: new Date(Date.now() - 2 * 3_600_000) } },
      });
      if (open) return NextResponse.json({ error: 'A sync is already running for this list' }, { status: 409 });

      const jobId = await getJobQueueService().addSyncImportListsJob(undefined, id);
      return NextResponse.json({ success: true, jobId }, { status: 202 });
    } catch (error) {
      logger.error('Failed to queue import list sync', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to queue the sync' }, { status: 500 });
    }
  });
}
