/**
 * Component: Interactive E-book Pick to Download Job
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Shared by POST /api/audiobooks/[asin]/select-ebook and POST /api/requests/[id]/select-ebook.
 * Callers validate the pick first (guardEbookSelection).
 */

import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('EbookSelection');

/** An interactive e-book search result picked by the user/admin */
export interface SelectedEbook {
  guid: string;
  title: string;
  size: number;
  seeders: number;
  indexer: string;
  indexerId?: number;
  downloadUrl: string;
  infoUrl?: string;
  score: number;
  finalScore: number;
  source: 'annas_archive' | 'prowlarr';
  format?: string;
  md5?: string;
  downloadUrls?: string[];
  protocol?: string; // 'torrent' or 'usenet' - determines download client
}

/**
 * Handle Anna's Archive download (direct HTTP)
 */
export async function startAnnasArchiveDownload(
  requestId: string,
  audiobook: { id: string; title: string; author: string },
  selectedEbook: SelectedEbook,
  jobQueue: ReturnType<typeof getJobQueueService>
) {
  const configService = getConfigService();
  const preferredFormat = await configService.get('ebook_sidecar_preferred_format') || 'epub';

  logger.info(`Starting Anna's Archive download for "${audiobook.title}"`);
  logger.info(`MD5: ${selectedEbook.md5}, Format: ${selectedEbook.format || preferredFormat}`);

  // Create download history record
  const downloadHistory = await prisma.downloadHistory.create({
    data: {
      requestId,
      indexerName: "Anna's Archive",
      torrentName: `${audiobook.title} - ${audiobook.author}.${selectedEbook.format || preferredFormat}`,
      torrentSizeBytes: null, // Unknown until download starts
      qualityScore: selectedEbook.score,
      selected: true,
      downloadClient: 'direct',
      downloadStatus: 'queued',
    },
  });

  // Store all download URLs for retry purposes
  if (selectedEbook.downloadUrls && selectedEbook.downloadUrls.length > 0) {
    await prisma.downloadHistory.update({
      where: { id: downloadHistory.id },
      data: {
        torrentUrl: JSON.stringify(selectedEbook.downloadUrls),
      },
    });
  }

  // Trigger direct download job
  await jobQueue.addStartDirectDownloadJob(
    requestId,
    downloadHistory.id,
    selectedEbook.downloadUrl,
    `${audiobook.title} - ${audiobook.author}.${selectedEbook.format || preferredFormat}`,
    undefined // Size unknown
  );

  logger.info(`Queued direct download job for request ${requestId}`);
}

/**
 * Handle indexer download (torrent/NZB)
 */
export async function startIndexerEbookDownload(
  requestId: string,
  audiobook: { id: string; title: string; author: string },
  selectedEbook: SelectedEbook,
  jobQueue: ReturnType<typeof getJobQueueService>
) {
  logger.info(`Starting indexer download for "${audiobook.title}"`);
  logger.info(`Torrent: "${selectedEbook.title}", Indexer: ${selectedEbook.indexer}`);

  // Convert to RankedTorrent shape expected by download job
  // Note: format is omitted as ebook formats (epub, pdf) differ from audiobook formats (M4B, M4A, MP3)
  const torrentForJob = {
    guid: selectedEbook.guid,
    title: selectedEbook.title,
    size: selectedEbook.size,
    seeders: selectedEbook.seeders || 0,
    indexer: selectedEbook.indexer,
    indexerId: selectedEbook.indexerId,
    downloadUrl: selectedEbook.downloadUrl,
    infoUrl: selectedEbook.infoUrl,
    publishDate: new Date(),
    score: selectedEbook.score,
    finalScore: selectedEbook.finalScore,
    bonusPoints: 0,
    bonusModifiers: [],
    rank: 1,
    breakdown: {
      formatScore: 0,
      sizeScore: 0,
      seederScore: 0,
      matchScore: 0,
      totalScore: selectedEbook.score,
      notes: [],
    },
    protocol: selectedEbook.protocol, // Pass through protocol for torrent vs usenet routing
  };

  // Use the download job (same as audiobooks)
  await jobQueue.addDownloadJob(requestId, {
    id: audiobook.id,
    title: audiobook.title,
    author: audiobook.author,
  }, torrentForJob as any); // Cast to any since ebook torrents don't have audiobook format field

  logger.info(`Queued download job for request ${requestId}`);
}
