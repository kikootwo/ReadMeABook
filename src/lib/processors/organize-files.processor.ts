/**
 * Component: Organize Files Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { OrganizeFilesPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getFileOrganizer } from '../utils/file-organizer';

/**
 * Process organize files job
 * Moves completed downloads to media library in proper directory structure
 */
export async function processOrganizeFiles(payload: OrganizeFilesPayload): Promise<any> {
  const { requestId, audiobookId, downloadPath } = payload;

  console.log(`[OrganizeFiles] Processing request ${requestId}`);
  console.log(`[OrganizeFiles] Download path: ${downloadPath}`);

  try {
    // Update request status to processing
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'processing',
        progress: 100, // Download is complete, now organizing
        updatedAt: new Date(),
      },
    });

    // Get audiobook details
    const audiobook = await prisma.audiobook.findUnique({
      where: { id: audiobookId },
    });

    if (!audiobook) {
      throw new Error(`Audiobook ${audiobookId} not found`);
    }

    console.log(`[OrganizeFiles] Organizing: ${audiobook.title} by ${audiobook.author}`);

    // Get file organizer
    const organizer = getFileOrganizer();

    // Organize files
    const result = await organizer.organize(downloadPath, {
      title: audiobook.title,
      author: audiobook.author,
      narrator: audiobook.narrator || undefined,
      coverArtUrl: audiobook.coverArtUrl || undefined,
    });

    if (!result.success) {
      throw new Error(`File organization failed: ${result.errors.join(', ')}`);
    }

    console.log(`[OrganizeFiles] Successfully moved ${result.filesMovedCount} files to ${result.targetPath}`);

    // Update audiobook record with file path
    await prisma.audiobook.update({
      where: { id: audiobookId },
      data: {
        filePath: result.targetPath,
        availabilityStatus: 'available',
        updatedAt: new Date(),
      },
    });

    // Update request to completed
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Trigger Plex scan job
    const jobQueue = getJobQueueService();

    // For now, we'll trigger a match job instead of a full scan
    // A full library scan would be too slow
    await jobQueue.addPlexMatchJob(
      requestId,
      audiobookId,
      audiobook.title,
      audiobook.author
    );

    console.log(`[OrganizeFiles] Request ${requestId} completed successfully`);

    return {
      success: true,
      message: 'Files organized successfully',
      requestId,
      audiobookId,
      targetPath: result.targetPath,
      filesCount: result.filesMovedCount,
      audioFiles: result.audioFiles,
      coverArt: result.coverArtFile,
      errors: result.errors,
    };
  } catch (error) {
    console.error('[OrganizeFiles] Error:', error);

    // Update request to failed
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'File organization failed',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
