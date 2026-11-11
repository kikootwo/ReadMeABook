/**
 * Component: Import Lists API (single list)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * GET    /api/admin/import-lists/:id
 * PUT    /api/admin/import-lists/:id   change settings
 * DELETE /api/admin/import-lists/:id   remove the list (requests already made stay)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { ListSettingsSchema } from '@/lib/services/import-lists/validation';
import { adminOnly, LIST_INCLUDE, serializeList } from '../_lib';

const logger = RMABLogger.create('API.Admin.ImportLists');
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  return adminOnly(request, async () => {
    const { id } = await params;
    const list = await prisma.importList.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });
    return NextResponse.json({ list: serializeList(list) });
  });
}

export async function PUT(request: NextRequest, { params }: Context) {
  return adminOnly(request, async (req) => {
    try {
      const { id } = await params;
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const parsed = ListSettingsSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const existing = await prisma.importList.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: 'List not found' }, { status: 404 });

      if (parsed.data.name && parsed.data.name !== existing.name) {
        const taken = await prisma.importList.findUnique({ where: { name: parsed.data.name } });
        if (taken) return NextResponse.json({ error: 'Another list already has that name' }, { status: 409 });
      }
      if (parsed.data.filterProfileId) {
        const profile = await prisma.importListFilterProfile.findUnique({ where: { id: parsed.data.filterProfileId } });
        if (!profile) return NextResponse.json({ error: 'Filter profile not found' }, { status: 400 });
      }

      const updated = await prisma.importList.update({ where: { id }, data: parsed.data, include: LIST_INCLUDE });
      return NextResponse.json({ list: serializeList(updated) });
    } catch (error) {
      logger.error('Failed to update import list', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to update import list' }, { status: 500 });
    }
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return adminOnly(request, async () => {
    try {
      const { id } = await params;
      const existing = await prisma.importList.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: 'List not found' }, { status: 404 });
      await prisma.importList.delete({ where: { id } });
      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete import list', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to delete import list' }, { status: 500 });
    }
  });
}
