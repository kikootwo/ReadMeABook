/**
 * Component: Import Lists API (status and global settings)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * GET /api/admin/import-lists/status   free space, guards and this hour's request count
 * PUT /api/admin/import-lists/status   { minFreeGb?, maxRequestsPerHour? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { getConfigService } from '@/lib/services/config.service';
import {
  getFreeGb,
  getSettings,
  MAX_REQUESTS_PER_HOUR_KEY,
  MIN_FREE_GB_KEY,
} from '@/lib/services/import-lists/sync.service';
import { GlobalSettingsSchema } from '@/lib/services/import-lists/validation';
import { adminOnly } from '../_lib';

const logger = RMABLogger.create('API.Admin.ImportLists');

async function buildStatus() {
  const [settings, freeGb, recent, lists] = await Promise.all([
    getSettings(),
    getFreeGb(),
    prisma.importListSyncLog.aggregate({
      where: { startedAt: { gt: new Date(Date.now() - 3_600_000) } },
      _sum: { requested: true },
    }),
    prisma.importList.groupBy({ by: ['enabled'], _count: { _all: true } }),
  ]);
  const requestedLastHour = recent._sum.requested ?? 0;
  return {
    freeGb: freeGb === null ? null : Math.round(freeGb),
    minFreeGb: settings.minFreeGb,
    maxRequestsPerHour: settings.maxRequestsPerHour,
    requestedLastHour,
    allowanceLeft: Math.max(0, settings.maxRequestsPerHour - requestedLastHour),
    lowDisk: freeGb !== null && freeGb < settings.minFreeGb,
    lists: {
      enabled: lists.find((l) => l.enabled)?._count._all ?? 0,
      paused: lists.find((l) => !l.enabled)?._count._all ?? 0,
    },
  };
}

export async function GET(request: NextRequest) {
  return adminOnly(request, async () => {
    try {
      return NextResponse.json(await buildStatus());
    } catch (error) {
      logger.error('Failed to read import list status', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to read status' }, { status: 500 });
    }
  });
}

export async function PUT(request: NextRequest) {
  return adminOnly(request, async (req) => {
    try {
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const parsed = GlobalSettingsSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const updates = [];
      if (parsed.data.minFreeGb !== undefined) {
        updates.push({ key: MIN_FREE_GB_KEY, value: String(parsed.data.minFreeGb), category: 'import_lists', description: 'Stop requesting when free space is below this many GB' });
      }
      if (parsed.data.maxRequestsPerHour !== undefined) {
        updates.push({ key: MAX_REQUESTS_PER_HOUR_KEY, value: String(parsed.data.maxRequestsPerHour), category: 'import_lists', description: 'Most requests lists may create per hour' });
      }
      if (updates.length > 0) await getConfigService().setMany(updates);
      return NextResponse.json(await buildStatus());
    } catch (error) {
      logger.error('Failed to save import list settings', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }
  });
}
