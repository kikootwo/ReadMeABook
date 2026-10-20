/**
 * Component: File Organization System
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { RMAB_USER_AGENT } from './user-agent';
import { tagMultipleFiles, checkFfmpegAvailable, addMp4FreeformTags } from './metadata-tagger';
import { RMABLogger } from './logger';
import { hasCover, publishCover, type CoverPlacement } from './cover-placement';
import { placeAudio, placeFile, isVerifiedStatus, type AudioPlacement } from './organize-copy';
import { walkFiles, ORGANIZER_EBOOK_FORMATS, type ImportInventory, type PlacementRecord } from './import-inventory';
import { getMediaDir } from './media-dir';
import { probeStreamDurationMs } from './audio-duration';
import { MAX_COVER_ART_BYTES, MAX_COVER_ART_REDIRECTS, cachedThumbnailPath, isAllowedRemoteCoverUrl, isLibraryCoverSource } from './cover-art-url';

const moduleLogger = RMABLogger.create('FileOrganizer');
import {
  detectChapterFiles,
  analyzeChapterFiles,
  mergeChapters,
  formatDuration,
  estimateOutputSize,
  checkDiskSpace,
} from './chapter-merger';
import { prisma } from '../db';
import { substituteTemplate, buildRenamedFilename, type TemplateVariables } from './path-template.util';
import { AUDIO_EXTENSIONS, COERCION_CANDIDATE_EXTENSIONS } from '../constants/audio-formats';

export interface AudiobookMetadata {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  coverArtUrl?: string;
  asin?: string;
  series?: string;
  seriesPart?: string;
}

export interface OrganizationResult {
  success: boolean;
  targetPath: string;
  filesMovedCount: number;
  errors: string[];
  audioFiles: string[];
  coverArtFile?: string;
  /** One record per original audio source: where it went and whether that is proven. */
  records?: PlacementRecord[];
  coverRecord?: PlacementRecord;
  /** Every audio file found in the source (before file selection). */
  inventory?: ImportInventory;
  /** Files placed whose permissions could not be set (logged once per job by the caller). */
  permissionWarnings?: string[];
}

export interface PlacementOptions {
  /** Compare same-size existing targets byte-for-byte; only worth it when a delete depends on it. */
  compareExisting?: boolean;
}

export interface EbookOrganizationResult {
  success: boolean;
  targetPath: string;
  errors: string[];
  format?: string;
  /** The ebook file that was read (may be a temp copy when a fixed EPUB was organized). */
  sourceFile?: string;
  /** Placement of the ebook file (source is the file that was read). */
  record?: PlacementRecord;
  /** Every ebook file found in the source. */
  inventory?: ImportInventory;
  /** Files placed whose permissions could not be set (logged once per job by the caller). */
  permissionWarnings?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  path: string;
}

export interface LoggerConfig {
  jobId: string;
  context: string;
}

export class FileOrganizer {
  private mediaDir: string;
  private tempDir: string;
  private fileMode: number;
  private dirMode: number;

  constructor(mediaDir: string = '/media/audiobooks', tempDir: string = '/tmp/readmeabook', fileMode: number = 0o664, dirMode: number = 0o775) {
    this.mediaDir = mediaDir;
    this.tempDir = tempDir;
    this.fileMode = fileMode;
    this.dirMode = dirMode;
  }

  /**
   * Organize completed download into proper directory structure
   */
  async organize(
    downloadPath: string,
    audiobook: AudiobookMetadata,
    template: string,
    loggerConfig?: LoggerConfig,
    renameConfig?: { enabled: boolean; template: string },
    selectedFiles?: string[],
    placement?: PlacementOptions
  ): Promise<OrganizationResult> {
    // Create logger if config provided
    const logger = loggerConfig ? RMABLogger.forJob(loggerConfig.jobId, loggerConfig.context) : null;

    const result: OrganizationResult = {
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: [],
      audioFiles: [],
      records: [],
    };

    try {
      await logger?.info(`Organizing: ${downloadPath}`);

      // Find audiobook files
      const found = await this.findAudiobookFiles(downloadPath);
      let { audioFiles } = found;
      const { coverFile, isFile } = found;
      const baseForInventory = isFile ? path.dirname(downloadPath) : downloadPath;
      result.inventory = {
        kind: 'audio',
        files: audioFiles.map((f) => (isFile ? downloadPath : path.join(baseForInventory, f))),
        coverFile: coverFile ? path.join(baseForInventory, coverFile) : undefined,
        complete: found.complete,
      };
      if (!found.complete) {
        await logger?.warn('Some folders in the source could not be read; the source will not be removed');
      }

      // Filter to only selected files if specified
      if (selectedFiles && selectedFiles.length > 0) {
        const selectedSet = new Set(selectedFiles);
        audioFiles = audioFiles.filter((f) => selectedSet.has(f));
        await logger?.info(`Filtered to ${audioFiles.length} selected files`);
      }

      if (audioFiles.length === 0) {
        throw new Error('No audiobook files found in download');
      }

      await logger?.info(`Found ${audioFiles.length} audio files`);

      // Determine base path for source files
      const baseSourcePath = isFile ? path.dirname(downloadPath) : downloadPath;

      const metadataTaggingEnabled = await prisma.configuration.findUnique({ where: { key: 'metadata_tagging_enabled' } }).then((c) => c?.value === 'true', async (error: unknown) => {
        const skipped = `Metadata tagging skipped: could not read setting (${error instanceof Error ? error.message : 'Unknown error'})`;
        await logger?.warn(skipped); result.errors.push(skipped); return false;
      }); // read once: merge disk-space check + tagging pass

      // Track if we created a merged file that needs cleanup
      let tempMergedFile: string | null = null;
      // Original chapter files behind the merged file, and whether its duration was verified
      let mergedInputs: string[] = [];
      let mergeDurationVerified = false;

      // Check for chapter merging if multiple files
      if (audioFiles.length > 1) {
        await logger?.info(`Multiple audio files detected (${audioFiles.length} files) - checking chapter merge settings...`);

        try {
          const chapterMergingConfig = await prisma.configuration.findUnique({
            where: { key: 'chapter_merging_enabled' },
          });

          const chapterMergingEnabled = chapterMergingConfig?.value === 'true';

          if (!chapterMergingEnabled) {
            await logger?.info(`Chapter merging disabled in settings - organizing ${audioFiles.length} files individually`);
          } else {
            await logger?.info(`Chapter merging enabled - analyzing files...`);

            // Build full paths to source files
            const sourceFilePaths = audioFiles.map((audioFile) =>
              isFile ? downloadPath : path.join(downloadPath, audioFile)
            );

            const isChapterDownload = await detectChapterFiles(sourceFilePaths, logger ?? undefined);

            if (isChapterDownload) {
              // Check disk space: the merged file, the ASIN post-step's full copy (with an ASIN), and the tagged copy when tagging
              const estimatedSize = (await estimateOutputSize(sourceFilePaths)) * (1 + (audiobook.asin ? 1 : 0) + (metadataTaggingEnabled ? 1 : 0));
              const availableSpace = await checkDiskSpace(this.tempDir);

              if (availableSpace !== null && availableSpace < estimatedSize) {
                await logger?.warn(`Insufficient disk space for merge (need ${Math.round(estimatedSize / 1024 / 1024)}MB, have ${Math.round(availableSpace / 1024 / 1024)}MB). Organizing files individually.`);
              } else {
                // Log disk space check passed
                if (availableSpace !== null) {
                  await logger?.info(`Disk space check passed: ${Math.round(availableSpace / 1024 / 1024)}MB available, ${Math.round(estimatedSize / 1024 / 1024)}MB needed`);
                }

                // Analyze and order chapter files
                const chapters = await analyzeChapterFiles(sourceFilePaths, logger ?? undefined);

                // Validate that we have valid ordering
                if (chapters.length === 0) {
                  await logger?.warn(`Chapter analysis failed: No valid chapters found. Organizing files individually.`);
                } else {
                  // Create output path in temp directory
                  const outputFilename = `${this.sanitizePath(audiobook.title)}.m4b`;
                  const outputPath = path.join(this.tempDir, outputFilename);

                  // Perform merge
                  const mergeResult = await mergeChapters(
                    chapters,
                    {
                      title: audiobook.title,
                      author: audiobook.author,
                      narrator: audiobook.narrator,
                      year: audiobook.year,
                      outputPath,
                      dirMode: this.dirMode,
                    },
                    logger ?? undefined
                  );

                  if (mergeResult.success && mergeResult.outputPath) {
                    // Replace audioFiles array with single merged file
                    audioFiles.length = 0;
                    audioFiles.push(mergeResult.outputPath);

                    // Mark for cleanup after copy
                    tempMergedFile = mergeResult.outputPath;
                    mergedInputs = chapters.map((c) => c.path);
                    mergeDurationVerified = mergeResult.durationVerified === true;

                    await logger?.info(`Chapter merge complete - organizing single M4B file`);

                    // Update isFile flag since we now have a single file path
                    // (not in the download directory structure)
                  } else {
                    await logger?.warn(`Chapter merge failed: ${mergeResult.error}. Organizing ${audioFiles.length} files individually.`);
                    result.errors.push(`Chapter merge failed: ${mergeResult.error}`);
                    // Continue with original audioFiles array
                  }
                }
              }
            } else {
              // detectChapterFiles already logged the reason for skipping
              await logger?.info(`Organizing ${audioFiles.length} files individually`);
            }
          }
        } catch (error) {
          await logger?.error(`Chapter merging error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          result.errors.push(`Chapter merging error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          await logger?.warn(`Falling back to organizing ${audioFiles.length} files individually`);
          // Continue with original audioFiles array
        }
      } else {
        await logger?.info(`Single audio file detected - no chapter merging needed`);
      }

      // Tag metadata BEFORE moving files (prevents Plex race condition)
      // Map from original file path to tagged file path (for successful tags)
      const taggedFileMap = new Map<string, string>();

      try {
        if (metadataTaggingEnabled && audioFiles.length > 0) {
          await logger?.info(`Metadata tagging enabled, checking ffmpeg availability...`);

          const ffmpegAvailable = await checkFfmpegAvailable();

          if (ffmpegAvailable) {
            await logger?.info(`Tagging ${audioFiles.length} audio files with metadata (before move)...`);

            // Build full paths to source files for tagging
            // Handle merged files (absolute paths) vs original files (relative paths)
            const sourceFilePaths = audioFiles.map((audioFile) =>
              path.isAbsolute(audioFile)
                ? audioFile // Merged file - use path directly
                : isFile
                  ? downloadPath
                  : path.join(downloadPath, audioFile)
            );

            const taggingResults = await tagMultipleFiles(sourceFilePaths, {
              title: audiobook.title,
              author: audiobook.author,
              narrator: audiobook.narrator,
              year: audiobook.year,
              asin: audiobook.asin,
              series: audiobook.series,
              seriesPart: audiobook.seriesPart,
            });

            const successCount = taggingResults.filter((r) => r.success).length;
            const failCount = taggingResults.filter((r) => !r.success).length;

            if (successCount > 0) {
              await logger?.info(`Successfully tagged ${successCount} file(s) with metadata`);
            }

            if (failCount > 0) {
              await logger?.warn(`Failed to tag ${failCount} file(s): ${
                taggingResults
                  .filter((r) => !r.success)
                  .map((r) => `${path.basename(r.filePath)}: ${r.error}`)
                  .join(', ')
              }`);
              result.errors.push(`Failed to tag ${failCount} file(s) with metadata`);
            }

            // Build map of successfully tagged files
            for (const tagResult of taggingResults) {
              if (tagResult.success && tagResult.taggedFilePath) {
                taggedFileMap.set(tagResult.filePath, tagResult.taggedFilePath);
              }
            }
          } else {
            await logger?.warn(`Metadata tagging enabled but ffmpeg not available - skipping tagging`);
            result.errors.push('Metadata tagging skipped: ffmpeg not available');
          }
        } else {
          await logger?.info(`Metadata tagging disabled or no audio files to tag`);
        }
      } catch (error) {
        await logger?.error(`Metadata tagging failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        result.errors.push(`Metadata tagging failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Don't fail the whole operation if metadata tagging fails - continue with copying files
      }

      // Build target directory
      const targetPath = this.buildTargetPath(
        this.mediaDir,
        template,
        audiobook.author,
        audiobook.title,
        audiobook.narrator,
        audiobook.asin,
        audiobook.year,
        audiobook.series,
        audiobook.seriesPart
      );

      await logger?.info(`Target path: ${targetPath}`);

      // Create target directory
      await fs.mkdir(targetPath, { recursive: true, mode: this.dirMode });

      // Determine if file renaming should be applied
      const shouldRename = renameConfig?.enabled && renameConfig.template;
      const isMultiFile = audioFiles.length > 1;
      const duplicateBasenames = this.findDuplicateBasenames(audioFiles);
      const usedTargetFilenames = new Set<string>();

      if (shouldRename) {
        await logger?.info(`File renaming enabled with template: ${renameConfig.template}${isMultiFile ? ` (${audioFiles.length} files, indices will be appended)` : ''}`);
      } else if (duplicateBasenames.size > 0) {
        await logger?.info(`Detected ${duplicateBasenames.size} duplicate source filename(s); applying folder-aware naming to avoid collisions`);
      }

      // Copy audio files (do NOT delete originals - needed for seeding)
      for (let i = 0; i < audioFiles.length; i++) {
        const audioFile = audioFiles[i];
        // Handle merged files (absolute paths) vs original files (relative paths)
        const isAbsolutePath = path.isAbsolute(audioFile);
        const originalSourcePath = isAbsolutePath
          ? audioFile // Merged file - use path directly
          : isFile
            ? downloadPath
            : path.join(downloadPath, audioFile);

        // Determine target filename (apply rename template if enabled)
        let filename: string;
        if (shouldRename) {
          const ext = path.extname(audioFile);
          const variables: TemplateVariables = {
            author: audiobook.author,
            title: audiobook.title,
            narrator: audiobook.narrator,
            asin: audiobook.asin,
            year: audiobook.year,
            series: audiobook.series,
            seriesPart: audiobook.seriesPart,
          };
          filename = buildRenamedFilename(
            renameConfig.template,
            variables,
            ext,
            isMultiFile ? i + 1 : undefined,
          );
          filename = this.makeUniqueFilename(filename, usedTargetFilenames);
        } else {
          filename = this.buildSourceAwareFilename(
            audioFile,
            duplicateBasenames,
            usedTargetFilenames
          );
        }

        const targetFilePath = path.join(targetPath, filename);

        // Tagged derivative (when tagging succeeded); the original stays untouched for seeding
        const taggedFilePath = taggedFileMap.get(originalSourcePath);
        // The one ASIN step (MP4 freeform tag), only on a file RMAB wrote: the tagged copy, else the merged file
        const ownOutput = taggedFilePath ?? (originalSourcePath === tempMergedFile ? tempMergedFile : undefined);
        const freeform = ownOutput ? await addMp4FreeformTags(ownOutput, path.extname(audioFile), audiobook) : null;
        if (freeform?.warning) await logger?.warn(`${path.basename(audioFile)}: ${freeform.warning}`);
        if (freeform?.written) await logger?.info(`Embedded ASIN ${audiobook.asin} in ${path.basename(audioFile)}`);

        const placed: AudioPlacement = await placeAudio(originalSourcePath, taggedFilePath, targetFilePath, {
          fileMode: this.fileMode,
          // Coercion renames only this import's content, so a retry must know whether a same-size
          // .mp4/.m4a already there is ours (identical) rather than just present
          compareExisting:
            placement?.compareExisting === true ||
            COERCION_CANDIDATE_EXTENSIONS.includes(path.extname(targetFilePath).toLowerCase()),
          probeDuration: probeStreamDurationMs,
        });

        // Records are keyed on the original source; a merged file stands for all its chapters
        const sources = tempMergedFile && originalSourcePath === tempMergedFile ? mergedInputs : [originalSourcePath];
        for (const source of sources) {
          result.records!.push({
            source,
            target: placed.target,
            status: placed.status,
            verified: placed.verified && (sources === mergedInputs ? mergeDurationVerified : true),
            tagsDropped: placed.tagsDropped,
            reason: placed.reason,
          });
        }

        if (taggedFilePath) {
          try {
            await fs.unlink(taggedFilePath);
            await logger?.info(`Cleaned up temp file: ${path.basename(taggedFilePath)}`);
          } catch {
            // Ignore cleanup errors
          }
        }

        if (placed.warning) (result.permissionWarnings ??= []).push(placed.warning);

        switch (placed.status) {
          case 'copied':
            result.audioFiles.push(placed.target);
            result.filesMovedCount++;
            await logger?.info(
              placed.usedDerivative ? `Copied tagged file: ${filename}` : `Copied: ${filename}`
            );
            if (placed.reason) {
              result.errors.push(`${filename}: ${placed.reason}`);
            }
            break;
          case 'identical':
            result.audioFiles.push(placed.target);
            await logger?.info(`Already in place, skipping copy: ${filename}`);
            break;
          case 'present':
            result.audioFiles.push(placed.target);
            moduleLogger.debug(`File already exists, skipping: ${filename}`);
            break;
          case 'differs':
            // The library already has a file by this name; it stays, and so does the source
            await logger?.warn(`Not imported, left untouched: ${filename} (${placed.reason})`);
            result.errors.push(`${filename} not imported: ${placed.reason}`);
            if ((await fs.lstat(placed.target).catch(() => null))?.isFile()) {
              result.audioFiles.push(placed.target);
            }
            break;
          default:
            await logger?.error(`Failed to copy ${filename}: ${placed.reason}`);
            result.errors.push(`Failed to copy ${audioFile}: ${placed.reason}`);
        }
      }

      // Clean up temp merged file after successful copy
      if (tempMergedFile) {
        try {
          await fs.unlink(tempMergedFile);
          await logger?.info(`Cleaned up temp merged file: ${path.basename(tempMergedFile)}`);
        } catch (cleanupError) {
          await logger?.warn(`Failed to clean up temp merged file: ${path.basename(tempMergedFile)}`);
        }
      }

      // Handle cover art
      if (coverFile) {
        const sourcePath = path.join(baseSourcePath, coverFile);
        const targetCoverPath = path.join(targetPath, 'cover.jpg');
        const placedCover = await placeFile(sourcePath, targetCoverPath, {
          fileMode: this.fileMode,
          compareExisting: placement?.compareExisting === true,
        });
        if (placedCover.warning) (result.permissionWarnings ??= []).push(placedCover.warning);
        result.coverRecord = {
          source: sourcePath,
          target: placedCover.target,
          status: placedCover.status,
          verified: isVerifiedStatus(placedCover.status),
          reason: placedCover.reason,
        };
        if (placedCover.status === 'copied') {
          result.coverArtFile = targetCoverPath;
          result.filesMovedCount++;
          await logger?.info(`Copied cover art`);
        } else if (placedCover.status === 'failed') {
          await logger?.warn(`Failed to copy cover art: ${placedCover.reason}`);
          result.errors.push('Failed to copy cover art');
        } else {
          // Already in place (or the library keeps its own cover): never copied onto itself
          result.coverArtFile = targetCoverPath;
          await logger?.info(`Cover art already in place, skipping copy`);
        }
      } else if (audiobook.coverArtUrl && !isLibraryCoverSource(audiobook.coverArtUrl)) {
        // Display-only cover (e.g. a shelf-sync fallback host): never fetched into the library
        const message = 'Cover art is not from a cached thumbnail or known cover image host; skipping cover.jpg';
        if (logger) await logger.warn(message);
        else moduleLogger.warn(message);
      } else if (audiobook.coverArtUrl) {
        // Download cover art from Audible if not in torrent
        try {
          const cover = await this.downloadCoverArt(audiobook.coverArtUrl, targetPath);
          if (cover.warning) (result.permissionWarnings ??= []).push(cover.warning);
          result.coverArtFile = path.join(targetPath, 'cover.jpg');
          if (cover.outcome === 'kept') {
            // The library's own cover stays (a re-import with the same cover lands here too)
            if (logger) await logger.debug('cover.jpg already exists; keeping it');
            else moduleLogger.debug('cover.jpg already exists; keeping it');
          } else {
            await logger?.info(`Downloaded cover art from Audible`);
          }
        } catch (error) {
          await logger?.warn(`Failed to download cover art: ${error instanceof Error ? error.message : 'Unknown error'}`);
          result.errors.push('Failed to download cover art');
        }
      }

      // NOTE: E-book downloads are now handled via first-class ebook requests
      // The createEbookRequestIfEnabled() function in organize-files.processor.ts
      // creates a separate ebook request that goes through the full job queue flow.
      // This replaces the old inline ebook sidecar download that happened here.

      result.targetPath = targetPath;

      // Only mark as success if at least one audio file was placed in the target directory
      // (either freshly copied or already existed from a previous attempt)
      if (result.audioFiles.length > 0) {
        result.success = true;
      } else {
        result.errors.push('No audio files were successfully copied to the target directory');
        await logger?.error(`Organization failed: no audio files copied despite ${audioFiles.length} file(s) found`);
      }

      // DO NOT clean up download directory - files needed for seeding
      // Cleanup will be handled by the seeding cleanup job after seeding requirements are met
      await logger?.info(`Organization complete: ${result.filesMovedCount} files copied (originals kept for seeding)`);

      return result;
    } catch (error) {
      await logger?.error(`Organization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Find audiobook files in download directory or single file
   */
  private async findAudiobookFiles(
    downloadPath: string
  ): Promise<{ audioFiles: string[]; coverFile?: string; isFile: boolean; complete: boolean }> {
    const audioExtensions: readonly string[] = AUDIO_EXTENSIONS;
    const coverPatterns = [
      /cover\.(jpg|jpeg|png)$/i,
      /folder\.(jpg|jpeg|png)$/i,
      /art\.(jpg|jpeg|png)$/i,
    ];

    const audioFiles: string[] = [];
    let coverFile: string | undefined;
    let isFile = false;
    let complete = true;

    try {
      // Check if downloadPath is a file or directory
      const stats = await fs.stat(downloadPath);

      if (stats.isFile()) {
        // Handle single file case
        isFile = true;
        const ext = path.extname(downloadPath).toLowerCase();

        if (audioExtensions.includes(ext)) {
          // Return just the filename (not full path)
          audioFiles.push(path.basename(downloadPath));
        }
      } else {
        // Handle directory case
        const walk = await walkFiles(downloadPath);
        complete = walk.complete;
        if (!walk.complete) {
          moduleLogger.error(`Some folders under ${downloadPath} could not be read`);
        }

        for (const file of walk.files) {
          const ext = path.extname(file).toLowerCase();

          // Check if it's an audio file
          if (audioExtensions.includes(ext)) {
            audioFiles.push(file);
          }

          // Check if it's cover art
          const basename = path.basename(file);
          if (coverPatterns.some((pattern) => pattern.test(basename))) {
            coverFile = file;
          }
        }
      }
    } catch (error) {
      moduleLogger.error('Error reading directory', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }

    return { audioFiles, coverFile, isFile, complete };
  }

  /**
   * Build target path using template-based path building
   * Uses the path template engine to substitute variables and sanitize paths
   */
  private buildTargetPath(
    baseDir: string,
    template: string,
    author: string,
    title: string,
    narrator?: string,
    asin?: string,
    year?: number,
    series?: string,
    seriesPart?: string
  ): string {
    const variables: TemplateVariables = {
      author,
      title,
      narrator,
      asin,
      year,
      series,
      seriesPart,
    };

    const relativePath = substituteTemplate(template, variables);
    return path.join(baseDir, relativePath);
  }

  /**
   * Sanitize path component (remove invalid characters)
   */
  private sanitizePath(name: string): string {
    return (
      name
        // Remove invalid filename characters
        .replace(/[<>:"/\\|?*]/g, '')
        // Remove leading/trailing dots and spaces
        .trim()
        .replace(/^\.+/, '')
        .replace(/\.+$/, '')
        // Collapse multiple spaces
        .replace(/\s+/g, ' ')
        // Limit length (255 chars max for most filesystems)
        .slice(0, 200)
    );
  }

  private findDuplicateBasenames(files: string[]): Set<string> {
    const counts = new Map<string, number>();

    for (const file of files) {
      const basename = path.basename(file);
      counts.set(basename, (counts.get(basename) || 0) + 1);
    }

    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([basename]) => basename)
    );
  }

  private buildSourceAwareFilename(
    sourcePath: string,
    duplicateBasenames: Set<string>,
    usedFilenames: Set<string>
  ): string {
    const basename = path.basename(sourcePath);
    const ext = path.extname(basename);
    const stem = path.basename(basename, ext);

    let candidate = basename;

    // Preserve folder context for duplicate track names (e.g. CD1/Track01.mp3,
    // CD2/Track01.mp3) so each file keeps a unique target name.
    if (duplicateBasenames.has(basename) && !path.isAbsolute(sourcePath)) {
      const folder = path.dirname(sourcePath);
      if (folder !== '.') {
        const folderPrefix = folder
          .split(path.sep)
          .filter(Boolean)
          .map((segment) => this.sanitizePath(segment))
          .join('-');

        if (folderPrefix) {
          candidate = `${folderPrefix}-${stem}${ext}`;
        }
      }
    }

    return this.makeUniqueFilename(candidate, usedFilenames);
  }

  private makeUniqueFilename(filename: string, usedFilenames: Set<string>): string {
    if (!usedFilenames.has(filename)) {
      usedFilenames.add(filename);
      return filename;
    }

    const ext = path.extname(filename);
    const stem = path.basename(filename, ext);
    let suffix = 2;

    while (true) {
      const candidate = `${stem} (${suffix})${ext}`;
      if (!usedFilenames.has(candidate)) {
        usedFilenames.add(candidate);
        return candidate;
      }
      suffix++;
    }
  }

  /**
   * Download cover art from URL or copy from local cache. An existing cover.jpg
   * is never replaced ('kept') and is not fetched for; an empty one is replaced. A warning is returned
   * when the cover was written but its permissions could not be set.
   */
  private async downloadCoverArt(url: string, targetDir: string): Promise<CoverPlacement> {
    const targetPath = path.join(targetDir, 'cover.jpg');

    try {
      if (await hasCover(targetPath)) {
        return { outcome: 'kept' };
      }
      // Cached thumbnail (plain file name inside the cache dir only)
      const cachedPath = cachedThumbnailPath(url);
      if (cachedPath) {
        const cover = await publishCover(targetPath, { file: cachedPath }, this.fileMode);
        moduleLogger.debug(`Cover art from cache ${path.basename(cachedPath)}: ${cover.outcome}`);
        return cover;
      } else if (isAllowedRemoteCoverUrl(url)) {
        // Known Audible/Amazon image host over https; every redirect hop must be one too
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
          maxRedirects: MAX_COVER_ART_REDIRECTS,
          beforeRedirect: (redirect: { href?: string; protocol?: string; hostname?: string }) => {
            const next = redirect.href ?? `${redirect.protocol}//${redirect.hostname}/`;
            if (!isAllowedRemoteCoverUrl(next)) {
              throw new Error('Cover art redirected to a host that is not a known cover image host');
            }
          },
          maxContentLength: MAX_COVER_ART_BYTES,
          headers: { 'User-Agent': RMAB_USER_AGENT },
        });

        const data = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        const cover = await publishCover(targetPath, { data }, this.fileMode);
        moduleLogger.debug(`Cover art from URL: ${cover.outcome}`);
        return cover;
      } else {
        throw new Error('Cover art URL is not a cached thumbnail or a known cover image host');
      }
    } catch (error) {
      moduleLogger.error('Failed to download cover art', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Validate directory structure
   */
  async validate(basePath: string): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      issues: [],
      path: basePath,
    };

    try {
      // Check if base path exists
      await fs.access(basePath);

      // Check if it's a directory
      const stats = await fs.stat(basePath);
      if (!stats.isDirectory()) {
        result.isValid = false;
        result.issues.push('Path is not a directory');
      }

      // Check if writable
      try {
        const testFile = path.join(basePath, '.test-write');
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
      } catch {
        result.isValid = false;
        result.issues.push('Directory is not writable');
      }
    } catch (error) {
      result.isValid = false;
      result.issues.push(`Path does not exist or is not accessible: ${basePath}`);
    }

    return result;
  }

  /**
   * Organize ebook file into proper directory structure
   * Simplified compared to audiobooks - no metadata tagging, cover art, or chapter merging
   * Supports both direct file paths (Anna's Archive) and directories (indexer downloads)
   */
  async organizeEbook(
    downloadPath: string,
    metadata: { title: string; author: string; narrator?: string; asin?: string; year?: number; series?: string; seriesPart?: string },
    template: string,
    loggerConfig?: LoggerConfig,
    isIndexerDownload: boolean = false,
    renameConfig?: { enabled: boolean; template: string },
    placement?: PlacementOptions
  ): Promise<EbookOrganizationResult> {
    const logger = loggerConfig ? RMABLogger.forJob(loggerConfig.jobId, loggerConfig.context) : null;

    const result: EbookOrganizationResult = {
      success: false,
      targetPath: '',
      errors: [],
    };

    try {
      await logger?.info(`Organizing ebook: ${downloadPath}`);

      const ebookFormats = ORGANIZER_EBOOK_FORMATS;

      // Find ebook file (handle both file and directory cases)
      const { ebookFile, baseSourcePath, isFile, allEbookFiles, complete } = await this.findEbookFile(downloadPath, ebookFormats);
      result.inventory = {
        kind: 'ebook',
        files: allEbookFiles.map((f) => (isFile ? downloadPath : path.join(baseSourcePath, f))),
        complete,
      };

      if (!ebookFile) {
        throw new Error(`No ebook files found in download (looking for: ${ebookFormats.join(', ')})`);
      }

      // Build full path to source file
      const sourceFilePath = isFile ? downloadPath : path.join(baseSourcePath, ebookFile);
      result.sourceFile = sourceFilePath;
      await logger?.info(`Found ebook file: ${ebookFile}`);

      // Detect format from extension
      const ext = path.extname(ebookFile).toLowerCase().slice(1);
      result.format = ext;
      await logger?.info(`Detected ebook format: ${ext}`);

      // Build target directory using same template as audiobooks
      const targetDir = this.buildTargetPath(
        this.mediaDir,
        template,
        metadata.author,
        metadata.title,
        metadata.narrator,
        metadata.asin,
        metadata.year,
        metadata.series,
        metadata.seriesPart
      );

      await logger?.info(`Target directory: ${targetDir}`);

      // Create target directory
      await fs.mkdir(targetDir, { recursive: true, mode: this.dirMode });

      // Build target filename (apply rename template if enabled, otherwise sanitize source filename)
      const sourceFilename = path.basename(ebookFile);
      let targetFilename: string;
      if (renameConfig?.enabled && renameConfig.template) {
        const originalExt = path.extname(ebookFile);
        const variables: TemplateVariables = {
          author: metadata.author,
          title: metadata.title,
          narrator: metadata.narrator,
          asin: metadata.asin,
          year: metadata.year,
          series: metadata.series,
          seriesPart: metadata.seriesPart,
        };
        targetFilename = buildRenamedFilename(renameConfig.template, variables, originalExt);
        await logger?.info(`Renamed ebook file: ${sourceFilename} -> ${targetFilename}`);
      } else {
        targetFilename = this.sanitizePath(sourceFilename);
      }
      const targetPath = path.join(targetDir, targetFilename);

      const placed = await placeFile(sourceFilePath, targetPath, {
        fileMode: this.fileMode,
        compareExisting: placement?.compareExisting === true,
      });
      if (placed.warning) (result.permissionWarnings ??= []).push(placed.warning);
      result.record = {
        source: sourceFilePath,
        target: placed.target,
        status: placed.status,
        verified: isVerifiedStatus(placed.status),
        reason: placed.reason,
      };
      if (placed.status === 'failed') {
        throw new Error(`Failed to copy ebook ${targetFilename}: ${placed.reason}`);
      }
      if (placed.status === 'differs') {
        // Not a failure: the library keeps its own file, the source stays
        await logger?.warn(`Ebook not imported, left untouched: ${targetFilename} (${placed.reason})`);
        result.errors.push(`${targetFilename} not imported: ${placed.reason}`);
      } else {
        await logger?.info(
          placed.status === 'copied'
            ? `Copied ebook: ${targetFilename}`
            : `Ebook already exists at target, skipping copy: ${targetFilename}`
        );
      }

      // The source is never deleted here. Direct HTTP download files are removed
      // afterwards by the post-organize cleanup, behind the delete guard.
      if (isIndexerDownload) {
        await logger?.info(`Keeping source file for seeding: ${sourceFilename}`);
      }

      result.success = true;
      result.targetPath = targetDir;

      await logger?.info(`Ebook organization complete: ${targetFilename}`);

      return result;
    } catch (error) {
      await logger?.error(`Ebook organization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Find ebook file in download path (handles both single file and directory)
   */
  private async findEbookFile(
    downloadPath: string,
    ebookFormats: string[]
  ): Promise<{ ebookFile: string | null; baseSourcePath: string; isFile: boolean; allEbookFiles: string[]; complete: boolean }> {
    let ebookFile: string | null = null;
    let isFile = false;
    let allEbookFiles: string[] = [];
    let complete = true;

    try {
      const stats = await fs.stat(downloadPath);

      if (stats.isFile()) {
        // Handle single file case
        isFile = true;
        const ext = path.extname(downloadPath).toLowerCase().slice(1);

        if (ebookFormats.includes(ext)) {
          ebookFile = path.basename(downloadPath);
          allEbookFiles = [ebookFile];
        }
      } else {
        // Handle directory case - find ebook files inside
        const walk = await walkFiles(downloadPath);
        complete = walk.complete;

        // Filter to ebook files and sort by preference (epub > pdf > others)
        const ebookFiles = walk.files.filter(file => {
          const ext = path.extname(file).toLowerCase().slice(1);
          return ebookFormats.includes(ext);
        });

        if (ebookFiles.length > 0) {
          // Sort by format preference
          ebookFiles.sort((a, b) => {
            const extA = path.extname(a).toLowerCase().slice(1);
            const extB = path.extname(b).toLowerCase().slice(1);
            const priorityOrder = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'cbr'];
            return priorityOrder.indexOf(extA) - priorityOrder.indexOf(extB);
          });

          ebookFile = ebookFiles[0];
          allEbookFiles = ebookFiles;
        }
      }
    } catch {
      // Path doesn't exist or inaccessible
    }

    return {
      ebookFile,
      baseSourcePath: downloadPath,
      isFile,
      allEbookFiles,
      complete,
    };
  }
}

/**
 * Get FileOrganizer instance configured from database settings
 * Reads media_dir, file_chmod, dir_chmod from database configuration
 */
export async function getFileOrganizer(): Promise<FileOrganizer> {
  const mediaDir = await getMediaDir();
  const tempDir = process.env.TEMP_DIR || '/tmp/readmeabook';

  // Read file/directory permission settings
  const { getConfigService } = await import('../services/config.service');
  const configService = getConfigService();
  const fileChmodStr = await configService.get('file_chmod') || '664';
  const dirChmodStr = await configService.get('dir_chmod') || '775';
  const fileMode = parseInt(fileChmodStr, 8);
  const dirMode = parseInt(dirChmodStr, 8);

  return new FileOrganizer(mediaDir, tempDir, fileMode, dirMode);
}

/**
 * Build audiobook path using template-based path building
 * Standalone function for use by other modules (e.g., fetch-ebook route, request-delete service)
 *
 * @param baseDir - Base directory for audiobooks (e.g., /media/audiobooks)
 * @param template - Path template string (e.g., "{author}/{title} {asin}")
 * @param variables - Object containing variable values (author, title, narrator, asin)
 * @returns Full path to audiobook directory
 *
 * @example
 * ```typescript
 * const path = buildAudiobookPath(
 *   '/media/audiobooks',
 *   '{author}/{title} {asin}',
 *   { author: 'Brandon Sanderson', title: 'Mistborn', asin: 'B002UZMLXM' }
 * );
 * // Returns: "/media/audiobooks/Brandon Sanderson/Mistborn B002UZMLXM"
 * ```
 */
export function buildAudiobookPath(
  baseDir: string,
  template: string,
  variables: { author: string; title: string; narrator?: string; asin?: string; year?: number; series?: string; seriesPart?: string }
): string {
  const templateVars: TemplateVariables = {
    author: variables.author,
    title: variables.title,
    narrator: variables.narrator,
    asin: variables.asin,
    year: variables.year,
    series: variables.series,
    seriesPart: variables.seriesPart,
  };

  const relativePath = substituteTemplate(template, templateVars);
  return path.join(baseDir, relativePath);
}
