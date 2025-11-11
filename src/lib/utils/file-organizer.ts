/**
 * Component: File Organization System
 * Documentation: documentation/phase3/file-organization.md
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

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
    audiobook: AudiobookMetadata
  ): Promise<OrganizationResult> {
    const result: OrganizationResult = {
      success: false,
      targetPath: '',
      filesMovedCount: 0,
      errors: [],
      audioFiles: [],
    };

    try {
      console.log(`[FileOrganizer] Organizing: ${downloadPath}`);

      // Find audiobook files
      const { audioFiles, coverFile } = await this.findAudiobookFiles(downloadPath);

      if (audioFiles.length === 0) {
        throw new Error('No audiobook files found in download');
      }

      console.log(`[FileOrganizer] Found ${audioFiles.length} audio files`);

      // Build target directory
      const targetPath = this.buildTargetPath(
        this.mediaDir,
        audiobook.author,
        audiobook.title,
        audiobook.year
      );

      console.log(`[FileOrganizer] Target path: ${targetPath}`);

      // Create target directory
      await fs.mkdir(targetPath, { recursive: true });

      // Move audio files
      for (const audioFile of audioFiles) {
        const sourcePath = path.join(downloadPath, audioFile);
        const filename = path.basename(audioFile);
        const targetFilePath = path.join(targetPath, filename);

        // Check if source exists
        try {
          await fs.access(sourcePath);
        } catch {
          console.warn(`[FileOrganizer] Source file not found: ${sourcePath}`);
          result.errors.push(`Source file not found: ${audioFile}`);
          continue;
        }

        // Move file (or copy if crossing filesystems)
        try {
          await fs.rename(sourcePath, targetFilePath);
        } catch (renameError) {
          // If rename fails (crossing filesystems), copy then delete
          console.log(`[FileOrganizer] Rename failed, using copy+delete for: ${filename}`);
          await fs.copyFile(sourcePath, targetFilePath);
          await fs.unlink(sourcePath);
        }

        result.audioFiles.push(targetFilePath);
        result.filesMovedCount++;
        console.log(`[FileOrganizer] Moved: ${filename}`);
      }

      // Handle cover art
      if (coverFile) {
        const sourcePath = path.join(downloadPath, coverFile);
        const targetCoverPath = path.join(targetPath, 'cover.jpg');

        try {
          await fs.rename(sourcePath, targetCoverPath);
          result.coverArtFile = targetCoverPath;
          result.filesMovedCount++;
          console.log(`[FileOrganizer] Moved cover art`);
        } catch (error) {
          console.warn(`[FileOrganizer] Failed to move cover art:`, error);
          result.errors.push('Failed to move cover art');
        }
      } else if (audiobook.coverArtUrl) {
        // Download cover art from Audible if not in torrent
        try {
          await this.downloadCoverArt(audiobook.coverArtUrl, targetPath);
          result.coverArtFile = path.join(targetPath, 'cover.jpg');
          console.log(`[FileOrganizer] Downloaded cover art from Audible`);
        } catch (error) {
          console.warn(`[FileOrganizer] Failed to download cover art:`, error);
          result.errors.push('Failed to download cover art');
        }
      }

      result.targetPath = targetPath;
      result.success = true;

      // Clean up download directory
      try {
        await this.cleanup(downloadPath);
      } catch (error) {
        console.warn(`[FileOrganizer] Cleanup warning:`, error);
        result.errors.push('Failed to cleanup download directory');
      }

      console.log(`[FileOrganizer] Organization complete: ${result.filesMovedCount} files moved`);

      return result;
    } catch (error) {
      console.error(`[FileOrganizer] Organization failed:`, error);
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      return result;
    }
  }

  /**
   * Find audiobook files in download directory
   */
  private async findAudiobookFiles(
    downloadPath: string
  ): Promise<{ audioFiles: string[]; coverFile?: string }> {
    const audioExtensions = ['.m4b', '.m4a', '.mp3', '.mp4', '.aa', '.aax'];
    const coverPatterns = [
      /cover\.(jpg|jpeg|png)$/i,
      /folder\.(jpg|jpeg|png)$/i,
      /art\.(jpg|jpeg|png)$/i,
    ];

    const audioFiles: string[] = [];
    let coverFile: string | undefined;

    try {
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
    } catch (error) {
      console.error('[FileOrganizer] Error walking directory:', error);
      throw error;
    }

    return { audioFiles, coverFile };
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
