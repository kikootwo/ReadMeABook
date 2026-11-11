/**
 * Component: Import Lists API (bulk actions)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * POST /api/admin/import-lists/bulk   { ids, action: enable | disable | delete | set_profile | set_auto_request }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { BulkActionSchema } from '@/lib/services/import-lists/validation';
import { adminOnly } from '../_lib';

const logger = RMABLogger.create('API.Admin.ImportLists');

export async function POST(request: NextRequest) {
  return adminOnly(request, async (req) => {
    try {
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const parsed = BulkActionSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const { ids, action } = parsed.data;
      const where = { id: { in: ids } };

      let count = 0;
      switch (action) {
        case 'enable':
          count = (await prisma.importList.updateMany({ where, data: { enabled: true } })).count;
          break;
        case 'disable':
          count = (await prisma.importList.updateMany({ where, data: { enabled: false } })).count;
          break;
        case 'delete':
          count = (await prisma.importList.deleteMany({ where })).count;
          break;
        case 'set_auto_request':
          if (parsed.data.autoRequest === undefined) return NextResponse.json({ error: 'autoRequest is required' }, { status: 400 });
          count = (await prisma.importList.updateMany({ where, data: { autoRequest: parsed.data.autoRequest } })).count;
          break;
        case 'set_profile': {
          const profileId = parsed.data.filterProfileId ?? null;
          if (profileId && !(await prisma.importListFilterProfile.findUnique({ where: { id: profileId } }))) {
            return NextResponse.json({ error: 'Filter profile not found' }, { status: 400 });
          }
          count = (await prisma.importList.updateMany({ where, data: { filterProfileId: profileId } })).count;
          break;
        }
      }
      return NextResponse.json({ success: true, count });
    } catch (error) {
      logger.error('Bulk import list action failed', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Bulk action failed' }, { status: 500 });
    }
  });
}
