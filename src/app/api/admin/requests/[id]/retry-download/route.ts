/**
 * Component: Admin Retry Download API
 * Documentation: documentation/admin-dashboard.md
 *
 * Retries a failed download by either resuming monitoring of a still-alive
 * download in the client, or re-adding the download using metadata from the
 * most recent selected DownloadHistory record.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager } from '@/lib/services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '@/lib/interfaces/download-client.interface';
import { TorrentResult } from '@/lib/utils/ranking-algorithm';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Requests.RetryDownload');

/** Download statuses considered "alive" — monitoring can be resumed */
const ALIVE_STATUSES = new Set([
  'downloading',
  'queued',
  'paused',
  'checking',
  'seeding',
  'completed',
]);

/**
 * POST /api/admin/requests/[id]/retry-download
 * Retry a failed download for an admin request.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        if (!req.user) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'User not authenticated' },
            { status: 401 }
          );
        }

        const { id } = await params;

        // Fetch the request with audiobook info
        const existingRequest = await prisma.request.findFirst({
          where: { id, deletedAt: null },
          include: {
            audiobook: true,
          },
        });

        if (!existingRequest) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Request not found' },
            { status: 404 }
          );
        }

        if (existingRequest.status !== 'failed') {
          return NextResponse.json(
            {
              error: 'InvalidStatus',
              message: `Request is not in a failed state (current status: ${existingRequest.status})`,
              currentStatus: existingRequest.status,
            },
            { status: 400 }
          );
        }

        // Find the most recent selected DownloadHistory record
        const downloadHistory = await prisma.downloadHistory.findFirst({
          where: { requestId: id, selected: true },
          orderBy: { createdAt: 'desc' },
        });

        if (!downloadHistory) {
          return NextResponse.json(
            {
              error: 'NoHistory',
              message: 'No previous download attempt found to retry',
            },
            { status: 400 }
          );
        }

        // Require a download URL to be able to re-add
        if (!downloadHistory.magnetLink) {
          return NextResponse.json(
            {
              error: 'NoDownloadUrl',
              message: 'No download URL available in history to retry',
            },
            { status: 400 }
          );
        }

        const jobQueue = getJobQueueService();
        let retryPath: 'resumed_monitoring' | 're_added';

        // Determine if we can attempt to resume monitoring.
        // downloadClient is stored as a plain string in the DB (can be 'qbittorrent', 'sabnzbd',
        // 'nzbget', 'transmission', 'deluge', 'direct', or null).
        const rawClientType: string | null = downloadHistory.downloadClient;
        const clientId = downloadHistory.downloadClientId;
        const isDirect = rawClientType === 'direct';

        // Only attempt to query the download client if we have a known DownloadClientType,
        // a clientId, and it is not a direct (HTTP) download.
        const canCheckClient = !isDirect && !!rawClientType && !!clientId;
        // Safe to cast here: we have already confirmed rawClientType is non-null and non-direct
        const clientType = rawClientType as DownloadClientType | null;

        if (canCheckClient) {
          // Try to look up the download in the client
          try {
            const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
            const configService = getConfigService();
            const manager = getDownloadClientManager(configService);
            const client = await manager.getClientServiceForProtocol(protocol);

            if (client) {
              const downloadInfo = await client.getDownload(clientId!);

              if (downloadInfo && ALIVE_STATUSES.has(downloadInfo.status)) {
                // Download is still alive — restart monitoring
                logger.info(`Retry download: resuming monitoring for request ${id}`, {
                  requestId: id,
                  downloadClientId: clientId,
                  downloadStatus: downloadInfo.status,
                  adminId: req.user.sub,
                });

                await jobQueue.addMonitorJob(
                  id,
                  downloadHistory.id,
                  clientId!, // canCheckClient guard ensures clientId is non-null
                  clientType as DownloadClientType,
                  0 // no delay — start immediately
                );

                retryPath = 'resumed_monitoring';
              } else {
                // Download not found or is failed — re-add
                logger.info(`Retry download: download not alive (status: ${downloadInfo?.status ?? 'not found'}), re-adding for request ${id}`, {
                  requestId: id,
                  adminId: req.user.sub,
                });

                await reAddDownload(jobQueue, id, existingRequest.audiobook, downloadHistory);
                retryPath = 're_added';
              }
            } else {
              // No client configured for that protocol — fall through to re-add
              logger.warn(`Retry download: no ${protocol} client configured, re-adding for request ${id}`, {
                requestId: id,
                adminId: req.user.sub,
              });

              await reAddDownload(jobQueue, id, existingRequest.audiobook, downloadHistory);
              retryPath = 're_added';
            }
          } catch (clientError) {
            // Client lookup failed (connection error etc.) — re-add to be safe
            logger.warn(`Retry download: client check failed, re-adding for request ${id}`, {
              requestId: id,
              error: clientError instanceof Error ? clientError.message : String(clientError),
              adminId: req.user.sub,
            });

            await reAddDownload(jobQueue, id, existingRequest.audiobook, downloadHistory);
            retryPath = 're_added';
          }
        } else {
          // Direct download (ebook), no clientId, or no clientType — re-add
          logger.info(`Retry download: re-adding for request ${id} (direct=${isDirect}, hasClientId=${!!clientId})`, {
            requestId: id,
            adminId: req.user.sub,
          });

          await reAddDownload(jobQueue, id, existingRequest.audiobook, downloadHistory);
          retryPath = 're_added';
        }

        // Increment downloadAttempts, clear errorMessage, set status to downloading
        await prisma.request.update({
          where: { id },
          data: {
            status: 'downloading',
            errorMessage: null,
            downloadAttempts: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        const message =
          retryPath === 'resumed_monitoring'
            ? 'Download monitoring resumed'
            : 'Download re-added to client';

        logger.info(`Retry download completed for request ${id} via ${retryPath}`, {
          requestId: id,
          adminId: req.user.sub,
          path: retryPath,
        });

        return NextResponse.json({
          success: true,
          message,
          path: retryPath,
        });
      } catch (error) {
        logger.error('Failed to retry download', {
          error: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json(
          {
            error: 'RetryError',
            message: 'Failed to retry download',
          },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * Re-add the download to the queue using metadata from DownloadHistory.
 * Reconstructs a TorrentResult from the stored history fields.
 */
async function reAddDownload(
  jobQueue: ReturnType<typeof getJobQueueService>,
  requestId: string,
  audiobook: { id: string; title: string; author: string },
  history: {
    torrentName: string | null;
    magnetLink: string | null;
    indexerName: string;
    indexerId: number | null;
    torrentSizeBytes: bigint | null;
    seeders: number | null;
    leechers: number | null;
    torrentHash: string | null;
    torrentUrl: string | null;
  }
): Promise<void> {
  const torrent: TorrentResult = {
    title: history.torrentName ?? audiobook.title,
    downloadUrl: history.magnetLink!, // Validated non-null before calling this function
    indexer: history.indexerName,
    indexerId: history.indexerId ?? undefined,
    size: history.torrentSizeBytes !== null ? Number(history.torrentSizeBytes) : 0,
    seeders: history.seeders ?? undefined,
    leechers: history.leechers ?? undefined,
    infoHash: history.torrentHash ?? undefined,
    infoUrl: history.torrentUrl ?? undefined,
    guid: history.torrentUrl ?? history.magnetLink!,
    publishDate: new Date(), // Not stored; use current date as a safe default
  };

  await jobQueue.addDownloadJob(requestId, audiobook, torrent);
}
