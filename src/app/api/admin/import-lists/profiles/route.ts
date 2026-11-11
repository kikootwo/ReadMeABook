/**
 * Component: Import List Filter Profiles API (collection)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * GET  /api/admin/import-lists/profiles
 * POST /api/admin/import-lists/profiles
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { ensureSeedProfiles } from '@/lib/services/import-lists/sync.service';
import { toRules } from '@/lib/services/import-lists/filter';
import { FilterProfileSchema } from '@/lib/services/import-lists/validation';
import { adminOnly } from '../_lib';
import { profileData, serializeProfile } from './_profile';

const logger = RMABLogger.create('API.Admin.ImportListProfiles');

export async function GET(request: NextRequest) {
  return adminOnly(request, async () => {
    try {
      await ensureSeedProfiles();
      const profiles = await prisma.importListFilterProfile.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { lists: true } } },
      });
      return NextResponse.json({ profiles: profiles.map((p) => serializeProfile(p, toRules(p))) });
    } catch (error) {
      logger.error('Failed to list filter profiles', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to list filter profiles' }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return adminOnly(request, async (req) => {
    try {
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const parsed = FilterProfileSchema.safeParse(body.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      if (await prisma.importListFilterProfile.findUnique({ where: { name: parsed.data.name } })) {
        return NextResponse.json({ error: 'A profile with that name already exists' }, { status: 409 });
      }
      const created = await prisma.importListFilterProfile.create({
        data: profileData(parsed.data),
        include: { _count: { select: { lists: true } } },
      });
      return NextResponse.json({ profile: serializeProfile(created, toRules(created)) }, { status: 201 });
    } catch (error) {
      logger.error('Failed to create filter profile', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to create filter profile' }, { status: 500 });
    }
  });
}
