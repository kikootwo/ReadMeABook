/**
 * Component: File Organization System
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { createJobLogger, JobLogger } from './job-logger';
import { tagMultipleFiles, checkFfmpegAvailable } from './metadata-tagger';
import { prisma } from '../db';

export interface AudiobookMetadata {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
  coverArtUrl?: string;
}

export interface OrganizationResult {
  success: boolean;
  targetPath: string;
  filesMovedCount: number;
  errors: string[];
  audioFiles: string[];
  coverArtFile?: string;
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
    loggerConfig?: LoggerConfig
  ): Promise<OrganizationResult> {
    // Create logger if config provided
    const logger = loggerConfig ? createJobLogger(loggerConfig.jobId, loggerConfig.context) : null;

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
            const sourceFilePaths = audioFiles.map((audioFile) =>
              isFile ? downloadPath : path.join(downloadPath, audioFile)
            );

            const taggingResults = await tagMultipleFiles(sourceFilePaths, {
              title: audiobook.title,
              author: audiobook.author,
              narrator: audiobook.narrator,
              year: audiobook.year,
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
        audiobook.author,
        audiobook.title,
        audiobook.year
      );

      await logger?.info(`Target path: ${targetPath}`);

      // Create target directory
      await fs.mkdir(targetPath, { recursive: true });

      // Copy audio files (do NOT delete originals - needed for seeding)
      for (const audioFile of audioFiles) {
        const originalSourcePath = isFile ? downloadPath : path.join(downloadPath, audioFile);
        const filename = path.basename(audioFile);
        const targetFilePath = path.join(targetPath, filename);

        // Check if we have a tagged version of this file
        const taggedFilePath = taggedFileMap.get(originalSourcePath);
        const sourcePath = taggedFilePath || originalSourcePath; // Use tagged version if available, otherwise use original

        // Check if source exists
        try {
          await fs.access(sourcePath, fs.constants.R_OK);
        } catch {
          console.warn(`[FileOrganizer] Source file not found or not readable: ${sourcePath}`);
          result.errors.push(`Source file not found: ${audioFile}`);
          continue;
        }

        // Check if target already exists (skip if already copied)
        try {
          await fs.access(targetFilePath);
          console.log(`[FileOrganizer] File already exists, skipping: ${filename}`);
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
          // Read source file (either tagged version or original)
          const fileData = await fs.readFile(sourcePath);
          // Write to target with explicit permissions
          await fs.writeFile(targetFilePath, fileData, { mode: 0o644 });

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
          result.errors.push(`Failed to copy ${audioFile}: ${errorMsg}`);
          // Continue with other files instead of throwing
        }
      }

      // Handle cover art
      if (coverFile) {
        const sourcePath = path.join(baseSourcePath, coverFile);
        const targetCoverPath = path.join(targetPath, 'cover.jpg');

        try {
          // Copy cover art (do NOT delete original)
          const coverData = await fs.readFile(sourcePath);
          await fs.writeFile(targetCoverPath, coverData, { mode: 0o644 });
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

      result.targetPath = targetPath;
      result.success = true;

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
    const audioExtensions = ['.m4b', '.m4a', '.mp3', '.mp4', '.aa', '.aax'];
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
      console.error('[FileOrganizer] Error reading directory:', error);
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
      console.error(`[FileOrganizer] Error reading directory ${dir}:`, error);
    }

    return files;
  }

  /**
   * Build target path with sanitized names
   */
  private buildTargetPath(
    baseDir: string,
    author: string,
    title: string,
    year?: number
  ): string {
    const authorClean = this.sanitizePath(author);
    const titleClean = this.sanitizePath(title);
    const folderName = year ? `${titleClean} (${year})` : titleClean;

    return path.join(baseDir, authorClean, folderName);
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

  /**
   * Download cover art from URL
   */
  private async downloadCoverArt(url: string, targetDir: string): Promise<void> {
    const targetPath = path.join(targetDir, 'cover.jpg');

    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      await fs.writeFile(targetPath, response.data);
    } catch (error) {
      console.error('[FileOrganizer] Failed to download cover art:', error);
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
      console.log(`[FileOrganizer] Cleaned up: ${downloadPath}`);
    } catch (error) {
      console.error(`[FileOrganizer] Cleanup failed for ${downloadPath}:`, error);
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
}

// Singleton instance
let fileOrganizer: FileOrganizer | null = null;

export function getFileOrganizer(): FileOrganizer {
  if (!fileOrganizer) {
    const mediaDir = process.env.MEDIA_DIR || '/media/audiobooks';
    const tempDir = process.env.TEMP_DIR || '/tmp/readmeabook';

    fileOrganizer = new FileOrganizer(mediaDir, tempDir);
  }

  return fileOrganizer;
}
