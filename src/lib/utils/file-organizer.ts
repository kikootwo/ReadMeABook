/**
 * Component: File Organization System
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { tagMultipleFiles, checkFfmpegAvailable } from './metadata-tagger';
import { RMABLogger } from './logger';
import { copyFile } from './copy-file';

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
import { AUDIO_EXTENSIONS } from '../constants/audio-formats';

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
}

export interface EbookOrganizationResult {
  success: boolean;
  targetPath: string;
  errors: string[];
  format?: string;
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

  constructor(mediaDir: string = '/media/audiobooks', tempDir: string = '/tmp/readmeabook') {
    this.mediaDir = mediaDir;
    this.tempDir = tempDir;
  }

  /**
   * Organize completed download into proper directory structure
   */
  async organize(
    downloadPath: string,
    audiobook: AudiobookMetadata,
    template: string,
    loggerConfig?: LoggerConfig,
    renameConfig?: { enabled: boolean; template: string }
  ): Promise<OrganizationResult> {
    // Create logger if config provided
    const logger = loggerConfig ? RMABLogger.forJob(loggerConfig.jobId, loggerConfig.context) : null;

    const result: OrganizationResult = {
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: [],
      audioFiles: [],
    };

    try {
      await logger?.info(`Organizing: ${downloadPath}`);

      // Find audiobook files
      const { audioFiles, coverFile, isFile } = await this.findAudiobookFiles(downloadPath);

      if (audioFiles.length === 0) {
        throw new Error('No audiobook files found in download');
      }

      await logger?.info(`Found ${audioFiles.length} audio files`);

      // Determine base path for source files
      const baseSourcePath = isFile ? path.dirname(downloadPath) : downloadPath;

      // Track if we created a merged file that needs cleanup
      let tempMergedFile: string | null = null;

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
              // Check disk space
              const estimatedSize = await estimateOutputSize(sourceFilePaths);
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
                      asin: audiobook.asin,
                      outputPath,
                    },
                    logger ?? undefined
                  );

                  if (mergeResult.success && mergeResult.outputPath) {
                    // Replace audioFiles array with single merged file
                    audioFiles.length = 0;
                    audioFiles.push(mergeResult.outputPath);

                    // Mark for cleanup after copy
                    tempMergedFile = mergeResult.outputPath;

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
        const config = await prisma.configuration.findUnique({
          where: { key: 'metadata_tagging_enabled' },
        });

        const metadataTaggingEnabled = config?.value === 'true';

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
      await fs.mkdir(targetPath, { recursive: true });

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

        // Check if we have a tagged version of this file
        const taggedFilePath = taggedFileMap.get(originalSourcePath);
        const sourcePath = taggedFilePath || originalSourcePath; // Use tagged version if available, otherwise use original

        // Check if source exists
        try {
          await fs.access(sourcePath, fs.constants.R_OK);
        } catch {
          moduleLogger.warn(`Source file not found or not readable: ${sourcePath}`);
          result.errors.push(`Source file not found: ${audioFile}`);
          continue;
        }

        // Check if target already exists (skip if already copied)
        try {
          await fs.access(targetFilePath);
          moduleLogger.debug(`File already exists, skipping: ${filename}`);
          result.audioFiles.push(targetFilePath);

          // Clean up tagged temp file if it exists
          if (taggedFilePath) {
            try {
              await fs.unlink(taggedFilePath);
              await logger?.info(`Cleaned up temp file: ${path.basename(taggedFilePath)}`);
            } catch {
              // Ignore cleanup errors
            }
          }
          continue;
        } catch {
          // File doesn't exist, continue with copy
        }

        // Copy file (do NOT delete original - needed for seeding)
        try {
          // Copy file via streams (avoids copy_file_range EPERM on NFS/FUSE)
          await copyFile(sourcePath, targetFilePath);
          // Set explicit permissions after copy
          await fs.chmod(targetFilePath, 0o644);

          result.audioFiles.push(targetFilePath);
          result.filesMovedCount++;

          if (taggedFilePath) {
            await logger?.info(`Copied tagged file: ${filename}`);
            // Clean up the tagged temp file after successful copy
            try {
              await fs.unlink(taggedFilePath);
              await logger?.info(`Cleaned up temp file: ${path.basename(taggedFilePath)}`);
            } catch (cleanupError) {
              await logger?.warn(`Failed to clean up temp file: ${path.basename(taggedFilePath)}`);
            }
          } else {
            await logger?.info(`Copied: ${filename}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          await logger?.error(`Failed to copy ${filename}: ${errorMsg}`);

          // If the tagged temp file failed to copy, clean it up and try the original untagged file
          if (taggedFilePath) {
            // Clean up the tagged temp file that failed to copy
            try {
              await fs.unlink(taggedFilePath);
              await logger?.info(`Cleaned up temp file after copy failure: ${path.basename(taggedFilePath)}`);
            } catch {
              // Ignore cleanup errors
            }

            // Fallback: attempt to copy the original untagged file instead
            await logger?.info(`Attempting fallback copy of original (untagged) file: ${filename}`);
            try {
              await fs.access(originalSourcePath, fs.constants.R_OK);
              await copyFile(originalSourcePath, targetFilePath);
              await fs.chmod(targetFilePath, 0o644);
              result.audioFiles.push(targetFilePath);
              result.filesMovedCount++;
              await logger?.info(`Fallback copy succeeded (without metadata tags): ${filename}`);
              result.errors.push(`Tagged copy failed for ${filename}, copied original without metadata tags`);
              continue;
            } catch (fallbackError) {
              const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
              await logger?.error(`Fallback copy of original file also failed: ${fallbackMsg}`);
            }
          }

          result.errors.push(`Failed to copy ${audioFile}: ${errorMsg}`);
          // Continue with other files instead of throwing
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

        try {
          // Copy cover art (do NOT delete original)
          await copyFile(sourcePath, targetCoverPath);
          await fs.chmod(targetCoverPath, 0o644);
          result.coverArtFile = targetCoverPath;
          result.filesMovedCount++;
          await logger?.info(`Copied cover art`);
        } catch (error) {
          await logger?.warn(`Failed to copy cover art: ${error instanceof Error ? error.message : 'Unknown error'}`);
          result.errors.push('Failed to copy cover art');
        }
      } else if (audiobook.coverArtUrl) {
        // Download cover art from Audible if not in torrent
        try {
          await this.downloadCoverArt(audiobook.coverArtUrl, targetPath);
          result.coverArtFile = path.join(targetPath, 'cover.jpg');
          await logger?.info(`Downloaded cover art from Audible`);
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
  ): Promise<{ audioFiles: string[]; coverFile?: string; isFile: boolean }> {
    const audioExtensions: readonly string[] = AUDIO_EXTENSIONS;
    const coverPatterns = [
      /cover\.(jpg|jpeg|png)$/i,
      /folder\.(jpg|jpeg|png)$/i,
      /art\.(jpg|jpeg|png)$/i,
    ];

    const audioFiles: string[] = [];
    let coverFile: string | undefined;
    let isFile = false;

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
        const files = await this.walkDirectory(downloadPath);

        for (const file of files) {
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

    return { audioFiles, coverFile, isFile };
  }

  /**
   * Recursively walk directory to find all files
   */
  private async walkDirectory(dir: string, baseDir: string = ''): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = baseDir ? path.join(baseDir, entry.name) : entry.name;

        if (entry.isDirectory()) {
          const subFiles = await this.walkDirectory(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch (error) {
      moduleLogger.error(`Error reading directory ${dir}`, { error: error instanceof Error ? error.message : String(error) });
    }

    return files;
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
   * Download cover art from URL or copy from local cache
   */
  private async downloadCoverArt(url: string, targetDir: string): Promise<void> {
    const targetPath = path.join(targetDir, 'cover.jpg');

    try {
      // Check if this is a cached thumbnail (local file)
      if (url.startsWith('/api/cache/thumbnails/')) {
        // Extract filename from the API path
        const filename = url.replace('/api/cache/thumbnails/', '');
        const cachedPath = path.join('/app/cache/thumbnails', filename);

        // Copy from local cache instead of downloading
        await copyFile(cachedPath, targetPath);
        await fs.chmod(targetPath, 0o644);
        moduleLogger.debug(`Copied cover art from cache: ${filename}`);
      } else {
        // Download from external URL (e.g., Audible CDN)
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });

        await fs.writeFile(targetPath, response.data);
        moduleLogger.debug(`Downloaded cover art from URL`);
      }
    } catch (error) {
      moduleLogger.error('Failed to download cover art', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Clean up download directory
   */
  async cleanup(downloadPath: string): Promise<void> {
    try {
      // Remove download directory and all remaining files
      await fs.rm(downloadPath, { recursive: true, force: true });
      moduleLogger.debug(`Cleaned up: ${downloadPath}`);
    } catch (error) {
      moduleLogger.error(`Cleanup failed for ${downloadPath}`, { error: error instanceof Error ? error.message : String(error) });
      // Don't throw - cleanup is non-critical
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
    renameConfig?: { enabled: boolean; template: string }
  ): Promise<EbookOrganizationResult> {
    const logger = loggerConfig ? RMABLogger.forJob(loggerConfig.jobId, loggerConfig.context) : null;

    const result: EbookOrganizationResult = {
      success: false,
      targetPath: '',
      errors: [],
    };

    try {
      await logger?.info(`Organizing ebook: ${downloadPath}`);

      const ebookFormats = ['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'cbz', 'cbr'];

      // Find ebook file (handle both file and directory cases)
      const { ebookFile, baseSourcePath, isFile } = await this.findEbookFile(downloadPath, ebookFormats);

      if (!ebookFile) {
        throw new Error(`No ebook files found in download (looking for: ${ebookFormats.join(', ')})`);
      }

      // Build full path to source file
      const sourceFilePath = isFile ? downloadPath : path.join(baseSourcePath, ebookFile);
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
      await fs.mkdir(targetDir, { recursive: true });

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

      // Check if target already exists
      try {
        await fs.access(targetPath);
        await logger?.info(`Ebook already exists at target, skipping copy: ${targetFilename}`);
        result.success = true;
        result.targetPath = targetDir;
        return result;
      } catch {
        // File doesn't exist, continue with copy
      }

      // Copy ebook file (do NOT delete original - may need for seeding or retry)
      await copyFile(sourceFilePath, targetPath);
      await fs.chmod(targetPath, 0o644);

      await logger?.info(`Copied ebook: ${targetFilename}`);

      // Clean up source file ONLY for direct HTTP downloads (not indexer downloads which need to seed)
      if (!isIndexerDownload && isFile) {
        try {
          await fs.unlink(sourceFilePath);
          await logger?.info(`Cleaned up source file: ${sourceFilename}`);
        } catch {
          // Ignore cleanup errors
        }
      } else if (isIndexerDownload) {
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
  ): Promise<{ ebookFile: string | null; baseSourcePath: string; isFile: boolean }> {
    let ebookFile: string | null = null;
    let isFile = false;

    try {
      const stats = await fs.stat(downloadPath);

      if (stats.isFile()) {
        // Handle single file case
        isFile = true;
        const ext = path.extname(downloadPath).toLowerCase().slice(1);

        if (ebookFormats.includes(ext)) {
          ebookFile = path.basename(downloadPath);
        }
      } else {
        // Handle directory case - find ebook files inside
        const files = await this.walkDirectory(downloadPath);

        // Filter to ebook files and sort by preference (epub > pdf > others)
        const ebookFiles = files.filter(file => {
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
        }
      }
    } catch {
      // Path doesn't exist or inaccessible
    }

    return {
      ebookFile,
      baseSourcePath: downloadPath,
      isFile,
    };
  }
}

/**
 * Get FileOrganizer instance configured from database settings
 * Reads media_dir from database configuration, falls back to /media/audiobooks if not configured
 */
export async function getFileOrganizer(): Promise<FileOrganizer> {
  // Read media_dir from database config
  const config = await prisma.configuration.findUnique({
    where: { key: 'media_dir' },
  });

  const mediaDir = config?.value || process.env.MEDIA_DIR || '/media/audiobooks';
  const tempDir = process.env.TEMP_DIR || '/tmp/readmeabook';

  return new FileOrganizer(mediaDir, tempDir);
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
