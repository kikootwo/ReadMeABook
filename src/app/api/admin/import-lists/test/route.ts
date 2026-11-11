/**
 * Component: Import Lists API (test)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * POST /api/admin/import-lists/test   { source }   check that Goodreads can be read for a list link or number
 */

import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/utils/request-body';
import { readListMeta } from '@/lib/services/import-lists/goodreads-list.provider';
import { parseListId } from '@/lib/services/import-lists/validation';
import { adminOnly } from '../_lib';

export async function POST(request: NextRequest) {
  return adminOnly(request, async (req) => {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;
    const listId = parseListId(String((body.data as { source?: unknown }).source ?? ''));
    if (!listId) {
      return NextResponse.json({ success: false, error: 'Not a Goodreads list link or number' }, { status: 400 });
    }
    try {
      const meta = await readListMeta(listId);
      return NextResponse.json({ success: true, listId, name: meta.name, size: meta.size });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Could not read the list' },
        { status: 200 },
      );
    }
  });
}
