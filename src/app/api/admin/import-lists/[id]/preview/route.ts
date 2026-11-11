/**
 * Component: Import Lists API (preview)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * POST /api/admin/import-lists/:id/preview   start a preview (requests nothing)
 * GET  /api/admin/import-lists/:id/preview   progress and results so far
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getPreview, startPreview } from '@/lib/services/import-lists/preview.service';
import { adminOnly } from '../../_lib';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  return adminOnly(request, async () => {
    const { id } = await params;
    const list = await prisma.importList.findUnique({ where: { id } });
    if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });
    return NextResponse.json({ preview: startPreview(id) }, { status: 202 });
  });
}

export async function GET(request: NextRequest, { params }: Context) {
  return adminOnly(request, async () => {
    const { id } = await params;
    return NextResponse.json({ preview: getPreview(id) });
  });
}
