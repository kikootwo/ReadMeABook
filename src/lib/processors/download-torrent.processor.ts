/**
 * Component: Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { DownloadTorrentPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { ProwlarrService } from '../integrations/prowlarr.service';
import { getProwlarrConnection } from '../integrations/prowlarr-connection';
import { isMagnetUri, toConfiguredProwlarrUrl } from '../utils/prowlarr-url';
import { RMABLogger } from '../utils/logger';
import { isTransientConnectionError } from '../utils/connection-errors';
import {
  DownloadSourceError,
  UnusableDownloadSourceError,
  isRetryableDownloadSourceError,
} from '../interfaces/download-client.interface';

/**
 * Process download job
 * Routes to appropriate download client based on protocol detection
 * Adds selected result to download client and starts monitoring
 */
export async function processDownloadTorrent(payload: DownloadTorrentPayload): Promise<any> {
  const { requestId, audiobook, torrent, alternateTorrents = [], jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'DownloadTorrent');

  // A magnet must be one whitespace-free URI (clients split their URL lists on newlines)
  const candidates = [torrent, ...(alternateTorrents ?? [])].filter((candidate) => {
    if (!candidate) return false;
    const malformed = /^magnet:/i.test(candidate.downloadUrl ?? '') && !isMagnetUri(candidate.downloadUrl);
    if (malformed) {
      logger.warn(`Skipping release with a malformed magnet link: ${candidate.title}`, { indexer: candidate.indexer });
    }
    return !malformed;
  });

  logger.info(`Processing request ${requestId} for "${audiobook.title}"`);
  logger.info(`Selected result: ${torrent.title}`, {
    size: torrent.size,
    seeders: torrent.seeders,
    format: torrent.format,
    indexer: torrent.indexer,
    alternateCount: alternateTorrents.length,
  });

  try {
    // Update request status to downloading
    const request = await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloading',
        progress: 0,
        updatedAt: new Date(),
      },
      include: {
        user: { select: { plexUsername: true } },
      },
    });

    const config = await getConfigService();
    const manager = getDownloadClientManager(config);

    // Prowlarr credentials for authenticated proxy-download fetches (fixes 403 for
    // indexers like NZBFinder). The fetcher sends the key only to Prowlarr download hops.
    const prowlarr = await getProwlarrConnection();
    const sourceAuth = prowlarr.apiKey
      ? { prowlarrBaseUrl: prowlarr.baseUrl, apiKey: prowlarr.apiKey }
      : undefined;

    // Last temporary (429/5xx) failure, so a later unusable release cannot hide it from Bull's retry
    let lastRetryableError: DownloadSourceError | null = null;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const candidate = candidates[candidateIndex];
      const hasNextCandidate = candidateIndex < candidates.length - 1;
      const isUsenet = ProwlarrService.isNZBResult(candidate);
      const protocol = isUsenet ? 'usenet' : 'torrent';
      const client = await manager.getClientServiceForProtocol(protocol);

      if (!client) {
        throw new Error(`No ${protocol} download client configured. Please add a ${protocol} client in Settings > Download Clients.`);
      }

      const clientConfig = await manager.getClientForProtocol(protocol);
      const category = clientConfig?.category || 'readmeabook';

      logger.info(
        `Trying release ${candidateIndex + 1}/${candidates.length}: ${candidate.title}`,
        { indexer: candidate.indexer, protocol, downloadClient: client.clientType }
      );

      let downloadClientId: string;
      try {
        downloadClientId = await client.addDownload(
          // Prowlarr links go to the configured base (scheme, port, credentials); others as-is
          toConfiguredProwlarrUrl(candidate.downloadUrl, prowlarr.base, { withCredentials: true }) ?? candidate.downloadUrl,
          { category, priority: 'normal', sourceAuth }
        );
      } catch (error) {
        if (error instanceof UnusableDownloadSourceError) {
          // This release can't be fetched (bad redirect, malformed magnet, ...): try the next one
          logger.warn(`${error.message} for "${candidate.title}"${hasNextCandidate ? '; trying next ranked release' : ''}`, {
            indexer: candidate.indexer,
            candidate: candidateIndex + 1,
            candidateCount: candidates.length,
          });
          if (hasNextCandidate) continue;
          throw lastRetryableError ?? error;
        }

        if (!(error instanceof DownloadSourceError)) {
          throw error;
        }

        const contextualError = new DownloadSourceError(
          `Grab failed: ${candidate.indexer} returned HTTP ${error.status} while fetching "${candidate.title}" through Prowlarr`,
          error.status,
          error.sourceUrl,
          error
        );

        if (!isRetryableDownloadSourceError(error)) {
          throw contextualError;
        }

        lastRetryableError = contextualError;

        logger.warn(
          `${contextualError.message}${hasNextCandidate ? '; trying next ranked release' : ''}`,
          {
            indexer: candidate.indexer,
            upstreamStatus: error.status,
            candidate: candidateIndex + 1,
            candidateCount: candidates.length,
          }
        );

        if (hasNextCandidate) {
          continue;
        }

        throw contextualError;
      }

      logger.info(`Download added with ID: ${downloadClientId}`);

      // Create DownloadHistory record. Exclude magnet links from the indexer-page fallback.
      const indexerPageUrl = candidate.infoUrl || (candidate.guid?.startsWith('magnet:') ? null : candidate.guid);

      const downloadHistory = await prisma.downloadHistory.create({
        data: {
          requestId,
          indexerName: candidate.indexer,
          indexerId: candidate.indexerId,
          downloadClient: client.clientType,
          downloadClientId,
          torrentName: candidate.title,
          // Set protocol-specific ID fields for backward compatibility
          torrentHash: client.protocol === 'torrent' ? (candidate.infoHash || downloadClientId) : undefined,
          nzbId: client.protocol === 'usenet' ? downloadClientId : undefined,
          torrentSizeBytes: candidate.size,
          torrentUrl: indexerPageUrl,
          magnetLink: candidate.downloadUrl,
          seeders: candidate.seeders || 0,
          leechers: candidate.leechers || 0,
          downloadStatus: 'downloading',
          selected: true,
          startedAt: new Date(),
        },
      });

      logger.info(`Created download history record: ${downloadHistory.id}`);

      // Send grab notification (non-blocking — failures here don't fail the download)
      const jobQueue = getJobQueueService();
      const grabMessage = `${candidate.title} via ${candidate.indexer} (${client.clientType})`;
      await jobQueue.addNotificationJob(
        'request_grabbed',
        requestId,
        audiobook.title,
        audiobook.author,
        request.user.plexUsername || 'Unknown User',
        grabMessage,
        request.type
      ).catch((error) => {
        logger.error('Failed to queue grab notification', { error: error instanceof Error ? error.message : String(error) });
      });

      // Trigger monitor download job with initial delay
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistory.id,
        downloadClientId,
        client.clientType,
        3 // Wait 3 seconds before first check
      );

      logger.info(`Started monitoring job for request ${requestId} (${client.clientType}, 3s initial delay)`);

      return {
        success: true,
        message: `Download added to ${client.clientType} and monitoring started`,
        requestId,
        downloadHistoryId: downloadHistory.id,
        downloadClientId,
        torrent: {
          title: candidate.title,
          size: candidate.size,
          seeders: candidate.seeders || 0,
          format: candidate.format,
        },
      };
    }

    throw new Error('No release candidates were available to download');
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    if (isTransientConnectionError(error) || isRetryableDownloadSourceError(error)) {
      // Connection error — don't mark request as failed yet.
      // Bull will retry this job (3 attempts with exponential backoff).
      // If all retries are exhausted, the global failed handler marks it failed.
      logger.warn(
        isRetryableDownloadSourceError(error)
          ? `All ranked release grabs were temporarily unavailable for request ${requestId}, allowing Bull to retry`
          : `Download client unreachable for request ${requestId}, allowing Bull to retry`
      );
    } else {
      // Permanent error — mark request as failed immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Failed to add download to client',
          updatedAt: new Date(),
        },
      });
    }

    throw error;
  }
}
