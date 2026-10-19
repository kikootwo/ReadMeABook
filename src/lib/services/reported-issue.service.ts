/**
 * Component: Reported Issue Service
 * Documentation: documentation/backend/services/reported-issues.md
 *
 * Handles user-reported problems with available audiobooks.
 * Supports dismiss (admin closes) and replace (admin picks new torrent) workflows.
 */

import { prisma } from '@/lib/db';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { RMABLogger } from '@/lib/utils/logger';
import { sanitizeCoverArtUrl } from '@/lib/utils/cover-art-url';

const logger = RMABLogger.create('ReportedIssue');

/**
 * Report an issue with an available audiobook
 */
export async function reportIssue(
  asin: string,
  reporterId: string,
  reason: string,
  metadata?: { title?: string; author?: string; coverArtUrl?: string }
) {
  // Validate the book is in the library
  const plexMatch = await findPlexMatch({
    asin,
    title: metadata?.title || '',
    author: metadata?.author || '',
  });

  if (!plexMatch) {
    throw new ReportedIssueError('This audiobook is not currently in your library', 404);
  }

  // Find or create audiobook record for this ASIN
  let audiobook = await prisma.audiobook.findFirst({
    where: { audibleAsin: asin },
  });

  if (!audiobook) {
    audiobook = await prisma.audiobook.create({
      data: {
        audibleAsin: asin,
        title: metadata?.title || 'Unknown Title',
        author: metadata?.author || 'Unknown Author',
        coverArtUrl: sanitizeCoverArtUrl(metadata?.coverArtUrl),
        status: 'requested',
      },
    });
    logger.info(`Created audiobook record for ASIN ${asin} to link reported issue`);
  }

  // Check for existing open issue
  const existingIssue = await prisma.reportedIssue.findFirst({
    where: {
      audiobookId: audiobook.id,
      status: 'open',
    },
  });

  if (existingIssue) {
    throw new ReportedIssueError('An issue has already been reported for this audiobook', 409);
  }

  const issue = await prisma.reportedIssue.create({
    data: {
      audiobookId: audiobook.id,
      reporterId,
      reason,
    },
    include: {
      audiobook: { select: { title: true, author: true, audibleAsin: true } },
      reporter: { select: { plexUsername: true } },
    },
  });

  logger.info(`Issue reported for "${audiobook.title}" by user ${reporterId}`);

  // Queue notification (non-blocking)
  try {
    const { getJobQueueService } = await import('./job-queue.service');
    const jobQueue = getJobQueueService();
    await jobQueue.addNotificationJob(
      'issue_reported',
      issue.id,
      audiobook.title,
      audiobook.author,
      issue.reporter.plexUsername,
      reason
    );
  } catch (error) {
    logger.error('Failed to queue issue_reported notification', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return issue;
}

/**
 * Dismiss a reported issue (admin action)
 */
export async function dismissIssue(issueId: string, adminUserId: string) {
  const issue = await prisma.reportedIssue.findUnique({
    where: { id: issueId },
  });

  if (!issue) {
    throw new ReportedIssueError('Issue not found', 404);
  }

  if (issue.status !== 'open') {
    throw new ReportedIssueError('Issue is already resolved', 409);
  }

  const updated = await prisma.reportedIssue.update({
    where: { id: issueId },
    data: {
      status: 'dismissed',
      resolvedAt: new Date(),
      resolvedById: adminUserId,
    },
  });

  logger.info(`Issue ${issueId} dismissed by admin ${adminUserId}`);
  return updated;
}

/**
 * Replace audiobook content for a reported issue (atomic admin action):
 * 1. Validate issue is open
 * 2. Delete old content (via request delete or direct library deletion)
 * 3. Create new request + start download with selected torrent
 * 4. Resolve issue as "replaced"
 */
export async function replaceAudiobook(
  issueId: string,
  adminUserId: string,
  torrent: any
) {
  const issue = await prisma.reportedIssue.findUnique({
    where: { id: issueId },
    include: {
      audiobook: {
        select: {
          id: true,
          title: true,
          author: true,
          audibleAsin: true,
          coverArtUrl: true,
          narrator: true,
          plexGuid: true,
          absItemId: true,
        },
      },
    },
  });

  if (!issue) {
    throw new ReportedIssueError('Issue not found', 404);
  }

  if (issue.status !== 'open') {
    throw new ReportedIssueError('Issue is already resolved', 409);
  }

  const audiobook = issue.audiobook;

  // Step 1: Find existing active request for this audiobook
  const existingRequest = await prisma.request.findFirst({
    where: {
      audiobookId: audiobook.id,
      type: 'audiobook',
      deletedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Step 2: Delete old content
  if (existingRequest) {
    // Has an RMAB request — use deleteRequest which handles torrent cleanup, files, library backend
    const { deleteRequest } = await import('./request-delete.service');
    const deleteResult = await deleteRequest(existingRequest.id, adminUserId);
    if (!deleteResult.success) {
      logger.warn(`deleteRequest partial failure for ${existingRequest.id}: ${deleteResult.error}`);
      // Continue anyway - we want replacement to proceed
    }
    logger.info(`Deleted existing request ${existingRequest.id} for replacement`);
  } else {
    // No RMAB request — book was added to library outside RMAB
    await deleteFromLibrary(audiobook);
    logger.info(`Deleted library content directly for "${audiobook.title}" (no RMAB request)`);
  }

  // Step 3: Reset audiobook record for new request
  await prisma.audiobook.update({
    where: { id: audiobook.id },
    data: {
      status: 'requested',
      plexGuid: null,
      absItemId: null,
      filePath: null,
      fileFormat: null,
      fileSizeBytes: null,
      filesHash: null,
    },
  });

  // Step 4: Create new request + start download (admin-initiated, no approval needed)
  const newRequest = await prisma.request.create({
    data: {
      userId: adminUserId,
      audiobookId: audiobook.id,
      status: 'downloading',
      type: 'audiobook',
      progress: 0,
    },
    include: {
      audiobook: true,
      user: { select: { id: true, plexUsername: true } },
    },
  });

  // Queue download job with selected torrent
  const { getJobQueueService } = await import('./job-queue.service');
  const jobQueue = getJobQueueService();
  await jobQueue.addDownloadJob(
    newRequest.id,
    {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
    },
    torrent
  );

  // Step 5: Resolve issue
  await prisma.reportedIssue.update({
    where: { id: issueId },
    data: {
      status: 'replaced',
      resolvedAt: new Date(),
      resolvedById: adminUserId,
    },
  });

  logger.info(`Issue ${issueId} resolved via replacement. New request: ${newRequest.id}`);
  return { issue, request: newRequest };
}

/**
 * Get all open issues with audiobook metadata and reporter info (admin list)
 */
export async function getOpenIssues() {
  return prisma.reportedIssue.findMany({
    where: { status: 'open' },
    include: {
      audiobook: {
        select: {
          id: true,
          title: true,
          author: true,
          coverArtUrl: true,
          audibleAsin: true,
        },
      },
      reporter: {
        select: {
          id: true,
          plexUsername: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Batch query for open issues by ASINs (used for enrichment in audiobook-matcher)
 */
export async function getOpenIssuesByAsins(asins: string[]): Promise<Set<string>> {
  if (asins.length === 0) return new Set();

  const issues = await prisma.reportedIssue.findMany({
    where: {
      status: 'open',
      audiobook: {
        audibleAsin: { in: asins },
      },
    },
    select: {
      audiobook: {
        select: { audibleAsin: true },
      },
    },
  });

  return new Set(
    issues
      .map((i) => i.audiobook.audibleAsin)
      .filter((asin): asin is string => asin !== null)
  );
}

/**
 * Delete audiobook content from library backend directly (no RMAB request).
 * Used when a book was added to Plex/ABS outside of RMAB.
 * Mirrors the library deletion logic from request-delete.service.ts lines 280-440.
 */
async function deleteFromLibrary(audiobook: {
  id: string;
  title: string;
  author: string;
  audibleAsin: string | null;
  plexGuid: string | null;
  absItemId: string | null;
}) {
  const { getConfigService } = await import('./config.service');
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();

  // Delete from library backend API
  if (backendMode === 'audiobookshelf') {
    // absItemId may be null if the book was added outside RMAB.
    // Fall back to looking up the ABS item ID from plex_library by ASIN
    // (plexGuid stores the ABS item ID when using ABS backend).
    let itemId = audiobook.absItemId;
    if (!itemId && audiobook.audibleAsin) {
      const libraryRecord = await prisma.plexLibrary.findFirst({
        where: {
          OR: [
            { asin: audiobook.audibleAsin },
            { plexGuid: { contains: audiobook.audibleAsin } },
          ],
        },
        select: { plexGuid: true },
      });
      itemId = libraryRecord?.plexGuid ?? null;
    }

    if (itemId) {
      try {
        const { deleteABSItem } = await import('./audiobookshelf/api');
        await deleteABSItem(itemId);
        logger.info(`Deleted ABS item ${itemId} for "${audiobook.title}"`);
      } catch (error) {
        logger.error(`Failed to delete ABS item ${itemId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.warn(`No ABS item ID found for "${audiobook.title}" (ASIN: ${audiobook.audibleAsin}) — skipping ABS deletion`);
    }
  } else if (backendMode === 'plex' && audiobook.plexGuid) {
    try {
      const plexLibraryRecord = await prisma.plexLibrary.findUnique({
        where: { plexGuid: audiobook.plexGuid },
        select: { plexRatingKey: true },
      });

      if (plexLibraryRecord?.plexRatingKey) {
        const plexServerUrl = (await configService.get('plex_url')) || '';
        const plexToken = (await configService.get('plex_token')) || '';

        if (plexServerUrl && plexToken) {
          const { getPlexService } = await import('../integrations/plex.service');
          const plexService = getPlexService();
          await plexService.deleteItem(plexServerUrl, plexToken, plexLibraryRecord.plexRatingKey);
          logger.info(`Deleted Plex item ${plexLibraryRecord.plexRatingKey} for "${audiobook.title}"`);
        }
      }
    } catch (error) {
      logger.error(`Failed to delete Plex item for "${audiobook.title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete plex_library records by ASIN
  if (audiobook.audibleAsin) {
    try {
      const result = await prisma.plexLibrary.deleteMany({
        where: {
          OR: [
            { asin: audiobook.audibleAsin },
            { plexGuid: { contains: audiobook.audibleAsin } },
          ],
        },
      });
      if (result.count > 0) {
        logger.info(`Deleted ${result.count} plex_library record(s) by ASIN "${audiobook.audibleAsin}"`);
      }
    } catch (error) {
      logger.error(`Failed to delete plex_library records for ASIN "${audiobook.audibleAsin}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Custom error class for reported issues
 */
export class ReportedIssueError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'ReportedIssueError';
  }
}
