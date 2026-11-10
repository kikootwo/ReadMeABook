/**
 * Component: Admin Add Torrent API (a magnet link or a .torrent file for one request)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * Admin sessions only: an API token is refused by requireAuth (no allowlist entry), a non-admin by
 * requireAdmin, both before the body is read or any request is looked up.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager } from '@/lib/services/download-client-manager.service';
import { checkAddableMagnet } from '@/lib/services/download-selection-guard';
import { magnetHashes } from '@/lib/integrations/torrent-ids';
import { manualFileResult, manualMagnetResult, readUploadedTorrent, type UploadedTorrent } from '@/lib/services/manual-torrent';
import { ADVANCEABLE_FROM_INTERACTIVE_SEARCH } from '@/lib/constants/request-statuses';
import { NO_TORRENT_CLIENT_MESSAGE } from '@/lib/constants/manual-torrent';
import { readJsonBody, TORRENT_UPLOAD_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { RMABLogger } from '@/lib/utils/logger';
import type { TorrentResult } from '@/lib/utils/ranking-algorithm';

const logger = RMABLogger.create('API.Admin.Requests.AddTorrent');

const BodySchema = z.object({ magnet: z.string().optional(), torrentFile: z.string().optional() });

const fail = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });

/** Refusal for a request outside ADVANCEABLE_FROM_INTERACTIVE_SEARCH */
function statusRefusal(status: string): NextResponse {
  if (status === 'awaiting_approval') return fail(409, 'AwaitingApproval', 'Approve this request before adding a torrent.');
  if (status === 'denied') return fail(409, 'RequestDenied', 'This request was denied.');
  return fail(409, 'InvalidStatus', `A torrent can only be added to a pending, failed or waiting request (this one is ${status.replace(/_/g, ' ')}).`);
}

/**
 * POST /api/admin/requests/[id]/add-torrent
 * Body (JSON): { magnet } or { torrentFile } (base64). Queues the normal download job.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody<unknown>(req, {
          maxBytes: TORRENT_UPLOAD_JSON_BODY_LIMIT_BYTES,
          requireJsonContentType: true,
          fallback: null,
        });
        if (!bodyResult.ok) return bodyResult.response;
        const body = BodySchema.safeParse(bodyResult.data);
        if (!body.success) return fail(400, 'ValidationError', 'Send a magnet link or a .torrent file.');
        const { magnet, torrentFile } = body.data;
        if ((magnet === undefined) === (torrentFile === undefined)) {
          return fail(400, 'ValidationError', 'Send either a magnet link or a .torrent file.');
        }

        // The torrent itself, checked before any request is looked up
        let torrent: TorrentResult;
        let file: UploadedTorrent | undefined;
        if (torrentFile !== undefined) {
          const upload = await readUploadedTorrent(torrentFile);
          if (!upload.ok) return fail(400, 'ValidationError', upload.error);
          file = upload.value;
          torrent = manualFileResult(file);
        } else {
          const checked = await checkAddableMagnet(magnet);
          if (!checked.ok) return fail(400, 'ValidationError', checked.error);
          torrent = manualMagnetResult(checked.value, magnetHashes(checked.value)!.v1!);
        }

        const { id } = await params;
        const record = await prisma.request.findFirst({ where: { id, deletedAt: null }, include: { audiobook: true } });
        if (!record) return fail(404, 'NotFound', 'Request not found.');
        if (record.type !== 'audiobook') return fail(409, 'NotAudiobook', 'Add Torrent is for audiobook requests only.');
        if (!(ADVANCEABLE_FROM_INTERACTIVE_SEARCH as readonly string[]).includes(record.status)) {
          return statusRefusal(record.status);
        }

        const manager = getDownloadClientManager(await getConfigService());
        if (!(await manager.getClientForProtocol('torrent'))) return fail(409, 'NoDownloadClient', NO_TORRENT_CLIENT_MESSAGE);

        // Claim: only the status read above moves to downloading (a double submit, cancel or delete loses)
        const claim = await prisma.request.updateMany({
          where: { id, deletedAt: null, status: record.status },
          data: { status: 'downloading', progress: 0, errorMessage: null, autoRerequestCount: 0, updatedAt: new Date() },
        });
        if (claim.count === 0) return fail(409, 'RequestChanged', 'This request changed; refresh and try again.');

        const audiobook = { id: record.audiobook.id, title: record.audiobook.title, author: record.audiobook.author };
        try {
          await getJobQueueService().addDownloadJob(
            id, audiobook, torrent, [], undefined, file && { data: file.data, infoHash: file.infoHash }
          );
        } catch (error) {
          // Undo everything the claim changed. If the queue took the job and only its row update threw,
          // the job still runs and moves the request on; a second submit then meets a request that is
          // no longer in this status (or, rarely, queues a second add, which the client takes over as a duplicate).
          await prisma.request.updateMany({
            where: { id, status: 'downloading' },
            data: { status: record.status, progress: record.progress, errorMessage: record.errorMessage, autoRerequestCount: record.autoRerequestCount },
          });
          throw error;
        }

        logger.info('Admin added a torrent to a request', {
          requestId: id,
          adminId: req.user!.id,
          source: file ? 'file' : 'magnet',
          infoHash: torrent.infoHash,
          bytes: file?.data.length ?? null,
        });
        return NextResponse.json({ success: true, request: { id, status: 'downloading' }, message: 'Torrent added.' });
      } catch (error) {
        logger.error('Failed to add a torrent', { error: error instanceof Error ? error.message : String(error) });
        return fail(500, 'AddTorrentError', 'The torrent could not be added. Try again.');
      }
    });
  });
}
