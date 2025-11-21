/**
 * Component: Metadata Tagging Utility
 * Documentation: documentation/phase3/file-organization.md
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execPromise = promisify(exec);

export interface MetadataTaggingOptions {
  title: string;
  author: string;
  narrator?: string;
  year?: number;
}

export interface TaggingResult {
  success: boolean;
  filePath: string; // Original file path
  taggedFilePath?: string; // Path to tagged file (if successful)
  error?: string;
}

/**
 * Tag audio file metadata using ffmpeg
 * Supports m4b and mp3 files
 * Uses -codec copy for lossless operation (metadata only, no re-encoding)
 */
export async function tagAudioFileMetadata(
  filePath: string,
  metadata: MetadataTaggingOptions
): Promise<TaggingResult> {
  try {
    // Check if file exists
    await fs.access(filePath);

    const ext = path.extname(filePath).toLowerCase();

    // Only process supported formats
    if (!['.m4b', '.m4a', '.mp3', '.mp4'].includes(ext)) {
      return {
        success: false,
        filePath,
        error: `Unsupported file format: ${ext}`,
      };
    }

    // Create temporary file path
    const tempFile = `${filePath}.tmp`;

    // Build ffmpeg command
    const args: string[] = [
      'ffmpeg',
      '-i', `"${filePath}"`,
      '-codec', 'copy', // No re-encoding, metadata only
    ];

    // For m4b/m4a/mp4 files, use standard metadata tags
    if (['.m4b', '.m4a', '.mp4'].includes(ext)) {
      args.push(
        '-metadata', `title="${escapeMetadata(metadata.title)}"`,
        '-metadata', `album="${escapeMetadata(metadata.title)}"`, // Book title in Album field (Plex uses this)
        '-metadata', `album_artist="${escapeMetadata(metadata.author)}"`, // Author in Album Artist (PRIMARY for Plex)
        '-metadata', `artist="${escapeMetadata(metadata.author)}"` // Fallback
      );

      if (metadata.narrator) {
        args.push('-metadata', `composer="${escapeMetadata(metadata.narrator)}"`); // Narrator in Composer
      }

      if (metadata.year) {
        args.push('-metadata', `date="${metadata.year}"`);
      }

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp4');
    }
    // For mp3 files, use ID3v2 tags
    else if (ext === '.mp3') {
      args.push(
        '-metadata', `title="${escapeMetadata(metadata.title)}"`,
        '-metadata', `album="${escapeMetadata(metadata.title)}"`,
        '-metadata', `album_artist="${escapeMetadata(metadata.author)}"`,
        '-metadata', `artist="${escapeMetadata(metadata.author)}"`
      );

      if (metadata.narrator) {
        // For MP3, composer is also used for narrator
        args.push('-metadata', `composer="${escapeMetadata(metadata.narrator)}"`);
      }

      if (metadata.year) {
        args.push('-metadata', `date="${metadata.year}"`);
      }

      // Explicitly specify output format (fixes .tmp extension issue)
      args.push('-f', 'mp3');
    }

    // Output to temp file
    args.push(`"${tempFile}"`);

    // Execute ffmpeg command
    const command = args.join(' ');

    try {
      await execPromise(command, { timeout: 120000 }); // 2 minute timeout
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`ffmpeg failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // DO NOT replace original file - return temp file path instead
    // This preserves the original file for seeding
    return {
      success: true,
      filePath,
      taggedFilePath: tempFile,
    };
  } catch (error) {
    return {
      success: false,
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Tag multiple audio files with metadata
 */
export async function tagMultipleFiles(
  filePaths: string[],
  metadata: MetadataTaggingOptions
): Promise<TaggingResult[]> {
  const results: TaggingResult[] = [];

  for (const filePath of filePaths) {
    const result = await tagAudioFileMetadata(filePath, metadata);
    results.push(result);
  }

  return results;
}

/**
 * Escape metadata values for shell command
 * Removes quotes and special characters that could break the command
 */
function escapeMetadata(value: string): string {
  return value
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/'/g, "\\'") // Escape single quotes
    .replace(/`/g, '\\`') // Escape backticks
    .replace(/\$/g, '\\$') // Escape dollar signs
    .replace(/\\/g, '\\\\'); // Escape backslashes
}

/**
 * Check if ffmpeg is available
 */
export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execPromise('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}
