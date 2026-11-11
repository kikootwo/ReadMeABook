/**
 * Component: Import Lists API (collection)
 * Documentation: documentation/backend/services/list-sync.md
 *
 * GET  /api/admin/import-lists   list every import list with its status
 * POST /api/admin/import-lists   add one list ({ source }) or many ({ sources: [...] })
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { ensureSeedProfiles } from '@/lib/services/import-lists/sync.service';
import { readListMeta } from '@/lib/services/import-lists/goodreads-list.provider';
import { CreateListSchema, parseListId } from '@/lib/services/import-lists/validation';
import { adminOnly, LIST_INCLUDE, serializeList } from './_lib';

const logger = RMABLogger.create('API.Admin.ImportLists');

export async function GET(request: NextRequest) {
  return adminOnly(request, async () => {
    try {
      await ensureSeedProfiles();
      const lists = await prisma.importList.findMany({ include: LIST_INCLUDE, orderBy: { name: 'asc' } });
      return NextResponse.json({ lists: lists.map(serializeList) });
    } catch (error) {
      logger.error('Failed to list import lists', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to list import lists' }, { status: 500 });
    }
  });
}

async function addOne(source: string, settings: Record<string, unknown>) {
  const listId = parseListId(source);
  if (!listId) return { ok: false as const, source, error: 'Not a Goodreads list link or number' };

  const duplicate = await prisma.importList.findUnique({ where: { provider_listId: { provider: 'goodreads-list', listId } } });
  if (duplicate) return { ok: false as const, source, error: `Already added as "${duplicate.name}"` };

  let meta: { name: string; size: number };
  try {
    meta = await readListMeta(listId);
  } catch (error) {
    return { ok: false as const, source, error: error instanceof Error ? error.message : 'Could not read the list' };
  }

  const name = typeof settings.name === 'string' && settings.name ? settings.name : meta.name;
  const taken = await prisma.importList.findUnique({ where: { name } });
  const created = await prisma.importList.create({
    data: {
      name: taken ? `${name} (#${listId})` : name,
      listId,
      sourceSize: meta.size,
      enabled: settings.enabled === undefined ? true : Boolean(settings.enabled),
      autoRequest: settings.autoRequest === undefined ? true : Boolean(settings.autoRequest),
      syncIntervalHours: (settings.syncIntervalHours as number) ?? 24,
      topN: (settings.topN as number) ?? 100,
      maxRequestsPerSync: (settings.maxRequestsPerSync as number) ?? 0,
      filterProfileId: (settings.filterProfileId as string | null | undefined) ?? null,
    },
    include: LIST_INCLUDE,
  });
  return { ok: true as const, source, list: serializeList(created) };
}

export async function POST(request: NextRequest) {
  return adminOnly(request, async (req) => {
    try {
      const body = await readJsonBody(req);
      if (!body.ok) return body.response;
      const data = body.data as Record<string, unknown>;

      // Several lists at once: { sources: ["…/list/show/135", "264", …], …shared settings }
      if (Array.isArray(data.sources)) {
        const { sources, ...shared } = data as { sources: unknown[] } & Record<string, unknown>;
        if (sources.length === 0 || sources.length > 200) {
          return NextResponse.json({ error: 'Provide between 1 and 200 lists' }, { status: 400 });
        }
        const results = [];
        for (const source of sources) {
          // Shared settings apply to every list; names always come from Goodreads for a batch
          results.push(await addOne(String(source), { ...shared, name: undefined }));
        }
        return NextResponse.json({
          added: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      }

      const parsed = CreateListSchema.safeParse(data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const result = await addOne(parsed.data.source, parsed.data);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ list: result.list }, { status: 201 });
    } catch (error) {
      logger.error('Failed to add import list', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to add import list' }, { status: 500 });
    }
  });
}
