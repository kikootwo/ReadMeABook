/**
 * Component: Manual Torrent Download API
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager } from '@/lib/services/download-client-manager.service';
import { TorrentResult } from '@/lib/utils/ranking-algorithm';
import { RMABLogger } from '@/lib/utils/logger';
import * as parseTorrentModule from 'parse-torrent';

// Handle both ESM and CommonJS imports (same pattern as the download client services)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;

const logger = RMABLogger.create('API.ManualDownload');

/** Statuses a manual torrent may be attached to (mirrors manual-search) */
const MANUAL_DOWNLOADABLE_STATUSES = ['pending', 'failed', 'awaiting_search', 'awaiting_release'];

/** Magnet links must carry a BitTorrent info hash */
const MAGNET_PATTERN = /^magnet:\?.*xt=urn:btih:[a-zA-Z0-9]+/i;

/** Upload ceiling for .torrent files */
const MAX_TORRENT_FILE_BYTES = 5 * 1024 * 1024;

interface ParsedTorrentFile {
  infoHash?: string;
  name?: string;
  announce?: string[];
}

/**
 * Build a magnet URI from a parsed .torrent file.
 * parse-torrent v11 exposes the decoded metadata (infoHash/name/announce) rather
 * than a ready-made magnet, so the URI is assembled here.
 */
function buildMagnetFromParsedTorrent(parsed: ParsedTorrentFile | null | undefined): string | null {
  const infoHash = parsed?.infoHash;
  if (!infoHash) {
    return null;
  }

  const params = [`xt=urn:btih:${infoHash}`];
  if (parsed?.name) {
    params.push(`dn=${encodeURIComponent(parsed.name)}`);
  }
  for (const tracker of parsed?.announce || []) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }

  return `magnet:?${params.join('&')}`;
}

/**
 * POST /api/requests/[id]/manual-download
 * Attach a user-supplied magnet link or .torrent file to a request and hand it
 * to the configured torrent client via the normal download pipeline.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      if (!MANUAL_DOWNLOADABLE_STATUSES.includes(requestRecord.status)) {
        return NextResponse.json(
          {
            error: 'InvalidStatus',
            message: `Cannot add a manual torrent to a request with status: ${requestRecord.status}`,
          },
          { status: 409 }
        );
      }

      // Parse multipart body (magnet text field and/or .torrent file field)
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Expected multipart/form-data body' },
          { status: 400 }
        );
      }

      const magnetField = formData.get('magnet');
      const magnetInput = typeof magnetField === 'string' ? magnetField.trim() : '';
      const fileField = formData.get('file');
      const torrentFile =
        fileField && typeof fileField !== 'string' && (fileField as File).size > 0
          ? (fileField as File)
          : null;

      if (!magnetInput && !torrentFile) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Provide a magnet link or a .torrent file' },
          { status: 400 }
        );
      }

      if (magnetInput && torrentFile) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Provide either a magnet link or a .torrent file, not both' },
          { status: 400 }
        );
      }

      let magnetUri: string;
      let sourceLabel: string;

      if (magnetInput) {
        if (!MAGNET_PATTERN.test(magnetInput)) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Invalid magnet link' },
            { status: 400 }
          );
        }
        magnetUri = magnetInput;
        sourceLabel = 'magnet';
      } else {
        const file = torrentFile as File;

        if (!file.name?.toLowerCase().endsWith('.torrent')) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'File must be a .torrent file' },
            { status: 400 }
          );
        }

        if (file.size > MAX_TORRENT_FILE_BYTES) {
          return NextResponse.json(
            { error: 'ValidationError', message: '.torrent file must be 5 MB or smaller' },
            { status: 400 }
          );
        }

        let derivedMagnet: string | null = null;
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const parsed = (await parseTorrent(buffer)) as ParsedTorrentFile;
          derivedMagnet = buildMagnetFromParsedTorrent(parsed);
        } catch (error) {
          logger.warn('Failed to parse uploaded .torrent file', {
            error: error instanceof Error ? error.message : String(error),
          });
        }

        if (!derivedMagnet || !MAGNET_PATTERN.test(derivedMagnet)) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Invalid .torrent file' },
            { status: 400 }
          );
        }

        magnetUri = derivedMagnet;
        sourceLabel = file.name;
      }

      // A torrent client must be configured - manual uploads always take the magnet path
      const config = await getConfigService();
      const manager = getDownloadClientManager(config);
      const torrentClient = await manager.getClientForProtocol('torrent');

      if (!torrentClient) {
        return NextResponse.json(
          {
            error: 'NoDownloadClient',
            message: 'No torrent download client configured. Please add a torrent client in Settings > Download Clients.',
          },
          { status: 409 }
        );
      }

      const torrent: TorrentResult = {
        title: 'Manual torrent',
        downloadUrl: magnetUri,
        size: 0,
        indexer: 'manual',
        guid: magnetUri,
        publishDate: new Date(),
        protocol: 'torrent',
        format: 'OTHER',
      };

      const jobQueue = getJobQueueService();
      await jobQueue.addDownloadJob(
        id,
        {
          id: requestRecord.audiobook.id,
          title: requestRecord.audiobook.title,
          author: requestRecord.audiobook.author,
        },
        torrent
      );

      logger.info(`Manual torrent queued for request ${id}`, {
        source: sourceLabel,
        userId: req.user.id,
      });

      const updated = await prisma.request.update({
        where: { id },
        data: {
          status: 'downloading',
          progress: 0,
          errorMessage: null,
          updatedAt: new Date(),
        },
        include: {
          audiobook: true,
        },
      });

      return NextResponse.json({
        success: true,
        request: updated,
        message: 'Manual torrent download initiated',
      });
    } catch (error) {
      logger.error('Failed to start manual torrent download', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        {
          error: 'DownloadError',
          message: error instanceof Error ? error.message : 'Failed to start manual torrent download',
        },
        { status: 500 }
      );
    }
  });
}
