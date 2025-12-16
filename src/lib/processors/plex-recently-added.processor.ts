/**
 * Component: Library Recently Added Check Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Lightweight polling for new library items (Plex or Audiobookshelf)
 */

import { prisma } from '../db';
import { createJobLogger } from '../utils/job-logger';
import { getLibraryService } from '../services/library';

export interface PlexRecentlyAddedPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processPlexRecentlyAddedCheck(payload: PlexRecentlyAddedPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = jobId ? createJobLogger(jobId, 'RecentlyAdded') : null;

  const { getConfigService } = await import('../services/config.service');
  const configService = getConfigService();

  // Get backend mode
  const backendMode = await configService.getBackendMode();
  await logger?.info(`Backend mode: ${backendMode}`);

  // Validate configuration based on backend mode
  if (backendMode === 'audiobookshelf') {
    const absConfig = await configService.getMany([
      'audiobookshelf.server_url',
      'audiobookshelf.api_token',
      'audiobookshelf.library_id',
    ]);

    const missingFields: string[] = [];
    if (!absConfig['audiobookshelf.server_url']) missingFields.push('Audiobookshelf server URL');
    if (!absConfig['audiobookshelf.api_token']) missingFields.push('Audiobookshelf API token');
    if (!absConfig['audiobookshelf.library_id']) missingFields.push('Audiobookshelf library ID');

    if (missingFields.length > 0) {
      const errorMsg = `Audiobookshelf is not configured. Missing: ${missingFields.join(', ')}`;
      await logger?.warn(errorMsg);
      return { success: false, message: errorMsg, skipped: true };
    }
  } else {
    const plexConfig = await configService.getMany([
      'plex_url',
      'plex_token',
      'plex_audiobook_library_id',
    ]);

    const missingFields: string[] = [];
    if (!plexConfig.plex_url) missingFields.push('Plex server URL');
    if (!plexConfig.plex_token) missingFields.push('Plex auth token');
    if (!plexConfig.plex_audiobook_library_id) missingFields.push('Plex audiobook library ID');

    if (missingFields.length > 0) {
      const errorMsg = `Plex is not configured. Missing: ${missingFields.join(', ')}`;
      await logger?.warn(errorMsg);
      return { success: false, message: errorMsg, skipped: true };
    }
  }

  await logger?.info(`Starting recently added check...`);

  // Get library service (automatically selects Plex or Audiobookshelf)
  const libraryService = await getLibraryService();

  try {
    // Get configured library ID
    const libraryId = backendMode === 'audiobookshelf'
      ? await configService.get('audiobookshelf.library_id')
      : await configService.get('plex_audiobook_library_id');

    // Fetch top 10 recently added items using abstraction layer
    const recentItems = await libraryService.getRecentlyAdded(libraryId!, 10);

    await logger?.info(`Found ${recentItems.length} recently added items`);

    if (recentItems.length === 0) {
      return { success: true, message: 'No recent items', newCount: 0, updatedCount: 0, matchedDownloads: 0 };
    }

    // Check for new items not in database
    let newCount = 0;
    let updatedCount = 0;
    let matchedDownloads = 0;

    for (const item of recentItems) {
      const existing = await prisma.plexLibrary.findUnique({
        where: { plexGuid: item.externalId },
      });

      if (!existing) {
        await prisma.plexLibrary.create({
          data: {
            plexGuid: item.externalId,
            plexRatingKey: item.id,
            title: item.title,
            author: item.author || 'Unknown Author',
            narrator: item.narrator,
            summary: item.description,
            duration: item.duration ? item.duration * 1000 : null, // Convert seconds to milliseconds
            year: item.year,
            thumbUrl: item.coverUrl,
            plexLibraryId: libraryId!,
            addedAt: item.addedAt,
            lastScannedAt: new Date(),
          },
        });
        newCount++;
        await logger?.info(`New item added: ${item.title} by ${item.author}`);
      } else {
        await prisma.plexLibrary.update({
          where: { plexGuid: item.externalId },
          data: {
            title: item.title,
            author: item.author || existing.author,
            narrator: item.narrator || existing.narrator,
            summary: item.description || existing.summary,
            duration: item.duration ? item.duration * 1000 : existing.duration,
            year: item.year || existing.year,
            thumbUrl: item.coverUrl || existing.thumbUrl,
            lastScannedAt: new Date(),
          },
        });
        updatedCount++;
      }
    }

    // Check for downloaded requests to match
    const downloadedRequests = await prisma.request.findMany({
      where: { status: 'downloaded' },
      include: { audiobook: true },
      take: 50,
    });

    if (downloadedRequests.length > 0) {
      await logger?.info(`Checking ${downloadedRequests.length} downloaded requests for matches`);

      const { findPlexMatch } = await import('../utils/audiobook-matcher');

      for (const request of downloadedRequests) {
        try {
          const audiobook = request.audiobook;
          const match = await findPlexMatch({
            asin: audiobook.audibleAsin || '',
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator || undefined,
          });

          if (match) {
            await logger?.info(`Match found: "${audiobook.title}" → "${match.title}"`);

            // Update audiobook with matched library item ID
            const updateData: any = { updatedAt: new Date() };

            if (backendMode === 'audiobookshelf') {
              updateData.absItemId = match.plexGuid; // plexGuid field stores the externalId from either backend
            } else {
              updateData.plexGuid = match.plexGuid;
            }

            await prisma.audiobook.update({
              where: { id: audiobook.id },
              data: updateData,
            });

            await prisma.request.update({
              where: { id: request.id },
              data: { status: 'available', completedAt: new Date(), updatedAt: new Date() },
            });

            matchedDownloads++;
          }
        } catch (error) {
          await logger?.error(`Failed to match request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    await logger?.info(`Complete: ${newCount} new, ${updatedCount} updated, ${matchedDownloads} matched downloads`);

    return {
      success: true,
      message: `Recently added check completed (${backendMode})`,
      backendMode,
      newCount,
      updatedCount,
      matchedDownloads,
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
