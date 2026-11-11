/**
 * Component: Import List Filter Profiles API (single profile)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * PUT    /api/admin/import-lists/profiles/:profileId
 * DELETE /api/admin/import-lists/profiles/:profileId   lists using it go back to "no filter"
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { toRules } from '@/lib/services/import-lists/filter';
import { FilterProfileSchema } from '@/lib/services/import-lists/validation';
import { adminOnly } from '../../_lib';
import { profileData, serializeProfile } from '../_profile';

const logger = RMABLogger.create('API.Admin.ImportListProfiles');
type Context = { params: Promise<{ profileId: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  return adminOnly(request, async (req) => {
    try {
      const { profileId } = await params;
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const parsed = FilterProfileSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const existing = await prisma.importListFilterProfile.findUnique({ where: { id: profileId } });
      if (!existing) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      if (parsed.data.name !== existing.name && (await prisma.importListFilterProfile.findUnique({ where: { name: parsed.data.name } }))) {
        return NextResponse.json({ error: 'A profile with that name already exists' }, { status: 409 });
      }
      const updated = await prisma.importListFilterProfile.update({
        where: { id: profileId },
        data: profileData(parsed.data),
        include: { _count: { select: { lists: true } } },
      });
      return NextResponse.json({ profile: serializeProfile(updated, toRules(updated)) });
    } catch (error) {
      logger.error('Failed to update filter profile', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to update filter profile' }, { status: 500 });
    }
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return adminOnly(request, async () => {
    try {
      const { profileId } = await params;
      const existing = await prisma.importListFilterProfile.findUnique({ where: { id: profileId } });
      if (!existing) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      await prisma.importListFilterProfile.delete({ where: { id: profileId } });
      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete filter profile', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to delete filter profile' }, { status: 500 });
    }
  });
}
